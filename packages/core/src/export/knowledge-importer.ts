import type { CreateKnowledgeDocumentInput } from "../db/database";
import { createKnowledgeExcerpt, markdownToBasicTiptap } from "../knowledge";
import type {
  KnowledgeDocumentCreateProposal,
  KnowledgeDocumentUpdateProposal,
} from "../knowledge/proposals";
import type {
  JSONValue,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeSourceKind,
} from "../types";
import {
  type KnowledgeExportManifest,
  type KnowledgeExportObservedFile,
  createKnowledgeExportHash,
} from "./knowledge-exporter";

export interface KnowledgeMarkdownImportInput {
  path?: string;
  relativePath?: string;
  content: string;
  defaultType?: KnowledgeDocumentType;
  defaultParentId?: string;
  bookId?: string;
}

export type KnowledgeMarkdownImportPlanFile = KnowledgeMarkdownImportInput;

export interface KnowledgeMarkdownImportPlanInput {
  files: KnowledgeMarkdownImportPlanFile[];
  defaultType?: KnowledgeDocumentType;
  defaultParentId?: string;
  bookId?: string;
  preservePathHierarchy?: boolean;
  currentDocuments?: KnowledgeDocument[];
}

export interface KnowledgeImportFrontmatter {
  type?: string;
  id?: string;
  documentType?: KnowledgeDocumentType;
  title?: string;
  bookId?: string;
  parentId?: string;
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

export interface KnowledgeMarkdownImportPlanItem {
  path: string;
  relativePath: string;
  proposal: KnowledgeImportWriteProposal;
  warnings: string[];
}

export interface KnowledgeMarkdownImportPlan {
  items: KnowledgeMarkdownImportPlanItem[];
  folderItems: KnowledgeMarkdownImportPlanItem[];
  documentItems: KnowledgeMarkdownImportPlanItem[];
}

export type KnowledgeVaultImportEntryStatus =
  | "unchanged"
  | "modified"
  | "missing"
  | "modified_unreadable"
  | "conflict";

export interface KnowledgeVaultImportEntry {
  documentId: string;
  path: string;
  status: KnowledgeVaultImportEntryStatus;
  previousHash: string;
  existingHash?: string;
  currentHash?: string;
  draft?: KnowledgeImportDocumentDraft;
  warnings: string[];
}

export interface KnowledgeVaultImportPlan {
  manifest: KnowledgeExportManifest;
  entries: KnowledgeVaultImportEntry[];
  modified: KnowledgeVaultImportEntry[];
  missing: KnowledgeVaultImportEntry[];
  unreadable: KnowledgeVaultImportEntry[];
  conflicts: KnowledgeVaultImportEntry[];
}

export interface KnowledgeVaultImportPlanInput {
  manifest: KnowledgeExportManifest;
  files: KnowledgeExportObservedFile[];
  currentFiles?: KnowledgeExportObservedFile[];
}

export interface KnowledgeImportProposalOptions {
  mode?: "create" | "update";
  documentId?: string;
  message?: string;
  current?: KnowledgeDocumentUpdateProposal["current"];
}

export type KnowledgeImportWriteProposal =
  | KnowledgeDocumentCreateProposal
  | KnowledgeDocumentUpdateProposal;

const DOCUMENT_TYPES = new Set<KnowledgeDocumentType>([
  "book_home",
  "folder",
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

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/");
}

function isJsonRecord(value: JSONValue | undefined): value is Record<string, JSONValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringJsonAttr(attrs: Record<string, JSONValue>, key: string): string | undefined {
  const value = attrs[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripMarkdownExtension(path: string): string {
  return normalizePath(path).replace(/\.md$/i, "");
}

function stripReadmeIndex(path: string): string {
  return path.replace(/\/README$/i, "");
}

function stripRootDir(path: string, rootDir: string): string {
  const normalizedRoot = normalizePath(rootDir);
  if (!normalizedRoot) return path;
  return path === normalizedRoot
    ? ""
    : path.startsWith(`${normalizedRoot}/`)
      ? path.slice(normalizedRoot.length + 1)
      : path;
}

function createManifestDocumentIdsByPath(manifest: KnowledgeExportManifest): Map<string, string> {
  const idsByPath = new Map<string, string>();

  for (const [documentId, document] of Object.entries(manifest.documents)) {
    const normalized = stripMarkdownExtension(document.path);
    const withoutRoot = stripRootDir(normalized, manifest.rootDir);
    const aliases = new Set([
      normalized,
      stripReadmeIndex(normalized),
      withoutRoot,
      stripReadmeIndex(withoutRoot),
    ]);

    for (const alias of aliases) {
      if (alias) idsByPath.set(alias, documentId);
    }
  }

  return idsByPath;
}

function resolveManifestDocumentIdByPath(
  targetPath: string,
  documentIdsByPath: Map<string, string>,
): string | undefined {
  const normalized = stripMarkdownExtension(targetPath);
  return documentIdsByPath.get(normalized) ?? documentIdsByPath.get(stripReadmeIndex(normalized));
}

function resolveInternalLinkTargetPaths(
  contentJson: JSONValue,
  documentIdsByPath: Map<string, string>,
): JSONValue {
  if (Array.isArray(contentJson)) {
    return contentJson.map((item) => resolveInternalLinkTargetPaths(item, documentIdsByPath));
  }
  if (!isJsonRecord(contentJson)) return contentJson;

  const next: Record<string, JSONValue> = {};
  for (const [key, value] of Object.entries(contentJson)) {
    next[key] = resolveInternalLinkTargetPaths(value, documentIdsByPath);
  }

  if (contentJson.type === "readanyInternalLink" && isJsonRecord(contentJson.attrs)) {
    const targetPath = stringJsonAttr(contentJson.attrs, "targetPath");
    const documentId = stringJsonAttr(contentJson.attrs, "documentId");
    const resolvedDocumentId = targetPath
      ? resolveManifestDocumentIdByPath(targetPath, documentIdsByPath)
      : undefined;

    if (resolvedDocumentId && resolvedDocumentId !== documentId) {
      next.attrs = {
        ...(next.attrs && isJsonRecord(next.attrs) ? next.attrs : {}),
        documentId: resolvedDocumentId,
      };
    }
  }

  return next as JSONValue;
}

function splitPath(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .replace(/^file:\/+/, "")
    .replace(/\/+/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function fileNameFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = splitPath(path);
  return parts[parts.length - 1];
}

function directoryParts(path: string): string[] {
  const parts = splitPath(path);
  return parts.slice(0, -1);
}

function commonDirectoryParts(paths: string[]): string[] {
  const directories = paths.map(directoryParts).filter((parts) => parts.length > 0);
  if (directories.length === 0) return [];

  const shortest = Math.min(...directories.map((parts) => parts.length));
  const common: string[] = [];
  for (let index = 0; index < shortest; index += 1) {
    const candidate = directories[0][index];
    if (directories.every((parts) => parts[index] === candidate)) {
      common.push(candidate);
    } else {
      break;
    }
  }
  return common;
}

function relativePathFromCommonDirectory(path: string, commonParts: string[]): string {
  const parts = splitPath(path);
  const hasCommonPrefix =
    commonParts.length > 0 && commonParts.every((part, index) => parts[index] === part);
  const relativeParts = hasCommonPrefix ? parts.slice(commonParts.length) : parts.slice(-1);
  return relativeParts.join("/") || fileNameFromPath(path) || path;
}

function sanitizeImportPathSegment(segment: string): string {
  return segment
    .trim()
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeImportSiblingTitle(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function importSiblingKey(input: {
  bookId?: string;
  parentId?: string;
  title?: string;
}): string {
  return [input.bookId ?? "", input.parentId ?? "", normalizeImportSiblingTitle(input.title)].join(
    "\u0000",
  );
}

function folderIdForImportPath({
  bookId,
  baseParentId,
  relativeDirPath,
}: {
  bookId?: string;
  baseParentId?: string;
  relativeDirPath: string;
}): string {
  const hash = createKnowledgeExportHash(
    ["knowledge-import-folder-v1", bookId ?? "", baseParentId ?? "", relativeDirPath].join("\n"),
  ).replace(/[^a-zA-Z0-9]+/g, "-");
  return `import-folder-${hash}`;
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
    parentId: readString(parsed.parentId),
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
    fileTitle(input.relativePath ?? input.path) ??
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
  const parentId =
    metadata.parentId ??
    (!isReadAnyExport && documentType !== "book_home" ? input.defaultParentId : undefined);

  return {
    path: input.path,
    hash: createKnowledgeExportHash(input.content),
    isReadAnyExport,
    frontmatter: metadata,
    contentMd,
    draft: {
      id: metadata.id,
      parentId,
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

function observedFileHash(file: KnowledgeExportObservedFile): string | undefined {
  if (file.hash) return file.hash;
  if (typeof file.content === "string") return createKnowledgeExportHash(file.content);
  return undefined;
}

export function createKnowledgeVaultImportPlan(
  input: KnowledgeVaultImportPlanInput,
): KnowledgeVaultImportPlan {
  const filesByPath = new Map(input.files.map((file) => [normalizePath(file.path), file] as const));
  const documentIdsByPath = createManifestDocumentIdsByPath(input.manifest);
  const currentHashesByPath = new Map(
    (input.currentFiles ?? [])
      .map((file) => [normalizePath(file.path), observedFileHash(file)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );
  const entries: KnowledgeVaultImportEntry[] = [];

  for (const [documentId, manifestDocument] of Object.entries(input.manifest.documents)) {
    const path = normalizePath(manifestDocument.path);
    const file = filesByPath.get(path);
    const currentHash = currentHashesByPath.get(path);
    const hasLocalChange = Boolean(currentHash && currentHash !== manifestDocument.hash);

    if (!file) {
      entries.push({
        documentId,
        path,
        status: "missing",
        previousHash: manifestDocument.hash,
        currentHash,
        warnings: ["manifest_file_missing"],
      });
      continue;
    }

    const existingHash = observedFileHash(file);
    if (existingHash === manifestDocument.hash) {
      entries.push({
        documentId,
        path,
        status: "unchanged",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings: [],
      });
      continue;
    }

    if (existingHash && hasLocalChange && existingHash === currentHash) {
      entries.push({
        documentId,
        path,
        status: "unchanged",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings: ["remote_matches_current_local"],
      });
      continue;
    }

    if (existingHash && hasLocalChange) {
      entries.push({
        documentId,
        path,
        status: "conflict",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings: ["local_and_remote_modified"],
      });
      continue;
    }

    if (typeof file.content !== "string") {
      entries.push({
        documentId,
        path,
        status: "modified_unreadable",
        previousHash: manifestDocument.hash,
        existingHash,
        currentHash,
        warnings: ["modified_file_content_missing"],
      });
      continue;
    }

    const draft = parseKnowledgeMarkdownDocument({
      path,
      content: file.content,
      defaultType: manifestDocument.type,
      bookId: manifestDocument.bookId,
    });
    draft.draft.contentJson = resolveInternalLinkTargetPaths(
      draft.draft.contentJson ?? ({ type: "doc", content: [] } as unknown as JSONValue),
      documentIdsByPath,
    );
    const warnings = [...draft.warnings];
    if (!draft.draft.id) {
      warnings.push("frontmatter_id_missing_using_manifest");
      draft.draft.id = documentId;
    }
    draft.draft.type = draft.draft.type ?? manifestDocument.type;
    draft.draft.bookId = draft.draft.bookId ?? manifestDocument.bookId;
    draft.draft.sourceKind = draft.draft.sourceKind ?? manifestDocument.sourceKind;
    draft.draft.sourceId = draft.draft.sourceId ?? manifestDocument.sourceId;

    entries.push({
      documentId,
      path,
      status: "modified",
      previousHash: manifestDocument.hash,
      existingHash: createKnowledgeExportHash(file.content),
      currentHash,
      draft,
      warnings,
    });
  }

  return {
    manifest: input.manifest,
    entries,
    modified: entries.filter((entry) => entry.status === "modified"),
    missing: entries.filter((entry) => entry.status === "missing"),
    unreadable: entries.filter((entry) => entry.status === "modified_unreadable"),
    conflicts: entries.filter((entry) => entry.status === "conflict"),
  };
}

function requireImportedContentJson(imported: KnowledgeImportDocumentDraft): JSONValue {
  return imported.draft.contentJson ?? ({ type: "doc", content: [] } as unknown as JSONValue);
}

function createKnowledgeImportCreateProposal(
  imported: KnowledgeImportDocumentDraft,
  message?: string,
): KnowledgeDocumentCreateProposal {
  return {
    success: true,
    action: "create",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_create",
    message: message ?? "Imported knowledge draft generated. No document has been saved.",
    draft: {
      ...imported.draft,
      contentJson: requireImportedContentJson(imported),
      contentMd: imported.contentMd,
      tags: imported.draft.tags ?? [],
      sourceKind: imported.draft.sourceKind ?? (imported.path ? "obsidian" : "external"),
      sourceId: imported.draft.sourceId ?? imported.path,
    },
  };
}

function createKnowledgeImportUpdateProposal(
  imported: KnowledgeImportDocumentDraft,
  options: KnowledgeImportProposalOptions,
): KnowledgeDocumentUpdateProposal {
  const documentId = options.documentId ?? imported.draft.id;
  if (!documentId) {
    throw new Error("documentId is required to create a knowledge import update proposal");
  }

  const patch: KnowledgeDocumentUpdateProposal["patch"] = {
    parentId: imported.draft.parentId,
    title: imported.draft.title ?? options.current?.title ?? "Imported Knowledge",
    contentMd: imported.contentMd,
    contentJson: requireImportedContentJson(imported),
    excerpt: imported.draft.excerpt,
    tags: imported.draft.tags ?? [],
  };

  const changedFields = ["parentId", "title", "contentMd", "contentJson", "excerpt", "tags"].filter(
    (field) => {
      if (field === "parentId") return patch.parentId !== options.current?.parentId;
      if (field === "title") return patch.title !== options.current?.title;
      if (field === "tags") {
        return JSON.stringify(patch.tags ?? []) !== JSON.stringify(options.current?.tags ?? []);
      }
      return true;
    },
  );

  return {
    success: true,
    action: "update",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_update",
    message:
      options.message ??
      "Imported knowledge update generated. The existing document has not been changed.",
    documentId,
    current: options.current,
    patch,
    changedFields,
  };
}

export function createKnowledgeImportWriteProposal(
  imported: KnowledgeImportDocumentDraft,
  options: KnowledgeImportProposalOptions = {},
): KnowledgeImportWriteProposal {
  if (options.mode === "update" || options.documentId) {
    return createKnowledgeImportUpdateProposal(imported, options);
  }
  return createKnowledgeImportCreateProposal(imported, options.message);
}

function createKnowledgeImportFolderProposal({
  id,
  title,
  parentId,
  bookId,
  targetPath,
}: {
  id: string;
  title: string;
  parentId?: string;
  bookId?: string;
  targetPath: string;
}): KnowledgeDocumentCreateProposal {
  return {
    success: true,
    action: "create",
    requiresConfirmation: true,
    confirmationKind: "knowledge_document_create",
    message: "Imported folder draft generated. No document has been saved.",
    targetPath,
    draft: {
      id,
      parentId,
      bookId,
      type: "folder",
      title,
      contentJson: { type: "doc", content: [] } as unknown as JSONValue,
      contentMd: "",
      contentSchemaVersion: 1,
      tags: [],
      sourceKind: "obsidian",
      sourceId: targetPath,
    },
  };
}

function importRelativePathForFile(
  file: KnowledgeMarkdownImportPlanFile,
  commonParts: string[],
): string {
  if (file.relativePath?.trim()) return normalizePath(file.relativePath);
  if (file.path?.trim())
    return normalizePath(relativePathFromCommonDirectory(file.path, commonParts));
  return fileNameFromPath(file.path) ?? "Imported Knowledge.md";
}

function shouldPreserveImportHierarchy(imported: KnowledgeImportDocumentDraft): boolean {
  if (imported.isReadAnyExport) return false;
  if (imported.draft.type === "book_home") return false;
  if (imported.frontmatter.parentId) return false;
  return true;
}

export function createKnowledgeMarkdownImportPlan(
  input: KnowledgeMarkdownImportPlanInput,
): KnowledgeMarkdownImportPlan {
  const preservePathHierarchy = input.preservePathHierarchy ?? true;
  const existingFolderIdBySiblingKey = new Map<string, string>();
  const siblingDocumentIdByTitleKey = new Map<string, string>();

  for (const document of input.currentDocuments ?? []) {
    if (document.deletedAt) continue;
    const key = importSiblingKey({
      bookId: document.bookId,
      parentId: document.parentId,
      title: document.title,
    });
    if (normalizeImportSiblingTitle(document.title) && !siblingDocumentIdByTitleKey.has(key)) {
      siblingDocumentIdByTitleKey.set(key, document.id);
    }
    if (document.type === "folder" && !existingFolderIdBySiblingKey.has(key)) {
      existingFolderIdBySiblingKey.set(key, document.id);
    }
  }

  const commonParts = commonDirectoryParts(
    input.files
      .map((file) => file.relativePath ?? file.path ?? "")
      .filter((path) => path.trim().length > 0),
  );
  const folderItemsById = new Map<string, KnowledgeMarkdownImportPlanItem>();
  const documentItems: KnowledgeMarkdownImportPlanItem[] = [];

  for (const file of input.files) {
    const relativePath = importRelativePathForFile(file, commonParts);
    const bookId = file.bookId ?? input.bookId;
    const baseParentId = file.defaultParentId ?? input.defaultParentId;
    const imported = parseKnowledgeMarkdownDocument({
      ...file,
      relativePath,
      bookId,
      defaultType: file.defaultType ?? input.defaultType,
      defaultParentId: baseParentId,
    });

    if (preservePathHierarchy && shouldPreserveImportHierarchy(imported)) {
      const segments = splitPath(relativePath).map(sanitizeImportPathSegment).filter(Boolean);
      const directorySegments = segments.slice(0, -1);
      let parentId = baseParentId;
      const pathSegments: string[] = [];

      for (const segment of directorySegments) {
        pathSegments.push(segment);
        const relativeDirPath = pathSegments.join("/");
        const titleKey = importSiblingKey({ bookId, parentId, title: segment });
        const existingFolderId = existingFolderIdBySiblingKey.get(titleKey);
        const folderId =
          existingFolderId ?? folderIdForImportPath({ bookId, baseParentId, relativeDirPath });
        if (!existingFolderId && !folderItemsById.has(folderId)) {
          const proposal = createKnowledgeImportFolderProposal({
            id: folderId,
            title: segment,
            parentId,
            bookId,
            targetPath: relativeDirPath,
          });
          folderItemsById.set(folderId, {
            path: relativeDirPath,
            relativePath: relativeDirPath,
            proposal,
            warnings: ["created_folder_from_import_path"],
          });
          existingFolderIdBySiblingKey.set(titleKey, folderId);
          siblingDocumentIdByTitleKey.set(titleKey, folderId);
        }
        parentId = folderId;
      }

      if (directorySegments.length > 0) {
        imported.draft.parentId = parentId;
      }
    }

    const proposal = createKnowledgeImportWriteProposal(imported, {
      message: "Imported knowledge draft generated. No document has been saved.",
    });
    if (proposal.action === "create" || proposal.action === "update") {
      proposal.targetPath = relativePath;
    }
    const warnings = [...imported.warnings];
    if (proposal.action === "create") {
      const titleKey = importSiblingKey({
        bookId: proposal.draft.bookId,
        parentId: proposal.draft.parentId,
        title: proposal.draft.title,
      });
      const existingDocumentId = siblingDocumentIdByTitleKey.get(titleKey);
      if (existingDocumentId && existingDocumentId !== proposal.draft.id) {
        warnings.push("duplicate_sibling_title");
      } else if (normalizeImportSiblingTitle(proposal.draft.title)) {
        siblingDocumentIdByTitleKey.set(titleKey, proposal.draft.id ?? `${relativePath}\u0000doc`);
      }
    }
    documentItems.push({
      path: file.path ?? relativePath,
      relativePath,
      proposal,
      warnings,
    });
  }

  const folderItems = Array.from(folderItemsById.values());
  return {
    items: [...folderItems, ...documentItems],
    folderItems,
    documentItems,
  };
}

export function createKnowledgeVaultImportWriteProposals(
  plan: KnowledgeVaultImportPlan,
): KnowledgeDocumentUpdateProposal[] {
  return plan.modified
    .filter((entry): entry is KnowledgeVaultImportEntry & { draft: KnowledgeImportDocumentDraft } =>
      Boolean(entry.draft),
    )
    .map((entry) => {
      const manifestDocument = plan.manifest.documents[entry.documentId];
      return createKnowledgeImportUpdateProposal(entry.draft, {
        mode: "update",
        documentId: entry.documentId,
        message: `Imported changes from ${entry.path}. The knowledge document has not been changed.`,
        current: {
          id: entry.documentId,
          bookId: manifestDocument?.bookId,
          parentId: manifestDocument?.parentId,
          type: manifestDocument?.type,
          title: manifestDocument?.title,
          updatedAt: manifestDocument?.updatedAt,
        },
      });
    });
}
