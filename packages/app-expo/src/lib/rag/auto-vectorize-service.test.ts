import type { Book } from "@readany/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const vectorizeMocks = vi.hoisted(() => ({
  resetBookVectorization: vi.fn(),
  triggerVectorizeBook: vi.fn(),
}));

vi.mock("./vectorize-trigger", () => vectorizeMocks);

import { isProcessing, queueBook, setCallback, setExtractorRef } from "./auto-vectorize-service";

const book: Book = {
  id: "book-1",
  filePath: "books/protected.mobi",
  format: "mobi",
  meta: { title: "Protected book", author: "Author" },
  addedAt: 1,
  updatedAt: 1,
  progress: 0,
  isVectorized: true,
  vectorizeProgress: 1,
  tags: [],
  syncStatus: "local",
};

afterEach(() => {
  setExtractorRef(null);
  setCallback(null);
  vi.clearAllMocks();
});

describe("automatic vectorization failure lifecycle", () => {
  it("cleans the book before publishing a classified extraction error", async () => {
    const events: string[] = [];
    vectorizeMocks.resetBookVectorization.mockImplementation(async () => {
      events.push("cleanup");
    });
    setExtractorRef({
      extractChapters: vi.fn().mockRejectedValue(new Error("Encrypted MOBI records")),
    });

    const errorPublished = new Promise<void>((resolve) => {
      setCallback((_bookId, progress) => {
        if (progress.status === "error") {
          events.push(`error:${progress.errorCategory}`);
          resolve();
        }
      });
    });

    await queueBook(book, "base64", "application/x-mobipocket-ebook");
    await errorPublished;

    expect(events).toEqual(["cleanup", "error:drm-protected"]);
    expect(vectorizeMocks.triggerVectorizeBook).not.toHaveBeenCalled();
  });

  it("publishes the failure and releases the queue if cleanup itself rejects", async () => {
    vectorizeMocks.resetBookVectorization.mockRejectedValueOnce(new Error("cleanup failed"));
    setExtractorRef({
      extractChapters: vi.fn().mockRejectedValue(new Error("loader failed")),
    });
    const callback = vi.fn();
    setCallback(callback);

    await queueBook(book, "base64", "application/x-mobipocket-ebook");

    await vi.waitFor(() => {
      expect(callback).toHaveBeenCalledWith("book-1", {
        status: "error",
        progress: 0,
        errorCategory: "unknown",
      });
      expect(isProcessing()).toBe(false);
    });
  });
});
