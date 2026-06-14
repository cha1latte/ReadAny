import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig, KnowledgeDocument } from "../../types";

const dbMocks = vi.hoisted(() => ({
  createKnowledgeDocument: vi.fn(),
  getKnowledgeBacklinks: vi.fn(),
  getKnowledgeDocument: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  getKnowledgeLinks: vi.fn(),
  insertKnowledgeLink: vi.fn(),
  searchKnowledgeDocuments: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}));
const knowledgeMemoryMocks = vi.hoisted(() => ({
  maybeCompressAndPersistKnowledgeSummary: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);
vi.mock("../knowledge-memory", () => knowledgeMemoryMocks);

const {
  createCompressKnowledgeDocumentSummaryTool,
  createGetBookKnowledgeTool,
  createGetKnowledgeDocumentTool,
  createProposeKnowledgeDocumentCreateTool,
  createProposeKnowledgeDocumentTagsUpdateTool,
  createProposeKnowledgeDocumentUpdateTool,
  createProposeKnowledgeLinkCreateTool,
  createSearchKnowledgeBaseTool,
} = await import("./knowledge-tools");
const {
  applyKnowledgeWriteProposal,
  createKnowledgeWriteProposalPreview,
  getKnowledgeWriteProposal,
} = await import("../../knowledge/proposals");

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
    dbMocks.getKnowledgeDocuments.mockResolvedValue([]);
    dbMocks.getKnowledgeLinks.mockResolvedValue([]);
    dbMocks.getKnowledgeBacklinks.mockResolvedValue([]);
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
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Chapter Notes",
      contentMd: "",
      excerpt: undefined,
      tags: [],
      updatedAt: 4000,
    });
    const home = doc({ id: "doc-1", title: "Deep Reading Home", updatedAt: 3000 });
    const cooking = doc({
      id: "doc-2",
      title: "Cooking",
      contentMd: "Nothing about reading here.",
      excerpt: "Kitchen notes.",
      tags: ["food"],
      updatedAt: 1000,
    });
    const memory = doc({
      id: "doc-3",
      title: "Memory",
      parentId: "folder-1",
      contentMd: "Spaced repetition.",
      excerpt: "Memory note.",
      tags: ["memory"],
      updatedAt: 2000,
    });
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([home, cooking, memory]);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, home, cooking, memory]);

    const tool = createSearchKnowledgeBaseTool();
    const result = (await tool.execute({
      reasoning: "Need user knowledge",
      query: "memory",
      bookId: "book-1",
      limit: 2,
    })) as {
      total: number;
      showing: number;
      documents: Array<{
        id: string;
        parentTitle?: string;
        path: string;
        snippet: string;
        childCount: number;
      }>;
    };

    expect(dbMocks.searchKnowledgeDocuments).toHaveBeenCalledWith({
      query: "memory",
      bookId: "book-1",
      type: undefined,
      limit: 200,
    });
    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
    expect(result.total).toBe(2);
    expect(result.showing).toBe(2);
    expect(result.documents.map((item) => item.id)).toEqual(["doc-3", "doc-1"]);
    expect(result.documents[0].parentTitle).toBe("Chapter Notes");
    expect(result.documents[0].path).toBe("Knowledge base / Chapter Notes / Memory");
    expect(result.documents[0].snippet).toContain("Memory note");
    expect(result.documents[0].childCount).toBe(0);
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
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
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
      documents: Array<{
        id: string;
        parentId?: string;
        path: string;
        summary?: string;
        snippet: string;
      }>;
    };

    expect(result.total).toBe(1);
    expect(result.documents[0]).toMatchObject({
      id: "doc-summary",
      parentId: undefined,
      path: "Knowledge base / Untitled",
      summary: "Vector memory: durable insight about context windows.",
      snippet: "Vector memory: durable insight about context windows.",
    });
  });

  it("finds documents by vault folder path when database search misses the path", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Chapter Notes",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const child = doc({
      id: "doc-child",
      type: "standalone_note",
      title: "Opening Question",
      parentId: "folder-1",
      contentMd: "Why does the argument begin this way?",
      excerpt: "Opening question.",
      tags: [],
    });
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([]);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, child]);

    const tool = createSearchKnowledgeBaseTool();
    const result = (await tool.execute({
      reasoning: "Find notes under a folder",
      query: "chapter notes",
      bookId: "book-1",
      type: "standalone_note",
    })) as {
      total: number;
      documents: Array<{ id: string; path: string }>;
    };

    expect(result.total).toBe(1);
    expect(result.documents).toEqual([
      {
        id: "doc-child",
        bookId: "book-1",
        parentId: "folder-1",
        parentTitle: "Chapter Notes",
        path: "Knowledge base / Chapter Notes / Opening Question",
        type: "standalone_note",
        isFolder: false,
        title: "Opening Question",
        tags: [],
        excerpt: "Opening question.",
        summary: undefined,
        snippet: "Opening question.",
        childCount: 0,
        children: [],
        updatedAt: 2000,
        content: undefined,
      },
    ]);
  });

  it("marks orphaned knowledge paths in search results", async () => {
    const orphan = doc({
      id: "doc-orphan",
      title: "Loose Idea",
      parentId: "missing-folder",
      contentMd: "A loose idea that survived sync.",
      excerpt: "Loose idea.",
      tags: [],
    });
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([orphan]);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([orphan]);

    const tool = createSearchKnowledgeBaseTool();
    const result = (await tool.execute({
      reasoning: "Find loose knowledge",
      query: "loose",
      bookId: "book-1",
    })) as {
      documents: Array<{ id: string; path: string }>;
    };

    expect(result.documents[0]).toMatchObject({
      id: "doc-orphan",
      path: "Knowledge base / Orphaned / Loose Idea",
    });
  });

  it("returns current book knowledge and can include full content", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Reading Journal",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const nestedNote = doc({
      id: "doc-1",
      type: "standalone_note",
      parentId: "folder-1",
    });
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, nestedNote]);

    const tool = createGetBookKnowledgeTool("book-1");
    const result = (await tool.execute({
      reasoning: "Need the user's book notes",
      includeContent: true,
      type: "standalone_note",
    })) as {
      bookId: string;
      total: number;
      showing: number;
      documents: Array<{ id: string; path: string; content?: string; snippet: string }>;
    };

    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
    expect(result.bookId).toBe("book-1");
    expect(result.total).toBe(1);
    expect(result.showing).toBe(1);
    expect(result.documents[0]).toMatchObject({
      id: "doc-1",
      parentTitle: "Reading Journal",
      path: "Knowledge base / Reading Journal / Deep Reading Home",
      content: "Reading slowly helps memory and reflection.",
      snippet: "Reading slowly helps memory.",
      childCount: 0,
    });
  });

  it("prioritizes book home and compact memories for current book knowledge", async () => {
    const recentScratch = doc({
      id: "scratch-1",
      title: "Recent Scratch",
      type: "standalone_note",
      excerpt: "Tiny recent note.",
      updatedAt: 9000,
    });
    const summary = doc({
      id: "summary-1",
      title: "Durable Summary",
      type: "summary",
      summaryMd: "Durable memory about the whole book.",
      updatedAt: 2000,
    });
    const home = doc({
      id: "home-1",
      title: "Book Home",
      type: "book_home",
      contentMd: "Book-level workspace.",
      updatedAt: 1000,
    });
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Folder Only",
      contentMd: "",
      excerpt: undefined,
      updatedAt: 10,
    });
    dbMocks.getKnowledgeDocuments.mockResolvedValue([recentScratch, folder, summary, home]);

    const tool = createGetBookKnowledgeTool("book-1");
    const result = (await tool.execute({
      reasoning: "Need high-level knowledge",
      limit: 2,
    })) as { total: number; showing: number; documents: Array<{ id: string; summary?: string }> };

    expect(result.total).toBe(3);
    expect(result.showing).toBe(2);
    expect(result.documents.map((document) => document.id)).toEqual(["home-1", "summary-1"]);
    expect(result.documents[1].summary).toBe("Durable memory about the whole book.");
  });

  it("returns direct children for folder knowledge results", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Reading Journal",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const nestedNote = doc({
      id: "doc-child",
      type: "standalone_note",
      title: "Chapter 1",
      parentId: "folder-1",
      updatedAt: 3000,
    });
    const nestedFolder = doc({
      id: "folder-child",
      type: "folder",
      title: "Themes",
      parentId: "folder-1",
      contentMd: "",
      excerpt: undefined,
      tags: [],
      updatedAt: 4000,
    });
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, nestedNote, nestedFolder]);

    const tool = createGetBookKnowledgeTool("book-1");
    const result = (await tool.execute({
      reasoning: "Need folder context",
      type: "folder",
      limit: 1,
    })) as {
      total: number;
      showing: number;
      documents: Array<{
        id: string;
        isFolder: boolean;
        childCount: number;
        children: Array<{ id: string; title: string; type: string; path: string }>;
      }>;
    };

    expect(result.total).toBe(2);
    expect(result.showing).toBe(1);
    expect(result.documents[0]).toMatchObject({
      id: "folder-1",
      isFolder: true,
      childCount: 2,
      children: [
        {
          id: "folder-child",
          title: "Themes",
          type: "folder",
          path: "Knowledge base / Reading Journal / Themes",
        },
        {
          id: "doc-child",
          title: "Chapter 1",
          type: "standalone_note",
          path: "Knowledge base / Reading Journal / Chapter 1",
        },
      ],
    });
  });

  it("reads one exact knowledge document by stable id with path context", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Reading Journal",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const child = doc({
      id: "doc-1",
      type: "standalone_note",
      title: "Chapter 1",
      parentId: "folder-1",
      contentMd: "Full durable note content.",
      excerpt: "Durable note.",
      tags: ["theme"],
    });
    const nested = doc({
      id: "doc-child",
      type: "summary",
      title: "Nested summary",
      parentId: "doc-1",
      updatedAt: 3000,
    });
    const related = doc({
      id: "doc-related",
      type: "standalone_note",
      title: "Related Idea",
      parentId: "folder-1",
      updatedAt: 2500,
    });
    const backlinkSource = doc({
      id: "doc-source",
      type: "standalone_note",
      title: "Earlier Observation",
      parentId: "folder-1",
      updatedAt: 2400,
    });
    dbMocks.getKnowledgeDocument.mockResolvedValue(child);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      folder,
      child,
      nested,
      related,
      backlinkSource,
    ]);
    dbMocks.getKnowledgeLinks.mockResolvedValue([
      {
        id: "link-out",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-related",
        relation: "related",
        label: "Compare with",
        createdAt: 2100,
        updatedAt: 2100,
      },
    ]);
    dbMocks.getKnowledgeBacklinks.mockResolvedValue([
      {
        link: {
          id: "link-back",
          fromDocumentId: "doc-source",
          toKind: "document",
          toId: "doc-1",
          relation: "references",
          createdAt: 2200,
          updatedAt: 2200,
        },
        fromDocument: backlinkSource,
      },
    ]);

    const tool = createGetKnowledgeDocumentTool();
    const result = (await tool.execute({
      reasoning: "Need the exact document before updating it",
      documentId: "doc-1",
      includeContent: true,
    })) as {
      success: boolean;
      documentId: string;
      bookId: string;
      path: string;
      document: {
        id: string;
        path: string;
        content?: string;
        childCount: number;
        children: Array<{ id: string; path: string }>;
      };
      outgoingLinks: Array<{
        id: string;
        relation: string;
        label?: string;
        target?: { id: string; path: string };
      }>;
      backlinks: Array<{
        id: string;
        relation: string;
        from: { id: string; path: string };
      }>;
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("doc-1");
    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
    expect(dbMocks.getKnowledgeLinks).toHaveBeenCalledWith("doc-1");
    expect(dbMocks.getKnowledgeBacklinks).toHaveBeenCalledWith("doc-1", 12);
    expect(result).toMatchObject({
      success: true,
      documentId: "doc-1",
      bookId: "book-1",
      path: "Knowledge base / Reading Journal / Chapter 1",
      document: {
        id: "doc-1",
        path: "Knowledge base / Reading Journal / Chapter 1",
        content: "Full durable note content.",
        childCount: 1,
        children: [
          {
            id: "doc-child",
            path: "Knowledge base / Reading Journal / Chapter 1 / Nested summary",
          },
        ],
      },
      outgoingLinks: [
        {
          id: "link-out",
          relation: "related",
          label: "Compare with",
          target: {
            id: "doc-related",
            path: "Knowledge base / Reading Journal / Related Idea",
          },
        },
      ],
      backlinks: [
        {
          id: "link-back",
          relation: "references",
          from: {
            id: "doc-source",
            path: "Knowledge base / Reading Journal / Earlier Observation",
          },
        },
      ],
    });
  });

  it("returns a safe failure when an exact knowledge document is missing", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(null);

    const tool = createGetKnowledgeDocumentTool();
    const result = await tool.execute({
      reasoning: "Need the exact document",
      documentId: "missing-doc",
    });

    expect(result).toEqual({
      success: false,
      error: "Knowledge document not found",
      documentId: "missing-doc",
    });
    expect(dbMocks.getKnowledgeDocuments).not.toHaveBeenCalled();
  });

  it("resolves outgoing document link targets outside the current path context", async () => {
    const source = doc({
      id: "doc-source",
      type: "standalone_note",
      title: "Source Note",
    });
    const remoteTarget = doc({
      id: "doc-remote",
      bookId: "book-remote",
      type: "summary",
      title: "Remote Summary",
      contentMd: "Remote context.",
    });
    dbMocks.getKnowledgeDocument.mockImplementation(async (documentId: string) => {
      if (documentId === "doc-source") return source;
      if (documentId === "doc-remote") return remoteTarget;
      return null;
    });
    dbMocks.getKnowledgeDocuments.mockResolvedValue([source]);
    dbMocks.getKnowledgeLinks.mockResolvedValue([
      {
        id: "link-remote",
        fromDocumentId: "doc-source",
        toKind: "document",
        toId: "doc-remote",
        relation: "references",
        createdAt: 2300,
        updatedAt: 2300,
      },
    ]);

    const tool = createGetKnowledgeDocumentTool();
    const result = (await tool.execute({
      reasoning: "Need linked context",
      documentId: "doc-source",
    })) as {
      outgoingLinks: Array<{ target?: { id: string; path: string; title: string } }>;
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("doc-remote");
    expect(result.outgoingLinks[0].target).toMatchObject({
      id: "doc-remote",
      title: "Remote Summary",
      path: "Knowledge base / Remote Summary",
    });
  });

  it("compresses and persists derived knowledge summaries without changing content", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Long Notes",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const source = doc({
      id: "doc-long",
      title: "Compression Target",
      parentId: "folder-1",
      contentMd: "Long durable note.".repeat(300),
    });
    dbMocks.getKnowledgeDocument.mockResolvedValue(source);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, source]);

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
      path: string;
      document: { id: string; path: string; parentTitle?: string };
      reason: string;
      sourceChars: number;
      summaryMd: string;
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("doc-long");
    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
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
      path: "Knowledge base / Long Notes / Compression Target",
      document: {
        id: "doc-long",
        parentTitle: "Long Notes",
        path: "Knowledge base / Long Notes / Compression Target",
      },
      reason: "missing_summary",
      sourceChars: 4000,
      summaryMd: "## Durable memory\n- Read slowly.",
    });
  });

  it("creates confirmation-required drafts without saving knowledge documents", async () => {
    const folder = doc({ id: "folder-1", type: "folder", title: "Folder" });
    dbMocks.getKnowledgeDocument.mockResolvedValue(folder);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder]);

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
      targetPath: string;
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
    expect(result.targetPath).toBe("Knowledge base / Folder / Reading Summary");
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
    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
  });

  it("rejects create drafts that would duplicate a sibling vault path", async () => {
    const folder = doc({ id: "folder-1", type: "folder", title: "Folder" });
    const existing = doc({
      id: "existing-summary",
      type: "summary",
      title: "Reading Summary",
      parentId: "folder-1",
    });
    dbMocks.getKnowledgeDocument.mockResolvedValue(folder);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, existing]);

    const tool = createProposeKnowledgeDocumentCreateTool();
    const result = await tool.execute({
      reasoning: "User asked to save a summary",
      title: " reading   summary ",
      contentMd: "## Summary\nSlow reading helps memory.",
      type: "summary",
      bookId: "book-1",
      parentId: "folder-1",
    });

    expect(result).toEqual({
      success: false,
      error: "Invalid title: duplicate_sibling_title",
    });
    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("folder-1");
    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
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
    })) as {
      success: boolean;
      targetPath: string;
      draft: { bookId?: string; parentId?: string };
    };

    expect(result).toMatchObject({
      success: true,
      targetPath: "Knowledge base / Deep Reading Home / Folder Child",
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
      current: { path: string };
      targetPath: string;
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
    expect(result.current.path).toBe("Knowledge base / Deep Reading Home");
    expect(result.targetPath).toBe("Knowledge base / Target Folder / Deep Reading Notes");
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

  it("creates confirmation-required tag add proposals without saving documents", async () => {
    const source = doc({ id: "doc-tags", tags: ["reading"] });
    dbMocks.getKnowledgeDocument.mockResolvedValue(source);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([source]);

    const tool = createProposeKnowledgeDocumentTagsUpdateTool();
    const result = (await tool.execute({
      reasoning: "Organize the note",
      documentId: "doc-tags",
      mode: "add",
      tags: '["memory","reading","theme"]',
    })) as {
      success: boolean;
      requiresConfirmation: boolean;
      documentId: string;
      current: { path: string; tags: string[] };
      targetPath: string;
      patch: { tags: string[] };
      changedFields: string[];
      tagMode: string;
    };

    expect(dbMocks.getKnowledgeDocument).toHaveBeenCalledWith("doc-tags");
    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
    expect(result).toMatchObject({
      success: true,
      requiresConfirmation: true,
      documentId: "doc-tags",
      current: {
        path: "Knowledge base / Deep Reading Home",
        tags: ["reading"],
      },
      targetPath: "Knowledge base / Deep Reading Home",
      patch: {
        tags: ["reading", "memory", "theme"],
      },
      changedFields: ["tags"],
      tagMode: "add",
    });
  });

  it("supports tag removal and replacement proposals", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(
      doc({ id: "doc-tags", tags: ["reading", "memory", "draft"] }),
    );
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({ id: "doc-tags", tags: ["reading", "memory", "draft"] }),
    ]);

    const tool = createProposeKnowledgeDocumentTagsUpdateTool();
    await expect(
      tool.execute({
        reasoning: "Remove noisy tags",
        documentId: "doc-tags",
        mode: "remove",
        tags: "draft, missing",
      }),
    ).resolves.toMatchObject({
      success: true,
      patch: { tags: ["reading", "memory"] },
      tagMode: "remove",
    });

    await expect(
      tool.execute({
        reasoning: "Replace with final tags",
        documentId: "doc-tags",
        mode: "set",
        tags: "finished,reflection",
      }),
    ).resolves.toMatchObject({
      success: true,
      patch: { tags: ["finished", "reflection"] },
      tagMode: "set",
    });
  });

  it("rejects tag proposals with no effective changes", async () => {
    dbMocks.getKnowledgeDocument.mockResolvedValue(doc({ tags: ["reading", "memory"] }));

    const tool = createProposeKnowledgeDocumentTagsUpdateTool();
    await expect(
      tool.execute({
        reasoning: "No-op",
        documentId: "doc-1",
        mode: "add",
        tags: "reading",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "No tag changes were proposed",
      documentId: "doc-1",
    });

    await expect(
      tool.execute({
        reasoning: "Missing tags",
        documentId: "doc-1",
        mode: "set",
        tags: "",
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "tags is required",
    });
  });

  it("creates confirmation-required link proposals without saving links", async () => {
    const sourceFolder = doc({
      id: "folder-source",
      type: "folder",
      title: "Source Folder",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const targetFolder = doc({
      id: "folder-target",
      type: "folder",
      title: "Target Folder",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const source = doc({ id: "doc-1", title: "Source Note", parentId: "folder-source" });
    const target = doc({ id: "doc-2", title: "Related Idea", parentId: "folder-target" });
    dbMocks.getKnowledgeDocument.mockResolvedValueOnce(source).mockResolvedValueOnce(target);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([sourceFolder, targetFolder, source, target]);

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
      source: { id: string; title: string; path: string };
      target: { id: string; title: string; path: string };
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
      source: {
        id: "doc-1",
        title: "Source Note",
        path: "Knowledge base / Source Folder / Source Note",
      },
      target: {
        id: "doc-2",
        title: "Related Idea",
        path: "Knowledge base / Target Folder / Related Idea",
      },
      link: {
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        label: "Related idea",
      },
    });
  });

  it("keeps every AI write tool proposal-only until the user confirms", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const note = doc({
      id: "doc-1",
      type: "standalone_note",
      title: "Source Note",
      parentId: "folder-1",
      tags: ["reading"],
    });
    const related = doc({
      id: "doc-2",
      type: "standalone_note",
      title: "Related Note",
      parentId: "folder-1",
      tags: [],
    });
    const documents = [folder, note, related];
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    dbMocks.getKnowledgeDocument.mockImplementation(async (documentId: string) => {
      return documentsById.get(documentId) ?? null;
    });
    dbMocks.getKnowledgeDocuments.mockResolvedValue(documents);

    const createResult = await createProposeKnowledgeDocumentCreateTool().execute({
      reasoning: "Draft a summary",
      title: "New Summary",
      contentMd: "A proposed note body.",
      type: "summary",
      bookId: "book-1",
      parentId: "folder-1",
    });
    const updateResult = await createProposeKnowledgeDocumentUpdateTool().execute({
      reasoning: "Draft an update",
      documentId: "doc-1",
      contentMd: "Updated proposed body.",
    });
    const tagsResult = await createProposeKnowledgeDocumentTagsUpdateTool().execute({
      reasoning: "Draft tag organization",
      documentId: "doc-1",
      mode: "add",
      tags: "memory",
    });
    const linkResult = await createProposeKnowledgeLinkCreateTool().execute({
      reasoning: "Draft a relation",
      fromDocumentId: "doc-1",
      toKind: "document",
      toId: "doc-2",
      relation: "related",
    });

    for (const result of [createResult, updateResult, tagsResult, linkResult]) {
      expect(result).toMatchObject({
        success: true,
        requiresConfirmation: true,
      });
    }
    expect(dbMocks.createKnowledgeDocument).not.toHaveBeenCalled();
    expect(dbMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
    expect(dbMocks.insertKnowledgeLink).not.toHaveBeenCalled();
  });

  it("runs a safe AI knowledge read-to-confirmed-update workflow", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
      excerpt: undefined,
      tags: [],
    });
    const note = doc({
      id: "doc-note",
      type: "standalone_note",
      title: "Tea Ceremony Notes",
      parentId: "folder-1",
      contentMd: "Ritual attention starts as a rough observation.",
      excerpt: "Ritual attention starts as a rough observation.",
      tags: ["ritual"],
    });

    dbMocks.searchKnowledgeDocuments.mockResolvedValue([note]);
    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder, note]);

    const searchTool = createSearchKnowledgeBaseTool();
    const searchResult = (await searchTool.execute({
      reasoning: "Find the user's durable note before editing it",
      query: "tea ceremony",
      bookId: "book-1",
    })) as {
      documents: Array<{ id: string; path: string }>;
    };

    expect(searchResult.documents[0]).toMatchObject({
      id: "doc-note",
      path: "Knowledge base / Themes / Tea Ceremony Notes",
    });

    const getTool = createGetKnowledgeDocumentTool();
    dbMocks.getKnowledgeDocument.mockResolvedValueOnce(note);
    const readResult = (await getTool.execute({
      reasoning: "Read exact document before drafting an update",
      documentId: "doc-note",
      includeContent: true,
    })) as {
      success: boolean;
      path: string;
      document: { content?: string; path: string };
    };

    expect(readResult).toMatchObject({
      success: true,
      path: "Knowledge base / Themes / Tea Ceremony Notes",
      document: {
        path: "Knowledge base / Themes / Tea Ceremony Notes",
        content: "Ritual attention starts as a rough observation.",
      },
    });

    const updateTool = createProposeKnowledgeDocumentUpdateTool();
    dbMocks.getKnowledgeDocument.mockResolvedValueOnce(note);
    const proposalResult = await updateTool.execute({
      reasoning: "Draft a clearer note while keeping the user in control",
      documentId: "doc-note",
      contentMd: "Updated durable interpretation with source-aware wording.",
    });

    expect(dbMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
    expect(proposalResult).toMatchObject({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-note",
      targetPath: "Knowledge base / Themes / Tea Ceremony Notes",
    });

    const proposal = getKnowledgeWriteProposal(proposalResult);
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    const preview = createKnowledgeWriteProposalPreview(proposal);
    expect(preview).toMatchObject({
      action: "update",
      title: "Tea Ceremony Notes",
      visiblePath: "Knowledge base / Themes / Tea Ceremony Notes",
      hasPathChange: false,
    });
    expect(preview.contentPreviewHtml).toContain("Updated durable interpretation");

    dbMocks.getKnowledgeDocument.mockResolvedValueOnce(note);
    dbMocks.updateKnowledgeDocument.mockResolvedValueOnce(undefined);

    await expect(applyKnowledgeWriteProposal(proposal)).resolves.toEqual({
      action: "update",
      documentId: "doc-note",
    });
    expect(dbMocks.updateKnowledgeDocument).toHaveBeenCalledWith(
      "doc-note",
      expect.objectContaining({
        contentMd: "Updated durable interpretation with source-aware wording.",
      }),
    );
  });
});
