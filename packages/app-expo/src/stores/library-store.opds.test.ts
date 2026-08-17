import type { Book } from "@readany/core/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const platform = {
    getAppDataDir: vi.fn(async () => "/app"),
    joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    writeFile: vi.fn(async () => undefined),
    deleteFile: vi.fn(async (_path: string) => undefined),
    exists: vi.fn(async () => false),
  };
  const db = {
    initDatabase: vi.fn(async () => undefined),
    insertBook: vi.fn(async () => undefined),
    updateBook: vi.fn(async () => undefined),
    getDeletedBookByFileHash: vi.fn(async () => null as Book | null),
    getDeletedBookByTitle: vi.fn(async () => null as Book | null),
  };
  return {
    platform,
    db,
    getInfoAsync: vi.fn(async () => ({
      exists: true,
      isDirectory: false,
      size: 3,
      md5: "same-hash",
    })),
    saveCover: vi.fn(async (bookId: string) => `covers/${bookId}.jpg`),
    copied: [] as string[],
  };
});

vi.mock("@/lib/book/cover-storage", () => ({
  saveCoverBytesToAppData: mocks.saveCover,
}));
vi.mock("@/lib/book/imported-book-meta", () => ({
  shouldPersistEmbeddedCover: () => true,
  buildImportedBookMeta: ({
    existing,
    opds,
    embedded,
    fallbackTitle,
  }: {
    existing?: Partial<Book["meta"]>;
    opds?: Partial<Book["meta"]>;
    embedded?: Partial<Book["meta"]>;
    fallbackTitle: string;
  }) => ({
    ...embedded,
    ...opds,
    ...existing,
    title: existing?.title ?? opds?.title ?? embedded?.title ?? fallbackTitle,
    author: existing?.author ?? opds?.author ?? embedded?.author ?? "",
  }),
}));
vi.mock("@/lib/book/metadata-extractor", () => ({
  createRangeReadableFile: vi.fn(),
  extractBookMetadata: vi.fn(async () => ({
    title: "Embedded title",
    author: "Embedded author",
    coverBytes: new Uint8Array([9]),
    coverMimeType: "image/jpeg",
  })),
  extractBookMetadataFromFile: vi.fn(),
}));
vi.mock("@/lib/rag/auto-vectorize-service", () => ({ queueBook: vi.fn() }));
vi.mock("@readany/core/db/database", () => mocks.db);
vi.mock("@readany/core/db/write-retry", () => ({
  runWithDbRetry: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock("@readany/core/services", () => ({ getPlatformService: () => mocks.platform }));
vi.mock("./persist", () => ({ debouncedSave: vi.fn(), loadFromFS: vi.fn() }));
vi.mock("./vector-model-store", () => ({
  useVectorModelStore: {
    getState: () => ({
      autoVectorizeOnImport: false,
      vectorModelEnabled: false,
      hasVectorCapability: () => false,
    }),
  },
}));
vi.mock("expo-file-system/legacy", () => ({ getInfoAsync: mocks.getInfoAsync }));
vi.mock("expo-file-system", () => ({
  File: class {
    exists = false;
    constructor(private readonly path: string) {}
    copy(destination: { path: string }) {
      mocks.copied.push(destination.path);
    }
    delete() {}
  },
}));

import { useLibraryStore } from "./library-store";

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: "existing-id",
    filePath: "books/existing-id.epub",
    format: "epub",
    meta: { title: "Saved title", author: "Saved author" },
    progress: 0.5,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: ["user-tag"],
    fileHash: "same-hash",
    syncStatus: "local",
    addedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("mobile transactional OPDS imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copied.length = 0;
    mocks.db.getDeletedBookByFileHash.mockResolvedValue(null);
    mocks.db.insertBook.mockResolvedValue(undefined);
    mocks.db.updateBook.mockResolvedValue(undefined);
    useLibraryStore.setState({ books: [], isImporting: false });
  });

  it("uses the real mobile MD5 to skip an existing duplicate", async () => {
    useLibraryStore.setState({ books: [book()] });

    const result = await useLibraryStore
      .getState()
      .importBooks([{ uri: "file:///cache/book.epub", name: "Catalog.epub" }], {
        transactional: true,
      });

    expect(mocks.getInfoAsync).toHaveBeenCalledWith("file:///cache/book.epub", { md5: true });
    expect(result.skippedDuplicates).toHaveLength(1);
    expect(result.imported).toHaveLength(0);
    expect(mocks.copied).toHaveLength(0);
  });

  it("rolls back the managed book and cover when durable insertion fails", async () => {
    mocks.db.insertBook.mockRejectedValueOnce(new Error("insert failed"));
    mocks.getInfoAsync.mockResolvedValueOnce({
      exists: true,
      isDirectory: false,
      size: 3,
      md5: "new-hash",
    });

    const result = await useLibraryStore.getState().importBooks(
      [
        {
          uri: "file:///cache/book.epub",
          name: "Catalog.epub",
          metadata: { title: "Catalog title", author: "Catalog author" },
        },
      ],
      { transactional: true },
    );

    expect(result.failures).toHaveLength(1);
    expect(result.imported).toHaveLength(0);
    expect(useLibraryStore.getState().books).toHaveLength(0);
    expect(mocks.platform.deleteFile).toHaveBeenCalledTimes(2);
    expect(mocks.platform.deleteFile.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\/app\/books\/.*\.epub$/),
        expect.stringMatching(/^\/app\/covers\/.*\.jpg$/),
      ]),
    );
  });

  it("does not expose a restored row when the durable update fails", async () => {
    const deleted = book({ deletedAt: 10 });
    mocks.db.getDeletedBookByFileHash.mockResolvedValueOnce(deleted);
    mocks.db.updateBook.mockRejectedValueOnce(new Error("update failed"));

    const result = await useLibraryStore.getState().importBooks(
      [
        {
          uri: "file:///cache/book.epub",
          name: "Catalog.epub",
          metadata: { title: "Catalog title", author: "Catalog author" },
        },
      ],
      { transactional: true },
    );

    expect(result.failures).toHaveLength(1);
    expect(useLibraryStore.getState().books).toHaveLength(0);
    expect(mocks.platform.deleteFile).toHaveBeenCalled();
  });

  it("restores by hash durably while preserving saved user fields", async () => {
    const deleted = book({ deletedAt: 10 });
    mocks.db.getDeletedBookByFileHash.mockResolvedValueOnce(deleted);

    const result = await useLibraryStore.getState().importBooks(
      [
        {
          uri: "file:///cache/book.epub",
          name: "Catalog.epub",
          metadata: { title: "Catalog title", author: "Catalog author" },
        },
      ],
      { transactional: true },
    );

    expect(result.imported).toHaveLength(1);
    expect(mocks.db.updateBook).toHaveBeenCalledTimes(1);
    expect(useLibraryStore.getState().books[0]).toMatchObject({
      id: "existing-id",
      tags: ["user-tag"],
      meta: { title: "Saved title", author: "Saved author" },
    });
  });
});
