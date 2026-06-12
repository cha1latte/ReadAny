/**
 * Knowledge Tools — let AI read the user's ReadAny knowledge base.
 *
 * These tools are intentionally read-only. Mutating knowledge documents should
 * go through a confirmation-capable UI flow so AI never silently overwrites a
 * user's durable notes.
 */
import {
  getKnowledgeDocument,
  getKnowledgeDocuments,
  searchKnowledgeDocuments,
} from "../../db/database";
import {
  orderKnowledgeDocuments,
  validateKnowledgeDocumentParent,
} from "../../knowledge/document-utils";
import { markdownToBasicTiptap } from "../../knowledge/editor-projection";
import type {
  AIConfig,
  JSONValue,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLinkRelation,
  KnowledgeLinkTargetKind,
} from "../../types";
import { generateId } from "../../utils/generate-id";
import { maybeCompressAndPersistKnowledgeSummary } from "../knowledge-memory";
import type { ToolDefinition } from "./tool-types";

const SEARCH_SCAN_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 8;
const MAX_CHILD_CONTEXT_COUNT = 8;
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
const KNOWLEDGE_ROOT_TITLE = "Knowledge base";
const UNTITLED_DOCUMENT_TITLE = "Untitled document";
const ORPHANED_PARENT_TITLE = "Orphaned";

function asPositiveLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 30) : fallback;
}

function asPositiveNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

function normalizeQuery(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeType(value: unknown): KnowledgeDocumentType | undefined {
  const type = String(value ?? "").trim();
  if (!type || type === "all") return undefined;
  const allowed = new Set<KnowledgeDocumentType>([
    "book_home",
    "folder",
    "standalone_note",
    "highlight_note",
    "review",
    "summary",
    "imported_markdown",
  ]);
  return allowed.has(type as KnowledgeDocumentType) ? (type as KnowledgeDocumentType) : undefined;
}

function normalizeDocumentType(value: unknown): KnowledgeDocumentType {
  return normalizeType(value) ?? "standalone_note";
}

function normalizeParentId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (!raw || ["root", "none", "null"].includes(raw.toLowerCase())) return undefined;
  return raw;
}

function normalizeLinkTargetKind(value: unknown): KnowledgeLinkTargetKind | null {
  const kind = String(value ?? "").trim();
  return LINK_TARGET_KINDS.has(kind as KnowledgeLinkTargetKind)
    ? (kind as KnowledgeLinkTargetKind)
    : null;
}

function normalizeLinkRelation(value: unknown): KnowledgeLinkRelation | null {
  const relation = String(value ?? "").trim();
  return LINK_RELATIONS.has(relation as KnowledgeLinkRelation)
    ? (relation as KnowledgeLinkRelation)
    : null;
}

function parseTags(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (!raw) return [];

  let values: unknown[];
  if (raw.startsWith("[")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("tags JSON must be an array");
    values = parsed;
  } else {
    values = raw.split(/[,，\n]/);
  }

  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeTagMode(value: unknown): "add" | "remove" | "set" {
  const mode = String(value ?? "").trim();
  return mode === "remove" || mode === "set" ? mode : "add";
}

function applyTagMode(
  currentTags: readonly string[],
  requestedTags: readonly string[],
  mode: "add" | "remove" | "set",
): string[] {
  const normalizedCurrent = [...new Set(currentTags.map((tag) => tag.trim()).filter(Boolean))];
  const normalizedRequested = [...new Set(requestedTags.map((tag) => tag.trim()).filter(Boolean))];

  if (mode === "set") return normalizedRequested;
  if (mode === "remove") {
    const removeSet = new Set(normalizedRequested);
    return normalizedCurrent.filter((tag) => !removeSet.has(tag));
  }
  return [...new Set([...normalizedCurrent, ...normalizedRequested])];
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function createExcerpt(markdown: string): string | undefined {
  const text = compactText(
    markdown.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~\-[\]()]/g, " "),
  );
  return text ? text.slice(0, 220) : undefined;
}

