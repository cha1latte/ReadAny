import { describe, expect, it } from "vitest";
import {
  createDefaultReadAnyCardAttrs,
  createReadAnyCardAttrsFromTemplate,
  getReadAnyCardDefinition,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateInsertLabel,
  renderReadAnyCardMarkdownFallback,
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
  });

  it("keeps unknown cards readable through a generic callout fallback", () => {
    expect(
      renderReadAnyCardMarkdownFallback(
        { cardType: "customMetric", title: "Reading score", text: "Focus: 92%" },
        { body: "" },
      ),
    ).toBe("> [!note] Reading score\n> Focus: 92%");
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
