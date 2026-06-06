import type { Book } from "../types";

export interface StatsBookIdentity {
  bookById: Map<string, Book>;
  canonicalBookById: Map<string, Book>;
  canonicalBookIdById: Map<string, string>;
}

function toBookArray(books: Book[] | Map<string, Book>): Book[] {
  return books instanceof Map ? Array.from(books.values()) : books;
}

function isActiveBook(book: Book): boolean {
  return book.deletedAt === undefined;
}

function rankBookForStats(book: Book): number {
  const activeBonus = isActiveBook(book) ? 1_000_000_000_000_000 : 0;
  return activeBonus + Math.max(book.lastOpenedAt ?? 0, book.updatedAt ?? 0, book.addedAt ?? 0);
}

function pickCanonicalBook(a: Book, b: Book): Book {
  const rankA = rankBookForStats(a);
  const rankB = rankBookForStats(b);
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

export function createStatsBookIdentity(books: Book[] | Map<string, Book>): StatsBookIdentity {
  const bookList = toBookArray(books);
  const bookById = new Map(bookList.map((book) => [book.id, book]));
  const canonicalByHash = new Map<string, Book>();

  for (const book of bookList) {
    const fileHash = book.fileHash?.trim();
    if (!fileHash) continue;
    const existing = canonicalByHash.get(fileHash);
    canonicalByHash.set(fileHash, existing ? pickCanonicalBook(existing, book) : book);
  }

  const canonicalBookIdById = new Map<string, string>();
  const canonicalBookById = new Map<string, Book>();
  for (const book of bookList) {
    const fileHash = book.fileHash?.trim();
    const canonicalBook = fileHash ? canonicalByHash.get(fileHash) ?? book : book;
    canonicalBookIdById.set(book.id, canonicalBook.id);
    canonicalBookById.set(book.id, canonicalBook);
  }

  return {
    bookById,
    canonicalBookById,
    canonicalBookIdById,
  };
}

export function getCanonicalStatsBook(
  identity: StatsBookIdentity,
  bookId: string,
): Book | undefined {
  return identity.canonicalBookById.get(bookId) ?? identity.bookById.get(bookId);
}

export function getCanonicalStatsBookId(identity: StatsBookIdentity, bookId: string): string {
  return identity.canonicalBookIdById.get(bookId) ?? bookId;
}
