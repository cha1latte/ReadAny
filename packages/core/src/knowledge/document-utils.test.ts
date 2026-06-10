import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "../types";
import {
  createKnowledgeExcerpt,
  knowledgeDocumentFingerprint,
  orderKnowledgeDocuments,
} from "./document-utils";

function document(overrides: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: "doc",
    bookId: "book-1",
    type: "standalone_note",
    title: "Document",
    contentJson: { type: "doc", content: [] },
    contentMd: "",
    contentSchemaVersion: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("knowledge document utilities", () => {
  it("orders book home first and keeps newer documents ahead", () => {
    const oldNote = document({ id: "old", createdAt: 10, updatedAt: 20 });
    const home = document({ id: "home", type: "book_home", createdAt: 1, updatedAt: 1 });
    const newerNote = document({ id: "new", createdAt: 20, updatedAt: 40 });

    expect(orderKnowledgeDocuments([oldNote, newerNote, home]).map((item) => item.id)).toEqual([
      "home",
      "new",
      "old",
    ]);
  });

  it("deduplicates documents before sorting", () => {
    const stale = document({ id: "same", title: "Stale", updatedAt: 1 });
    const current = document({ id: "same", title: "Current", updatedAt: 10 });

    expect(orderKnowledgeDocuments([stale, current])).toEqual([current]);
  });

  it("uses normalized titles in document fingerprints", () => {
    const value = {
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMd: "Hello",
    };

    expect(knowledgeDocumentFingerprint("  Title  ", value)).toBe(
      knowledgeDocumentFingerprint("Title", value),
    );
    expect(knowledgeDocumentFingerprint("Other", value)).not.toBe(
      knowledgeDocumentFingerprint("Title", value),
    );
  });

  it("creates compact excerpts from markdown", () => {
    const excerpt = createKnowledgeExcerpt(`# Title

> quoted **text**

\`\`\`ts
const hidden = true;
\`\`\`

- final point`);

    expect(excerpt).toBe("Title quoted text final point");
  });
});
