import { describe, expect, it } from "vitest";
import type { Book } from "../../types";
import { buildSystemPrompt } from "../system-prompt";

function makeBook(): Book {
  return {
    id: "book-1",
    filePath: "book.epub",
    format: "epub",
    meta: {
      title: "Test Book",
      author: "Test Author",
      description: "",
      subjects: [],
      language: "en",
    },
    progress: 0,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: [],
    addedAt: 1,
    lastOpenedAt: 1,
    updatedAt: 1,
    syncStatus: "local",
  };
}

describe("buildSystemPrompt citations", () => {
  it("injects bounded knowledge-base context when provided", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: false,
      userLanguage: "en",
      knowledgeContext:
        "- [summary] Memory Map\n  id: summary-1\n  path: Knowledge base / Themes / Memory Map",
    });

    expect(prompt).toContain("Knowledge Base Context");
    expect(prompt).toContain("id: summary-1");
    expect(prompt).toContain("Knowledge base / Themes / Memory Map");
    expect(prompt).toContain("getKnowledgeDocument");
  });

  it("allows fallback citations only when a returned CFI can be validated", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: false,
      userLanguage: "en",
    });

    expect(prompt).toContain("Fallback Source Requirements");
    expect(prompt).toContain("If the exact fallback result/chunk you cite has a non-empty cfi");
    expect(prompt).toContain("Call addCitation before writing the final response body");
    expect(prompt).toContain("Use [1], [2], [3] markers only after addCitation succeeds");
    expect(prompt).toContain("Never invent a CFI");
    expect(prompt).toContain("addCitation");
  });

  it("keeps clickable citation instructions for indexed content", () => {
    const prompt = buildSystemPrompt({
      book: makeBook(),
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      userLanguage: "en",
    });

    expect(prompt).toContain("Citation Requirements");
    expect(prompt).toContain("addCitation");
    expect(prompt).toContain("Wait for addCitation to return a citation result successfully");
    expect(prompt).toContain("Users can click [N]");
  });
});
