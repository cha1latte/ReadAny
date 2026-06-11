import {
  type CreateKnowledgeDocumentInput,
  createKnowledgeDocument,
  getKnowledgeDocument,
  getKnowledgeLinks,
  insertKnowledgeLink,
  updateKnowledgeDocument,
} from "../db/database";
import type {
  JSONValue,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLink,
  KnowledgeLinkRelation,
  KnowledgeLinkTargetKind,
  KnowledgeSourceKind,
} from "../types";
import { generateId } from "../utils/generate-id";

export type KnowledgeProposalAction = "create" | "update" | "link";
export type KnowledgeProposalConfirmationKind =
  | "knowledge_document_create"
  | "knowledge_document_update"
  | "knowledge_link_create";

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
    parentId?: string;
    type?: KnowledgeDocumentType;
    title?: string;
    tags?: string[];
    excerpt?: string;
    updatedAt?: number;
  };
  patch: Partial<
    Pick<KnowledgeDocument, "parentId" | "title" | "contentMd" | "contentJson" | "excerpt" | "tags">
  >;
  changedFields: string[];
}

export interface KnowledgeLinkCreateProposal {
  success: true;
  action: "link";
  requiresConfirmation: true;
  confirmationKind: "knowledge_link_create";
  message?: string;
  link: {
    id?: string;
    fromDocumentId: string;
    toKind: KnowledgeLinkTargetKind;
    toId: string;
    relation: KnowledgeLinkRelation;
    label?: string;
    cfi?: string;
  };
}

export type KnowledgeWriteProposal =
  | KnowledgeDocumentCreateProposal
  | KnowledgeDocumentUpdateProposal
  | KnowledgeLinkCreateProposal;

export interface KnowledgeProposalApplyResult {
  action: KnowledgeProposalAction;
  documentId?: string;
  linkId?: string;
  alreadyApplied?: boolean;
}

const DOCUMENT_TYPES = new Set<KnowledgeDocumentType>([
  "book_home",
  "folder",
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

const LINK_TARGET_KINDS = new Set<KnowledgeLinkTargetKind>([
  "book",
  "highlight",
  "document",
  "cfi",
  "url",
  "ai_message",
  "obsidian",
]);

const LINK_RELATIONS = new Set<KnowledgeLinkRelation>([
  "source",
  "references",
  "backlink",
  "related",
  "contains",
  "generated_from",
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

function asLinkTargetKind(value: unknown): KnowledgeLinkTargetKind | null {
  return typeof value === "string" && LINK_TARGET_KINDS.has(value as KnowledgeLinkTargetKind)
    ? (value as KnowledgeLinkTargetKind)
    : null;
}

function asLinkRelation(value: unknown): KnowledgeLinkRelation | null {
  return typeof value === "string" && LINK_RELATIONS.has(value as KnowledgeLinkRelation)
    ? (value as KnowledgeLinkRelation)
    : null;
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
  if (Object.prototype.hasOwnProperty.call(patchResult, "parentId")) {
    patch.parentId = stringOrUndefined(patchResult.parentId);
  }
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
        parentId: stringOrUndefined(result.current.parentId),
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

function normalizeLinkProposal(
  result: Record<string, unknown>,
): KnowledgeLinkCreateProposal | null {
  if (result.action !== "link" || result.confirmationKind !== "knowledge_link_create") {
    return null;
  }

  const link = result.link;
  if (!isRecord(link)) return null;

  const fromDocumentId = stringOrUndefined(link.fromDocumentId);
  const toKind = asLinkTargetKind(link.toKind);
  const toId = stringOrUndefined(link.toId);
  const relation = asLinkRelation(link.relation);
  if (!fromDocumentId || !toKind || !toId || !relation) return null;

  return {
    success: true,
    action: "link",
    requiresConfirmation: true,
    confirmationKind: "knowledge_link_create",
    message: stringOrUndefined(result.message),
    link: {
      id: stringOrUndefined(link.id),
      fromDocumentId,
      toKind,
      toId,
      relation,
      label: stringOrUndefined(link.label),
      cfi: stringOrUndefined(link.cfi),
    },
  };
}

export function getKnowledgeWriteProposal(value: unknown): KnowledgeWriteProposal | null {
  if (!isRecord(value) || value.success !== true || value.requiresConfirmation !== true) {
    return null;
  }
  return (
    normalizeCreateProposal(value) ?? normalizeUpdateProposal(value) ?? normalizeLinkProposal(value)
  );
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

  if (proposal.action === "update") {
    await updateKnowledgeDocument(proposal.documentId, proposal.patch);
    return { action: "update", documentId: proposal.documentId };
  }

  const existingLinks = await getKnowledgeLinks(proposal.link.fromDocumentId);
  const existing = existingLinks.find(
    (link) =>
      (proposal.link.id && link.id === proposal.link.id) ||
      (link.toKind === proposal.link.toKind &&
        link.toId === proposal.link.toId &&
        link.relation === proposal.link.relation &&
        (link.cfi ?? "") === (proposal.link.cfi ?? "")),
  );
  if (existing) {
    return {
      action: "link",
      documentId: proposal.link.fromDocumentId,
      linkId: existing.id,
      alreadyApplied: true,
    };
  }

  const now = Date.now();
  const link: KnowledgeLink = {
    id: proposal.link.id ?? generateId(),
    fromDocumentId: proposal.link.fromDocumentId,
    toKind: proposal.link.toKind,
    toId: proposal.link.toId,
    relation: proposal.link.relation,
    label: proposal.link.label,
    cfi: proposal.link.cfi,
    createdAt: now,
    updatedAt: now,
  };
  await insertKnowledgeLink(link);
  return { action: "link", documentId: link.fromDocumentId, linkId: link.id };
}
