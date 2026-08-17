import { describe, expect, it, vi } from "vitest";
import type { OpdsAssetResponse } from "./opds-client";
import { createOpdsCoverCache, readOpdsCover } from "./opds-cover-cache";

function imageResponse(bytes: number[], headers: Record<string, string> = {}) {
  const response = new Response(Uint8Array.from(bytes), {
    headers: { "Content-Type": "image/png", ...headers },
  });
  return Object.assign(response, { cancel: vi.fn(async () => undefined) }) as OpdsAssetResponse;
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
