import {
  type CreateKnowledgeDocumentInput,
  createKnowledgeDocument,
  getKnowledgeDocument,
  updateKnowledgeDocument,
} from "../db/database";
import type {
  JSONValue,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeSourceKind,
} from "../types";

export type KnowledgeProposalAction = "create" | "update";
export type KnowledgeProposalConfirmationKind =
  | "knowledge_document_create"
  | "knowledge_document_update";

export interface KnowledgeDocumentCreateProposal {
  success: true;
  action: "create";
  requiresConfirmation: true;
  confirmationKind: "knowledge_document_create";
  message?: string;
  draft: CreateKnowledgeDocumentInput;
}

export interface KnowledgeDocumentUpdateProposal {
  success: true;
  action: "update";
  requiresConfirmation: true;
  confirmationKind: "knowledge_document_update";
  message?: string;
  documentId: string;
  current?: {
    id: string;
    bookId?: string;
    type?: KnowledgeDocumentType;
    title?: string;
    tags?: string[];
    excerpt?: string;
    updatedAt?: number;
  };
  patch: Partial<
    Pick<KnowledgeDocument, "title" | "contentMd" | "contentJson" | "excerpt" | "tags">
  >;
  changedFields: string[];
}

export type KnowledgeWriteProposal =
  | KnowledgeDocumentCreateProposal
  | KnowledgeDocumentUpdateProposal;

export interface KnowledgeProposalApplyResult {
  action: KnowledgeProposalAction;
  documentId: string;
  alreadyApplied?: boolean;
}

const DOCUMENT_TYPES = new Set<KnowledgeDocumentType>([
  "book_home",
  "standalone_note",
  "highlight_note",
  "review",
  "summary",
  "imported_markdown",
]);

const SOURCE_KINDS = new Set<KnowledgeSourceKind>([
  "book",
  "highlight",
  "note",
  "cfi",
  "ai_message",
  "external",
  "obsidian",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJSONValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJSONValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJSONValue);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function asDocumentType(value: unknown): KnowledgeDocumentType | null {
  return typeof value === "string" && DOCUMENT_TYPES.has(value as KnowledgeDocumentType)
    ? (value as KnowledgeDocumentType)
    : null;
}

function asSourceKind(value: unknown): KnowledgeSourceKind | undefined {
  return typeof value === "string" && SOURCE_KINDS.has(value as KnowledgeSourceKind)
    ? (value as KnowledgeSourceKind)
    : undefined;
}

function normalizeCreateProposal(
  result: Record<string, unknown>,
): KnowledgeDocumentCreateProposal | null {
  if (result.action !== "create" || result.confirmationKind !== "knowledge_document_create") {
    return null;
  }

  const draft = result.draft;
  if (!isRecord(draft)) return null;

  const type = asDocumentType(draft.type);
  const title = stringOrUndefined(draft.title);
  const contentMd = typeof draft.contentMd === "string" ? draft.contentMd : "";
  const contentJson = isJSONValue(draft.contentJson) ? draft.contentJson : null;
  if (!type || !title || !contentJson) return null;

  return {
    success: true,
    action: "create",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_create",
    message: stringOrUndefined(result.message),
    draft: {
      id: stringOrUndefined(draft.id),
      bookId: stringOrUndefined(draft.bookId),
      parentId: stringOrUndefined(draft.parentId),
      type,
      title,
      contentJson,
      contentMd,
      contentSchemaVersion:
        typeof draft.contentSchemaVersion === "number" ? draft.contentSchemaVersion : undefined,
      excerpt: stringOrUndefined(draft.excerpt),
      tags: asStringArray(draft.tags),
      sourceKind: asSourceKind(draft.sourceKind),
      sourceId: stringOrUndefined(draft.sourceId),
    },
  };
}

function normalizeUpdateProposal(
  result: Record<string, unknown>,
): KnowledgeDocumentUpdateProposal | null {
  if (result.action !== "update" || result.confirmationKind !== "knowledge_document_update") {
    return null;
  }

  const documentId = stringOrUndefined(result.documentId);
  const patchResult = result.patch;
  if (!documentId || !isRecord(patchResult)) return null;

  const patch: KnowledgeDocumentUpdateProposal["patch"] = {};
  if (typeof patchResult.title === "string") patch.title = patchResult.title;
  if (typeof patchResult.contentMd === "string") {
    if (!isJSONValue(patchResult.contentJson)) return null;
    patch.contentMd = patchResult.contentMd;
    patch.contentJson = patchResult.contentJson;
  } else if (isJSONValue(patchResult.contentJson)) {
    patch.contentJson = patchResult.contentJson;
  }
  if (Object.prototype.hasOwnProperty.call(patchResult, "excerpt")) {
    patch.excerpt = stringOrUndefined(patchResult.excerpt);
  }
  if (Array.isArray(patchResult.tags)) patch.tags = asStringArray(patchResult.tags);

  if (Object.keys(patch).length === 0) return null;

  const current = isRecord(result.current)
    ? {
        id: String(result.current.id ?? documentId),
        bookId: stringOrUndefined(result.current.bookId),
        type: asDocumentType(result.current.type) ?? undefined,
        title: stringOrUndefined(result.current.title),
        tags: asStringArray(result.current.tags),
        excerpt: stringOrUndefined(result.current.excerpt),
        updatedAt:
          typeof result.current.updatedAt === "number" ? result.current.updatedAt : undefined,
      }
    : undefined;

  return {
    success: true,
    action: "update",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_update",
    message: stringOrUndefined(result.message),
    documentId,
    current,
    patch,
    changedFields: asStringArray(result.changedFields),
  };
}

export function getKnowledgeWriteProposal(value: unknown): KnowledgeWriteProposal | null {
  if (!isRecord(value) || value.success !== true || value.requiresConfirmation !== true) {
    return null;
  }
  return normalizeCreateProposal(value) ?? normalizeUpdateProposal(value);
}

export async function applyKnowledgeWriteProposal(
  proposal: KnowledgeWriteProposal,
): Promise<KnowledgeProposalApplyResult> {
  if (proposal.action === "create") {
    if (proposal.draft.id) {
      const existing = await getKnowledgeDocument(proposal.draft.id);
      if (existing) {
        return { action: "create", documentId: existing.id, alreadyApplied: true };
      }
    }
    const document = await createKnowledgeDocument(proposal.draft);
    return { action: "create", documentId: document.id };
  }

  await updateKnowledgeDocument(proposal.documentId, proposal.patch);
  return { action: "update", documentId: proposal.documentId };
}
