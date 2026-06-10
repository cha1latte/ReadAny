export type KnowledgeEditorTier = "inline_note" | "knowledge_doc" | "publishable_doc";

export type KnowledgeEditorFeature =
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "strike"
  | "inlineCode"
  | "link"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "horizontalRule"
  | "readAnyCards";

export interface KnowledgeEditorProfile {
  tier: KnowledgeEditorTier;
  features: readonly KnowledgeEditorFeature[];
}

const INLINE_NOTE_FEATURES = [
  "undo",
  "redo",
  "bold",
  "italic",
  "strike",
  "inlineCode",
  "link",
  "bulletList",
  "orderedList",
  "blockquote",
] as const satisfies readonly KnowledgeEditorFeature[];

const KNOWLEDGE_DOCUMENT_FEATURES = [
  "undo",
  "redo",
  "heading1",
  "heading2",
  "heading3",
  "bold",
  "italic",
  "strike",
  "inlineCode",
  "link",
  "bulletList",
  "orderedList",
  "blockquote",
  "horizontalRule",
  "readAnyCards",
] as const satisfies readonly KnowledgeEditorFeature[];

const PUBLISHABLE_DOCUMENT_FEATURES = [
  "undo",
  "redo",
  "heading1",
  "heading2",
  "heading3",
  "bold",
  "italic",
  "strike",
  "inlineCode",
  "link",
  "bulletList",
  "orderedList",
  "blockquote",
  "horizontalRule",
] as const satisfies readonly KnowledgeEditorFeature[];

const EDITOR_PROFILES: Record<KnowledgeEditorTier, KnowledgeEditorProfile> = {
  inline_note: {
    tier: "inline_note",
    features: INLINE_NOTE_FEATURES,
  },
  knowledge_doc: {
    tier: "knowledge_doc",
    features: KNOWLEDGE_DOCUMENT_FEATURES,
  },
  publishable_doc: {
    tier: "publishable_doc",
    features: PUBLISHABLE_DOCUMENT_FEATURES,
  },
};

export function getKnowledgeEditorProfile(tier: KnowledgeEditorTier): KnowledgeEditorProfile {
  return EDITOR_PROFILES[tier];
}

export function hasKnowledgeEditorFeature(
  profile: KnowledgeEditorProfile,
  feature: KnowledgeEditorFeature,
): boolean {
  return profile.features.includes(feature);
}
