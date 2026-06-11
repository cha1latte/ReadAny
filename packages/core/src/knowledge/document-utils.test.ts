import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "../types";
import {
  buildKnowledgeDocumentTree,
  createHighlightNoteMarkdown,
  createHighlightNoteProjection,
  createHighlightNoteTitle,
  createKnowledgeExcerpt,
  createLegacyNoteMarkdown,
  createLegacyNoteProjection,
  createLegacyNoteTitle,
  extractHighlightNoteContentForLegacyField,
  extractLegacyNoteContentForLegacyField,
  isGeneratedHighlightNoteDocument,
  isGeneratedLegacyNoteDocument,
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

  it("orders folders before regular documents", () => {
    const note = document({ id: "note", title: "Latest note", updatedAt: 100 });
    const folder = document({ id: "folder", type: "folder", title: "Research", updatedAt: 1 });

    expect(orderKnowledgeDocuments([note, folder]).map((item) => item.id)).toEqual([
      "folder",
      "note",
    ]);
  });

  it("deduplicates documents before sorting", () => {
    const stale = document({ id: "same", title: "Stale", updatedAt: 1 });
    const current = document({ id: "same", title: "Current", updatedAt: 10 });

    expect(orderKnowledgeDocuments([stale, current])).toEqual([current]);
  });

  it("builds a stable document tree from parent ids", () => {
    const home = document({ id: "home", type: "book_home", title: "Home" });
    const folder = document({ id: "folder", type: "folder", title: "Ideas", updatedAt: 1 });
    const nested = document({ id: "nested", title: "Nested note", parentId: "folder" });
    const stale = document({
      id: "stale",
      title: "Missing parent",
      parentId: "missing-folder",
      updatedAt: 2,
    });

    const tree = buildKnowledgeDocumentTree([nested, stale, folder, home], "home");

    expect(tree.roots.map((node) => node.document.id)).toEqual(["home", "folder", "stale"]);
    expect(tree.roots[1].children.map((node) => node.document.id)).toEqual(["nested"]);
    expect(tree.roots[1].children[0].depth).toBe(1);
    expect(tree.orphaned.map((item) => item.id)).toEqual(["stale"]);
  });

  it("promotes cyclic document parents to roots", () => {
    const left = document({ id: "left", parentId: "right" });
    const right = document({ id: "right", parentId: "left" });

    const tree = buildKnowledgeDocumentTree([left, right]);

    expect(tree.roots.map((node) => node.document.id).sort()).toEqual(["left", "right"]);
    expect(tree.roots.flatMap((node) => node.children)).toEqual([]);
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

  it("uses normalized tag sets in document fingerprints", () => {
    const value = {
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMd: "Hello",
    };

    expect(knowledgeDocumentFingerprint("Title", value, [" idea ", "book", "idea"])).toBe(
      knowledgeDocumentFingerprint("Title", value, ["book", "idea"]),
    );
    expect(knowledgeDocumentFingerprint("Title", value, ["book"])).not.toBe(
      knowledgeDocumentFingerprint("Title", value, ["book", "idea"]),
    );
  });

  it("creates compact excerpts from markdown", () => {
    const excerpt = createKnowledgeExcerpt(`# Title

> quoted **text**

<!-- internal marker -->

\`\`\`ts
const hidden = true;
\`\`\`

- final point`);

    expect(excerpt).toBe("Title quoted text final point");
  });

  it("projects highlight notes into readable knowledge markdown", () => {
    const highlight = {
      id: "hl-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/2)",
      text: "Learning without thought is labor lost.\nThought without learning is perilous.",
      color: "yellow" as const,
      note: "Modern meaning: study and reflection need each other.",
      chapterTitle: "Analects",
      createdAt: 1,
      updatedAt: 1,
    };

    expect(createHighlightNoteTitle(highlight)).toBe(
      "Modern meaning: study and reflection need each other.",
    );
    expect(
      createHighlightNoteMarkdown(highlight),
    ).toBe(`Modern meaning: study and reflection need each other.

> Learning without thought is labor lost.
> Thought without learning is perilous.

_Source: Analects_`);

    const projection = createHighlightNoteProjection(highlight);
    expect(projection.contentJson).toMatchObject({ type: "doc" });
    expect(projection.excerpt).toContain("Modern meaning");
  });

  it("detects generated highlight note documents without treating user edits as generated", () => {
    const highlight = {
      id: "hl-1",
      bookId: "book-1",
      cfi: "epubcfi(/6/2)",
      text: "Source quote",
      color: "yellow" as const,
      note: "Original note",
      chapterTitle: "Chapter 1",
      createdAt: 1,
      updatedAt: 1,
    };
    const generated = document({
      id: "doc-1",
      type: "highlight_note",
      sourceKind: "highlight",
      sourceId: "hl-1",
      contentMd: createHighlightNoteMarkdown(highlight),
    });
    const edited = document({
      ...generated,
      contentMd: `${createHighlightNoteMarkdown(highlight)}\n\nUser expansion`,
    });

    expect(isGeneratedHighlightNoteDocument(generated, highlight)).toBe(true);
    expect(isGeneratedHighlightNoteDocument(edited, highlight)).toBe(false);
  });

  it("extracts only user-authored content when writing highlight notes back to legacy fields", () => {
    const highlight = {
      text: "Source quote\nwith two lines",
      chapterTitle: "Chapter 1",
    };

    const markdown = `My interpretation.

> Source quote
> with two lines

_Source: Chapter 1_

> A user-authored quote should stay.

Follow-up idea.`;

    expect(extractHighlightNoteContentForLegacyField(markdown, highlight)).toBe(`My interpretation.

> A user-authored quote should stay.

Follow-up idea.`);
  });

  it("projects legacy notes into standalone knowledge documents", () => {
    const note = {
      id: "note-1",
      bookId: "book-1",
      title: "Reading question",
      content: "Why does this argument depend on memory?",
      chapterTitle: "Chapter 2",
      tags: ["question"],
      createdAt: 1,
      updatedAt: 1,
    };

    expect(createLegacyNoteTitle(note)).toBe("Reading question");
    expect(createLegacyNoteMarkdown(note)).toBe(`Why does this argument depend on memory?

_Source: Chapter 2_`);

    const projection = createLegacyNoteProjection(note);
    expect(projection.contentJson).toMatchObject({ type: "doc" });
    expect(projection.tags).toEqual(["question"]);
    expect(projection.excerpt).toContain("argument");
  });

  it("detects generated legacy note documents without overwriting expanded notes", () => {
    const note = {
      id: "note-1",
      bookId: "book-1",
      title: "Reading question",
      content: "Original content",
      chapterTitle: "Chapter 2",
      tags: ["question"],
      createdAt: 1,
      updatedAt: 1,
    };
    const generated = document({
      id: "doc-1",
      type: "standalone_note",
      title: "Reading question",
      sourceKind: "note",
      sourceId: "note-1",
      contentMd: createLegacyNoteMarkdown(note),
    });
    const retitled = document({
      ...generated,
      title: "My own title",
    });
    const expanded = document({
      ...generated,
      contentMd: `${createLegacyNoteMarkdown(note)}\n\nUser expansion`,
    });

    expect(isGeneratedLegacyNoteDocument(generated, note)).toBe(true);
    expect(isGeneratedLegacyNoteDocument(retitled, note)).toBe(false);
    expect(isGeneratedLegacyNoteDocument(expanded, note)).toBe(false);
  });

  it("removes generated source metadata when writing legacy notes back", () => {
    const markdown = `Reading question.

_Source: Chapter 2_

Extra thought.`;

    expect(extractLegacyNoteContentForLegacyField(markdown, { chapterTitle: "Chapter 2" })).toBe(
      `Reading question.

Extra thought.`,
    );
  });
});
