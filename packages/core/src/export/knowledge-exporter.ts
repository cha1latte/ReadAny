import { renderKnowledgeJsonToMarkdown } from "../knowledge/editor-projection";
import type { Book, KnowledgeAttachment, KnowledgeDocument, KnowledgeLink } from "../types";

export type KnowledgeExportFormat = "markdown" | "obsidian";

export interface KnowledgeExportFile {
  path: string;
  content: string;
  mimeType: "text/markdown";
}

export interface KnowledgeExportInput {
  documents: KnowledgeDocument[];
  books?: Book[];
  links?: KnowledgeLink[];
  attachments?: KnowledgeAttachment[];
}

export interface KnowledgeExportOptions {
  format?: KnowledgeExportFormat;
  rootDir?: string;
  includeDeleted?: boolean;
  includeReadAnyCardMetadata?: boolean;
}

interface ExportContext {
  booksById: Map<string, Book>;
  documentsById: Map<string, KnowledgeDocument>;
  linksByDocumentId: Map<string, KnowledgeLink[]>;
  attachmentsByDocumentId: Map<string, KnowledgeAttachment[]>;
}

function slugPart(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 80);
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(values: string[]): string[] {
  if (values.length === 0) return ["tags: []"];
  return ["tags:", ...values.map((value) => `  - ${yamlString(value)}`)];
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function createContext(input: KnowledgeExportInput): ExportContext {
  const booksById = new Map((input.books ?? []).map((book) => [book.id, book]));
  const documentsById = new Map(input.documents.map((document) => [document.id, document]));
  const linksByDocumentId = new Map<string, KnowledgeLink[]>();
  const attachmentsByDocumentId = new Map<string, KnowledgeAttachment[]>();

  for (const link of input.links ?? []) {
    const links = linksByDocumentId.get(link.fromDocumentId) ?? [];
    links.push(link);
    linksByDocumentId.set(link.fromDocumentId, links);
  }

  for (const attachment of input.attachments ?? []) {
    if (!attachment.documentId) continue;
    const attachments = attachmentsByDocumentId.get(attachment.documentId) ?? [];
    attachments.push(attachment);
    attachmentsByDocumentId.set(attachment.documentId, attachments);
  }

  return { booksById, documentsById, linksByDocumentId, attachmentsByDocumentId };
}

function documentBody(document: KnowledgeDocument, options: Required<KnowledgeExportOptions>) {
  return (
    renderKnowledgeJsonToMarkdown(document.contentJson, {
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata,
    }) ||
    document.contentMd ||
    ""
  ).trim();
}

function documentPath(
  document: KnowledgeDocument,
  context: ExportContext,
  options: Required<KnowledgeExportOptions>,
): string {
  const book = document.bookId ? context.booksById.get(document.bookId) : undefined;
  const fileName =
    document.type === "book_home"
      ? "README"
      : slugPart(document.title, document.type || "knowledge");

  const scopedPath = book
    ? joinPath("Books", slugPart(book.meta.title, document.bookId ?? "book"), `${fileName}.md`)
    : joinPath("Notes", `${slugPart(document.title, document.id)}.md`);

  return joinPath(options.rootDir, scopedPath);
}

function renderLinkItem(link: KnowledgeLink, context: ExportContext): string {
  const label = link.label || link.relation;

  if (link.toKind === "document") {
    const target = context.documentsById.get(link.toId);
    return `- **${link.relation}:** ${target ? `[[${target.title}]]` : `[[${link.toId}]]`}`;
  }

  const target =
    link.toKind === "url"
      ? link.toId
      : link.cfi
        ? `readany://cfi/${encodeURIComponent(link.cfi)}`
        : `readany://${link.toKind}/${encodeURIComponent(link.toId)}`;
  return `- **${link.relation}:** [${label}](${target})`;
}

function renderLinks(document: KnowledgeDocument, context: ExportContext): string[] {
  const links = context.linksByDocumentId.get(document.id) ?? [];
  if (links.length === 0) return [];

  return ["## ReadAny Links", "", ...links.map((link) => renderLinkItem(link, context))];
}

function renderAttachments(document: KnowledgeDocument, context: ExportContext): string[] {
  const attachments = context.attachmentsByDocumentId.get(document.id) ?? [];
  if (attachments.length === 0) return [];

  return [
    "## Attachments",
    "",
    ...attachments.map((attachment) => {
      const target = attachment.remotePath || attachment.localPath || attachment.fileName;
      return `- [${attachment.fileName}](${target})`;
    }),
  ];
}

function renderFrontmatter(document: KnowledgeDocument, context: ExportContext): string[] {
  const book = document.bookId ? context.booksById.get(document.bookId) : undefined;
  const lines = [
    "---",
    "type: readany-knowledge",
    `id: ${yamlString(document.id)}`,
    `documentType: ${yamlString(document.type)}`,
    `title: ${yamlString(document.title)}`,
  ];

  if (document.bookId) lines.push(`bookId: ${yamlString(document.bookId)}`);
  if (book) {
    lines.push(`book: ${yamlString(book.meta.title)}`);
    if (book.meta.author) lines.push(`author: ${yamlString(book.meta.author)}`);
  }
  if (document.sourceKind) lines.push(`sourceKind: ${yamlString(document.sourceKind)}`);
  if (document.sourceId) lines.push(`sourceId: ${yamlString(document.sourceId)}`);
  lines.push(`created: ${yamlString(isoDate(document.createdAt))}`);
  lines.push(`updated: ${yamlString(isoDate(document.updatedAt))}`);
  lines.push(...yamlList(document.tags));
  lines.push("---");
  return lines;
}

function renderDocument(
  document: KnowledgeDocument,
  context: ExportContext,
  options: Required<KnowledgeExportOptions>,
): string {
  const body = documentBody(document, options);
  const sections = [
    ...(options.format === "obsidian" ? renderFrontmatter(document, context) : []),
    `# ${document.title}`,
    "",
    body,
    "",
    ...renderLinks(document, context),
    "",
    ...renderAttachments(document, context),
  ];

  return sections
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()
    .concat("\n");
}

function withUniquePaths(files: KnowledgeExportFile[]): KnowledgeExportFile[] {
  const seen = new Map<string, number>();

  return files.map((file) => {
    const count = seen.get(file.path) ?? 0;
    seen.set(file.path, count + 1);
    if (count === 0) return file;

    const nextPath = file.path.replace(/\.md$/i, `-${count + 1}.md`);
    return { ...file, path: nextPath };
  });
}

export class KnowledgeExporter {
  export(input: KnowledgeExportInput, options: KnowledgeExportOptions = {}): KnowledgeExportFile[] {
    const opts: Required<KnowledgeExportOptions> = {
      format: options.format ?? "obsidian",
      rootDir: options.rootDir ?? "",
      includeDeleted: options.includeDeleted ?? false,
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata ?? false,
    };
    const context = createContext(input);
    const documents = opts.includeDeleted
      ? input.documents
      : input.documents.filter((document) => !document.deletedAt);

    const files = documents.map<KnowledgeExportFile>((document) => ({
      path: documentPath(document, context, opts),
      content: renderDocument(document, context, opts),
      mimeType: "text/markdown",
    }));

    return withUniquePaths(files);
  }
}

export const knowledgeExporter = new KnowledgeExporter();
