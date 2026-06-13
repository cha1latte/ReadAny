import { getKnowledgeDocuments } from "../db/database";
import { formatKnowledgeDocumentPath } from "../knowledge/document-utils";
import type { KnowledgeDocument } from "../types";

const DEFAULT_MAX_DOCUMENTS = 6;
const DEFAULT_MAX_CHARS = 2600;
const DOCUMENT_SCAN_LIMIT = 5000;
const ROOT_TITLE = "Knowledge base";
const UNTITLED_TITLE = "Untitled document";
const ORPHANED_TITLE = "Orphaned";

export interface KnowledgePromptContextOptions {
  bookId?: string | null;
  maxDocuments?: number;
  maxChars?: number;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdown(value: string): string {
  return compactText(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/[#>*_`~|[\]()]/g, " "),
  );
}

function truncateText(value: string, maxLength: number): string {
  const compacted = compactText(value);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function documentPriority(document: KnowledgeDocument): number {
  const typeScore: Record<KnowledgeDocument["type"], number> = {
    book_home: 100,
    summary: 85,
    review: 80,
    standalone_note: 65,
    imported_markdown: 55,
    highlight_note: 45,
    folder: 10,
  };
  const contentScore =
    (document.summaryMd?.trim() ? 14 : 0) +
    (document.excerpt?.trim() ? 8 : 0) +
    (document.contentMd?.trim() ? 4 : 0);
  return typeScore[document.type] + contentScore;
}

function sortKnowledgeContextDocuments(documents: KnowledgeDocument[]): KnowledgeDocument[] {
  return [...documents].sort(
    (left, right) =>
      documentPriority(right) - documentPriority(left) ||
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt,
  );
}

function createDocumentPreview(document: KnowledgeDocument): string {
  const source = document.summaryMd || document.excerpt || document.contentMd;
  return source ? truncateText(stripMarkdown(source), 280) : "";
}

function formatDocumentForPrompt(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
): string {
  const title = compactText(document.title) || UNTITLED_TITLE;
  const path = formatKnowledgeDocumentPath(document, documents, {
    rootTitle: ROOT_TITLE,
    untitledTitle: UNTITLED_TITLE,
    orphanedParentTitle: ORPHANED_TITLE,
    includeOrphanedParent: true,
  });
  const tags = document.tags.length > 0 ? `\n  tags: ${document.tags.join(", ")}` : "";
  const preview = createDocumentPreview(document);
  const previewLine = preview ? `\n  note: ${preview}` : "";

  return `- [${document.type}] ${title}\n  id: ${document.id}\n  path: ${path}${tags}${previewLine}`;
}

export function buildKnowledgePromptContext(
  documents: KnowledgeDocument[],
  options: Omit<KnowledgePromptContextOptions, "bookId"> = {},
): string | undefined {
  const maxDocuments = Math.max(1, Math.floor(options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS));
  const maxChars = Math.max(600, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS));
  const candidates = sortKnowledgeContextDocuments(documents)
    .filter((document) => !document.deletedAt && document.type !== "folder")
    .slice(0, maxDocuments);

  if (candidates.length === 0) return undefined;

  const intro =
    "Bounded snapshot of the user's durable knowledge documents for the current book. This is not the full vault. Use document ids with getKnowledgeDocument for exact reads before quoting, updating, or relying on a long document.";
  const lines = [intro];

  for (const document of candidates) {
    const nextLine = formatDocumentForPrompt(document, documents);
    const nextText = [...lines, nextLine].join("\n");
    if (nextText.length > maxChars) {
      if (lines.length === 1) {
        lines.push(truncateText(nextLine, maxChars - intro.length - 1));
      }
      break;
    }
    lines.push(nextLine);
  }

  return lines.length > 1 ? lines.join("\n") : undefined;
}

export async function loadKnowledgePromptContext(
  options: KnowledgePromptContextOptions,
): Promise<string | undefined> {
  const bookId = options.bookId?.trim();
  if (!bookId) return undefined;

  try {
    const documents = await getKnowledgeDocuments({ bookId, limit: DOCUMENT_SCAN_LIMIT });
    return buildKnowledgePromptContext(documents, options);
  } catch (error) {
    console.warn("[knowledge-context] Failed to load knowledge prompt context:", error);
    return undefined;
  }
}
