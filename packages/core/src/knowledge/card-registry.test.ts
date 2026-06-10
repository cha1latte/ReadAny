import { describe, expect, it } from "vitest";
import {
  createDefaultReadAnyCardAttrs,
  getReadAnyCardDefinition,
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
});
