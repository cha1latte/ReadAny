import { describe, expect, it } from "vitest";
import { getKnowledgeEditorProfile, hasKnowledgeEditorFeature } from "./editor-profile";

describe("knowledge editor profile", () => {
  it("keeps quick annotation editing lightweight", () => {
    const profile = getKnowledgeEditorProfile("inline_note");

    expect(hasKnowledgeEditorFeature(profile, "bold")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "link")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "blockquote")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "heading1")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "horizontalRule")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "readAnyCards")).toBe(false);
  });

  it("allows rich ReadAny blocks in knowledge documents", () => {
    const profile = getKnowledgeEditorProfile("knowledge_doc");

    expect(hasKnowledgeEditorFeature(profile, "heading1")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "horizontalRule")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "readAnyCards")).toBe(true);
  });

  it("keeps publishable documents export-friendly", () => {
    const profile = getKnowledgeEditorProfile("publishable_doc");

    expect(hasKnowledgeEditorFeature(profile, "heading1")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "horizontalRule")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "readAnyCards")).toBe(false);
  });
});
