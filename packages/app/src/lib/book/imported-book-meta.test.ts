import { describe, expect, it } from "vitest";
import { buildImportedBookMeta, fromDocumentMetadata } from "./imported-book-meta";

describe("desktop imported book metadata", () => {
  it("preserves restored fields while filling blanks from rich extracted metadata", () => {
    const reviews = [{ id: "review-1", content: "Keep this", createdAt: 1, updatedAt: 2 }];

    expect(
      buildImportedBookMeta({
        existing: {
          title: "Edited title",
          author: "",
          publisher: "Saved press",
          rating: 4,
          reviews,
          totalPages: 320,
        },
        opds: { author: "Catalog author", language: "fr" },
        embedded: {
          title: "Embedded title",
          author: "Embedded author",
          publisher: "Embedded press",
          isbn: "978 1 4028 9462 6",
          subjects: ["History"],
          coverUrl: "covers/1.jpg",
        },
        fallbackTitle: "filename",
      }),
    ).toMatchObject({
      title: "Edited title",
      author: "Catalog author",
      publisher: "Saved press",
      language: "fr",
      isbn: "9781402894626",
      subjects: ["History"],
      coverUrl: "covers/1.jpg",
      rating: 4,
      reviews,
      totalPages: 320,
    });
  });

  it("normalizes Foliate object metadata without turning subjects into tags", () => {
    expect(
      fromDocumentMetadata({
        title: { en: "Object title" },
        author: { name: "Object author" },
        publisher: "Press",
        language: "en-US",
        identifier: "978 1 4028 9462 6",
        published: "2020-4-3",
        description: "Summary",
        subject: [{ name: "History" }, "Science"],
      }),
    ).toEqual({
      title: "Object title",
      author: "Object author",
      publisher: "Press",
      language: "en-US",
      isbn: "978 1 4028 9462 6",
      publishDate: "2020-4-3",
      description: "Summary",
      subjects: ["History", "Science"],
    });
  });

  it("keeps a single Foliate subject as a subject", () => {
    expect(fromDocumentMetadata({ subject: "Fiction" }).subjects).toEqual(["Fiction"]);
  });
});
