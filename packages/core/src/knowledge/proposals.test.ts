import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  createKnowledgeDocument: vi.fn(),
  getKnowledgeDocument: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  getKnowledgeLinks: vi.fn(),
  insertKnowledgeLink: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}));

vi.mock("../db/database", () => dbMocks);

const idMocks = vi.hoisted(() => ({
  generateId: vi.fn(() => "generated-link-id"),
}));

vi.mock("../utils/generate-id", () => idMocks);

const { eventBus } = await import("../utils/event-bus");
const {
  applyKnowledgeWriteProposal,
  createKnowledgeWriteProposalPreview,
  getKnowledgeWriteProposal,
} = await import("./proposals");

describe("knowledge write proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventBus.clear("knowledge:changed");
  });

  function document(overrides: Record<string, unknown> = {}) {
    return {
      id: "doc-1",
      bookId: "book-1",
      parentId: undefined,
      type: "standalone_note",
      title: "Note",
      contentJson: { type: "doc", content: [] },
      contentMd: "Body",
      contentSchemaVersion: 1,
      excerpt: undefined,
      tags: [],
      createdAt: 1000,
      updatedAt: 2000,
      ...overrides,
    };
  }

  it("normalizes confirmation-required create proposals", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      targetPath: "Knowledge base / Summaries / Durable Summary",
      draft: {
        id: "proposal-doc-1",
        type: "summary",
        title: "Durable Summary",
        tags: ["reading", "reading", "summary"],
        contentMd: "A durable knowledge document.",
        contentJson: { type: "doc", content: [] },
        sourceKind: "book",
        sourceId: "book-1",
      },
    });

    expect(proposal).toMatchObject({
      action: "create",
      targetPath: "Knowledge base / Summaries / Durable Summary",
      draft: {
        id: "proposal-doc-1",
        type: "summary",
        title: "Durable Summary",
        tags: ["reading", "summary"],
        sourceKind: "book",
        sourceId: "book-1",
      },
    });
    expect(proposal ? createKnowledgeWriteProposalPreview(proposal) : null).toMatchObject({
      action: "create",
      title: "Durable Summary",
      documentType: "summary",
      tags: ["reading", "summary"],
      contentPreview: "A durable knowledge document.",
      targetPath: "Knowledge base / Summaries / Durable Summary",
      visiblePath: "Knowledge base / Summaries / Durable Summary",
      hasPathChange: false,
    });
  });

  it("rejects ordinary tool results and malformed proposal payloads", () => {
    expect(getKnowledgeWriteProposal({ success: true, documents: [] })).toBeNull();
    expect(
      getKnowledgeWriteProposal({
        success: true,
        action: "create",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_create",
        draft: { type: "summary", title: "", contentJson: { type: "doc" } },
      }),
    ).toBeNull();
    expect(
      getKnowledgeWriteProposal({
        success: true,
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        documentId: "doc-1",
        patch: { contentMd: "Markdown without canonical JSON" },
      }),
    ).toBeNull();
    expect(
      getKnowledgeWriteProposal({
        success: true,
        action: "link",
        requiresConfirmation: true,
        confirmationKind: "knowledge_link_create",
        link: { fromDocumentId: "doc-1", toKind: "unknown", toId: "doc-2", relation: "related" },
      }),
    ).toBeNull();
  });

  it("normalizes confirmation-required link proposals", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      link: {
        id: "link-1",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        label: "Related idea",
      },
    });

    expect(proposal).toMatchObject({
      action: "link",
      link: {
        id: "link-1",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        label: "Related idea",
      },
    });
    expect(proposal ? createKnowledgeWriteProposalPreview(proposal) : null).toMatchObject({
      action: "link",
      title: "Related idea",
      linkType: "document",
      contentPreview: "related -> document: doc-2",
      changedFields: ["related"],
      hasPathChange: false,
    });
  });

  it("surfaces document move paths in proposal previews", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      current: {
        id: "doc-1",
        type: "standalone_note",
        title: "Moved Note",
        path: "Knowledge base / Inbox / Moved Note",
        tags: ["draft"],
      },
      targetPath: "Knowledge base / Chapter Notes / Moved Note",
      patch: {
        parentId: "chapter-notes",
      },
      changedFields: ["parentId"],
    });

    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    expect(createKnowledgeWriteProposalPreview(proposal)).toMatchObject({
      action: "update",
      title: "Moved Note",
      documentType: "standalone_note",
      tags: ["draft"],
      changedFields: ["parentId"],
      currentPath: "Knowledge base / Inbox / Moved Note",
      targetPath: "Knowledge base / Chapter Notes / Moved Note",
      visiblePath: "Knowledge base / Chapter Notes / Moved Note",
      hasPathChange: true,
    });
  });

  it("applies create proposals once when the draft id already exists", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        id: "proposal-doc-1",
        type: "standalone_note",
        title: "New Note",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue({ id: "proposal-doc-1" });

    const result = await applyKnowledgeWriteProposal(proposal);

    expect(result).toEqual({
      action: "create",
      documentId: "proposal-doc-1",
      alreadyApplied: true,
    });
    expect(dbMocks.createKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("creates documents and applies update patches", async () => {
    const createProposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        type: "review",
        title: "Review",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(createProposal).not.toBeNull();
    if (!createProposal) throw new Error("Expected create proposal");
    dbMocks.createKnowledgeDocument.mockResolvedValue({ id: "created-doc" });

    await expect(applyKnowledgeWriteProposal(createProposal)).resolves.toEqual({
      action: "create",
      documentId: "created-doc",
    });

    const updateProposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      patch: {
        parentId: "folder-1",
        title: "Updated",
        tags: ["done"],
      },
      targetPath: "Knowledge base / Folder / Updated",
      changedFields: ["parentId", "title", "tags"],
    });
    expect(updateProposal).not.toBeNull();
    if (!updateProposal) throw new Error("Expected update proposal");
    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({ id: "doc-1", bookId: "book-1" }),
      document({ id: "folder-1", type: "folder", title: "Folder", bookId: "book-1" }),
    ]);

    await expect(applyKnowledgeWriteProposal(updateProposal)).resolves.toEqual({
      action: "update",
      documentId: "doc-1",
    });
    expect(dbMocks.updateKnowledgeDocument).toHaveBeenCalledWith("doc-1", {
      parentId: "folder-1",
      title: "Updated",
      tags: ["done"],
    });
    expect(createKnowledgeWriteProposalPreview(updateProposal)).toMatchObject({
      action: "update",
      title: "Updated",
      documentType: undefined,
      tags: ["done"],
      changedFields: ["parentId", "title", "tags"],
      targetPath: "Knowledge base / Folder / Updated",
      visiblePath: "Knowledge base / Folder / Updated",
      hasPathChange: false,
    });
  });

  it("emits knowledge changed events after create and update proposals apply", async () => {
    const events: unknown[] = [];
    const unsubscribe = eventBus.on("knowledge:changed", (event) => events.push(event));

    const createProposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        type: "review",
        title: "Review",
        bookId: "book-1",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(createProposal).not.toBeNull();
    if (!createProposal) throw new Error("Expected create proposal");
    dbMocks.createKnowledgeDocument.mockResolvedValue({ id: "created-doc", bookId: "book-1" });

    await applyKnowledgeWriteProposal(createProposal);

    const updateProposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "doc-1",
      patch: {
        title: "Updated",
      },
      changedFields: ["title"],
    });
    expect(updateProposal).not.toBeNull();
    if (!updateProposal) throw new Error("Expected update proposal");
    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));

    await applyKnowledgeWriteProposal(updateProposal);
    unsubscribe();

    expect(events).toEqual([
      {
        action: "create",
        documentId: "created-doc",
        bookId: "book-1",
        timestamp: expect.any(Number),
      },
      {
        action: "update",
        documentId: "doc-1",
        bookId: "book-1",
        timestamp: expect.any(Number),
      },
    ]);
  });

  it("validates parent folders before applying create proposals", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
      draft: {
        type: "standalone_note",
        title: "Child Note",
        bookId: "book-1",
        parentId: "not-folder",
        contentMd: "Body",
        contentJson: { type: "doc", content: [] },
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected create proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "not-folder", type: "summary" }));

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document parent: parent_not_folder",
    );
    expect(dbMocks.createKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("validates parent moves before applying update proposals", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "update",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_update",
      documentId: "folder-root",
      patch: {
        parentId: "folder-child",
      },
      changedFields: ["parentId"],
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected update proposal");

    dbMocks.getKnowledgeDocument.mockResolvedValue(
      document({ id: "folder-root", type: "folder", bookId: "book-1" }),
    );
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      document({ id: "folder-root", type: "folder", bookId: "book-1" }),
      document({
        id: "folder-child",
        type: "folder",
        parentId: "folder-root",
        bookId: "book-1",
      }),
    ]);

    await expect(applyKnowledgeWriteProposal(proposal)).rejects.toThrow(
      "Invalid knowledge document parent: descendant_parent",
    );
    expect(dbMocks.updateKnowledgeDocument).not.toHaveBeenCalled();
  });

  it("applies link proposals once and avoids duplicates", async () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      link: {
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        label: "Original highlight",
        cfi: "epubcfi(/6/2)",
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected link proposal");

    dbMocks.getKnowledgeLinks.mockResolvedValueOnce([]);
    await expect(applyKnowledgeWriteProposal(proposal)).resolves.toEqual({
      action: "link",
      documentId: "doc-1",
      linkId: "generated-link-id",
    });
    expect(dbMocks.insertKnowledgeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "generated-link-id",
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        cfi: "epubcfi(/6/2)",
      }),
    );

    dbMocks.getKnowledgeLinks.mockResolvedValueOnce([
      {
        id: "existing-link",
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        cfi: "epubcfi(/6/2)",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    await expect(applyKnowledgeWriteProposal(proposal)).resolves.toEqual({
      action: "link",
      documentId: "doc-1",
      linkId: "existing-link",
      alreadyApplied: true,
    });
  });

  it("emits knowledge changed events after link proposals apply", async () => {
    const events: unknown[] = [];
    const unsubscribe = eventBus.on("knowledge:changed", (event) => events.push(event));
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "link",
      requiresConfirmation: true,
      confirmationKind: "knowledge_link_create",
      link: {
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected link proposal");

    dbMocks.getKnowledgeLinks.mockResolvedValue([]);
    dbMocks.getKnowledgeDocument.mockResolvedValue(document({ id: "doc-1", bookId: "book-1" }));

    await applyKnowledgeWriteProposal(proposal);
    unsubscribe();

    expect(events).toEqual([
      {
        action: "link",
        documentId: "doc-1",
        linkId: "generated-link-id",
        bookId: "book-1",
        timestamp: expect.any(Number),
      },
    ]);
  });
});
