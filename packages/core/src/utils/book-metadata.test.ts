import { describe, expect, it } from "vitest";
import {
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
