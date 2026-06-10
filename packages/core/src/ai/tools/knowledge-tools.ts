/**
 * Knowledge Tools — let AI read the user's ReadAny knowledge base.
 *
 * These tools are intentionally read-only. Mutating knowledge documents should
 * go through a confirmation-capable UI flow so AI never silently overwrites a
 * user's durable notes.
 */
import { getKnowledgeDocuments } from "../../db/database";
import type { KnowledgeDocument, KnowledgeDocumentType } from "../../types";
import type { ToolDefinition } from "./tool-types";

const SEARCH_SCAN_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 8;

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

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function createSnippet(document: KnowledgeDocument, query: string): string {
  const source = compactText(document.excerpt || document.contentMd || "");
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
  const content = document.contentMd.toLowerCase();
  const tags = document.tags.join(" ").toLowerCase();

  if (title.includes(query)) score += 8;
  if (tags.includes(query)) score += 5;
  if (excerpt.includes(query)) score += 3;
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
      const documents = await getKnowledgeDocuments({
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