function markdownToKnowledgeJson(markdown: string): JSONValue {
  return markdownToBasicTiptap(markdown) as unknown as JSONValue;
}

function sameOptionalString(left: string | undefined, right: string | undefined): boolean {
  return (left || undefined) === (right || undefined);
}

function parentValidationError(reason: string): string {
  return `Invalid parentId: ${reason}`;
}

async function resolveCreateParentContext({
  type,
  bookId,
  parentId,
}: {
  type: KnowledgeDocumentType;
  bookId?: string;
  parentId?: string;
}): Promise<{ bookId?: string; parent?: KnowledgeDocument; error?: string }> {
  if (!parentId) return { bookId };
  if (type === "book_home") return { bookId, error: parentValidationError("book_home_locked") };

  const parent = await getKnowledgeDocument(parentId);
  if (!parent) return { bookId, error: parentValidationError("missing_parent") };
  if (parent.type !== "folder")
    return { bookId, error: parentValidationError("parent_not_folder") };
  if (bookId && !sameOptionalString(bookId, parent.bookId)) {
    return { bookId, error: parentValidationError("book_mismatch") };
  }

  return { bookId: bookId ?? parent.bookId, parent };
}

async function validateUpdateParentChange(
  document: KnowledgeDocument,
  parentId: string | undefined,
): Promise<string | null> {
  const documents = await getKnowledgeDocuments({
    ...(document.bookId ? { bookId: document.bookId } : {}),
    limit: 5000,
  });
  const validation = validateKnowledgeDocumentParent(document.id, parentId, documents);
  if (!validation.ok) return parentValidationError(validation.reason ?? "invalid_parent");

  if (!parentId) return null;
  const parent = documents.find((item) => item.id === parentId);
  if (!parent) return parentValidationError("missing_parent");
  if (!sameOptionalString(parent.bookId, document.bookId)) {
    return parentValidationError("book_mismatch");
  }
  return null;
}

