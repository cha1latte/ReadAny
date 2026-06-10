import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeDocument } from "../../types";

const dbMocks = vi.hoisted(() => ({
  getKnowledgeDocuments: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);

const { createGetBookKnowledgeTool, createSearchKnowledgeBaseTool } = await import(
  "./knowledge-tools"
);

function doc(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "book_home",
    title: "Deep Reading Home",
    contentJson: { type: "doc", content: [] },
    contentMd: "Reading slowly helps memory and reflection.",
    contentSchemaVersion: 1,
    excerpt: "Reading slowly helps memory.",
    tags: ["reading", "memory"],
    sourceKind: "book",
    sourceId: "book-1",
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe("knowledge tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches knowledge documents by title, tags, excerpt, and content", async () => {
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({ id: "doc-1", title: "Deep Reading Home", updatedAt: 3000 }),
      doc({
        id: "doc-2",
        title: "Cooking",
        contentMd: "Nothing about reading here.",
        excerpt: "Kitchen notes.",
        tags: ["food"],
        updatedAt: 1000,
      }),
      doc({
        id: "doc-3",
        title: "Memory",
        contentMd: "Spaced repetition.",
        excerpt: "Memory note.",
        tags: ["memory"],
        updatedAt: 2000,
      }),
    ]);

    const tool = createSearchKnowledgeBaseTool();
    const result = (await tool.execute({
      reasoning: "Need user knowledge",
      query: "memory",
      bookId: "book-1",
      limit: 2,
    })) as { total: number; showing: number; documents: Array<{ id: string; snippet: string }> };

    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({
      bookId: "book-1",
      type: undefined,
      limit: 200,
    });
    expect(result.total).toBe(2);
    expect(result.showing).toBe(2);
    expect(result.documents.map((item) => item.id)).toEqual(["doc-3", "doc-1"]);
    expect(result.documents[0].snippet).toContain("Memory note");
  });

  it("returns current book knowledge and can include full content", async () => {
    dbMocks.getKnowledgeDocuments.mockResolvedValue([doc()]);

    const tool = createGetBookKnowledgeTool("book-1");
    const result = (await tool.execute({
      reasoning: "Need the user's book notes",
      includeContent: true,
      type: "book_home",
    })) as {
      bookId: string;
      documents: Array<{ id: string; content?: string; snippet: string }>;
    };

    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({
      bookId: "book-1",
      type: "book_home",
      limit: 8,
    });
    expect(result.bookId).toBe("book-1");
    expect(result.documents[0]).toMatchObject({
      id: "doc-1",
      content: "Reading slowly helps memory and reflection.",
      snippet: "Reading slowly helps memory.",
    });
  });
});
