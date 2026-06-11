import type { Highlight, JSONValue, KnowledgeDocument, Note } from "../types";
import { markdownToBasicTiptap } from "./editor-projection";

export interface KnowledgeDocumentSnapshot {
  contentJson: unknown;
  contentMd: string;
}

export interface KnowledgeDocumentTreeNode {
  document: KnowledgeDocument;
  children: KnowledgeDocumentTreeNode[];
  depth: number;
}

export interface KnowledgeDocumentTree {
  roots: KnowledgeDocumentTreeNode[];
  nodesById: Map<string, KnowledgeDocumentTreeNode>;
  orphaned: KnowledgeDocument[];
}

export interface HighlightNoteProjection {
  title: string;
  contentJson: JSONValue;
  contentMd: string;
  excerpt?: string;
}

export interface LegacyNoteProjection extends HighlightNoteProjection {
  tags: string[];
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  const compacted = compactText(value);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function blockquoteMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function normalizeGeneratedMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeComparableMarkdown(value: string): string {
  return normalizeGeneratedMarkdown(value).replace(/\s+/g, " ");
}

function markdownBlocks(value: string): string[] {
  return normalizeGeneratedMarkdown(value)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isBlockquoteBlock(block: string): boolean {
  const lines = block.split("\n").filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => line.trimStart().startsWith(">"));
}

function unquoteMarkdownBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*>\s?/, ""))
    .join("\n")
    .trim();
}

function isGeneratedQuoteBlock(block: string, quote: string): boolean {
  return (
    isBlockquoteBlock(block) &&
    normalizeComparableMarkdown(unquoteMarkdownBlock(block)) === normalizeComparableMarkdown(quote)
  );
}

function isGeneratedSourceBlock(block: string, chapterTitle?: string): boolean {
  const normalizedBlock = normalizeComparableMarkdown(block);
  const normalizedChapterTitle = chapterTitle?.trim();
  if (normalizedChapterTitle) {
    return normalizedBlock === normalizeComparableMarkdown(`_Source: ${normalizedChapterTitle}_`);
  }
  return /^_Source:\s.+_$/.test(normalizedBlock);
}

function joinMarkdownBlocks(blocks: string[]): string {
  return blocks.join("\n\n").trim();
}

export function createKnowledgeExcerpt(markdown: string, maxLength = 220): string | undefined {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : undefined;
}

export function hasHighlightNoteContent(highlight: Pick<Highlight, "note">): boolean {
  return !!highlight.note?.trim();
}

export function createHighlightNoteTitle(highlight: Pick<Highlight, "note" | "text">): string {
  return truncateText(highlight.note?.trim() || highlight.text || "Highlight note", 80);
}

export function createHighlightNoteMarkdown(
  highlight: Pick<Highlight, "note" | "text" | "chapterTitle">,
): string {
  const note = highlight.note?.trim();
  const quote = highlight.text.trim();
  const chapterTitle = highlight.chapterTitle?.trim();
  const sections: string[] = [];

  if (note) sections.push(note);
  if (quote) sections.push(blockquoteMarkdown(quote));
  if (chapterTitle) sections.push(`_Source: ${chapterTitle}_`);

  return sections.join("\n\n");
}

export function extractHighlightNoteContentForLegacyField(
  markdown: string,
  highlight: Pick<Highlight, "text" | "chapterTitle">,
): string {
  return joinMarkdownBlocks(
    markdownBlocks(markdown).filter(
      (block) =>
        !isGeneratedQuoteBlock(block, highlight.text) &&
        !isGeneratedSourceBlock(block, highlight.chapterTitle),
    ),
  );
}

export function createHighlightNoteProjection(highlight: Highlight): HighlightNoteProjection {
  const contentMd = createHighlightNoteMarkdown(highlight);
  return {
    title: createHighlightNoteTitle(highlight),
    contentMd,
    contentJson: markdownToBasicTiptap(contentMd) as unknown as JSONValue,
    excerpt: createKnowledgeExcerpt(contentMd),
  };
}

export function isGeneratedHighlightNoteDocument(
  document: KnowledgeDocument,
  highlight: Highlight,
): boolean {
  if (document.type !== "highlight_note") return false;
  if (document.sourceKind !== "highlight" || document.sourceId !== highlight.id) return false;
  const content = normalizeGeneratedMarkdown(document.contentMd);
  return !content || content === normalizeGeneratedMarkdown(createHighlightNoteMarkdown(highlight));
}

export function hasLegacyNoteContent(note: Pick<Note, "title" | "content">): boolean {
  return !!note.title.trim() || !!note.content.trim();
}

export function createLegacyNoteTitle(note: Pick<Note, "title" | "content">): string {
  return truncateText(note.title || note.content || "Note", 80);
}

export function createLegacyNoteMarkdown(note: Pick<Note, "content" | "chapterTitle">): string {
  const content = note.content.trim();
  const chapterTitle = note.chapterTitle?.trim();
  const sections: string[] = [];

  if (content) sections.push(content);
  if (chapterTitle) sections.push(`_Source: ${chapterTitle}_`);

  return sections.join("\n\n");
}

