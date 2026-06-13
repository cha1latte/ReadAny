import { describe, expect, it } from "vitest";
import {
  createCustomReadAnyCardTemplate,
  createDefaultReadAnyCardAttrs,
  createReadAnyCardAttrsFromTemplate,
  getReadAnyCardDefinition,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateInsertLabel,
  normalizeReadAnyCardAttrs,
  renderReadAnyCardMarkdownFallback,
  updateCustomReadAnyCardTemplate,
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

  it("keeps unknown cards readable with ReadAny metadata in the fallback", () => {
    expect(
      renderReadAnyCardMarkdownFallback(
        {
          cardType: "customMetric",
          version: 3,
          title: "Reading score",
          text: "Focus: 92%",
          sourceTitle: "Chapter 4",
          cfi: "epubcfi(/6/4)",
        },
        { body: "" },
      ),
    ).toBe(
      [
        "> [!note] Reading score",
        "> Focus: 92%",
        "> ReadAny card: customMetric v3",
        "> Source: Chapter 4",
        "> CFI: epubcfi(/6/4)",
      ].join("\n"),
    );
  });

  it("does not silently pretend future built-in card versions are fully supported", () => {
    expect(
      renderReadAnyCardMarkdownFallback(
        {
          cardType: "aiSummary",
          version: 99,
          title: "Future summary",
          markdown: "Readable fallback body.",
        },
        { body: "" },
      ),
    ).toBe(
      [
        "> [!note] Future summary",
        "> Readable fallback body.",
        "> ReadAny card: aiSummary v99",
      ].join("\n"),
    );
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

  it("creates synced custom card templates for user-authored structures", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-reading-question",
      name: "Reading Question",
      description: "Track a question and answer.",
      markdown: "Question:\nAnswer:",
      now: 123,
    });

    expect(template).toEqual({
      id: "template-reading-question",
      name: "Reading Question",
      version: 1,
      schemaJson: {
        cardType: "custom:template-reading-question",
        insertLabel: "Reading Question",
        description: "Track a question and answer.",
        title: "Reading Question",
        markdown: "Question:\nAnswer:",
      },
      builtIn: false,
      enabled: true,
      createdAt: 123,
      updatedAt: 123,
    });
    expect(createReadAnyCardAttrsFromTemplate(template)).toEqual({
      cardType: "custom:template-reading-question",
      version: 1,
      title: "Reading Question",
      markdown: "Question:\nAnswer:",
    });
  });

  it("updates custom card templates without changing their stable card type", () => {
    const template = createCustomReadAnyCardTemplate({
      id: "template-reading-question",
      name: "Reading Question",
      description: "Track a question and answer.",
      markdown: "Question:\nAnswer:",
      now: 123,
    });

    const updated = updateCustomReadAnyCardTemplate({
      template: {
        ...template,
        schemaJson: {
          ...(template.schemaJson as Record<string, unknown>),
          attrs: {
            data: { tone: "short" },
          },
        },
      },
      name: "Reading Prompt",
      description: "",
      markdown: "Prompt:\nResponse:",
      now: 456,
    });

    expect(updated).toMatchObject({
      id: "template-reading-question",
      name: "Reading Prompt",
      version: 2,
      builtIn: false,
      enabled: true,
      createdAt: 123,
      updatedAt: 456,
      schemaJson: {
        cardType: "custom:template-reading-question",
        insertLabel: "Reading Prompt",
        title: "Reading Prompt",
        markdown: "Prompt:\nResponse:",
        attrs: {
          data: { tone: "short" },
        },
      },
    });
    expect((updated.schemaJson as Record<string, unknown>).description).toBeUndefined();
    expect(createReadAnyCardAttrsFromTemplate(updated)).toEqual({
      cardType: "custom:template-reading-question",
      version: 2,
      title: "Reading Prompt",
      markdown: "Prompt:\nResponse:",
      data: { tone: "short" },
    });
  });

  it("rejects edits to built-in card templates", () => {
    expect(() =>
      updateCustomReadAnyCardTemplate({
        template: {
          id: "callout",
          name: "Callout",
          version: 1,
          schemaJson: {},
          builtIn: true,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
        name: "Edited",
      }),
    ).toThrow("Built-in card templates cannot be edited.");
  });
});
