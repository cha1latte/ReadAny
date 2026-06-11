import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig, KnowledgeDocument } from "../../types";

const dbMocks = vi.hoisted(() => ({
  getKnowledgeDocument: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  searchKnowledgeDocuments: vi.fn(),
}));
const knowledgeMemoryMocks = vi.hoisted(() => ({
  maybeCompressAndPersistKnowledgeSummary: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);
vi.mock("../knowledge-memory", () => knowledgeMemoryMocks);

const {
  createCompressKnowledgeDocumentSummaryTool,
  createGetBookKnowledgeTool,
  createProposeKnowledgeDocumentCreateTool,
  createProposeKnowledgeDocumentUpdateTool,
  createProposeKnowledgeLinkCreateTool,
  createSearchKnowledgeBaseTool,
} = await import("./knowledge-tools");

function aiConfig(): AIConfig {
  return {
    endpoints: [
      {
        id: "endpoint-1",
        name: "Mock",
        provider: "custom",
        apiKey: "",
        baseUrl: "https://example.com/v1",
        models: ["mock-model"],
        modelsFetched: true,
      },
    ],
    activeEndpointId: "endpoint-1",
    activeModel: "mock-model",
    temperature: 0.7,
    maxTokens: 1000,
    slidingWindowSize: 8,
  };
}

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
    knowledgeMemoryMocks.maybeCompressAndPersistKnowledgeSummary.mockResolvedValue({
      status: "compressed",
      persisted: true,
      summaryMd: "## Durable memory\n- Read slowly.",
      plan: {
        shouldCompress: true,
        reason: "missing_summary",
        sourceFingerprint: "hash-1",
        sourceUpdatedAt: 2000,
        sourceChars: 4000,
        maxSummaryChars: 2400,
      },
      state: {
        summaryMd: "## Durable memory\n- Read slowly.",
        sourceFingerprint: "hash-1",
        sourceUpdatedAt: 2000,
        compressedAt: 3000,
      },
    });
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

  it("scores and returns compact summaries in knowledge search results", async () => {
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([
      doc({
        id: "doc-summary",
        title: "Untitled",
        excerpt: undefined,
        contentMd: "Long body without the key term.",
        summaryMd: "Vector memory: durable insight about context windows.",
        tags: [],
      }),
    ]);

    const tool = createSearchKnowledgeBaseTool();
    const result = (await tool.execute({
      reasoning: "Need compact knowledge",
      query: "vector",
    })) as {
      total: number;
      documents: Array<{ id: string; parentId?: string; summary?: string; snippet: string }>;
    };

    expect(result.total).toBe(1);
    expect(result.documents[0]).toMatchObject({
      id: "doc-summary",
      parentId: undefined,
      summary: "Vector memory: durable insight about context windows.",
      snippet: "Vector memory: durable insight about context windows.",
    });
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

  it("compresses and persists derived knowledge summaries without changing content", async () => {
    const source = doc({ id: "doc-long", contentMd: "Long durable note.".repeat(300) });
    dbMocks.getKnowledgeDocument.mockResolvedValue(source);

    const tool = createCompressKnowledgeDocumentSummaryTool(aiConfig());
    const result = (await tool.execute({
      reasoning: "Need compact memory for retrieval",
      documentId: "doc-long",
      minSourceChars: 100,
      maxSummaryChars: 500,
    })) as {
      success: boolean;
      status: string;
      persisted: boolean;
      documentId: string;
      reason: string;
      sourceChars: number;
      summaryMd: string;
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("doc-long");
    expect(knowledgeMemoryMocks.maybeCompressAndPersistKnowledgeSummary).toHaveBeenCalledWith(
      source,
      expect.objectContaining({ activeModel: "mock-model" }),
      { minSourceChars: 100, maxSummaryChars: 500 },
    );
    expect(result).toMatchObject({
      success: true,
      status: "compressed",
      persisted: true,
      documentId: "doc-long",
      reason: "missing_summary",
      sourceChars: 4000,
      summaryMd: "## Durable memory\n- Read slowly.",
    });
  });

  it("creates confirmation-required drafts without saving knowledge documents", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(
      doc({ id: "folder-1", type: "folder", title: "Folder" }),
    );

    const tool = createProposeKnowledgeDocumentCreateTool();
    const result = (await tool.execute({
      reasoning: "User asked to save a summary",
      title: "Reading Summary",
      contentMd: "## Summary\nSlow reading helps memory.",
      type: "summary",
      bookId: "book-1",
      parentId: "folder-1",
      tags: '["reading","memory","reading"]',
    })) as {
      success: boolean;
      requiresConfirmation: boolean;
      draft: {
        title: string;
        type: string;
        bookId: string;
        parentId?: string;
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
      parentId: "folder-1",
      tags: ["reading", "memory"],
      contentMd: "## Summary\nSlow reading helps memory.",
      contentJson: { type: "doc" },
      excerpt: "Summary Slow reading helps memory.",
    });
    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("folder-1");
    expect(dbMocks.getKnowledgeDocuments).not.toHaveBeenCalled();
  });

  it("rejects create drafts under missing or non-folder parents", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValueOnce(null);

    const tool = createProposeKnowledgeDocumentCreateTool();
    await expect(
      tool.execute({
        reasoning: "Create in a folder",
        title: "Bad child",
        contentMd: "Body",
        parentId: "missing-folder",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Invalid parentId: missing_parent",
    });

    dbMocks.getKnowledgeDocument.mockResolvedValueOnce(doc({ id: "doc-parent" }));
    await expect(
      tool.execute({
        reasoning: "Create in a document",
        title: "Bad child",
        contentMd: "Body",
        parentId: "doc-parent",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Invalid parentId: parent_not_folder",
    });
  });

  it("inherits the book id from the parent folder when creating drafts", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(
      doc({ id: "folder-1", type: "folder", bookId: "book-9" }),
    );

    const tool = createProposeKnowledgeDocumentCreateTool();
    const result = (await tool.execute({
      reasoning: "Create in the active folder",
      title: "Folder Child",
      contentMd: "Body",
      parentId: "folder-1",
    })) as { success: boolean; draft: { bookId?: string; parentId?: string } };

    expect(result).toMatchObject({
      success: true,
      draft: {
        bookId: "book-9",
        parentId: "folder-1",
      },
    });
  });

  it("creates confirmation-required update patches for existing knowledge documents", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(doc({ type: "standalone_note" }));
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({ type: "standalone_note" }),
      doc({ id: "folder-1", type: "folder", title: "Target Folder" }),
    ]);

    const tool = createProposeKnowledgeDocumentUpdateTool();
    const result = (await tool.execute({
      reasoning: "User asked to refine the note",
      documentId: "doc-1",
      parentId: "folder-1",
      title: "Deep Reading Notes",
      contentMd: "Updated durable note.",
      tags: "reading, reflection",
    })) as {
      success: boolean;
      requiresConfirmation: boolean;
      documentId: string;
      patch: {
        parentId?: string;
        title?: string;
        contentMd?: string;
        contentJson?: { type: string };
        tags?: string[];
      };
      changedFields: string[];
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("doc-1");
    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
    expect(result.success).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.documentId).toBe("doc-1");
    expect(result.patch).toMatchObject({
      parentId: "folder-1",
      title: "Deep Reading Notes",
      contentMd: "Updated durable note.",
      contentJson: { type: "doc" },
      tags: ["reading", "reflection"],
    });
    expect(result.changedFields).toEqual([
      "parentId",
      "title",
      "contentMd",
      "contentJson",
      "excerpt",
      "tags",
    ]);
  });

  it("rejects update patches that move documents into invalid parents", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(doc({ type: "standalone_note" }));
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({ type: "standalone_note" }),
      doc({ id: "not-folder", type: "summary", title: "Not Folder" }),
    ]);

    const tool = createProposeKnowledgeDocumentUpdateTool();
    const result = (await tool.execute({
      reasoning: "Move to a target",
      documentId: "doc-1",
      parentId: "not-folder",
    })) as { success: boolean; error: string; documentId: string };

    expect(result).toEqual({
      success: false,
      error: "Invalid parentId: parent_not_folder",
      documentId: "doc-1",
    });
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
