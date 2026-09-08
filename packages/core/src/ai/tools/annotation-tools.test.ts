import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getChunks: vi.fn(),
  getHighlights: vi.fn(),
  getNotes: vi.fn(),
  fallback: vi.fn(),
}));
vi.mock("../../db/database", () => mocks);
vi.mock("../fallback-source-resolver", () => ({ resolveFallbackCitationSource: mocks.fallback }));
import { createAddCitationTool, createGetAnnotationsTool } from "./annotation-tools";
beforeEach(() => {
  vi.resetAllMocks();
});

it.each([
  ["Chapter 01", "Chapter 1"],
  ["Chapter 1", "Chapter 01"],
])("matches %s when querying %s", async (stored, query) => {
  mocks.getHighlights.mockResolvedValue([{ text: "quote", color: "yellow", chapterTitle: stored }]);
  const result = (await createGetAnnotationsTool("book").execute({
    type: "highlights",
    chapterTitle: query,
  })) as { highlights: unknown[] };
  expect(result.highlights).toHaveLength(1);
});

it("resolves a source after indexed lookup throws instead of trusting the supplied CFI", async () => {
  mocks.getChunks.mockRejectedValue(new Error("database unavailable"));
  mocks.fallback.mockResolvedValue(null);
  const result = (await createAddCitationTool("book").execute({
    citationIndex: 1,
    chapterTitle: "Chapter 1",
    chapterIndex: 0,
    cfi: "stale",
    quotedText: "quote",
  })) as { error?: string };
  expect(mocks.fallback).toHaveBeenCalled();
  expect(result.error).toBeTruthy();
});
