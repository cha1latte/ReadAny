import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  createKnowledgeDocument: vi.fn(),
  getKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
}));

vi.mock("../db/database", () => dbMocks);

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
        title: "Updated",
        tags: ["done"],
      },
      changedFields: ["title", "tags"],
    });
    expect(updateProposal).not.toBeNull();
    if (!updateProposal) throw new Error("Expected update proposal");

    await expect(applyKnowledgeWriteProposal(updateProposal)).resolves.toEqual({
      action: "update",
      documentId: "doc-1",
    });
    expect(dbMocks.updateKnowledgeDocument).toHaveBeenCalledWith("doc-1", {
      title: "Updated",
      tags: ["done"],
    });
  });
});
