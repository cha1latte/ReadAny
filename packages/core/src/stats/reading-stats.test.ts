import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Book, ReadingSession } from "../types";

const dbMocks = vi.hoisted(() => ({
  getBooks: vi.fn(),
  getReadingSessions: vi.fn(),
  getReadingSessionsByDateRange: vi.fn(),
}));

vi.mock("../db/database", () => dbMocks);

const { ReadingStatsService } = await import("./reading-stats");

function createBook(overrides: Partial<Book>): Book {
  return {
    id: overrides.id ?? "book-1",
    filePath: overrides.filePath ?? "/tmp/book.epub",
    format: overrides.format ?? "epub",
    meta: {
      title: "Deep Reading",
      author: "Alice",
      ...overrides.meta,
    },
    addedAt: overrides.addedAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    deletedAt: overrides.deletedAt,
    progress: overrides.progress ?? 0,
    currentCfi: overrides.currentCfi,
    isVectorized: overrides.isVectorized ?? false,
    vectorizeProgress: overrides.vectorizeProgress ?? 0,
    tags: overrides.tags ?? [],
    fileHash: overrides.fileHash,
    syncStatus: overrides.syncStatus ?? "local",
    lastOpenedAt: overrides.lastOpenedAt,
  };
}

function createSession(overrides: Partial<ReadingSession>): ReadingSession {
  return {
    id: overrides.id ?? "session-1",
    bookId: overrides.bookId ?? "book-1",
    state: overrides.state ?? "STOPPED",
    startedAt: overrides.startedAt ?? new Date(2026, 3, 17, 9, 0, 0).getTime(),
    endedAt: overrides.endedAt,
    totalActiveTime: overrides.totalActiveTime ?? 30 * 60 * 1000,
    pagesRead: overrides.pagesRead ?? 10,
    charactersRead: overrides.charactersRead ?? 12_000,
  };
}

describe("ReadingStatsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts duplicate deleted book records as the active book in overall stats", async () => {
    const active = createBook({
      id: "book-active",
      fileHash: "same-file",
      meta: { title: "如何成为不完美主义者", author: "斯蒂芬·盖斯" },
      progress: 0.4,
      updatedAt: 20,
    });
    const deleted = createBook({
      id: "book-deleted",
      fileHash: "same-file",
      deletedAt: 10,
      meta: { title: "如何成为不完美主义者（改变无数人...", author: "斯蒂芬·盖斯" },
      updatedAt: 5,
    });
    dbMocks.getBooks.mockResolvedValue([deleted, active]);
    dbMocks.getReadingSessions.mockImplementation((bookId: string) =>
      Promise.resolve(
        bookId === "book-deleted"
          ? [createSession({ bookId, totalActiveTime: 20 * 60 * 1000 })]
          : [createSession({ bookId, totalActiveTime: 40 * 60 * 1000 })],
      ),
    );

    const stats = await new ReadingStatsService().getOverallStats();

    expect(stats.totalBooks).toBe(1);
    expect(stats.totalReadingTime).toBe(60);
    expect(stats.totalSessions).toBe(2);
  });

  it("merges period book stats for duplicate deleted records into the active title", async () => {
    const active = createBook({
      id: "book-active",
      fileHash: "same-file",
      meta: { title: "如何成为不完美主义者", author: "斯蒂芬·盖斯", coverUrl: "cover-new" },
      progress: 0.4,
    });
    const deleted = createBook({
      id: "book-deleted",
      fileHash: "same-file",
      deletedAt: 10,
      meta: { title: "如何成为不完美主义者（改变无数人...", author: "斯蒂芬·盖斯" },
    });
    dbMocks.getBooks.mockResolvedValue([deleted, active]);
    dbMocks.getReadingSessionsByDateRange.mockResolvedValue([
      createSession({ id: "old", bookId: "book-deleted", totalActiveTime: 11 * 60 * 1000 }),
      createSession({ id: "new", bookId: "book-active", totalActiveTime: 89 * 60 * 1000 }),
    ]);

    const stats = await new ReadingStatsService().getBookStatsForPeriod(
      new Date(2026, 3, 1),
      new Date(2026, 3, 30),
    );

    expect(stats).toEqual([
      expect.objectContaining({
        bookId: "book-active",
        title: "如何成为不完美主义者",
        coverUrl: "cover-new",
        totalTime: 100,
      }),
    ]);
  });
});
