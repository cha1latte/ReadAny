export type KnowledgeEditorTier = "inline_note" | "knowledge_doc" | "publishable_doc";

export type KnowledgeEditorSurface =
  | "reader_quick_note"
  | "highlight_note"
  | "book_home"
  | "standalone_note"
  | "review";

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
  | "taskList"
  | "codeBlock"
  | "image"
  | "table"
  | "internalLink"
  | "sourceReference"
  | "attachments"
  | "readAnyCards"
  | "calloutCard"
  | "quoteCard"
  | "metadataCard"
  | "highlightCollectionCard"
  | "reviewCard"
  | "aiCard"
  | "diagramCard"
  | "relatedNotesCard";

export interface KnowledgeEditorProfile {
  tier: KnowledgeEditorTier;
  surface?: KnowledgeEditorSurface;
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
  "taskList",
  "codeBlock",
  "image",
  "internalLink",
  "sourceReference",
  "attachments",
  "readAnyCards",
  "calloutCard",
  "quoteCard",
  "metadataCard",
  "highlightCollectionCard",
  "reviewCard",
  "aiCard",
  "diagramCard",
  "relatedNotesCard",
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
  "codeBlock",
  "image",
  "internalLink",
  "sourceReference",
  "calloutCard",
  "quoteCard",
] as const satisfies readonly KnowledgeEditorFeature[];

const HIGHLIGHT_NOTE_FEATURES = [
  ...INLINE_NOTE_FEATURES,
  "heading2",
  "heading3",
  "taskList",
  "internalLink",
  "sourceReference",
  "calloutCard",
  "quoteCard",
] as const satisfies readonly KnowledgeEditorFeature[];

const STANDALONE_NOTE_FEATURES = KNOWLEDGE_DOCUMENT_FEATURES.filter(
  (feature) => feature !== "metadataCard" && feature !== "highlightCollectionCard",
) as readonly KnowledgeEditorFeature[];

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

const SURFACE_PROFILES: Record<KnowledgeEditorSurface, KnowledgeEditorProfile> = {
  reader_quick_note: {
    tier: "inline_note",
    surface: "reader_quick_note",
    features: INLINE_NOTE_FEATURES,
  },
  highlight_note: {
    tier: "knowledge_doc",
    surface: "highlight_note",
    features: HIGHLIGHT_NOTE_FEATURES,
  },
  book_home: {
    tier: "knowledge_doc",
    surface: "book_home",
    features: KNOWLEDGE_DOCUMENT_FEATURES,
  },
  standalone_note: {
    tier: "knowledge_doc",
    surface: "standalone_note",
    features: STANDALONE_NOTE_FEATURES,
  },
  review: {
    tier: "publishable_doc",
    surface: "review",
    features: PUBLISHABLE_DOCUMENT_FEATURES,
  },
};

export function getKnowledgeEditorProfile(tier: KnowledgeEditorTier): KnowledgeEditorProfile {
  return EDITOR_PROFILES[tier];
}

export function getKnowledgeEditorSurfaceProfile(
  surface: KnowledgeEditorSurface,
): KnowledgeEditorProfile {
  return SURFACE_PROFILES[surface];
}

export function hasKnowledgeEditorFeature(
  profile: KnowledgeEditorProfile,
  feature: KnowledgeEditorFeature,
): boolean {
  return profile.features.includes(feature);
}
