export type KnowledgeToolResultKind = "search" | "bookKnowledge" | "summary";

export interface KnowledgeToolResultDocument {
  id?: string;
  title: string;
  path?: string;
  type?: string;
  snippet?: string;
  childCount?: number;
}

export interface KnowledgeToolResultDisplay {
  kind: KnowledgeToolResultKind;
  total?: number;
  showing?: number;
  bookId?: string;
  status?: string;
  persisted?: boolean;
  reason?: string;
  sourceChars?: number;
  documentId?: string;
  summaryPreview?: string;
  documents: KnowledgeToolResultDocument[];
}

const KNOWLEDGE_RESULT_TOOLS = new Set([
  "searchKnowledgeBase",
  "getBookKnowledge",
  "compressKnowledgeDocumentSummary",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asDocumentSummary(value: unknown): KnowledgeToolResultDocument | null {
  if (!isRecord(value)) return null;

  const title = asString(value.title) || asString(value.id);
  if (!title) return null;

  return {
    id: asString(value.id),
    title,
    path: asString(value.path),
    type: asString(value.type),
    snippet: asString(value.snippet) || asString(value.excerpt) || asString(value.summary),
    childCount: asNumber(value.childCount),
  };
}

function asDocumentList(value: unknown): KnowledgeToolResultDocument[] {
  if (!Array.isArray(value)) return [];
  return value.map(asDocumentSummary).filter((item): item is KnowledgeToolResultDocument => !!item);
}

function compactMarkdownPreview(value: unknown): string | undefined {
  const markdown = asString(value);
  if (!markdown) return undefined;
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

export function getKnowledgeToolResultDisplay(
  toolName: string,
  result: unknown,
): KnowledgeToolResultDisplay | null {
  if (!KNOWLEDGE_RESULT_TOOLS.has(toolName) || !isRecord(result)) return null;

  if (toolName === "searchKnowledgeBase") {
    return {
      kind: "search",
      total: asNumber(result.total),
      showing: asNumber(result.showing),
      documents: asDocumentList(result.documents),
    };
  }

  if (toolName === "getBookKnowledge") {
    return {
      kind: "bookKnowledge",
      total: asNumber(result.total),
      bookId: asString(result.bookId),
      documents: asDocumentList(result.documents),
    };
  }

  return {
    kind: "summary",
    status: asString(result.status),
    persisted: asBoolean(result.persisted),
    reason: asString(result.reason),
    sourceChars: asNumber(result.sourceChars),
    documentId: asString(result.documentId),
    summaryPreview: compactMarkdownPreview(result.summaryMd),
    documents: [],
  };
}
