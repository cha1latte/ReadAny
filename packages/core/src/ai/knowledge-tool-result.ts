export type KnowledgeToolResultKind = "search" | "bookKnowledge" | "summary" | "failure";

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
  toolName?: string;
  total?: number;
  showing?: number;
  bookId?: string;
  status?: string;
  persisted?: boolean;
  reason?: string;
  error?: string;
  sourceChars?: number;
  documentId?: string;
  summaryPreview?: string;
  documents: KnowledgeToolResultDocument[];
}

const KNOWLEDGE_TOOL_NAMES = new Set([
  "searchKnowledgeBase",
  "getBookKnowledge",
  "compressKnowledgeDocumentSummary",
  "proposeKnowledgeDocumentCreate",
  "proposeKnowledgeDocumentUpdate",
  "proposeKnowledgeDocumentTagsUpdate",
  "proposeKnowledgeLinkCreate",
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

function asResultRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asFailureDisplay(
  toolName: string,
  result: Record<string, unknown>,
): KnowledgeToolResultDisplay | null {
  const error = asString(result.error);
  const message = asString(result.message);
  const reason = asString(result.reason);
  const success = asBoolean(result.success);
  if (success !== false && !error) return null;

  return {
    kind: "failure",
    toolName,
    status: asString(result.status),
    documentId: asString(result.documentId) || asString(result.fromDocumentId),
    reason,
    error: error || message || reason || "Tool execution failed",
    documents: [],
  };
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
  if (!KNOWLEDGE_TOOL_NAMES.has(toolName)) return null;

  const resultRecord = asResultRecord(result);
  if (!resultRecord) return null;

  const failureDisplay = asFailureDisplay(toolName, resultRecord);
  if (failureDisplay) return failureDisplay;

  if (toolName === "searchKnowledgeBase") {
    return {
      kind: "search",
      toolName,
      total: asNumber(resultRecord.total),
      showing: asNumber(resultRecord.showing),
      documents: asDocumentList(resultRecord.documents),
    };
  }

  if (toolName === "getBookKnowledge") {
    return {
      kind: "bookKnowledge",
      toolName,
      total: asNumber(resultRecord.total),
      bookId: asString(resultRecord.bookId),
      documents: asDocumentList(resultRecord.documents),
    };
  }

  if (toolName !== "compressKnowledgeDocumentSummary") return null;

  return {
    kind: "summary",
    toolName,
    status: asString(resultRecord.status),
    persisted: asBoolean(resultRecord.persisted),
    reason: asString(resultRecord.reason),
    sourceChars: asNumber(resultRecord.sourceChars),
    documentId: asString(resultRecord.documentId),
    summaryPreview: compactMarkdownPreview(resultRecord.summaryMd),
    documents: [],
  };
}
