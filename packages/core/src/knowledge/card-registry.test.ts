import { describe, expect, it } from "vitest";
import {
  createDefaultReadAnyCardAttrs,
  createReadAnyCardAttrsFromTemplate,
  getReadAnyCardDefinition,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateInsertLabel,
  normalizeReadAnyCardAttrs,
  renderReadAnyCardMarkdownFallback,
  upgradeReadAnyCardAttrs,
} from "./card-registry";

describe("ReadAny card registry", () => {
  it("creates exportable default attrs for built-in cards", () => {
    expect(createDefaultReadAnyCardAttrs("callout", { title: "Idea" })).toEqual({
      cardType: "callout",
      version: 1,
      title: "Idea",
      markdown: "",
    });

    expect(createDefaultReadAnyCardAttrs("qa", { title: "Question" })).toMatchObject({
      cardType: "qa",
      title: "Question",
      markdown: "Q:\nA:",
    });

    expect(createDefaultReadAnyCardAttrs("mindmap")).toMatchObject({
      cardType: "mindmap",
      title: getReadAnyCardDefinition("mindmap")?.insertLabel,
      markdown: "# Topic\n## Branch",
    });

    expect(createDefaultReadAnyCardAttrs("aiToolFailure")).toMatchObject({
      cardType: "aiToolFailure",
      title: getReadAnyCardDefinition("aiToolFailure")?.insertLabel,
      markdown: "Tool:\nError:\nReason:",
    });
  });

  it("keeps unknown cards readable through a generic callout fallback", () => {
    expect(
      renderReadAnyCardMarkdownFallback(
        { cardType: "customMetric", title: "Reading score", text: "Focus: 92%" },
        { body: "" },
      ),
    ).toBe("> [!note] Reading score\n> Focus: 92%");
  });

  it("normalizes legacy card aliases and unsafe versions", () => {
    expect(
      normalizeReadAnyCardAttrs({
        type: "legacyTimeline",
        version: "3",
        title: "Reading timeline",
        source: "highlight-1",
        "source-title": "Chapter 2",
        markdown: "A -> B",
      }),
    ).toEqual({
      cardType: "legacyTimeline",
      version: 3,
      title: "Reading timeline",
      sourceId: "highlight-1",
      sourceTitle: "Chapter 2",
      markdown: "A -> B",
    });

    expect(normalizeReadAnyCardAttrs({ cardType: "callout", version: 0 })).toEqual({
      cardType: "callout",
      version: 1,
    });
  });

  it("upgrades legacy built-in card payloads before rendering or editing", () => {
    expect(
      upgradeReadAnyCardAttrs({
        cardType: "bookQuote",
        data: {
          quote: "Reading is thinking.",
          chapterTitle: "Chapter 1",
          highlightId: "hl-1",
          rangeCfi: "epubcfi(/6/2)",
        },
      }),
    ).toEqual({
      cardType: "bookQuote",
      version: 1,
      markdown: "Reading is thinking.",
      text: "Reading is thinking.",
      sourceTitle: "Chapter 1",
      sourceId: "hl-1",
      cfi: "epubcfi(/6/2)",
      data: {
        quote: "Reading is thinking.",
        chapterTitle: "Chapter 1",
        highlightId: "hl-1",
        rangeCfi: "epubcfi(/6/2)",
      },
    });

    expect(
      normalizeReadAnyCardAttrs({
        cardType: "qa",
        data: {
          question: "What changed?",
          answer: "The card can migrate itself.",
        },
      }),
    ).toMatchObject({
      cardType: "qa",
      version: 1,
      markdown: "Q: What changed?\nA: The card can migrate itself.",
      text: "Q: What changed?\nA: The card can migrate itself.",
    });
  });

  it("keeps AI/tool failure cards visible and exportable", () => {
    const attrs = normalizeReadAnyCardAttrs({
      cardType: "aiToolFailure",
      data: {
        toolName: "searchKnowledgeBase",
        status: "failed",
        error: "Knowledge index unavailable",
        reason: "missing_index",
        documentId: "doc-1",
      },
    });

    expect(attrs).toEqual({
      cardType: "aiToolFailure",
      version: 1,
      title: "searchKnowledgeBase",
      markdown:
        "Tool: searchKnowledgeBase\nStatus: failed\nError: Knowledge index unavailable\nReason: missing_index\nDocument: doc-1",
      text: "Tool: searchKnowledgeBase\nStatus: failed\nError: Knowledge index unavailable\nReason: missing_index\nDocument: doc-1",
      sourceId: "doc-1",
      data: {
        toolName: "searchKnowledgeBase",
        status: "failed",
        error: "Knowledge index unavailable",
        reason: "missing_index",
        documentId: "doc-1",
      },
    });

    expect(renderReadAnyCardMarkdownFallback(attrs, { body: "" })).toBe(
      [
        "> [!failure] searchKnowledgeBase",
        "> Tool: searchKnowledgeBase",
        "> Status: failed",
        "> Error: Knowledge index unavailable",
        "> Reason: missing_index",
        "> Document: doc-1",
      ].join("\n"),
    );
  });

  it("creates insertable attrs from synced card templates", () => {
    const template = {
      id: "template-concept",
      name: "Concept Card",
      version: 2,
      schemaJson: {
        cardType: "concept",
        insertLabel: "Concept",
        description: "Capture a reusable concept.",
        title: "New concept",
        markdown: "Definition:\nEvidence:",
        attrs: {
          data: { kind: "concept" },
        },
      },
      builtIn: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(getReadAnyCardTemplateInsertLabel(template)).toBe("Concept");
    expect(getReadAnyCardTemplateDescription(template)).toBe("Capture a reusable concept.");
    expect(createReadAnyCardAttrsFromTemplate(template)).toEqual({
      cardType: "concept",
      version: 2,
      title: "New concept",
      markdown: "Definition:\nEvidence:",
      data: { kind: "concept" },
    });
  });
});
