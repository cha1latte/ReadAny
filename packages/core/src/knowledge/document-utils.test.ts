import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "../types";
import {
  buildKnowledgeDocumentTree,
  createHighlightNoteMarkdown,
  createHighlightNoteProjection,
  createHighlightNoteTitle,
  createKnowledgeDocumentSearchText,
  createKnowledgeExcerpt,
  createLegacyNoteMarkdown,
  createLegacyNoteProjection,
  createLegacyNoteTitle,
  extractHighlightNoteContentForLegacyField,
  extractKnowledgeDocumentOutline,
  extractLegacyNoteContentForLegacyField,
  formatKnowledgeDocumentPath,
  isGeneratedHighlightNoteDocument,
  isGeneratedLegacyNoteDocument,
  knowledgeDocumentFingerprint,
  orderKnowledgeDocuments,
  resolveKnowledgeDocumentPath,
  validateKnowledgeDocumentParent,
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

  it("resolves a stable vault path from parent ids", () => {
    const firstFolder = document({ id: "ideas-a", type: "folder", title: "Ideas" });
    const secondFolder = document({ id: "ideas-b", type: "folder", title: "Ideas" });
    const nested = document({
      id: "nested",
      title: "Quote map",
      parentId: "ideas-b",
      updatedAt: 20,
    });

    expect(resolveKnowledgeDocumentPath(nested, [nested, firstFolder, secondFolder])).toEqual([
      { id: "ideas-b", title: "Ideas", type: "folder" },
      { id: "nested", title: "Quote map", type: "standalone_note" },
    ]);
  });

  it("stops vault path resolution at missing or cyclic parents", () => {
    const orphan = document({ id: "orphan", title: "Orphan", parentId: "missing" });
    const left = document({ id: "left", title: "Left", parentId: "right" });
    const right = document({ id: "right", title: "Right", parentId: "left" });

    expect(resolveKnowledgeDocumentPath(orphan, [orphan])).toEqual([
      { id: "orphan", title: "Orphan", type: "standalone_note" },
    ]);
    expect(resolveKnowledgeDocumentPath(left, [left, right])).toEqual([
      { id: "right", title: "Right", type: "standalone_note" },
      { id: "left", title: "Left", type: "standalone_note" },
    ]);
  });

  it("formats a human-readable vault path with orphan context", () => {
    const folder = document({ id: "folder", type: "folder", title: "Ideas" });
    const nested = document({ id: "nested", title: "", parentId: "folder" });
    const orphan = document({ id: "orphan", title: "Loose", parentId: "missing" });

    expect(formatKnowledgeDocumentPath(nested, [folder, nested])).toBe(
      "Knowledge base / Ideas / Untitled document",
    );
    expect(
      formatKnowledgeDocumentPath(orphan, [orphan], {
        includeOrphanedParent: true,
      }),
    ).toBe("Knowledge base / Orphaned / Loose");
    expect(
      formatKnowledgeDocumentPath(nested, [folder, nested], {
        rootTitle: "知识库",
        untitledTitle: "未命名文档",
      }),
    ).toBe("知识库 / Ideas / 未命名文档");
  });

  it("includes vault paths and orphan context in document search text", () => {
    const folder = document({ id: "folder", type: "folder", title: "Chapter Notes" });
    const nested = document({
      id: "nested",
      title: "Question Log",
      parentId: "folder",
      contentMd: "A note about pacing.",
      tags: ["trail"],
    });
    const orphan = document({
      id: "orphan",
      title: "Loose",
      parentId: "missing",
      excerpt: "Recovered after sync",
    });

    expect(
      createKnowledgeDocumentSearchText(nested, [folder, nested], {
        rootTitle: "知识库",
        typeLabel: "文档",
      }),
    ).toContain("知识库 / chapter notes / question log");
    expect(createKnowledgeDocumentSearchText(nested, [folder, nested])).toContain("trail");
    expect(
      createKnowledgeDocumentSearchText(orphan, [orphan], {
        orphanedParentTitle: "孤立文档",
      }),
    ).toContain("knowledge base / 孤立文档 / loose");
  });

  it("validates document parent moves", () => {
    const home = document({ id: "home", type: "book_home" });
    const root = document({ id: "root", type: "folder", title: "Root" });
    const child = document({ id: "child", type: "folder", title: "Child", parentId: "root" });
    const note = document({ id: "note", parentId: "child" });
    const sibling = document({ id: "sibling" });
    const documents = [home, root, child, note, sibling];

    expect(validateKnowledgeDocumentParent("note", "root", documents)).toEqual({ ok: true });
    expect(validateKnowledgeDocumentParent("note", undefined, documents)).toEqual({ ok: true });
    expect(validateKnowledgeDocumentParent("note", "child", documents)).toEqual({
      ok: false,
      reason: "same_parent",
    });
    expect(validateKnowledgeDocumentParent("note", "missing", documents)).toEqual({
      ok: false,
      reason: "missing_parent",
    });
    expect(validateKnowledgeDocumentParent("note", "sibling", documents)).toEqual({
      ok: false,
      reason: "parent_not_folder",
    });
    expect(validateKnowledgeDocumentParent("child", "child", documents)).toEqual({
      ok: false,
      reason: "self_parent",
    });
    expect(validateKnowledgeDocumentParent("root", "child", documents)).toEqual({
      ok: false,
      reason: "descendant_parent",
    });
    expect(validateKnowledgeDocumentParent("home", "root", documents)).toEqual({
      ok: false,
      reason: "book_home_locked",
    });
  });

  it("extracts a heading outline from Tiptap JSON", () => {
    const outline = extractKnowledgeDocumentOutline({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "第一章  起点" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        {
          type: "blockquote",
          content: [
            {
              type: "heading",
              attrs: { level: 3 },
              content: [
                { type: "text", text: "关键问题" },
                { type: "hardBreak" },
                { type: "text", text: "继续" },
              ],
            },
          ],
        },
      ],
    });

    expect(outline).toEqual([
      { id: "heading-1", index: 0, level: 1, title: "第一章 起点" },
      { id: "heading-2", index: 1, level: 3, title: "关键问题 继续" },
    ]);
  });

  it("falls back to markdown headings when Tiptap JSON has no outline", () => {
    const outline = extractKnowledgeDocumentOutline(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] },
      `# Main **Idea**

\`\`\`md
## Hidden
\`\`\`

### [[doc-id|Linked section]]
`,
    );

    expect(outline).toEqual([
      { id: "heading-1-main-idea", index: 0, level: 1, title: "Main Idea" },
      { id: "heading-2-linked-section", index: 1, level: 3, title: "Linked section" },
    ]);
  });

  it("ignores empty headings and clamps invalid heading levels", () => {
    const outline = extractKnowledgeDocumentOutline({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 0 }, content: [{ type: "text", text: "Low" }] },
        { type: "heading", attrs: { level: 99 }, content: [{ type: "text", text: "High" }] },
        { type: "heading", attrs: { level: 2 }, content: [] },
      ],
    });

    expect(outline).toEqual([
      { id: "heading-1-low", index: 0, level: 1, title: "Low" },
      { id: "heading-2-high", index: 1, level: 6, title: "High" },
    ]);
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