export function extractLegacyNoteContentForLegacyField(
  markdown: string,
  note: Pick<Note, "chapterTitle">,
): string {
  return joinMarkdownBlocks(
    markdownBlocks(markdown).filter((block) => !isGeneratedSourceBlock(block, note.chapterTitle)),
  );
}

export function createLegacyNoteProjection(note: Note): LegacyNoteProjection {
  const contentMd = createLegacyNoteMarkdown(note);
  return {
    title: createLegacyNoteTitle(note),
    contentMd,
    contentJson: markdownToBasicTiptap(contentMd) as unknown as JSONValue,
    excerpt: createKnowledgeExcerpt(contentMd),
    tags: note.tags,
  };
}

export function isGeneratedLegacyNoteDocument(document: KnowledgeDocument, note: Note): boolean {
  if (document.type !== "standalone_note") return false;
  if (document.sourceKind !== "note" || document.sourceId !== note.id) return false;
  if (document.title.trim() !== createLegacyNoteTitle(note)) return false;
  const content = normalizeGeneratedMarkdown(document.contentMd);
  return !content || content === normalizeGeneratedMarkdown(createLegacyNoteMarkdown(note));
}

export function knowledgeValueFingerprint(value: KnowledgeDocumentSnapshot): string {
  return JSON.stringify({
    contentJson: value.contentJson,
    contentMd: value.contentMd,
  });
}

export function knowledgeDocumentFingerprint(
  title: string,
  value: KnowledgeDocumentSnapshot,
  tags: readonly string[] = [],
): string {
  return JSON.stringify({
    title: title.trim(),
    tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
    value: knowledgeValueFingerprint(value),
  });
}

export function orderKnowledgeDocuments(
  documents: KnowledgeDocument[],
  homeDocumentId?: string,
): KnowledgeDocument[] {
  const uniqueDocuments = Array.from(
    new Map(documents.map((document) => [document.id, document])).values(),
  );
  return uniqueDocuments.sort((left, right) =>
    compareKnowledgeDocuments(left, right, homeDocumentId),
  );
}

function compareKnowledgeDocuments(
  left: KnowledgeDocument,
  right: KnowledgeDocument,
  homeDocumentId?: string,
): number {
  if (left.id === homeDocumentId) return -1;
  if (right.id === homeDocumentId) return 1;
  if (left.type === "book_home") return -1;
  if (right.type === "book_home") return 1;
  if (left.type === "folder" && right.type !== "folder") return -1;
  if (left.type !== "folder" && right.type === "folder") return 1;
  if (left.type === "folder" && right.type === "folder") {
    const titleSort = left.title.localeCompare(right.title, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (titleSort !== 0) return titleSort;
  }
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
}

function hasAncestryCycle(
  documentId: string,
  parentId: string,
  documentsById: Map<string, KnowledgeDocument>,
): boolean {
  const visited = new Set<string>();
  let nextParentId: string | undefined = parentId;

  while (nextParentId) {
    if (nextParentId === documentId) return true;
    if (visited.has(nextParentId)) return true;
    visited.add(nextParentId);
    nextParentId = documentsById.get(nextParentId)?.parentId;
  }

  return false;
}

export function buildKnowledgeDocumentTree(
  documents: KnowledgeDocument[],
  homeDocumentId?: string,
): KnowledgeDocumentTree {
  const uniqueDocuments = orderKnowledgeDocuments(documents, homeDocumentId);
  const documentsById = new Map(uniqueDocuments.map((document) => [document.id, document]));
  const childDocumentsByParentId = new Map<string, KnowledgeDocument[]>();
  const rootDocuments: KnowledgeDocument[] = [];
  const orphaned: KnowledgeDocument[] = [];

  for (const document of uniqueDocuments) {
    const parentId = document.parentId;
    const hasValidParent =
      !!parentId &&
      parentId !== document.id &&
      documentsById.has(parentId) &&
      !hasAncestryCycle(document.id, parentId, documentsById);

    if (hasValidParent) {
      const children = childDocumentsByParentId.get(parentId) ?? [];
      children.push(document);
      childDocumentsByParentId.set(parentId, children);
    } else {
      rootDocuments.push(document);
      if (parentId && parentId !== document.id) orphaned.push(document);
    }
  }

  const nodesById = new Map<string, KnowledgeDocumentTreeNode>();
  const createNode = (document: KnowledgeDocument, depth: number): KnowledgeDocumentTreeNode => {
    const children = (childDocumentsByParentId.get(document.id) ?? [])
      .sort((left, right) => compareKnowledgeDocuments(left, right, homeDocumentId))
      .map((child) => createNode(child, depth + 1));
    const node: KnowledgeDocumentTreeNode = { document, children, depth };
    nodesById.set(document.id, node);
    return node;
  };

  return {
    roots: rootDocuments
      .sort((left, right) => compareKnowledgeDocuments(left, right, homeDocumentId))
      .map((document) => createNode(document, 0)),
    nodesById,
    orphaned,
  };
}

export function flattenKnowledgeDocumentTree(
  nodes: KnowledgeDocumentTreeNode[],
): KnowledgeDocumentTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenKnowledgeDocumentTree(node.children)]);
}
