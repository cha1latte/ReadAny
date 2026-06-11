import type { Highlight, JSONValue, KnowledgeDocument } from "../types";
import { markdownToBasicTiptap } from "./editor-projection";

export interface KnowledgeDocumentSnapshot {
  contentJson: unknown;
  contentMd: string;
}

export interface HighlightNoteProjection {
  title: string;
  contentJson: JSONValue;
  contentMd: string;
  excerpt?: string;
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

export function knowledgeValueFingerprint(value: KnowledgeDocumentSnapshot): string {
  return JSON.stringify({
    contentJson: value.contentJson,
    contentMd: value.contentMd,
  });
}

export function knowledgeDocumentFingerprint(
  title: string,
  value: KnowledgeDocumentSnapshot,
): string {
  return JSON.stringify({
    title: title.trim(),
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
  return uniqueDocuments.sort((left, right) => {
    if (left.id === homeDocumentId) return -1;
    if (right.id === homeDocumentId) return 1;
    if (left.type === "book_home") return -1;
    if (right.type === "book_home") return 1;
    return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
  });
}
