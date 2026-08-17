import { describe, expect, it, vi } from "vitest";
import { MOBI } from "../../../../foliate-js/mobi.js";
import { BookExtractionError } from "./extractor-error";
import { runVectorizeQueueJob } from "./vectorize-queue-job";

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index++) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function createProtectedMobiFile(): Blob {
  const bytes = new Uint8Array(512);
  const view = new DataView(bytes.buffer);
  const recordOffset = 86;

  writeAscii(bytes, 60, "BOOKMOBI");
  view.setUint16(76, 1);
  view.setUint32(78, recordOffset);
  view.setUint16(recordOffset, 1);
  view.setUint16(recordOffset + 12, 1);
  writeAscii(bytes, recordOffset + 16, "MOBI");
  view.setUint32(recordOffset + 20, 232);
  view.setUint32(recordOffset + 28, 65001);
  view.setUint32(recordOffset + 36, 6);

  return new Blob([bytes], { type: "application/x-mobipocket-ebook" });
}

describe("runVectorizeQueueJob", () => {
  it("routes a real protected MOBI parser failure through cleanup without vectorizing", async () => {
    const order: string[] = [];
    const vectorize = vi.fn();
    const parser = new MOBI({ unzlib: (value: Uint8Array) => value });

    const result = await runVectorizeQueueJob({
      format: "mobi",
      extract: async () => (await parser.open(createProtectedMobiFile())) as never,
      vectorize,
      cleanup: async () => {
        order.push("cleanup");
      },
      onEvent: (event) => order.push(event.status),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected protected extraction to fail");
    expect(result.error).toBeInstanceOf(BookExtractionError);
    expect(result.error).toMatchObject({ category: "drm-protected" });
    expect(order).toEqual(["extracting", "cleanup", "error"]);
    expect(vectorize).not.toHaveBeenCalled();
  });

  it.each(["manual", "automatic"])(
    "classifies raw parser failures at the shared %s queue boundary",
    async () => {
      const order: string[] = [];

      const result = await runVectorizeQueueJob({
        format: "azw3",
        extract: async () => {
          throw new Error("Invalid HUFF record");
        },
        vectorize: vi.fn(),
        cleanup: async () => {
          order.push("cleanup");
        },
        onEvent: (event) => order.push(event.status),
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected parser failure");
      expect(result.error).toMatchObject({ category: "malformed" });
      expect(order).toEqual(["extracting", "cleanup", "error"]);
    },
  );

  it("treats unmount cancellation as an extraction rejection and never completes", async () => {
    const statuses: string[] = [];
    const cleanup = vi.fn().mockResolvedValue(undefined);

    const result = await runVectorizeQueueJob({
      format: "mobi",
      extract: async () => {
        throw new Error("Extractor WebView unmounted");
      },
      vectorize: vi.fn(),
      cleanup,
      onEvent: (event) => statuses.push(event.status),
    });

    expect(result.ok).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(statuses).toEqual(["extracting", "error"]);
    expect(statuses).not.toContain("completed");
  });

  it("publishes error only after a rejected cleanup attempt", async () => {
    const order: string[] = [];
    const cleanupError = new Error("cleanup failed");

    const result = await runVectorizeQueueJob({
      format: "mobi",
      extract: async () => {
        throw new Error("loader failed");
      },
      vectorize: vi.fn(),
      cleanup: async () => {
        order.push("cleanup");
        throw cleanupError;
      },
      onEvent: (event) => order.push(event.status),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected extraction failure");
    expect(result.cleanupError).toBe(cleanupError);
    expect(order).toEqual(["extracting", "cleanup", "error"]);
  });

  it("cleans up a final state-write rejection without publishing completion", async () => {
    const statuses: string[] = [];
    const cleanup = vi.fn().mockResolvedValue(undefined);

    const result = await runVectorizeQueueJob({
      format: "mobi",
      extract: async () => [{ index: 0, title: "Chapter", content: "text", segments: [] }],
      vectorize: async (_chapters, onProgress) => {
        onProgress?.({ status: "completed" });
        throw new Error("failed to persist vectorized state");
      },
      cleanup,
      onEvent: (event) => statuses.push(event.status),
    });

    expect(result.ok).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(statuses).toEqual(["extracting", "vectorizing", "error"]);
    expect(statuses).not.toContain("completed");
  });
});
