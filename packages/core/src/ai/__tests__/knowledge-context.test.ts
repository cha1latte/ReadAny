import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeDocument } from "../../types";
import { buildKnowledgePromptContext, loadKnowledgePromptContext } from "../knowledge-context";

const dbMocks = vi.hoisted(() => ({
  getKnowledgeDocuments: vi.fn(),
  searchKnowledgeDocuments: vi.fn(),
}));

vi.mock("../../db/database", () => dbMocks);

function doc(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "standalone_note",
    title: "Document",
    contentJson: { type: "doc", content: [] },
    contentMd: "Document body",
    contentSchemaVersion: 1,
    tags: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildKnowledgePromptContext", () => {
  it("includes document ids, vault paths, tags, and compact durable summaries", () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
      createdAt: 90,
      updatedAt: 90,
    });
    const summary = doc({
      id: "summary-1",
      parentId: "folder-1",
      type: "summary",
      title: "Memory Map",
      summaryMd: "## Durable Memory\n- Power, ritual, and time.",
      tags: ["theme", "review"],
      createdAt: 110,
      updatedAt: 120,
    });

    const context = buildKnowledgePromptContext([folder, summary]);

    expect(context).toContain("not the full vault");
    expect(context).toContain("[summary] Memory Map");
    expect(context).toContain("id: summary-1");
    expect(context).toContain("path: Knowledge base / Themes / Memory Map");
    expect(context).toContain("tags: theme, review");
    expect(context).toContain("Power, ritual, and time.");
    expect(context).not.toContain("[folder] Themes");
  });

  it("prioritizes book home and compact summaries over newer low-signal notes", () => {
    const home = doc({
      id: "home-1",
      type: "book_home",
      title: "Book Home",
      summaryMd: "The central reading workspace.",
      updatedAt: 20,
    });
    const recentNote = doc({
      id: "recent-1",
      title: "Recent Scratch",
      excerpt: "A short scratch note.",
      updatedAt: 999,
    });

    const context = buildKnowledgePromptContext([recentNote, home], { maxDocuments: 1 });

    expect(context).toContain("[book_home] Book Home");
    expect(context).not.toContain("Recent Scratch");
  });

  it("prioritizes documents that match the current question", () => {
    const home = doc({
      id: "home-1",
      type: "book_home",
      title: "Book Home",
      summaryMd: "The central reading workspace.",
      updatedAt: 20,
    });
    const relevantNote = doc({
      id: "relevant-1",
      title: "Tea Ceremony Notes",
      excerpt: "Ritual timing and shared attention.",
      updatedAt: 10,
    });

    const context = buildKnowledgePromptContext([home, relevantNote], {
      query: "tea ceremony",
      maxDocuments: 1,
    });

    expect(context).toContain("Tea Ceremony Notes");
    expect(context).not.toContain("Book Home");
  });

  it("prioritizes documents whose vault path matches the current question", () => {
    const home = doc({
      id: "home-1",
      type: "book_home",
      title: "Book Home",
      summaryMd: "The central reading workspace.",
      updatedAt: 20,
    });
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Themes",
      contentMd: "",
      updatedAt: 10,
    });
    const childNote = doc({
      id: "child-1",
      parentId: "folder-1",
      title: "Reading Thread",
      excerpt: "Shared attention and ritual timing.",
      updatedAt: 10,
    });

    const context = buildKnowledgePromptContext([home, folder, childNote], {
      query: "themes",
      maxDocuments: 1,
    });

    expect(context).toContain("Reading Thread");
    expect(context).toContain("path: Knowledge base / Themes / Reading Thread");
    expect(context).not.toContain("Book Home");
  });

  it("keeps the prompt snapshot bounded", () => {
    const context = buildKnowledgePromptContext(
      [
        doc({
          id: "long-1",
          title: "Long Note",
          summaryMd: "x".repeat(5000),
        }),
      ],
      { maxChars: 700 },
    );

    expect(context).toBeTruthy();
    expect(context!.length).toBeLessThanOrEqual(700);
    expect(context).toContain("Long Note");
    expect(context).toContain("...");
  });
});

describe("loadKnowledgePromptContext", () => {
  it("loads current-book knowledge documents and formats a bounded prompt context", async () => {
    dbMocks.getKnowledgeDocuments.mockResolvedValue([
      doc({
        id: "review-1",
        type: "review",
        title: "Reading Review",
        excerpt: "This is the user's own review.",
      }),
    ]);
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([]);

    const context = await loadKnowledgePromptContext({ bookId: "book-1" });

    expect(dbMocks.getKnowledgeDocuments).toHaveBeenCalledWith({ bookId: "book-1", limit: 5000 });
    expect(dbMocks.searchKnowledgeDocuments).not.toHaveBeenCalled();
    expect(context).toContain("Reading Review");
    expect(context).toContain("This is the user's own review.");
  });

  it("merges question-related search matches with the full vault path context", async () => {
    const folder = doc({
      id: "folder-1",
      type: "folder",
      title: "Characters",
      contentMd: "",
    });
    const searched = doc({
      id: "match-1",
      parentId: "folder-1",
      title: "Ada Notes",
      excerpt: "Ada's promise changes the ending.",
      updatedAt: 1,
    });

    dbMocks.getKnowledgeDocuments.mockResolvedValue([folder]);
    dbMocks.searchKnowledgeDocuments.mockResolvedValue([searched]);

    const context = await loadKnowledgePromptContext({
      bookId: "book-1",
      query: "Ada promise",
      maxDocuments: 1,
    });

    expect(dbMocks.searchKnowledgeDocuments).toHaveBeenCalledWith({
      bookId: "book-1",
      query: "ada promise",
      limit: 12,
    });
    expect(context).toContain("Ada Notes");
    expect(context).toContain("path: Knowledge base / Characters / Ada Notes");
  });

  it("does not query when no current book is attached", async () => {
    await expect(loadKnowledgePromptContext({ bookId: null })).resolves.toBeUndefined();
    expect(dbMocks.getKnowledgeDocuments).not.toHaveBeenCalled();
  });

  it("keeps AI streaming usable when the knowledge lookup fails", async () => {
    dbMocks.getKnowledgeDocuments.mockRejectedValue(new Error("database busy"));

    await expect(loadKnowledgePromptContext({ bookId: "book-1" })).resolves.toBeUndefined();
  });
});
