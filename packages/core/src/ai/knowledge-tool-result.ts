export type KnowledgeToolResultKind =
  | "search"
  | "document"
  | "bookKnowledge"
  | "summary"
  | "failure";

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

export interface KnowledgeToolResultDisplayOptions {
  error?: unknown;
}

const KNOWLEDGE_TOOL_NAMES = new Set([
  "searchKnowledgeBase",
  "getKnowledgeDocument",
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

function asErrorString(value: unknown): string | undefined {
  if (value instanceof Error) return asString(value.message);
  return asString(value);
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function compactKnowledgePreview(value: unknown): string | undefined {
  const markdown = asString(value);
  if (!markdown) return undefined;
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
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
    documents: contextDocumentsFromResult(result),
  };
}

function createFailureDisplay(
  toolName: string,
  error: string,
  result?: Record<string, unknown>,
): KnowledgeToolResultDisplay {
  return {
    kind: "failure",
    toolName,
    status: result ? asString(result.status) : undefined,
    documentId: result ? asString(result.documentId) || asString(result.fromDocumentId) : undefined,
    reason: result ? asString(result.reason) : undefined,
    error,
    documents: result ? contextDocumentsFromResult(result) : [],
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
    snippet:
      asString(value.snippet) ||
      asString(value.excerpt) ||
      asString(value.summary) ||
      compactKnowledgePreview(value.content),
    childCount: asNumber(value.childCount),
  };
}

function asDocumentList(value: unknown): KnowledgeToolResultDocument[] {
  if (!Array.isArray(value)) return [];
  return value.map(asDocumentSummary).filter((item): item is KnowledgeToolResultDocument => !!item);
}

function contextDocumentsFromResult(result: Record<string, unknown>): KnowledgeToolResultDocument[] {
  const directDocument = asDocumentSummary(result.document);
  if (directDocument) return [directDocument];

  const targetDocument = isRecord(result.target) ? asDocumentSummary(result.target) : null;
  if (targetDocument) return [targetDocument];

  const currentDocument = isRecord(result.current) ? asDocumentSummary(result.current) : null;
  if (currentDocument) return [currentDocument];

  const documentId = asString(result.documentId) || asString(result.fromDocumentId);
  const path =
    asString(result.path) ||
    asString(result.targetPath) ||
    (isRecord(result.target) ? asString(result.target.path) : undefined) ||
    (isRecord(result.current) ? asString(result.current.path) : undefined);
  const title = asString(result.title) || path;

  return title
    ? [
        {
          id: documentId,
          title,
          path,
        },
      ]
    : [];
}

function compactMarkdownPreview(value: unknown): string | undefined {
  return compactKnowledgePreview(value);
}

export function getKnowledgeToolResultDisplay(
  toolName: string,
  result: unknown,
  options: KnowledgeToolResultDisplayOptions = {},
): KnowledgeToolResultDisplay | null {
  if (!KNOWLEDGE_TOOL_NAMES.has(toolName)) return null;

  const directError = asErrorString(options.error);
  const resultRecord = asResultRecord(result);
  if (!resultRecord) return directError ? createFailureDisplay(toolName, directError) : null;

  const failureDisplay = asFailureDisplay(toolName, resultRecord);
  if (failureDisplay) return failureDisplay;
  if (directError) return createFailureDisplay(toolName, directError, resultRecord);

  if (toolName === "searchKnowledgeBase") {
    return {
      kind: "search",
      toolName,
      total: asNumber(resultRecord.total),
      showing: asNumber(resultRecord.showing),
      documents: asDocumentList(resultRecord.documents),
    };
  }

  if (toolName === "getKnowledgeDocument") {
    return {
      kind: "document",
      toolName,
      total: 1,
      bookId: asString(resultRecord.bookId),
      documentId: asString(resultRecord.documentId),
      documents: contextDocumentsFromResult(resultRecord),
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

  const summaryDocument = asDocumentSummary(resultRecord.document);
  const summaryPath = asString(resultRecord.path);
  const summaryDocumentId = asString(resultRecord.documentId);

  return {
    kind: "summary",
    toolName,
    status: asString(resultRecord.status),
    persisted: asBoolean(resultRecord.persisted),
    reason: asString(resultRecord.reason),
    sourceChars: asNumber(resultRecord.sourceChars),
    documentId: summaryDocumentId,
    summaryPreview: compactMarkdownPreview(resultRecord.summaryMd),
    documents: summaryDocument
      ? [summaryDocument]
      : summaryPath || summaryDocumentId
        ? [
            {
              id: summaryDocumentId,
              title: summaryPath || summaryDocumentId || "Knowledge document",
              path: summaryPath,
            },
          ]
        : [],
  };
}
