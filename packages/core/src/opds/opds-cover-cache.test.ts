import { describe, expect, it, vi } from "vitest";
import type { OpdsAssetResponse } from "./opds-client";
import { createOpdsCoverCache, readOpdsCover } from "./opds-cover-cache";

function imageResponse(bytes: number[], headers: Record<string, string> = {}) {
  const response = new Response(Uint8Array.from(bytes), {
    headers: { "Content-Type": "image/png", ...headers },
  });
  return Object.assign(response, { cancel: vi.fn(async () => undefined) }) as OpdsAssetResponse;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("shared OPDS cover cache", () => {
  it("deduplicates in-flight authenticated image reads", async () => {
    const load = vi.fn(async () => ({ uri: "data:image/png;base64,AQ==", byteLength: 1 }));
    const cache = createOpdsCoverCache({ load, maxEntries: 2, maxBytes: 10 });

    const [first, second] = await Promise.all([cache.acquire("cover"), cache.acquire("cover")]);

    expect(load).toHaveBeenCalledTimes(1);
    first.release();
    second.release();
  });

  it("evicts the least recently used released cover within entry and byte bounds", async () => {
    const cache = createOpdsCoverCache({
      load: async (url) => ({ uri: url, byteLength: 4 }),
      maxEntries: 1,
      maxBytes: 4,
    });
    (await cache.acquire("first")).release();
    (await cache.acquire("second")).release();

    expect(cache.snapshot()).toEqual({ entries: 1, sourceBytes: 4, urls: ["second"] });
  });

  it("never admits beyond entry or byte bounds while every cached cover is leased", async () => {
    const cache = createOpdsCoverCache({
      load: async (url) => ({ uri: url, byteLength: 2 }),
      maxEntries: 12,
      maxBytes: 24,
    });
    const leases = [];
    for (let index = 0; index < 20; index += 1) {
      leases.push(await cache.acquire(`cover-${index}`));
      const snapshot = cache.snapshot();
      expect(snapshot.entries).toBeLessThanOrEqual(12);
      expect(snapshot.sourceBytes).toBeLessThanOrEqual(24);
    }

    expect(cache.snapshot()).toMatchObject({ entries: 12, sourceBytes: 24 });
    for (const lease of leases) lease.release();
  });

  it("caps concurrent distinct loads", async () => {
    const gate = deferred();
    let active = 0;
    let maximumActive = 0;
    const cache = createOpdsCoverCache({
      load: async (url) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await gate.promise;
        active -= 1;
        return { uri: url, byteLength: 1 };
      },
      maxEntries: 12,
      maxBytes: 24,
      maxConcurrentLoads: 3,
    });

    const pending = Array.from({ length: 20 }, (_, index) => cache.acquire(`cover-${index}`));
    await Promise.resolve();
    expect(maximumActive).toBe(3);
    gate.resolve();
    const leases = await Promise.all(pending);
    expect(maximumActive).toBe(3);
    for (const lease of leases) lease.release();
  });

  it("rejects a streamed non-image or oversized cover and cancels transport", async () => {
    const wrongType = imageResponse([1], { "Content-Type": "text/html" });
    await expect(readOpdsCover(wrongType, new AbortController().signal, 4)).rejects.toThrow(
      "not-an-image",
    );
    expect(wrongType.cancel).toHaveBeenCalledWith("not-an-image");

    const tooLarge = imageResponse([1, 2, 3, 4, 5]);
    await expect(readOpdsCover(tooLarge, new AbortController().signal, 4)).rejects.toThrow(
      "cover-too-large",
    );
    expect(tooLarge.cancel).toHaveBeenCalledWith("cover-too-large");
  });
});
