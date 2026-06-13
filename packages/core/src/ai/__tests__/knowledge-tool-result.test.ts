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
      toolName: "searchKnowledgeBase",
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
      path: "Knowledge base / Chapter Notes / Durable Memory",
      document: {
        id: "doc-1",
        title: "Durable Memory",
        type: "summary",
        path: "Knowledge base / Chapter Notes / Durable Memory",
      },
      reason: "stale",
      sourceChars: 12000,
      summaryMd: "## Summary\n\nA durable reading memory.",
    });

    expect(display).toMatchObject({
      kind: "summary",
      toolName: "compressKnowledgeDocumentSummary",
      status: "compressed",
      persisted: true,
      documentId: "doc-1",
      reason: "stale",
      sourceChars: 12000,
      summaryPreview: "Summary A durable reading memory.",
      documents: [
        {
          id: "doc-1",
          title: "Durable Memory",
          type: "summary",
          path: "Knowledge base / Chapter Notes / Durable Memory",
        },
      ],
    });
  });

  it("turns knowledge tool failures into explicit failure cards", () => {
    const display = getKnowledgeToolResultDisplay("proposeKnowledgeDocumentUpdate", {
      success: false,
      error: "Knowledge document not found",
      documentId: "missing-doc",
    });

    expect(display).toEqual({
      kind: "failure",
      toolName: "proposeKnowledgeDocumentUpdate",
      documentId: "missing-doc",
      error: "Knowledge document not found",
      documents: [],
    });
  });

  it("keeps knowledge document paths visible on tool failure cards", () => {
    const display = getKnowledgeToolResultDisplay("compressKnowledgeDocumentSummary", {
      success: false,
      status: "failed",
      error: "Model request failed",
      documentId: "doc-1",
      path: "Knowledge base / Chapter Notes / Durable Memory",
      document: {
        id: "doc-1",
        title: "Durable Memory",
        type: "summary",
        path: "Knowledge base / Chapter Notes / Durable Memory",
      },
    });

    expect(display).toEqual({
      kind: "failure",
      toolName: "compressKnowledgeDocumentSummary",
      status: "failed",
      documentId: "doc-1",
      error: "Model request failed",
      documents: [
        {
          id: "doc-1",
          title: "Durable Memory",
          type: "summary",
          path: "Knowledge base / Chapter Notes / Durable Memory",
        },
      ],
    });
  });

  it("parses JSON string failures from knowledge tools", () => {
    const display = getKnowledgeToolResultDisplay(
      "compressKnowledgeDocumentSummary",
      JSON.stringify({
        success: false,
        status: "failed",
        reason: "model_error",
        message: "Model request failed",
      }),
    );

    expect(display).toEqual({
      kind: "failure",
      toolName: "compressKnowledgeDocumentSummary",
      status: "failed",
      reason: "model_error",
      error: "Model request failed",
      documents: [],
    });
  });

  it("turns direct tool-call errors into knowledge failure cards", () => {
    const display = getKnowledgeToolResultDisplay("searchKnowledgeBase", undefined, {
      error: "Tool searchKnowledgeBase is not available",
    });

    expect(display).toEqual({
      kind: "failure",
      toolName: "searchKnowledgeBase",
      error: "Tool searchKnowledgeBase is not available",
      documents: [],
    });
  });

  it("keeps direct knowledge errors visible even when the raw result is malformed", () => {
    const display = getKnowledgeToolResultDisplay("getBookKnowledge", "not-json", {
      error: new Error("Bridge message failed"),
    });

    expect(display).toEqual({
      kind: "failure",
      toolName: "getBookKnowledge",
      error: "Bridge message failed",
      documents: [],
    });
  });

  it("lets successful knowledge proposals use the proposal card renderer", () => {
    expect(
      getKnowledgeToolResultDisplay("proposeKnowledgeDocumentCreate", {
        success: true,
        action: "create",
        requiresConfirmation: true,
      }),
    ).toBeNull();
  });

  it("ignores unrelated tools and malformed results", () => {
    expect(getKnowledgeToolResultDisplay("fallbackSearch", { hits: [] })).toBeNull();
    expect(
      getKnowledgeToolResultDisplay("fallbackSearch", undefined, { error: "No tool" }),
    ).toBeNull();
    expect(getKnowledgeToolResultDisplay("searchKnowledgeBase", "not-json")).toBeNull();
  });
});
