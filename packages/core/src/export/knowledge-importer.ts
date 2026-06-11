import type { CreateKnowledgeDocumentInput } from "../db/database";
import { createKnowledgeExcerpt, markdownToBasicTiptap } from "../knowledge";
import type { JSONValue, KnowledgeDocumentType, KnowledgeSourceKind } from "../types";
import { createKnowledgeExportHash } from "./knowledge-exporter";

export interface KnowledgeMarkdownImportInput {
  path?: string;
  content: string;
  defaultType?: KnowledgeDocumentType;
  bookId?: string;
}

export interface KnowledgeImportFrontmatter {
  type?: string;
  id?: string;
  documentType?: KnowledgeDocumentType;
  title?: string;
  bookId?: string;
  book?: string;
  author?: string;
  sourceKind?: KnowledgeSourceKind;
  sourceId?: string;
  created?: number;
  updated?: number;
  tags: string[];
}

export interface KnowledgeImportDocumentDraft {
  path?: string;
  hash: string;
  isReadAnyExport: boolean;
  frontmatter: KnowledgeImportFrontmatter;
  contentMd: string;
  draft: CreateKnowledgeDocumentInput;
  warnings: string[];
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

function parseQuotedValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\])/g, "$1")
      .trim();
  }
  return trimmed;
}

function parseScalar(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed === "[]") return [];
  return parseQuotedValue(trimmed);
}

function parseFrontmatterYaml(raw: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let listKey: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && listKey) {
      const existing = result[listKey];
      const values = Array.isArray(existing) ? existing : [];
      result[listKey] = [...values, parseQuotedValue(listItem[1])];
      continue;
    }

    const keyValue = line.match(/^([A-Za-z][\w-]*):(?:\s*(.*))?$/);
    if (!keyValue) continue;

    const key = keyValue[1];
    const value = keyValue[2] ?? "";
    if (value.trim()) {
      result[key] = parseScalar(value);
      listKey = null;
    } else {
      result[key] = [];
      listKey = key;
    }
  }

  return result;
}

function readString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  }
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTimestamp(value: string | string[] | undefined): number | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readDocumentType(value: string | string[] | undefined): KnowledgeDocumentType | undefined {
  const type = readString(value);
  return type && DOCUMENT_TYPES.has(type as KnowledgeDocumentType)
    ? (type as KnowledgeDocumentType)
    : undefined;
}

function readSourceKind(value: string | string[] | undefined): KnowledgeSourceKind | undefined {
  const sourceKind = readString(value);
  return sourceKind && SOURCE_KINDS.has(sourceKind as KnowledgeSourceKind)
    ? (sourceKind as KnowledgeSourceKind)
    : undefined;
}

function extractFrontmatter(content: string): {
  raw?: string;
  parsed: Record<string, string | string[]>;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { parsed: {}, body: normalized };
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return { parsed: {}, body: normalized };
  }

  const afterEnd = normalized.slice(end + 4);
  const raw = normalized.slice(4, end);
  return {
    raw,
    parsed: parseFrontmatterYaml(raw),
    body: afterEnd.startsWith("\n") ? afterEnd.slice(1) : afterEnd,
  };
}

function fileTitle(path?: string): string | undefined {
  if (!path) return undefined;
  const fileName = path.replace(/\\/g, "/").split("/").filter(Boolean).pop();
  return fileName?.replace(/\.[^.]+$/, "").trim() || undefined;
}

function firstHeadingTitle(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function removeLeadingDocumentTitle(markdown: string, title: string): string {
  const lines = markdown.trim().split("\n");
  if (lines[0]?.trim() === `# ${title.trim()}`) {
    lines.shift();
    if (lines[0]?.trim() === "") lines.shift();
  }
  return lines.join("\n").trim();
}

function stripGeneratedReadAnySections(markdown: string): string {
  const lines = markdown.trim().split("\n");
  const generatedSectionIndex = lines.findIndex((line) =>
    /^##\s+(ReadAny Links|Attachments)\s*$/.test(line.trim()),
  );
  if (generatedSectionIndex === -1) return markdown.trim();
  return lines.slice(0, generatedSectionIndex).join("\n").trim();
}

function normalizeFrontmatter(
  parsed: Record<string, string | string[]>,
): KnowledgeImportFrontmatter {
  return {
    type: readString(parsed.type),
    id: readString(parsed.id),
    documentType: readDocumentType(parsed.documentType),
    title: readString(parsed.title),
    bookId: readString(parsed.bookId),
    book: readString(parsed.book),
    author: readString(parsed.author),
    sourceKind: readSourceKind(parsed.sourceKind),
    sourceId: readString(parsed.sourceId),
    created: readTimestamp(parsed.created),
    updated: readTimestamp(parsed.updated),
    tags: readStringList(parsed.tags),
  };
}

export function parseKnowledgeMarkdownDocument(
  input: KnowledgeMarkdownImportInput,
): KnowledgeImportDocumentDraft {
  const frontmatter = extractFrontmatter(input.content);
  const metadata = normalizeFrontmatter(frontmatter.parsed);
  const isReadAnyExport = metadata.type === "readany-knowledge";
  const warnings: string[] = [];

  if (frontmatter.raw && !isReadAnyExport) {
    warnings.push("frontmatter_not_readany");
  }
  if (frontmatter.raw && !metadata.documentType && isReadAnyExport) {
    warnings.push("missing_document_type");
  }

  const title =
    metadata.title ??
    firstHeadingTitle(frontmatter.body) ??
    fileTitle(input.path) ??
    "Imported Knowledge";
  const documentType = metadata.documentType ?? input.defaultType ?? "imported_markdown";
  const contentMd = removeLeadingDocumentTitle(
    isReadAnyExport ? stripGeneratedReadAnySections(frontmatter.body) : frontmatter.body.trim(),
    title,
  );
  const contentJson = markdownToBasicTiptap(contentMd) as unknown as JSONValue;
  const sourceId = metadata.sourceId ?? input.path;
  const sourceKind = metadata.sourceKind ?? (input.path ? "obsidian" : "external");
  const bookId = input.bookId ?? metadata.bookId;

  return {
    path: input.path,
    hash: createKnowledgeExportHash(input.content),
    isReadAnyExport,
    frontmatter: metadata,
    contentMd,
    draft: {
      id: metadata.id,
      type: documentType,
      title,
      bookId,
      contentJson,
      contentMd,
      contentSchemaVersion: 1,
      excerpt: createKnowledgeExcerpt(contentMd),
      tags: metadata.tags,
      sourceKind,
      sourceId,
    },
    warnings,
  };
}