function createSnippet(document: KnowledgeDocument, query: string): string {
  const source = compactText(document.excerpt || document.summaryMd || document.contentMd || "");
  if (!source) return "";
  if (!query) return source.slice(0, 320);

  const lower = source.toLowerCase();
  const index = lower.indexOf(query);
  if (index === -1) return source.slice(0, 320);

  const start = Math.max(0, index - 120);
  const end = Math.min(source.length, index + query.length + 200);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

function scoreDocument(document: KnowledgeDocument, query: string): number {
  if (!query) return 1;

  let score = 0;
  const title = document.title.toLowerCase();
  const excerpt = (document.excerpt || "").toLowerCase();
  const summary = (document.summaryMd || "").toLowerCase();
  const content = document.contentMd.toLowerCase();
  const tags = document.tags.join(" ").toLowerCase();

  if (title.includes(query)) score += 8;
  if (tags.includes(query)) score += 5;
  if (excerpt.includes(query)) score += 3;
  if (summary.includes(query)) score += 2;
  if (content.includes(query)) score += 1;
  return score;
}

function createDocumentPath(
  document: KnowledgeDocument,
  documentsById: Map<string, KnowledgeDocument>,
): string {
  const path: string[] = [];
  const visited = new Set<string>();
  let current: KnowledgeDocument | undefined = document;

  while (current) {
    if (visited.has(current.id)) {
      path.unshift(ORPHANED_PARENT_TITLE);
      break;
    }
    visited.add(current.id);

    path.unshift(current.title.trim() || UNTITLED_DOCUMENT_TITLE);
    if (!current.parentId) break;

    const parent = documentsById.get(current.parentId);
    if (!parent) {
      path.unshift(ORPHANED_PARENT_TITLE);
      break;
    }
    current = parent;
  }

  return [KNOWLEDGE_ROOT_TITLE, ...path].join(" / ");
}

function createDocumentMap(documents: KnowledgeDocument[]): Map<string, KnowledgeDocument> {
  return new Map(documents.map((document) => [document.id, document]));
}

function createChildrenByParentId(
  documents: KnowledgeDocument[],
): Map<string, KnowledgeDocument[]> {
  const childrenByParentId = new Map<string, KnowledgeDocument[]>();
  for (const document of documents) {
    if (!document.parentId) continue;
    const children = childrenByParentId.get(document.parentId) ?? [];
    children.push(document);
    childrenByParentId.set(document.parentId, children);
  }

  for (const [parentId, children] of childrenByParentId) {
    childrenByParentId.set(parentId, orderKnowledgeDocuments(children));
  }

  return childrenByParentId;
}

async function createPathContext(bookId?: string): Promise<Map<string, KnowledgeDocument>> {
  const documents = await getKnowledgeDocuments({ ...(bookId ? { bookId } : {}), limit: 5000 });
  return createDocumentMap(documents);
}

function createDraftTargetPath({
  title,
  parentId,
  documentsById,
}: {
  title: string;
  parentId?: string;
  documentsById: Map<string, KnowledgeDocument>;
}): string {
  const safeTitle = title.trim() || UNTITLED_DOCUMENT_TITLE;
  if (!parentId) return [KNOWLEDGE_ROOT_TITLE, safeTitle].join(" / ");

  const parent = documentsById.get(parentId);
  if (!parent) return [KNOWLEDGE_ROOT_TITLE, ORPHANED_PARENT_TITLE, safeTitle].join(" / ");
  return [createDocumentPath(parent, documentsById), safeTitle].join(" / ");
}

function documentSummary(
  document: KnowledgeDocument,
  query = "",
  includeContent = false,
  documentsById = createDocumentMap([document]),
  childrenByParentId = createChildrenByParentId([...documentsById.values()]),
) {
  const parent = document.parentId ? documentsById.get(document.parentId) : undefined;
  const children = childrenByParentId.get(document.id) ?? [];
  return {
    id: document.id,
    bookId: document.bookId,
    parentId: document.parentId,
    parentTitle: parent?.title,
    path: createDocumentPath(document, documentsById),
    type: document.type,
    isFolder: document.type === "folder",
    title: document.title,
    tags: document.tags,
    excerpt: document.excerpt,
    summary: document.summaryMd,
    snippet: createSnippet(document, query),
    childCount: children.length,
    children: children.slice(0, MAX_CHILD_CONTEXT_COUNT).map((child) => ({
      id: child.id,
      type: child.type,
      title: child.title,
      path: createDocumentPath(child, documentsById),
      updatedAt: child.updatedAt,
    })),
    updatedAt: document.updatedAt,
    content: includeContent ? document.contentMd : undefined,
  };
}

export function createSearchKnowledgeBaseTool(): ToolDefinition {
  return {
    name: "searchKnowledgeBase",
    description:
      "Search the user's ReadAny knowledge base documents across books and standalone notes. Use this when the user asks about their saved knowledge, book home pages, reviews, summaries, or long-form notes.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are searching the knowledge base",
        required: true,
      },
      query: {
        type: "string",
        description: "Keyword or phrase to search for in titles, tags, excerpts, and content",
      },
      bookId: {
        type: "string",
        description: "Optional book id to restrict the search to one book",
      },
      type: {
        type: "string",
        description:
          "Optional document type: book_home, folder, standalone_note, highlight_note, review, summary, imported_markdown, or all",
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return (default 8, max 30)",
      },
    },
    execute: async (args) => {
      const query = normalizeQuery(args.query);
      const bookId = String(args.bookId ?? "").trim() || undefined;
      const type = normalizeType(args.type);
      const limit = asPositiveLimit(args.limit, DEFAULT_RESULT_LIMIT);
      const documents = await searchKnowledgeDocuments({
        query,
        bookId,
        type,
        limit: SEARCH_SCAN_LIMIT,
      });
      const pathContextDocuments = await getKnowledgeDocuments({
        ...(bookId ? { bookId } : {}),
        limit: 5000,
      });
      const documentsById = createDocumentMap([...pathContextDocuments, ...documents]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);

      const scored = documents
        .map((document) => ({ document, score: scoreDocument(document, query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt);

      return {
        total: scored.length,
        showing: Math.min(scored.length, limit),
        documents: scored
          .slice(0, limit)
          .map((item) =>
            documentSummary(item.document, query, false, documentsById, childrenByParentId),
          ),
      };
    },
  };
}

export function createGetBookKnowledgeTool(bookId: string): ToolDefinition {
  return {
    name: "getBookKnowledge",
    description:
      "Get ReadAny knowledge documents for the current book, including the book home page, reviews, summaries, and expanded highlight notes. Use this to incorporate the user's own durable notes before answering.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you need this book's knowledge documents",
        required: true,
      },
      type: {
        type: "string",
        description:
          "Optional document type: book_home, folder, standalone_note, highlight_note, review, summary, imported_markdown, or all",
      },
      includeContent: {
        type: "boolean",
        description: "Return full Markdown content instead of only snippets and excerpts",
      },
      limit: {
        type: "number",
        description: "Maximum number of documents to return (default 8, max 30)",
      },
    },
    execute: async (args) => {
      const type = normalizeType(args.type);
      const includeContent = args.includeContent === true;
      const limit = asPositiveLimit(args.limit, DEFAULT_RESULT_LIMIT);
      const documents = await getKnowledgeDocuments({ bookId, type, limit });
      const pathContextDocuments = await getKnowledgeDocuments({ bookId, limit: 5000 });
      const documentsById = createDocumentMap([...pathContextDocuments, ...documents]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);

      return {
        bookId,
        total: documents.length,
        documents: documents.map((document) =>
          documentSummary(document, "", includeContent, documentsById, childrenByParentId),
        ),
      };
    },
  };
}

