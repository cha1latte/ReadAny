import type { KnowledgeDocument } from "../types";

export interface KnowledgeDocumentSnapshot {
  contentJson: unknown;
  contentMd: string;
}

export function createKnowledgeExcerpt(markdown: string, maxLength = 220): string | undefined {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maxLength) : undefined;
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
