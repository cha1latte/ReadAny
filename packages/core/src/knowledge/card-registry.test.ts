import { describe, expect, it } from "vitest";
import type { JSONValue } from "../types";
import {
  createCustomReadAnyCardTemplate,
  createDefaultReadAnyCardAttrs,
  createReadAnyCardAttrsFromTemplate,
  createReadAnyCardReadOnlyModel,
  formatReadAnyCardDataForEditor,
  getReadAnyCardDefinition,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateInsertLabel,
  normalizeReadAnyCardAttrs,
  parseReadAnyCardDataFromEditor,
  renderReadAnyCardMarkdownFallback,
  updateCustomReadAnyCardTemplate,
  upgradeReadAnyCardAttrs,
  upgradeReadAnyCardAttrsWithTemplates,
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
    const model = createReadAnyCardReadOnlyModel({
      cardType: "customMetric",
      version: 3,
      title: "Reading score",
      text: "Focus: 92%",
      sourceTitle: "Chapter 4",
      cfi: "epubcfi(/6/4)",
    });

    expect(model).toMatchObject({
      cardType: "customMetric",
      version: 3,
      title: "Reading score",
      body: "Focus: 92%",
      state: "unsupported",
      stateLabel: "fallback",
      isFallback: true,
      isFutureVersion: false,
      isCustomCard: false,
      isKnownBuiltIn: false,
      sourceTitle: "Chapter 4",
      cfi: "epubcfi(/6/4)",
    });
    expect(model.metadata).toEqual([
      { key: "cardType", label: "Card", value: "customMetric" },
      { key: "version", label: "Version", value: "v3" },
      { key: "source", label: "Source", value: "Chapter 4" },
      { key: "cfi", label: "CFI", value: "epubcfi(/6/4)" },
    ]);

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
      createReadAnyCardReadOnlyModel({
        cardType: "aiSummary",
        version: 99,
        title: "Future summary",
        markdown: "Readable fallback body.",
      }),
    ).toMatchObject({
      cardType: "aiSummary",
      version: 99,
      title: "Future summary",
      body: "Readable fallback body.",
      state: "future",
      stateLabel: "v99 newer",
      isFallback: true,
      isFutureVersion: true,
      isCustomCard: false,
      isKnownBuiltIn: true,
    });

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

    expect(
      createReadAnyCardReadOnlyModel(
        {
          cardType: "custom:template-reading-question",
          version: 1,
        },
        {
          body: "",
          cardTemplates: [template],
        },
      ),
    ).toMatchObject({
      cardType: "custom:template-reading-question",
      version: 1,
      title: "Reading Question",
      body: "Question:\nAnswer:",
      state: "custom",
      stateLabel: "v1",
      insertLabel: "Reading Question",
      isFallback: false,
      isCustomCard: true,
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

  it("migrates custom card attrs to newer synced templates without overwriting user content", () => {
    const template = updateCustomReadAnyCardTemplate({
      template: {
        ...createCustomReadAnyCardTemplate({
          id: "template-reading-question",
          name: "Reading Question",
          markdown: "Question:\nAnswer:",
          now: 123,
        }),
        schemaJson: {
          cardType: "custom:template-reading-question",
          title: "Reading Question",
          markdown: "Question:\nAnswer:",
          attrs: {
            data: {
              kind: "prompt",
              layout: {
                tone: "short",
                density: "compact",
              },
            },
          },
        },
      },
      name: "Reading Prompt",
      markdown: "Prompt:\nResponse:",
      now: 456,
    });

    const migrated = upgradeReadAnyCardAttrsWithTemplates(
      {
        cardType: "custom:template-reading-question",
        version: 1,
        title: "My own prompt",
        markdown: "Question: What changed?\nAnswer: The ending.",
        data: {
          layout: {
            density: "detailed",
          },
        },
      },
      [template],
    );

    expect(migrated).toEqual({
      cardType: "custom:template-reading-question",
      version: 2,
      title: "My own prompt",
      markdown: "Question: What changed?\nAnswer: The ending.",
      text: "Question: What changed?\nAnswer: The ending.",
      data: {
        kind: "prompt",
        layout: {
          tone: "short",
          density: "detailed",
        },
      },
    });

    expect(
      upgradeReadAnyCardAttrsWithTemplates(
        {
          cardType: "custom:template-reading-question",
          version: 1,
          data: "legacy-data",
        },
        [template],
      ).data,
    ).toBe("legacy-data");
  });

  it("applies synced custom card schema migrations across versions", () => {
    const migrations: JSONValue[] = [
      {
        fromVersion: 1,
        toVersion: 2,
        dataRenames: {
          "meta.oldSource": "source.title",
          summary: "body.summary",
        },
        dataDefaults: {
          source: {
            kind: "book",
          },
          layout: {
            tone: "calm",
          },
        },
        removeData: ["meta.legacyFlag"],
      },
      {
        fromVersion: 2,
        toVersion: 3,
        dataRenames: {
          "body.summary": "body.abstract",
        },
        dataDefaults: {
          body: {
            format: "markdown",
          },
        },
      },
    ];
    const template = {
      id: "template-concept",
      name: "Concept",
      version: 3,
      schemaJson: {
        cardType: "custom:template-concept",
        title: "Concept",
        markdown: "Definition:\nEvidence:",
        attrs: {
          data: {
            schema: "concept-v3",
            layout: {
              density: "compact",
            },
          },
        },
        migrations,
      },
      builtIn: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };

    const migrated = upgradeReadAnyCardAttrsWithTemplates(
      {
        cardType: "custom:template-concept",
        version: 1,
        title: "My concept",
        markdown: "User-authored body",
        data: {
          summary: "A reusable idea.",
          meta: {
            oldSource: "Chapter 4",
            legacyFlag: true,
          },
          layout: {
            density: "detailed",
          },
        },
      },
      [template],
    );

    expect(migrated).toEqual({
      cardType: "custom:template-concept",
      version: 3,
      title: "My concept",
      markdown: "User-authored body",
      text: "User-authored body",
      data: {
        schema: "concept-v3",
        source: {
          kind: "book",
          title: "Chapter 4",
        },
        body: {
          format: "markdown",
          abstract: "A reusable idea.",
        },
        layout: {
          tone: "calm",
          density: "detailed",
        },
        meta: {},
      },
    });
  });

  it("does not force custom migrations onto explicit non-object card data", () => {
    const template = {
      id: "template-legacy",
      name: "Legacy",
      version: 2,
      schemaJson: {
        cardType: "custom:template-legacy",
        title: "Legacy",
        markdown: "Fallback",
        attrs: {
          data: {
            kind: "default",
          },
        },
        migrations: [
          {
            toVersion: 2,
            dataDefaults: {
              kind: "migrated",
            },
          },
        ],
      },
      builtIn: false,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(
      upgradeReadAnyCardAttrsWithTemplates(
        {
          cardType: "custom:template-legacy",
          version: 1,
          data: "legacy-serialized-data",
        },
        [template],
      ),
    ).toMatchObject({
      version: 2,
      data: "legacy-serialized-data",
    });

    expect(
      upgradeReadAnyCardAttrsWithTemplates(
        {
          cardType: "custom:template-legacy",
          version: 1,
        },
        [template],
      ).data,
    ).toEqual({ kind: "migrated" });
  });

  it("formats and parses custom card data safely for editor controls", () => {
    expect(formatReadAnyCardDataForEditor(undefined)).toBe("");
    expect(formatReadAnyCardDataForEditor(null)).toBe("");
    expect(
      formatReadAnyCardDataForEditor({
        source: "ai",
        layout: { density: "compact" },
        steps: ["read", "review"],
      }),
    ).toBe(
      [
        "{",
        '  "source": "ai",',
        '  "layout": {',
        '    "density": "compact"',
        "  },",
        '  "steps": [',
        '    "read",',
        '    "review"',
        "  ]",
        "}",
      ].join("\n"),
    );

    expect(parseReadAnyCardDataFromEditor("")).toEqual({ ok: true, data: null });
    expect(parseReadAnyCardDataFromEditor('{"source":"ai","count":2}')).toEqual({
      ok: true,
      data: { source: "ai", count: 2 },
    });
    expect(parseReadAnyCardDataFromEditor("[NaN]").ok).toBe(false);
    expect(parseReadAnyCardDataFromEditor("{broken").ok).toBe(false);
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