export function createCompressKnowledgeDocumentSummaryTool(aiConfig: AIConfig): ToolDefinition {
  return {
    name: "compressKnowledgeDocumentSummary",
    description:
      "Compress and persist a derived summary cache for a long ReadAny knowledge document. This does not rewrite the user's document content; it only updates the summary used for future retrieval and memory.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why this knowledge document needs compact memory",
        required: true,
      },
      documentId: {
        type: "string",
        description: "Knowledge document id to summarize",
        required: true,
      },
      minSourceChars: {
        type: "number",
        description:
          "Optional minimum source length before compression. Defaults to the app threshold.",
      },
      maxSourceChars: {
        type: "number",
        description:
          "Optional maximum source characters sent to the model. Defaults to the app threshold.",
      },
      maxSummaryChars: {
        type: "number",
        description:
          "Optional maximum summary characters to persist. Defaults to the app threshold.",
      },
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) return { success: false, error: "Knowledge document not found" };

      const minSourceChars = asPositiveNumber(args.minSourceChars);
      const maxSourceChars = asPositiveNumber(args.maxSourceChars);
      const maxSummaryChars = asPositiveNumber(args.maxSummaryChars);
      const compressionOptions = {
        ...(minSourceChars ? { minSourceChars } : {}),
        ...(maxSourceChars ? { maxSourceChars } : {}),
        ...(maxSummaryChars ? { maxSummaryChars } : {}),
      };
      const result = await maybeCompressAndPersistKnowledgeSummary(
        document,
        aiConfig,
        compressionOptions,
      );
      const pathContextDocuments = await getKnowledgeDocuments({
        ...(document.bookId ? { bookId: document.bookId } : {}),
        limit: 5000,
      });
      const documentsById = createDocumentMap([...pathContextDocuments, document]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);
      const summary = documentSummary(document, "", false, documentsById, childrenByParentId);

      return {
        success: result.status !== "failed",
        status: result.status,
        persisted: result.persisted,
        documentId,
        path: summary.path,
        document: summary,
        reason: result.plan.reason,
        sourceChars: result.plan.sourceChars,
        summaryMd: result.summaryMd ?? result.state?.summaryMd ?? document.summaryMd,
        error: result.error,
      };
    },
  };
}

export function createProposeKnowledgeDocumentCreateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeDocumentCreate",
    description:
      "Create a confirmation-required draft for a new ReadAny knowledge document. This tool NEVER saves data. Use it when the user asks AI to create a durable note, summary, review, or knowledge document, then ask the user to confirm applying the draft.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are drafting a new knowledge document",
        required: true,
      },
      title: {
        type: "string",
        description: "Proposed document title",
        required: true,
      },
      contentMd: {
        type: "string",
        description: "Proposed Markdown content for the document",
        required: true,
      },
      type: {
        type: "string",
        description:
          "Document type: folder, standalone_note, review, summary, highlight_note, imported_markdown, or book_home. Defaults to standalone_note.",
      },
      bookId: {
        type: "string",
        description: "Optional book id to attach the draft to a book",
      },
      parentId: {
        type: "string",
        description:
          "Optional parent folder document id. Use root, none, null, or omit to place the draft at the knowledge root.",
      },
      tags: {
        type: "string",
        description: 'Optional tags as comma-separated text or JSON array, e.g. "reading,summary"',
      },
    },
    execute: async (args) => {
      const title = String(args.title ?? "").trim();
      const contentMd = String(args.contentMd ?? "");
      if (!title) return { success: false, error: "title is required" };

      let tags: string[] | undefined;
      try {
        tags = parseTags(args.tags);
      } catch (error) {
        return { success: false, error: `Invalid tags: ${(error as Error).message}` };
      }

      const bookId = String(args.bookId ?? "").trim() || undefined;
      const parentId = normalizeParentId(args.parentId);
      const type = normalizeDocumentType(args.type);
      const parentContext = await resolveCreateParentContext({ type, bookId, parentId });
      if (parentContext.error) return { success: false, error: parentContext.error };
      const contentJson = markdownToKnowledgeJson(contentMd);
      const documentsById = parentId
        ? await createPathContext(parentContext.bookId)
        : createDocumentMap([]);
      if (parentContext.parent) {
        documentsById.set(parentContext.parent.id, parentContext.parent);
      }

      return {
        success: true,
        action: "create",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_create",
        message: "Draft generated only. No knowledge document has been saved.",
        targetPath: createDraftTargetPath({ title, parentId, documentsById }),
        draft: {
          id: generateId(),
          type,
          title,
          bookId: parentContext.bookId,
          parentId,
          tags: tags ?? [],
          contentMd,
          contentJson,
          excerpt: createExcerpt(contentMd),
          sourceKind: bookId ? "book" : undefined,
          sourceId: bookId,
        },
      };
    },
  };
}

export function createProposeKnowledgeDocumentUpdateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeDocumentUpdate",
    description:
      "Create a confirmation-required patch for an existing ReadAny knowledge document. This tool NEVER saves data. Use it when the user asks AI to update a knowledge note, summary, review, tags, or title, then ask the user to confirm applying the patch.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are drafting a document update",
        required: true,
      },
      documentId: {
        type: "string",
        description: "Knowledge document id to update",
        required: true,
      },
      title: {
        type: "string",
        description: "Optional replacement title",
      },
      contentMd: {
        type: "string",
        description: "Optional replacement Markdown content",
      },
      tags: {
        type: "string",
        description: "Optional replacement tags as comma-separated text or JSON array",
      },
      parentId: {
        type: "string",
        description:
          "Optional parent folder document id to move the document. Use root, none, or null to move it to the knowledge root.",
      },
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) return { success: false, error: "Knowledge document not found" };

      const patch: Partial<
        Pick<
          KnowledgeDocument,
          "parentId" | "title" | "contentMd" | "contentJson" | "excerpt" | "tags"
        >
      > = {};
      const changedFields: string[] = [];

      if (Object.prototype.hasOwnProperty.call(args, "parentId")) {
        const parentId = normalizeParentId(args.parentId);
        if ((parentId || undefined) !== (document.parentId || undefined)) {
          const parentError = await validateUpdateParentChange(document, parentId);
          if (parentError) return { success: false, error: parentError, documentId };
          patch.parentId = parentId;
          changedFields.push("parentId");
        }
      }

      if (Object.prototype.hasOwnProperty.call(args, "title")) {
        const title = String(args.title ?? "").trim();
        if (title && title !== document.title) {
          patch.title = title;
          changedFields.push("title");
        }
      }

      if (Object.prototype.hasOwnProperty.call(args, "contentMd")) {
        const contentMd = String(args.contentMd ?? "");
        if (contentMd !== document.contentMd) {
          patch.contentMd = contentMd;
          patch.contentJson = markdownToKnowledgeJson(contentMd);
          patch.excerpt = createExcerpt(contentMd);
          changedFields.push("contentMd", "contentJson", "excerpt");
        }
      }

      if (Object.prototype.hasOwnProperty.call(args, "tags")) {
        let tags: string[] | undefined;
        try {
          tags = parseTags(args.tags) ?? [];
        } catch (error) {
          return { success: false, error: `Invalid tags: ${(error as Error).message}` };
        }
        if (JSON.stringify(tags) !== JSON.stringify(document.tags)) {
          patch.tags = tags;
          changedFields.push("tags");
        }
      }

      if (changedFields.length === 0) {
        return {
          success: false,
          error: "No changes were proposed",
          documentId,
        };
      }
      const pathContextDocuments = await getKnowledgeDocuments({
        ...(document.bookId ? { bookId: document.bookId } : {}),
        limit: 5000,
      });
      const currentDocumentsById = createDocumentMap([...pathContextDocuments, document]);
      const currentChildrenByParentId = createChildrenByParentId([
        ...currentDocumentsById.values(),
      ]);
      const projectedDocument: KnowledgeDocument = {
        ...document,
        ...(patch.parentId !== undefined || Object.prototype.hasOwnProperty.call(patch, "parentId")
          ? { parentId: patch.parentId }
          : {}),
        ...(patch.title ? { title: patch.title } : {}),
      };
      const targetDocumentsById = createDocumentMap([...pathContextDocuments, projectedDocument]);
      const targetChildrenByParentId = createChildrenByParentId([...targetDocumentsById.values()]);

      return {
        success: true,
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        message: "Patch generated only. The existing knowledge document has not been changed.",
        documentId,
        current: documentSummary(
          document,
          "",
          false,
          currentDocumentsById,
          currentChildrenByParentId,
        ),
        targetPath: createDocumentPath(projectedDocument, targetDocumentsById),
        target: documentSummary(
          projectedDocument,
          "",
          false,
          targetDocumentsById,
          targetChildrenByParentId,
        ),
        patch,
        changedFields,
      };
    },
  };
}

