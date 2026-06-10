import { renderKnowledgeJsonToMarkdown } from "../knowledge/editor-projection";
import type { Book, KnowledgeAttachment, KnowledgeDocument, KnowledgeLink } from "../types";

export type KnowledgeExportFormat = "markdown" | "obsidian";

export interface KnowledgeExportFile {
  path: string;
  content: string;
  mimeType: "application/json" | "text/markdown";
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

export interface KnowledgeExportManifestDocument {
  id: string;
  type: KnowledgeDocument["type"];
  title: string;
  path: string;
  hash: string;
  updatedAt: number;
  contentSchemaVersion: number;
  bookId?: string;
  sourceKind?: KnowledgeDocument["sourceKind"];
  sourceId?: string;
  deletedAt?: number;
}

export interface KnowledgeExportManifestAttachment {
  id: string;
  kind: KnowledgeAttachment["kind"];
  fileName: string;
  path: string;
  size: number;
  updatedAt: number;
  documentId?: string;
  mimeType?: string;
  hash?: string;
}

export interface KnowledgeExportManifest {
  version: 1;
  app: "ReadAny";
  format: KnowledgeExportFormat;
  rootDir: string;
  exportedAt: number;
  documents: Record<string, KnowledgeExportManifestDocument>;
  attachments: Record<string, KnowledgeExportManifestAttachment>;
}

export interface KnowledgeExportObservedFile {
  path: string;
  content?: string;
  hash?: string;
}

export interface KnowledgeExportConflict {
  kind: "external_modified";
  documentId: string;
  path: string;
  previousHash: string;
  existingHash: string;
  nextHash: string;
}

export interface KnowledgeVaultExportOptions extends KnowledgeExportOptions {
  exportedAt?: number;
  includeManifest?: boolean;
  manifestPath?: string;
  previousManifest?: KnowledgeExportManifest;
  existingFiles?: KnowledgeExportObservedFile[];
}

export interface KnowledgeVaultPackage {
  files: KnowledgeExportFile[];
  manifest: KnowledgeExportManifest;
  conflicts: KnowledgeExportConflict[];
}

interface ExportContext {
  booksById: Map<string, Book>;
  documentsById: Map<string, KnowledgeDocument>;
  linksByDocumentId: Map<string, KnowledgeLink[]>;
  attachmentsByDocumentId: Map<string, KnowledgeAttachment[]>;
}

type ResolvedKnowledgeExportOptions = Required<KnowledgeExportOptions>;

interface DocumentExportFile extends KnowledgeExportFile {
  documentId: string;
  document: KnowledgeDocument;
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

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/");
}

function splitPathExtension(path: string): [string, string] {
  const lastSlash = path.lastIndexOf("/");
  const lastDot = path.lastIndexOf(".");
  if (lastDot <= lastSlash) return [path, ""];
  return [path.slice(0, lastDot), path.slice(lastDot)];
}

function ensureUniquePath(path: string, usedPaths: Set<string>): string {
  const normalized = normalizePath(path);
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return path;
  }

  const [base, extension] = splitPathExtension(path);
  let index = 2;
  while (usedPaths.has(normalizePath(`${base}-${index}${extension}`))) {
    index += 1;
  }
  const nextPath = `${base}-${index}${extension}`;
  usedPaths.add(normalizePath(nextPath));
  return nextPath;
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

export function createKnowledgeExportHash(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
  options: ResolvedKnowledgeExportOptions,
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
  options: ResolvedKnowledgeExportOptions,
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
  const usedPaths = new Set<string>();
  return files.map((file) => {
    const path = ensureUniquePath(file.path, usedPaths);
    if (path === file.path) return file;
    return { ...file, path };
  });
}

function createDocumentExportFiles(
  input: KnowledgeExportInput,
  options: ResolvedKnowledgeExportOptions,
  previousManifest?: KnowledgeExportManifest,
): DocumentExportFile[] {
  const context = createContext(input);
  const documents = options.includeDeleted
    ? input.documents
    : input.documents.filter((document) => !document.deletedAt);
  const usedPaths = new Set<string>();
  const canReuseManifestPaths = previousManifest?.rootDir === options.rootDir;

  return documents.map<DocumentExportFile>((document) => {
    const previousPath = canReuseManifestPaths
      ? previousManifest?.documents[document.id]?.path
      : undefined;
    const path = ensureUniquePath(
      previousPath || documentPath(document, context, options),
      usedPaths,
    );

    return {
      documentId: document.id,
      document,
      path,
      content: renderDocument(document, context, options),
      mimeType: "text/markdown",
    };
  });
}

function createAttachmentManifestEntries(
  input: KnowledgeExportInput,
  rootDir: string,
): Record<string, KnowledgeExportManifestAttachment> {
  const entries: Record<string, KnowledgeExportManifestAttachment> = {};

  for (const attachment of input.attachments ?? []) {
    const fallbackPath = joinPath("Assets", slugPart(attachment.fileName, attachment.id));
    entries[attachment.id] = {
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      path: normalizePath(
        joinPath(rootDir, attachment.remotePath || attachment.localPath || fallbackPath),
      ),
      size: attachment.size,
      updatedAt: attachment.updatedAt,
      ...(attachment.documentId ? { documentId: attachment.documentId } : {}),
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.hash ? { hash: attachment.hash } : {}),
    };
  }

