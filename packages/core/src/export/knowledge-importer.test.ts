import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "../types";
import { KnowledgeExporter } from "./knowledge-exporter";
import { parseKnowledgeMarkdownDocument } from "./knowledge-importer";

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
          type: "paragraph",
          content: [{ type: "text", text: "A durable idea." }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            id: "card-1",
            version: 2,
            title: "Important Quote",
            sourceId: "hl-1",
            cfi: "epubcfi(/6/2)",
            markdown: "Reading is thinking.\n\nKeep the source.",
          },
        },
      ],
    },
    contentMd: "",
    contentSchemaVersion: 1,
    tags: ["reading", "idea"],
    sourceKind: "book",
    sourceId: "book-1",
    createdAt: 1700000000000,
    updatedAt: 1700000100000,
    ...overrides,
  };
}

describe("Knowledge markdown importer", () => {
  it("round-trips a ReadAny exported Markdown document into a document draft", () => {
    const exporter = new KnowledgeExporter();
    const [file] = exporter.export(
      {
        documents: [knowledgeDocument()],
        links: [
          {
            id: "link-1",
            fromDocumentId: "doc-1",
            toKind: "url",
            toId: "https://example.com",
            relation: "related",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        attachments: [
          {
            id: "att-1",
            documentId: "doc-1",
            kind: "image",
            fileName: "diagram.png",
            localPath: "/tmp/diagram.png",
            size: 12,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    const imported = parseKnowledgeMarkdownDocument({
      path: file.path,
      content: file.content,
    });

    expect(imported.isReadAnyExport).toBe(true);
    expect(imported.warnings).toEqual([]);
    expect(imported.frontmatter).toMatchObject({
      type: "readany-knowledge",
      id: "doc-1",
      documentType: "book_home",
      title: "Book Home",
      bookId: "book-1",
      sourceKind: "book",
      sourceId: "book-1",
      tags: ["reading", "idea"],
    });
    expect(imported.contentMd).not.toContain("## ReadAny Links");
    expect(imported.contentMd).not.toContain("## Attachments");
    expect(imported.draft).toMatchObject({
      id: "doc-1",
      type: "book_home",
      title: "Book Home",
      bookId: "book-1",
      sourceKind: "book",
      sourceId: "book-1",
      tags: ["reading", "idea"],
      contentSchemaVersion: 1,
    });
    expect(imported.draft.contentJson).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A durable idea." }],
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            id: "card-1",
            version: 2,
            title: "Important Quote",
            sourceId: "hl-1",
            cfi: "epubcfi(/6/2)",
            markdown: "Reading is thinking.\n\nKeep the source.",
          },
        },
      ],
    });
  });

  it("imports ordinary Obsidian Markdown with frontmatter as an imported document", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Vault/Ideas/Slow Reading.md",
      content: [
        "---",
        'title: "Slow Reading"',
        "tags:",
        '  - "reading"',
        '  - "method"',
        "---",
        "# Slow Reading",
        "",
        "Read **slowly** and cite [[Book Home]].",
      ].join("\n"),
    });

    expect(imported.isReadAnyExport).toBe(false);
    expect(imported.warnings).toEqual(["frontmatter_not_readany"]);
    expect(imported.draft).toMatchObject({
      type: "imported_markdown",
      title: "Slow Reading",
      sourceKind: "obsidian",
      sourceId: "Vault/Ideas/Slow Reading.md",
      tags: ["reading", "method"],
      contentMd: "Read **slowly** and cite [[Book Home]].",
    });
    expect(imported.draft.contentJson).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "slowly", marks: [{ type: "bold" }] },
            { type: "text", text: " and cite " },
            {
              type: "readanyInternalLink",
              attrs: { label: "Book Home", title: "Book Home" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("uses the file name when ordinary Markdown has no title", () => {
    const imported = parseKnowledgeMarkdownDocument({
      path: "Vault/Untitled Note.md",
      content: "A note without a heading.",
    });

    expect(imported.draft.title).toBe("Untitled Note");
    expect(imported.draft.contentMd).toBe("A note without a heading.");
    expect(imported.draft.sourceKind).toBe("obsidian");
  });
});
