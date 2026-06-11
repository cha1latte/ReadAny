import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeDocument } from "../../types";

const dbMocks = vi.hoisted(() => ({
  getKnowledgeDocument: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  searchKnowledgeDocuments: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);

const {
  createGetBookKnowledgeTool,
  createProposeKnowledgeDocumentCreateTool,
  createProposeKnowledgeDocumentUpdateTool,
  createProposeKnowledgeLinkCreateTool,
  createSearchKnowledgeBaseTool,
} = await import("./knowledge-tools");

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
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([
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

    expect(dbMocks.searchKnowledgeDocuments).toHaveBeenCalledWith({
      query: "memory",
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

  it("creates confirmation-required drafts without saving knowledge documents", async () => {
    const tool = createProposeKnowledgeDocumentCreateTool();
    const result = (await tool.execute({
      reasoning: "User asked to save a summary",
      title: "Reading Summary",
      contentMd: "## Summary\nSlow reading helps memory.",
      type: "summary",
      bookId: "book-1",
      tags: '["reading","memory","reading"]',
    })) as {
      success: boolean;
      requiresConfirmation: boolean;
      draft: {
        title: string;
        type: string;
        bookId: string;
        tags: string[];
        contentMd: string;
        contentJson: { type: string };
        excerpt: string;
      };
    };

    expect(result.success).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.draft).toMatchObject({
      title: "Reading Summary",
      type: "summary",
      bookId: "book-1",
      tags: ["reading", "memory"],
      contentMd: "## Summary\nSlow reading helps memory.",
      contentJson: { type: "doc" },
      excerpt: "Summary Slow reading helps memory.",
    });
    expect(dbMocks.getKnowledgeDocument).not.toHaveBeenCalled();
    expect(dbMocks.getKnowledgeDocuments).not.toHaveBeenCalled();
  });

  it("creates confirmation-required update patches for existing knowledge documents", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(doc());

    const tool = createProposeKnowledgeDocumentUpdateTool();
    const result = (await tool.execute({
      reasoning: "User asked to refine the note",
      documentId: "doc-1",
      title: "Deep Reading Notes",
      contentMd: "Updated durable note.",
      tags: "reading, reflection",
    })) as {
      success: boolean;
      requiresConfirmation: boolean;
      documentId: string;
      patch: {
        title?: string;
        contentMd?: string;
        contentJson?: { type: string };
        tags?: string[];
      };
      changedFields: string[];
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("doc-1");
    expect(result.success).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.documentId).toBe("doc-1");
    expect(result.patch).toMatchObject({
      title: "Deep Reading Notes",
      contentMd: "Updated durable note.",
      contentJson: { type: "doc" },
      tags: ["reading", "reflection"],
    });
    expect(result.changedFields).toEqual(["title", "contentMd", "contentJson", "excerpt", "tags"]);
  });

  it("does not create an update proposal when nothing changes", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(doc());

    const tool = createProposeKnowledgeDocumentUpdateTool();
    const result = (await tool.execute({
      reasoning: "Check no-op",
      documentId: "doc-1",
      title: "Deep Reading Home",
      contentMd: "Reading slowly helps memory and reflection.",
      tags: '["reading","memory"]',
    })) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe("No changes were proposed");
  });

  it("creates confirmation-required link proposals without saving links", async () => {
    dbMocks.getKnowledgeDocument
      .mockResolvedValueOnce(doc({ id: "doc-1" }))
      .mockResolvedValueOnce(doc({ id: "doc-2", title: "Related Idea" }));

    const tool = createProposeKnowledgeLinkCreateTool();
    const result = (await tool.execute({
      reasoning: "User wants to connect related notes",
      fromDocumentId: "doc-1",
      toKind: "document",
      toId: "doc-2",
      relation: "related",
      label: "Related idea",
    })) as {
      success: boolean;
      requiresConfirmation: boolean;
      action: string;
      confirmationKind: string;
      link: {
        fromDocumentId: string;
        toKind: string;
        toId: string;
        relation: string;
        label: string;
      };
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenNthCalledWith(1, "doc-1");
    expect(dbMocks.getKnowledgeDocument).toHaveBeenNthCalledWith(2, "doc-2");
    expect(result).toMatchObject({
      success: true,
      requiresConfirmation: true,
      action: "link",
      confirmationKind: "knowledge_link_create",
      link: {
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        label: "Related idea",
      },
    });
  });
});
