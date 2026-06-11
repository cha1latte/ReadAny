import { describe, expect, it } from "vitest";
import type { KnowledgeDocument } from "../types";
import { KnowledgeExporter } from "./knowledge-exporter";
import {
  createKnowledgeVaultImportPlan,
  parseKnowledgeMarkdownDocument,
} from "./knowledge-importer";

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

  it("creates a vault import plan for modified manifest-tracked documents", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        documents: [knowledgeDocument({ bookId: undefined, sourceKind: undefined })],
      },
      { exportedAt: 1700000200000 },
    );
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");
    const editedContent = documentFile.content.replace(
      "A durable idea.",
      "A durable idea edited in Obsidian.",
    );

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: editedContent }],
    });

    expect(plan.entries).toHaveLength(1);
    expect(plan.missing).toEqual([]);
    expect(plan.unreadable).toEqual([]);
    expect(plan.modified).toHaveLength(1);
    expect(plan.modified[0]).toMatchObject({
      documentId: "doc-1",
      path: documentFile.path,
      status: "modified",
      previousHash: vault.manifest.documents["doc-1"].hash,
    });
    expect(plan.modified[0].draft?.draft).toMatchObject({
      id: "doc-1",
      type: "book_home",
      title: "Book Home",
      contentMd: expect.stringContaining("edited in Obsidian"),
    });
  });

  it("keeps unchanged manifest files out of the modified import list", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      documents: [knowledgeDocument({ bookId: undefined })],
    });
    const documentFile = vault.files.find((file) => file.path.endsWith(".md"));
    if (!documentFile) throw new Error("Expected exported document file");

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: documentFile.path, content: documentFile.content }],
    });

    expect(plan.modified).toEqual([]);
    expect(plan.entries).toEqual([
      expect.objectContaining({
        documentId: "doc-1",
        status: "unchanged",
        previousHash: vault.manifest.documents["doc-1"].hash,
        existingHash: vault.manifest.documents["doc-1"].hash,
      }),
    ]);
  });

  it("reports missing and unreadable modified vault files", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      documents: [
        knowledgeDocument({ id: "doc-missing", bookId: undefined }),
        knowledgeDocument({ id: "doc-unreadable", bookId: undefined, title: "Unreadable" }),
      ],
    });
    const unreadablePath = vault.manifest.documents["doc-unreadable"].path;

    const plan = createKnowledgeVaultImportPlan({
      manifest: vault.manifest,
      files: [{ path: unreadablePath, hash: "fnv1a32:changed" }],
    });

    expect(plan.missing).toEqual([
      expect.objectContaining({
        documentId: "doc-missing",
        status: "missing",
        warnings: ["manifest_file_missing"],
      }),
    ]);
    expect(plan.unreadable).toEqual([
      expect.objectContaining({
        documentId: "doc-unreadable",
        status: "modified_unreadable",
        existingHash: "fnv1a32:changed",
        warnings: ["modified_file_content_missing"],
      }),
    ]);
  });
});
