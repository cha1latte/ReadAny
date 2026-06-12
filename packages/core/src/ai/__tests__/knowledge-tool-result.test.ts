import { describe, expect, it } from "vitest";
import { getKnowledgeToolResultDisplay } from "../knowledge-tool-result";

describe("knowledge tool result display", () => {
  it("summarizes knowledge search results without exposing raw tool JSON", () => {
    const display = getKnowledgeToolResultDisplay("searchKnowledgeBase", {
      total: 2,
      showing: 1,
      documents: [
        {
          id: "doc-1",
          title: "Chapter Notes",
          type: "standalone_note",
          path: "Knowledge base / Chapter Notes",
          snippet: "A useful theme note",
          childCount: 0,
        },
      ],
    });

    expect(display).toEqual({
      kind: "search",
      total: 2,
      showing: 1,
      documents: [
        {
          id: "doc-1",
          title: "Chapter Notes",
          type: "standalone_note",
          path: "Knowledge base / Chapter Notes",
          snippet: "A useful theme note",
          childCount: 0,
        },
      ],
    });
  });

  it("summarizes current-book knowledge reads", () => {
    const display = getKnowledgeToolResultDisplay("getBookKnowledge", {
      bookId: "book-1",
      total: 1,
      documents: [
        {
          id: "home-1",
          title: "Book Home",
          type: "book_home",
          summary: "Compact memory",
        },
      ],
    });

    expect(display?.kind).toBe("bookKnowledge");
    expect(display?.bookId).toBe("book-1");
    expect(display?.documents[0]?.snippet).toBe("Compact memory");
  });

  it("summarizes compact-memory updates", () => {
    const display = getKnowledgeToolResultDisplay("compressKnowledgeDocumentSummary", {
      success: true,
      status: "compressed",
      persisted: true,
      documentId: "doc-1",
      reason: "stale",
      sourceChars: 12000,
      summaryMd: "## Summary\n\nA durable reading memory.",
    });

    expect(display).toMatchObject({
      kind: "summary",
      status: "compressed",
      persisted: true,
      documentId: "doc-1",
      reason: "stale",
      sourceChars: 12000,
      summaryPreview: "Summary A durable reading memory.",
      documents: [],
    });
  });

  it("ignores unrelated tools and malformed results", () => {
    expect(getKnowledgeToolResultDisplay("fallbackSearch", { hits: [] })).toBeNull();
    expect(getKnowledgeToolResultDisplay("searchKnowledgeBase", "not-json")).toBeNull();
  });
});
