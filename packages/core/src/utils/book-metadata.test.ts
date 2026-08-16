import { describe, expect, it } from "vitest";
import type { Book } from "../types";
import {
  applyBookMetadataFormUpdate,
  buildBookMetadataUpdate,
  hasMissingBookMetadataAutoFillTargets,
  mergeBookMetadataSources,
  mergeMissingBookMetadataValues,
} from "./book-metadata";

describe("mergeBookMetadataSources", () => {
  it("fills in priority order and normalizes extracted values", () => {
    expect(
      mergeBookMetadataSources(
        { title: "My title", author: "", language: "" },
        {
          title: "Catalog title",
          author: "Catalog author",
          language: "zh_hans",
          subjects: [" Fiction ", "Fiction"],
        },
        { author: "Embedded author", publisher: " Embedded Press " },
        { title: "filename" },
      ),
    ).toEqual({
      title: "My title",
      author: "Catalog author",
      language: "zh-CN",
      subjects: ["Fiction"],
      publisher: "Embedded Press",
    });
  });

  it("ignores empty and invalid candidates", () => {
    expect(
      mergeBookMetadataSources({ title: "" }, { title: "Book", publishDate: "not-a-date" }),
    ).toEqual({ title: "Book" });
  });
});

it("does not copy subjects into user tags during details repair", () => {
  const values = {
    title: "",
    author: "",
    coverUrl: "",
    publisher: "",
    language: "",
    isbn: "",
    publishDate: "",
    rating: null,
    description: "",
    reviews: [],
    subjectsText: "",
    tagsText: "",
    groupId: "",
  };
  const next = mergeMissingBookMetadataValues(values, { subjects: ["History"] });
  expect(next?.subjectsText).toBe("History");
  expect(next?.tagsText).toBe("");
});

it("does not request autofill when publication metadata is complete and tags are empty", () => {
  expect(
    hasMissingBookMetadataAutoFillTargets({
      title: "Book",
      author: "Author",
      coverUrl: "covers/book.jpg",
      publisher: "Publisher",
      language: "en",
      isbn: "9781234567890",
      publishDate: "2024",
      rating: null,
      description: "Description",
      reviews: [],
      subjectsText: "History",
      tagsText: "",
      groupId: "",
    }),
  ).toBe(false);
});

it("requests autofill for a missing cover and never replaces an existing cover", () => {
  const values = {
    title: "Book",
    author: "Author",
    coverUrl: "",
    publisher: "Publisher",
    language: "en",
    isbn: "9781234567890",
    publishDate: "2024",
    rating: null,
    description: "Description",
    reviews: [],
    subjectsText: "History",
    tagsText: "",
    groupId: "",
  };

  expect(hasMissingBookMetadataAutoFillTargets(values)).toBe(true);
  expect(
    mergeMissingBookMetadataValues(values, { coverUrl: "covers/extracted.jpg" })?.coverUrl,
  ).toBe("covers/extracted.jpg");
  expect(
    mergeMissingBookMetadataValues(
      { ...values, coverUrl: "covers/user.jpg" },
      { coverUrl: "covers/extracted.jpg" },
    ),
  ).toBeNull();
});

it("atomically exposes a just-entered edit to an in-flight metadata merge", () => {
  const book = {
    id: "book-1",
    format: "epub",
    filePath: "books/book-1.epub",
    meta: { title: "Book", author: "Author" },
    progress: 0,
    addedAt: 1,
  } as Book;
  const ref = {
    current: {
      title: "Book",
      author: "Author",
      coverUrl: "covers/book.jpg",
      publisher: "",
      language: "",
      isbn: "",
      publishDate: "",
      rating: null,
      description: "",
      reviews: [],
      subjectsText: "",
      tagsText: "",
      groupId: "",
    },
  };
  let rendered = ref.current;

  applyBookMetadataFormUpdate(
    ref,
    (next) => {
      rendered = next;
    },
    (current) => ({ ...current, publisher: "User press" }),
  );
  const repaired = mergeMissingBookMetadataValues(ref.current, {
    publisher: "Extracted press",
    language: "fr",
  });
  const finalValues = repaired ?? ref.current;
  const persisted = buildBookMetadataUpdate(book, finalValues);

  expect(rendered.publisher).toBe("User press");
  expect(persisted.meta.publisher).toBe("User press");
  expect(persisted.meta.language).toBe("fr");
});
