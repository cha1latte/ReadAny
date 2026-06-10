import { describe, expect, it } from "vitest";
import type { Book, KnowledgeAttachment, KnowledgeDocument, KnowledgeLink } from "../types";
import { KnowledgeExporter, createKnowledgeExportHash } from "./knowledge-exporter";

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

  it("builds a vault package with a ReadAny manifest", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [knowledgeDocument()],
      },
      { rootDir: "ReadAny", exportedAt: 1700000200000 },
    );

    expect(vault.conflicts).toEqual([]);
    expect(vault.files.map((file) => file.path)).toEqual([
      "ReadAny/Books/The Book A Study/README.md",
      "ReadAny/.readany/manifest.json",
    ]);
    expect(vault.files.at(-1)?.mimeType).toBe("application/json");
    expect(vault.manifest).toMatchObject({
      version: 1,
      app: "ReadAny",
      format: "obsidian",
      rootDir: "ReadAny",
      exportedAt: 1700000200000,
    });
    expect(vault.manifest.documents["doc-1"]).toMatchObject({
      id: "doc-1",
      type: "book_home",
      title: "Book Home",
      path: "ReadAny/Books/The Book A Study/README.md",
      bookId: "book-1",
      sourceKind: "book",
      sourceId: "book-1",
      contentSchemaVersion: 1,
      updatedAt: 1700000100000,
    });
    expect(vault.manifest.documents["doc-1"].hash).toBe(
      createKnowledgeExportHash(vault.files[0].content),
    );

    const manifestFile = vault.files.find((file) => file.path.endsWith("manifest.json"));
    expect(JSON.parse(manifestFile?.content ?? "{}")).toEqual(vault.manifest);
  });

  it("records attachment metadata in the vault manifest", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
      documents: [knowledgeDocument()],
      attachments: [
        {
          id: "att-1",
          documentId: "doc-1",
          kind: "image",
          fileName: "cover.png",
          mimeType: "image/png",
          localPath: "local/cover.png",
          size: 42,
          hash: "sha256:cover",
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });

    expect(vault.manifest.attachments["att-1"]).toEqual({
      id: "att-1",
      documentId: "doc-1",
      kind: "image",
      fileName: "cover.png",
      mimeType: "image/png",
      path: "local/cover.png",
      size: 42,
      hash: "sha256:cover",
      updatedAt: 2000,
    });
  });

  it("keeps duplicate document paths unique in both files and manifest entries", () => {
    const exporter = new KnowledgeExporter();
    const vault = exporter.buildVaultPackage({
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
          id: "doc-c",
          bookId: undefined,
          type: "standalone_note",
          title: "Same Name-2",
        }),
      ],
    });

    expect(vault.files.map((file) => file.path)).toEqual([
      "Notes/Same Name.md",
      "Notes/Same Name-2.md",
      "Notes/Same Name-2-2.md",
      ".readany/manifest.json",
    ]);
    expect(vault.manifest.documents["doc-a"].path).toBe("Notes/Same Name.md");
    expect(vault.manifest.documents["doc-b"].path).toBe("Notes/Same Name-2.md");
    expect(vault.manifest.documents["doc-c"].path).toBe("Notes/Same Name-2-2.md");
  });

  it("reuses previous manifest paths by document id during linked-folder exports", () => {
    const exporter = new KnowledgeExporter();
    const first = exporter.buildVaultPackage({
      documents: [
        knowledgeDocument({
          id: "doc-rename",
          bookId: undefined,
          type: "standalone_note",
          title: "Old Title",
        }),
      ],
    });
    const second = exporter.buildVaultPackage(
      {
        documents: [
          knowledgeDocument({
            id: "doc-rename",
            bookId: undefined,
            type: "standalone_note",
            title: "New Title",
          }),
        ],
      },
      { previousManifest: first.manifest },
    );

    expect(first.manifest.documents["doc-rename"].path).toBe("Notes/Old Title.md");
    expect(second.files[0].path).toBe("Notes/Old Title.md");
    expect(second.manifest.documents["doc-rename"]).toMatchObject({
      id: "doc-rename",
      title: "New Title",
      path: "Notes/Old Title.md",
    });
  });

  it("detects external edits before overwriting a manifest-tracked file", () => {
    const exporter = new KnowledgeExporter();
    const first = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [knowledgeDocument()],
      },
      { exportedAt: 1000 },
    );
    const next = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [
          knowledgeDocument({
            contentMd: "Updated from ReadAny",
            contentJson: { type: "doc", content: [] },
            updatedAt: 1700000300000,
          }),
        ],
      },
      {
        previousManifest: first.manifest,
        existingFiles: [
          {
            path: "Books/The Book A Study/README.md",
            content: `${first.files[0].content}\nEdited in Obsidian.\n`,
          },
        ],
      },
    );

    expect(next.conflicts).toHaveLength(1);
    expect(next.conflicts[0]).toMatchObject({
      kind: "external_modified",
      documentId: "doc-1",
      path: "Books/The Book A Study/README.md",
      previousHash: first.manifest.documents["doc-1"].hash,
      nextHash: next.manifest.documents["doc-1"].hash,
    });
  });

  it("does not report conflicts for unchanged or already-updated files", () => {
    const exporter = new KnowledgeExporter();
    const first = exporter.buildVaultPackage({
      books: [baseBook],
      documents: [knowledgeDocument()],
    });
    const next = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [
          knowledgeDocument({
            contentMd: "Updated from ReadAny",
            contentJson: { type: "doc", content: [] },
            updatedAt: 1700000300000,
          }),
        ],
      },
      {
        previousManifest: first.manifest,
        existingFiles: [
          {
            path: "Books/The Book A Study/README.md",
            content: first.files[0].content,
          },
          {
            path: "Notes/Missing.md",
            content: "Unknown file",
          },
        ],
      },
    );
    const alreadyUpdated = exporter.buildVaultPackage(
      {
        books: [baseBook],
        documents: [
          knowledgeDocument({
            contentMd: "Updated from ReadAny",
            contentJson: { type: "doc", content: [] },
            updatedAt: 1700000300000,
          }),
        ],
      },
      {
        previousManifest: first.manifest,
        existingFiles: [
          {
            path: "Books/The Book A Study/README.md",
            content: next.files[0].content,
          },
        ],
      },
    );

    expect(next.conflicts).toEqual([]);
    expect(alreadyUpdated.conflicts).toEqual([]);
  });
});
