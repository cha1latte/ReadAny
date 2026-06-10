import { describe, expect, it } from "vitest";
import {
  getKnowledgeEditorProfile,
  getKnowledgeEditorSurfaceProfile,
  hasKnowledgeEditorFeature,
} from "./editor-profile";

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
    expect(hasKnowledgeEditorFeature(profile, "taskList")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "image")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "sourceReference")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "readAnyCards")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "aiCard")).toBe(true);
  });

  it("keeps publishable documents export-friendly", () => {
    const profile = getKnowledgeEditorProfile("publishable_doc");

    expect(hasKnowledgeEditorFeature(profile, "heading1")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "horizontalRule")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "image")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "quoteCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "readAnyCards")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "aiCard")).toBe(false);
  });

  it("maps quick reader notes to the lightweight surface profile", () => {
    const profile = getKnowledgeEditorSurfaceProfile("reader_quick_note");

    expect(profile.tier).toBe("inline_note");
    expect(hasKnowledgeEditorFeature(profile, "bold")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "orderedList")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "heading2")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "image")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "aiCard")).toBe(false);
  });

  it("keeps highlight notes source-aware without making them full book pages", () => {
    const profile = getKnowledgeEditorSurfaceProfile("highlight_note");

    expect(profile.tier).toBe("knowledge_doc");
    expect(hasKnowledgeEditorFeature(profile, "heading1")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "heading2")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "sourceReference")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "quoteCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "image")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "metadataCard")).toBe(false);
  });

  it("keeps book home documents as the richest editing surface", () => {
    const profile = getKnowledgeEditorSurfaceProfile("book_home");

    expect(profile.tier).toBe("knowledge_doc");
    expect(hasKnowledgeEditorFeature(profile, "metadataCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "highlightCollectionCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "diagramCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "relatedNotesCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "table")).toBe(false);
  });

  it("keeps standalone notes rich but not book-metadata specific", () => {
    const profile = getKnowledgeEditorSurfaceProfile("standalone_note");

    expect(profile.tier).toBe("knowledge_doc");
    expect(hasKnowledgeEditorFeature(profile, "internalLink")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "attachments")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "metadataCard")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "highlightCollectionCard")).toBe(false);
  });

  it("keeps review writing polished but free of interactive AI blocks", () => {
    const profile = getKnowledgeEditorSurfaceProfile("review");

    expect(profile.tier).toBe("publishable_doc");
    expect(hasKnowledgeEditorFeature(profile, "heading1")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "sourceReference")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "calloutCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "quoteCard")).toBe(true);
    expect(hasKnowledgeEditorFeature(profile, "readAnyCards")).toBe(false);
    expect(hasKnowledgeEditorFeature(profile, "diagramCard")).toBe(false);
  });
});
