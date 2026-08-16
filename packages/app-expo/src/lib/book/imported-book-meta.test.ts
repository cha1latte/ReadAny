import { describe, expect, it } from "vitest";
import { buildImportedBookMeta } from "./imported-book-meta";

describe("buildImportedBookMeta", () => {
  it("persists rich extracted metadata", () => {
    expect(
      buildImportedBookMeta({
        existing: undefined,
        opds: undefined,
        embedded: {
          title: "Book",
          author: "Author",
          publisher: "Press",
          language: "en-US",
          isbn: "978 1 4028 9462 6",
          publishDate: "2020-4-3",
          description: "Summary",
          subjects: ["History"],
          coverUrl: "covers/1.jpg",
        },
        fallbackTitle: "file",
      }),
    ).toMatchObject({
      title: "Book",
      author: "Author",
      publisher: "Press",
      language: "en",
      isbn: "9781402894626",
      publishDate: "2020-04-03",
      description: "Summary",
      subjects: ["History"],
      coverUrl: "covers/1.jpg",
    });
  });

  it("preserves restored values and lets OPDS fill blanks before embedded metadata", () => {
    expect(
      buildImportedBookMeta({
        existing: { title: "Edited", author: "", publisher: "Saved" },
        opds: { title: "Catalog", author: "Catalog Author", publisher: "Catalog Press" },
        embedded: { author: "Embedded Author", language: "fr" },
        fallbackTitle: "file",
      }),
    ).toMatchObject({
      title: "Edited",
      author: "Catalog Author",
      publisher: "Saved",
      language: "fr",
    });
  });
});