  return entries;
}

function createManifest(
  input: KnowledgeExportInput,
  files: DocumentExportFile[],
  options: ResolvedKnowledgeExportOptions,
  exportedAt: number,
): KnowledgeExportManifest {
  const documents: Record<string, KnowledgeExportManifestDocument> = {};

  for (const file of files) {
    documents[file.documentId] = {
      id: file.document.id,
      type: file.document.type,
      title: file.document.title,
      path: normalizePath(file.path),
      hash: createKnowledgeExportHash(file.content),
      updatedAt: file.document.updatedAt,
      contentSchemaVersion: file.document.contentSchemaVersion,
      ...(file.document.bookId ? { bookId: file.document.bookId } : {}),
      ...(file.document.sourceKind ? { sourceKind: file.document.sourceKind } : {}),
      ...(file.document.sourceId ? { sourceId: file.document.sourceId } : {}),
      ...(file.document.deletedAt ? { deletedAt: file.document.deletedAt } : {}),
    };
  }

  return {
    version: 1,
    app: "ReadAny",
    format: options.format,
    rootDir: options.rootDir,
    exportedAt,
    documents,
    attachments: createAttachmentManifestEntries(input, options.rootDir),
  };
}

function observedHash(file: KnowledgeExportObservedFile): string | null {
  if (file.hash) return file.hash;
  if (typeof file.content === "string") return createKnowledgeExportHash(file.content);
  return null;
}

function detectConflicts(
  manifest: KnowledgeExportManifest,
  previousManifest?: KnowledgeExportManifest,
  existingFiles: KnowledgeExportObservedFile[] = [],
): KnowledgeExportConflict[] {
  if (!previousManifest || existingFiles.length === 0) return [];

  const existingByPath = new Map<string, string>();
  for (const file of existingFiles) {
    const hash = observedHash(file);
    if (!hash) continue;
    existingByPath.set(normalizePath(file.path), hash);
  }

  const conflicts: KnowledgeExportConflict[] = [];
  for (const [documentId, nextEntry] of Object.entries(manifest.documents)) {
    const previousEntry = previousManifest.documents[documentId];
    if (!previousEntry) continue;

    const existingHash =
      existingByPath.get(normalizePath(previousEntry.path)) ??
      existingByPath.get(normalizePath(nextEntry.path));
    if (!existingHash) continue;

    if (existingHash !== previousEntry.hash && existingHash !== nextEntry.hash) {
      conflicts.push({
        kind: "external_modified",
        documentId,
        path: previousEntry.path,
        previousHash: previousEntry.hash,
        existingHash,
        nextHash: nextEntry.hash,
      });
    }
  }

  return conflicts;
}

export class KnowledgeExporter {
  export(input: KnowledgeExportInput, options: KnowledgeExportOptions = {}): KnowledgeExportFile[] {
    const opts: ResolvedKnowledgeExportOptions = {
      format: options.format ?? "obsidian",
      rootDir: options.rootDir ?? "",
      includeDeleted: options.includeDeleted ?? false,
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata ?? false,
    };
    return createDocumentExportFiles(input, opts).map(({ document, documentId, ...file }) => file);
  }

  buildVaultPackage(
    input: KnowledgeExportInput,
    options: KnowledgeVaultExportOptions = {},
  ): KnowledgeVaultPackage {
    const opts: ResolvedKnowledgeExportOptions = {
      format: options.format ?? "obsidian",
      rootDir: options.rootDir ?? "",
      includeDeleted: options.includeDeleted ?? false,
      includeReadAnyCardMetadata: options.includeReadAnyCardMetadata ?? false,
    };
    const exportedAt = options.exportedAt ?? Date.now();
    const documentFiles = createDocumentExportFiles(input, opts, options.previousManifest);
    const manifest = createManifest(input, documentFiles, opts, exportedAt);
    const conflicts = detectConflicts(manifest, options.previousManifest, options.existingFiles);
    const files: KnowledgeExportFile[] = documentFiles.map(
      ({ document, documentId, ...file }) => file,
    );

    if (options.includeManifest ?? true) {
      files.push({
        path: normalizePath(
          options.manifestPath ?? joinPath(opts.rootDir, ".readany/manifest.json"),
        ),
        content: `${JSON.stringify(manifest, null, 2)}\n`,
        mimeType: "application/json",
      });
    }

    return { files: withUniquePaths(files), manifest, conflicts };
  }
}

export const knowledgeExporter = new KnowledgeExporter();
