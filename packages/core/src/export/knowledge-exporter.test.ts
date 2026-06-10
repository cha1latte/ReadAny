import { describe, expect, it } from "vitest";
import type { Book, KnowledgeAttachment, KnowledgeDocument, KnowledgeLink } from "../types";
import { KnowledgeExporter } from "./knowledge-exporter";

const baseBook: Book = {
  id: "book-1",
  filePath: "books/book.epub",
  format: "epub",
  meta: {
    title: "The Book: A Study",
    author: "Ada Reader",
    language: "en",
  },
  addedAt: 1000,
  updatedAt: 2000,
  progress: 0.4,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: ["philosophy"],
  syncStatus: "local",
};

function knowledgeDocument(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "doc-1",
    bookId: "book-1",
    type: "book_home",
    title: "Book Home",
    contentJson: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Notes" }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            title: "Quote",
            text: "Reading is thinking.",
            sourceTitle: "Chapter 1",
          },
        },
      ],
    },
    contentMd: "",
    contentSchemaVersion: 1,
    tags: ["reading"],
    sourceKind: "book",
    sourceId: "book-1",
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    ...overrides,
  };
}

describe("KnowledgeExporter", () => {
  it("exports book home documents as Obsidian-friendly README files", () => {
    const exporter = new KnowledgeExporter();
    const files = exporter.export({
      books: [baseBook],
      documents: [knowledgeDocument()],
    });

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("Books/The Book A Study/README.md");
    expect(files[0].mimeType).toBe("text/markdown");
    expect(files[0].content).toContain("type: readany-knowledge");
    expect(files[0].content).toContain('title: "Book Home"');
    expect(files[0].content).toContain('book: "The Book: A Study"');
    expect(files[0].content).toContain("# Book Home");
    expect(files[0].content).toContain("## Notes");
    expect(files[0].content).toContain("> [!quote] Quote");
    expect(files[0].content).toContain("> Reading is thinking.");
  });

  it("renders links and attachments into readable Markdown sections", () => {
    const exporter = new KnowledgeExporter();
    const related = knowledgeDocument({
      id: "doc-2",
      type: "standalone_note",
      title: "Related Idea",
      bookId: undefined,
      sourceKind: undefined,
      sourceId: undefined,
      contentJson: { type: "doc", content: [] },
    });
    const links: KnowledgeLink[] = [
      {
        id: "link-1",
        fromDocumentId: "doc-1",
        toKind: "document",
        toId: "doc-2",
        relation: "related",
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: "link-2",
        fromDocumentId: "doc-1",
        toKind: "highlight",
        toId: "hl-1",
        relation: "source",
        label: "Original highlight",
        cfi: "epubcfi(/6/2)",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];
    const attachments: KnowledgeAttachment[] = [
      {
        id: "att-1",
        documentId: "doc-1",
        kind: "image",
        fileName: "diagram.png",
        localPath: "attachments/diagram.png",
        size: 128,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    const files = exporter.export({
      books: [baseBook],
      documents: [knowledgeDocument(), related],
      links,
      attachments,
    });
    const home = files.find((file) => file.path.endsWith("README.md"));

    expect(home?.content).toContain("## ReadAny Links");
    expect(home?.content).toContain("- **related:** [[Related Idea]]");
    expect(home?.content).toContain(
      "- **source:** [Original highlight](readany://cfi/epubcfi(%2F6%2F2))",
    );
    expect(home?.content).toContain("## Attachments");
    expect(home?.content).toContain("- [diagram.png](attachments/diagram.png)");
  });

  it("skips deleted documents by default and disambiguates duplicate paths", () => {
    const exporter = new KnowledgeExporter();
    const files = exporter.export({
      documents: [
        knowledgeDocument({
          id: "doc-a",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name",
        }),
        knowledgeDocument({
          id: "doc-b",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name",
        }),
        knowledgeDocument({
          id: "doc-deleted",
          bookId: undefined,
          type: "standalone_note",
          title: "Deleted",
          deletedAt: 2000,
        }),
      ],
    });

    expect(files.map((file) => file.path)).toEqual(["Notes/Same Name.md", "Notes/Same Name-2.md"]);
  });

  it("can preserve ReadAny card metadata for round-tripping exports", () => {
    const exporter = new KnowledgeExporter();
    const [file] = exporter.export(
      {
        documents: [knowledgeDocument({ bookId: undefined })],
      },
      { format: "markdown", includeReadAnyCardMetadata: true },
    );

    expect(file.content).toContain(':::readany-card type="bookQuote" version="1"');
    expect(file.content).toContain("Reading is thinking.");
    expect(file.content).not.toContain("type: readany-knowledge");
  });
});
