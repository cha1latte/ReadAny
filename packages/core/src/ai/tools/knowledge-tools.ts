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
import { markdownToBasicTiptap } from "../../knowledge/editor-projection";
import type {
  JSONValue,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLinkRelation,
  KnowledgeLinkTargetKind,
} from "../../types";
import { generateId } from "../../utils/generate-id";
import type { ToolDefinition } from "./tool-types";

const SEARCH_SCAN_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 8;
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

function asPositiveLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 30) : fallback;
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

function documentSummary(document: KnowledgeDocument, query = "", includeContent = false) {
  return {
    id: document.id,
    bookId: document.bookId,
    type: document.type,
    title: document.title,
    tags: document.tags,
    excerpt: document.excerpt,
    summary: document.summaryMd,
    snippet: createSnippet(document, query),
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
          "Optional document type: book_home, standalone_note, highlight_note, review, summary, imported_markdown, or all",
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

      const scored = documents
        .map((document) => ({ document, score: scoreDocument(document, query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.document.updatedAt - a.document.updatedAt);

      return {
        total: scored.length,
        showing: Math.min(scored.length, limit),
        documents: scored
          .slice(0, limit)
          .map((item) => documentSummary(item.document, query, false)),
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
          "Optional document type: book_home, standalone_note, highlight_note, review, summary, imported_markdown, or all",
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

      return {
        bookId,
        total: documents.length,
        documents: documents.map((document) => documentSummary(document, "", includeContent)),
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
          "Document type: standalone_note, review, summary, highlight_note, imported_markdown, or book_home. Defaults to standalone_note.",
      },
      bookId: {
        type: "string",
        description: "Optional book id to attach the draft to a book",
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
      const type = normalizeDocumentType(args.type);
      const contentJson = markdownToKnowledgeJson(contentMd);

      return {
        success: true,
        action: "create",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_create",
        message: "Draft generated only. No knowledge document has been saved.",
        draft: {
          id: generateId(),
          type,
          title,
          bookId,
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
    },
    execute: async (args) => {
      const documentId = String(args.documentId ?? "").trim();
      if (!documentId) return { success: false, error: "documentId is required" };

      const document = await getKnowledgeDocument(documentId);
      if (!document) return { success: false, error: "Knowledge document not found" };

      const patch: Partial<
        Pick<KnowledgeDocument, "title" | "contentMd" | "contentJson" | "excerpt" | "tags">
      > = {};
      const changedFields: string[] = [];

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

      return {
        success: true,
        action: "update",
        requiresConfirmation: true,
        confirmationKind: "knowledge_document_update",
        message: "Patch generated only. The existing knowledge document has not been changed.",
        documentId,
        current: documentSummary(document, "", false),
        patch,
        changedFields,
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