export function createProposeKnowledgeDocumentTagsUpdateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeDocumentTagsUpdate",
    description:
      "Create a confirmation-required tag update for an existing ReadAny knowledge document. This tool NEVER saves data. Use it when the user asks AI to organize, add, remove, or replace tags on knowledge documents.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are changing knowledge document tags",
        required: true,
      },
      documentId: {
        type: "string",
        description: "Knowledge document id whose tags should change",
        required: true,
      },
      mode: {
        type: "string",
        description: "Tag operation: add, remove, or set. Defaults to add.",
      },
      tags: {
        type: "string",
        description: 'Tags as comma-separated text or JSON array, e.g. "theme,memory"',
        required: true,
      },
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) return { success: false, error: "Knowledge document not found" };

      let requestedTags: string[] | undefined;
      try {
        requestedTags = parseTags(args.tags);
      } catch (error) {
        return { success: false, error: `Invalid tags: ${(error as Error).message}` };
      }
      if (!requestedTags || requestedTags.length === 0) {
        return { success: false, error: "tags is required" };
      }

      const mode = normalizeTagMode(args.mode);
      const nextTags = applyTagMode(document.tags, requestedTags, mode);
      if (JSON.stringify(nextTags) === JSON.stringify(document.tags)) {
        return {
          success: false,
          error: "No tag changes were proposed",
          documentId,
        };
      }

      const pathContextDocuments = await getKnowledgeDocuments({
        ...(document.bookId ? { bookId: document.bookId } : {}),
        limit: 5000,
      });
      const documentsById = createDocumentMap([...pathContextDocuments, document]);
      const childrenByParentId = createChildrenByParentId([...documentsById.values()]);

      return {
        success: true,
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        message: "Tag update generated only. The existing knowledge document has not been changed.",
        documentId,
        current: documentSummary(document, "", false, documentsById, childrenByParentId),
        targetPath: createDocumentPath(document, documentsById),
        target: documentSummary(
          { ...document, tags: nextTags },
          "",
          false,
          documentsById,
          childrenByParentId,
        ),
        patch: {
          tags: nextTags,
        },
        changedFields: ["tags"],
        tagMode: mode,
      };
    },
  };
}

export function createProposeKnowledgeLinkCreateTool(): ToolDefinition {
  return {
    name: "proposeKnowledgeLinkCreate",
    description:
      "Create a confirmation-required draft for linking a ReadAny knowledge document to another document, highlight, CFI, book, URL, Obsidian path, or AI message. This tool NEVER saves data; the user must confirm applying the link.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why this knowledge link is useful",
        required: true,
      },
      fromDocumentId: {
        type: "string",
        description: "Source knowledge document id",
        required: true,
      },
      toKind: {
        type: "string",
        description: "Target kind: book, highlight, document, cfi, url, ai_message, or obsidian",
        required: true,
      },
      toId: {
        type: "string",
        description: "Target id, URL, CFI, or Obsidian path",
        required: true,
      },
      relation: {
        type: "string",
        description: "Relation: source, references, backlink, related, contains, or generated_from",
      },
      label: {
        type: "string",
        description: "Optional human-readable label for the link",
      },
      cfi: {
        type: "string",
        description: "Optional CFI when linking to an exact book location or highlight",
      },
    },
    execute: async (args) => {
      const fromDocumentId = String(args.fromDocumentId ?? "").trim();
      const toId = String(args.toId ?? "").trim();
      const toKind = normalizeLinkTargetKind(args.toKind);
      const relation = normalizeLinkRelation(args.relation) ?? "related";
      const label = String(args.label ?? "").trim() || undefined;
      const cfi = String(args.cfi ?? "").trim() || undefined;

      if (!fromDocumentId) return { success: false, error: "fromDocumentId is required" };
      if (!toKind) return { success: false, error: "Invalid toKind" };
      if (!toId) return { success: false, error: "toId is required" };

      const source = await getKnowledgeDocument(fromDocumentId);
      if (!source) return { success: false, error: "Source knowledge document not found" };

      if (toKind === "document") {
        const target = await getKnowledgeDocument(toId);
        if (!target) return { success: false, error: "Target knowledge document not found" };
      }

      return {
        success: true,
        action: "link",
        requiresConfirmation: true,
        confirmationKind: "knowledge_link_create",
        message: "Link draft generated only. No knowledge link has been saved.",
        link: {
          id: generateId(),
          fromDocumentId,
          toKind,
          toId,
          relation,
          label,
          cfi,
        },
      };
    },
  };
}
