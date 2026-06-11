import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  createKnowledgeDocument: vi.fn(),
  getKnowledgeDocument: vi.fn(),
  getKnowledgeLinks: vi.fn(),
  insertKnowledgeLink: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}));

vi.mock("../db/database", () => dbMocks);

const idMocks = vi.hoisted(() => ({
  generateId: vi.fn(() => "generated-link-id"),
}));

vi.mock("../utils/generate-id", () => idMocks);

const { applyKnowledgeWriteProposal, getKnowledgeWriteProposal } = await import("./proposals");

describe("knowledge write proposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes confirmation-required create proposals", () => {
    const proposal = getKnowledgeWriteProposal({
      success: true,
      action: "create",
      requiresConfirmation: true,
      confirmationKind: "knowledge_document_create",
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
      draft: {
        id: "proposal-doc-1",
        type: "summary",
        title: "Durable Summary",
        tags: ["reading", "summary"],
        sourceKind: "book",
        sourceId: "book-1",
      },
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
      changedFields: ["parentId", "title", "tags"],
    });
    expect(updateProposal).not.toBeNull();
    if (!updateProposal) throw new Error("Expected update proposal");

    await expect(applyKnowledgeWriteProposal(updateProposal)).resolves.toEqual({
      action: "update",
      documentId: "doc-1",
    });
    expect(dbMocks.updateKnowledgeDocument).toHaveBeenCalledWith("doc-1", {
      parentId: "folder-1",
      title: "Updated",
      tags: ["done"],
    });
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
});
