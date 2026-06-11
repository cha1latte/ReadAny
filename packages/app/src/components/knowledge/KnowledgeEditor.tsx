import { getKnowledgeCardTemplates } from "@/lib/db/database";
import {
  type KnowledgeEditorFeature,
  type KnowledgeEditorSurface,
  type KnowledgeEditorTier,
  type ReadAnyCardAttrs,
  builtInReadAnyCards,
  createDefaultReadAnyCardAttrs,
  createReadAnyCardAttrsFromTemplate,
  getKnowledgeEditorFeatureForCardType,
  getKnowledgeEditorProfile,
  getKnowledgeEditorSurfaceProfile,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateInsertLabel,
  hasKnowledgeEditorFeature,
  normalizeTiptapDocument,
  renderKnowledgeJsonToMarkdown,
} from "@readany/core/knowledge";
import type { JSONValue, KnowledgeCardTemplate } from "@readany/core/types";
import { cn } from "@readany/core/utils";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import {
  EditorContent,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  useEditor,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  BookOpen,
  Brain,
  Code,
  FileQuestion,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Map as MapIcon,
  MessageSquareQuote,
  Minus,
  Network,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  TextQuote,
  Undo2,
} from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export interface KnowledgeEditorValue {
  contentJson: JSONValue;
  contentMd: string;
  plainText: string;
}

interface KnowledgeEditorProps {
  value: KnowledgeEditorValue;
  onChange: (value: KnowledgeEditorValue) => void;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  autoFocus?: boolean;
  tier?: KnowledgeEditorTier;
  surface?: KnowledgeEditorSurface;
}

const cardIconMap = {
  bookQuote: MessageSquareQuote,
  callout: TextQuote,
  bookMetadata: BookOpen,
  aiSummary: Sparkles,
  qa: FileQuestion,
  review: Quote,
  mindmap: MapIcon,
  mermaid: Network,
  relatedNotes: Brain,
};

interface InsertableCardItem {
  key: string;
  cardType: string;
  insertLabel: string;
  description?: string;
  createAttrs: () => ReadAnyCardAttrs;
}

const ReadAnyCardExtension = Node.create({
  name: "readanyCard",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      cardType: { default: "callout" },
      id: { default: null },
      version: { default: 1 },
      title: { default: null },
      text: { default: null },
      sourceTitle: { default: null },
      sourceId: { default: null },
      cfi: { default: null },
      markdown: { default: null },
      data: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "readany-card" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = {
      "data-card-type": HTMLAttributes.cardType || "callout",
      "data-card-version": String(HTMLAttributes.version || 1),
    };
    return ["readany-card", mergeAttributes(attrs), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReadAnyCardView);
  },
});

const KnowledgeImageExtension = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        class:
          "mx-auto my-4 max-h-[520px] max-w-full rounded-md border border-border/60 object-contain",
      }),
    ];
  },
});

function contentJsonEquals(left: JSONValue, right: JSONValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function KnowledgeEditor({
  value,
  onChange,
  placeholder,
  className,
  contentClassName,
  autoFocus = false,
  tier = "knowledge_doc",
  surface,
}: KnowledgeEditorProps) {
  const { t } = useTranslation();
  const [isInsertOpen, setIsInsertOpen] = useState(false);
  const [isImageInsertOpen, setIsImageInsertOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const imageSrcInputId = useId();
  const imageAltInputId = useId();
  const [cardTemplates, setCardTemplates] = useState<KnowledgeCardTemplate[]>([]);
  const isInternalUpdate = useRef(false);
  const editorProfile = useMemo(
    () => (surface ? getKnowledgeEditorSurfaceProfile(surface) : getKnowledgeEditorProfile(tier)),
    [surface, tier],
  );
  const canUse = useCallback(
    (feature: KnowledgeEditorFeature) => hasKnowledgeEditorFeature(editorProfile, feature),
    [editorProfile],
  );
  const canInsertCard = useCallback(
    (cardType: string) => {
      const feature = getKnowledgeEditorFeatureForCardType(cardType);
      return canUse("readAnyCards") || (feature ? canUse(feature) : false);
    },
    [canUse],
  );
  const allowedCards = useMemo(
    () => [
      ...builtInReadAnyCards
        .filter((card) => canInsertCard(card.cardType))
        .map<InsertableCardItem>((card) => ({
          key: `built-in:${card.cardType}`,
          cardType: card.cardType,
          insertLabel: t(`notes.knowledgeCards.${card.cardType}`, {
            defaultValue: card.insertLabel,
          }),
          description: t(`notes.knowledgeCardDescriptions.${card.cardType}`, {
            defaultValue: "",
          }),
          createAttrs: () =>
            createDefaultReadAnyCardAttrs(card.cardType, {
              title: t(`notes.knowledgeCards.${card.cardType}`, {
                defaultValue: card.insertLabel,
              }),
              version: card.version,
            }),
        })),
      ...cardTemplates
        .map((template) => {
          const attrs = createReadAnyCardAttrsFromTemplate(template);
          const cardType = attrs.cardType ?? `custom:${template.id}`;
          return { template, cardType };
        })
        .filter(({ cardType }) => canInsertCard(cardType))
        .map<InsertableCardItem>(({ template, cardType }) => ({
          key: `template:${template.id}`,
          cardType,
          insertLabel: getReadAnyCardTemplateInsertLabel(template),
          description: getReadAnyCardTemplateDescription(template),
          createAttrs: () => createReadAnyCardAttrsFromTemplate(template),
        })),
    ],
    [canInsertCard, cardTemplates, t],
  );

  useEffect(() => {
    let mounted = true;
    void getKnowledgeCardTemplates()
      .then((templates) => {
        if (mounted) setCardTemplates(templates.filter((template) => !template.builtIn));
      })
      .catch((error) => {
        console.warn("[KnowledgeEditor] Failed to load card templates:", error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        dropcursor: false,
        gapcursor: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      KnowledgeImageExtension,
      ReadAnyCardExtension,
      Placeholder.configure({
        placeholder: placeholder || "",
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    [placeholder],
  );

  const editor = useEditor({
    extensions,
    content: normalizeTiptapDocument(value.contentJson),
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none min-h-[80px] outline-none",
          "readany-knowledge-editor",
          "prose-headings:font-semibold prose-headings:tracking-tight",
          "prose-h1:text-xl prose-h1:mb-3 prose-h1:mt-4",
          "prose-h2:text-base prose-h2:mb-2 prose-h2:mt-4",
          "prose-h3:text-sm prose-h3:mb-1.5 prose-h3:mt-3",
          "prose-p:my-2 prose-p:leading-relaxed prose-p:text-[13px]",
          "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-[13px]",
          "prose-blockquote:border-l-primary/50 prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:rounded-r prose-blockquote:not-italic prose-blockquote:text-muted-foreground",
          "prose-code:px-1.5 prose-code:py-0.5 prose-code:bg-muted prose-code:rounded prose-code:text-[12px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:text-[12px]",
          "prose-hr:border-border prose-hr:my-4",
          "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
          "prose-strong:font-semibold prose-strong:text-foreground",
          "prose-em:text-foreground/90",
        ),
      },
    },
    onUpdate: ({ editor }) => {
      const contentJson = editor.getJSON() as unknown as JSONValue;
      isInternalUpdate.current = true;
      onChange({
        contentJson,
        contentMd: renderKnowledgeJsonToMarkdown(contentJson),
        plainText: editor.getText(),
      });
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor || isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }

    const currentJson = editor.getJSON() as unknown as JSONValue;
    if (!contentJsonEquals(currentJson, value.contentJson)) {
      editor.commands.setContent(normalizeTiptapDocument(value.contentJson));
    }
  }, [editor, value.contentJson]);

  useEffect(() => {
    if (editor && autoFocus) {
      editor.commands.focus();
    }
  }, [editor, autoFocus]);

  const setLink = useCallback(() => {
    if (!editor || !canUse("link")) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt(t("editor.enterLink"), previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [canUse, editor, t]);

  const insertImage = useCallback(() => {
    if (!editor || !canUse("image")) return;
    const src = imageSrc.trim();
    if (!src) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "image",
        attrs: {
          src,
          alt: imageAlt.trim(),
        },
      })
      .run();
    setImageSrc("");
    setImageAlt("");
    setIsImageInsertOpen(false);
  }, [canUse, editor, imageAlt, imageSrc]);

  const insertCard = useCallback(
    (card: InsertableCardItem) => {
      if (!editor || !canInsertCard(card.cardType)) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "readanyCard",
          attrs: card.createAttrs(),
        })
        .run();
      setIsInsertOpen(false);
    },
    [canInsertCard, editor],
  );

  if (!editor) return null;

  const toolbarGroupCandidates: ({ key: string; node: ReactNode } | null)[] = [
    canUse("undo") || canUse("redo")
      ? {
          key: "history",
          node: (
            <ToolbarGroup>
              {canUse("undo") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().undo().run()}
                  disabled={!editor.can().undo()}
                  title={t("editor.undo")}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("redo") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().redo().run()}
                  disabled={!editor.can().redo()}
                  title={t("editor.redo")}
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
            </ToolbarGroup>
          ),
        }
      : null,
    canUse("heading1") || canUse("heading2") || canUse("heading3")
      ? {
          key: "headings",
          node: (
            <ToolbarGroup>
              {canUse("heading1") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                  isActive={editor.isActive("heading", { level: 1 })}
                  title={t("editor.heading1")}
                >
                  <Heading1 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("heading2") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  isActive={editor.isActive("heading", { level: 2 })}
                  title={t("editor.heading2")}
                >
                  <Heading2 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("heading3") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                  isActive={editor.isActive("heading", { level: 3 })}
                  title={t("editor.heading3")}
                >
                  <Heading3 className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
            </ToolbarGroup>
          ),
        }
      : null,
    {
      key: "inline",
      node: (
        <ToolbarGroup>
          {canUse("bold") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              isActive={editor.isActive("bold")}
              title={t("editor.bold")}
            >
              <Bold className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("italic") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              isActive={editor.isActive("italic")}
              title={t("editor.italic")}
            >
              <Italic className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("strike") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleStrike().run()}
              isActive={editor.isActive("strike")}
              title={t("editor.strikethrough")}
            >
              <Strikethrough className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("inlineCode") ? (
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleCode().run()}
              isActive={editor.isActive("code")}
              title={t("editor.inlineCode")}
            >
              <Code className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
          {canUse("link") ? (
            <ToolbarButton
              onClick={setLink}
              isActive={editor.isActive("link")}
              title={t("editor.link")}
            >
              <Link2 className="h-3.5 w-3.5" />
            </ToolbarButton>
          ) : null}
        </ToolbarGroup>
      ),
    },
    canUse("bulletList") ||
    canUse("orderedList") ||
    canUse("taskList") ||
    canUse("blockquote") ||
    canUse("horizontalRule")
      ? {
          key: "blocks",
          node: (
            <ToolbarGroup>
              {canUse("bulletList") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  isActive={editor.isActive("bulletList")}
                  title={t("editor.bulletList")}
                >
                  <List className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("orderedList") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  isActive={editor.isActive("orderedList")}
                  title={t("editor.orderedList")}
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("taskList") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleTaskList().run()}
                  isActive={editor.isActive("taskList")}
                  title={t("editor.taskList")}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("blockquote") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                  isActive={editor.isActive("blockquote")}
                  title={t("editor.blockquote")}
                >
                  <Quote className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
              {canUse("horizontalRule") ? (
                <ToolbarButton
                  onClick={() => editor.chain().focus().setHorizontalRule().run()}
                  title={t("editor.horizontalRule")}
                >
                  <Minus className="h-3.5 w-3.5" />
                </ToolbarButton>
              ) : null}
            </ToolbarGroup>
          ),
        }
      : null,
    canUse("image")
      ? {
          key: "media",
          node: (
            <div className="relative">
              <ToolbarGroup>
                <ToolbarButton
                  onClick={() => {
                    setIsImageInsertOpen((open) => !open);
                    setIsInsertOpen(false);
                  }}
                  title={t("notes.knowledgeInsertImage")}
                  disabled={!canUse("image")}
                  isActive={isImageInsertOpen}
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                </ToolbarButton>
              </ToolbarGroup>

              {isImageInsertOpen && (
                <form
                  className="absolute left-0 top-8 z-20 w-72 rounded-lg border border-border/70 bg-popover p-2.5 shadow-lg"
                  onSubmit={(event) => {
                    event.preventDefault();
                    insertImage();
                  }}
                >
                  <div className="mb-2 text-xs font-medium text-popover-foreground">
                    {t("notes.knowledgeInsertImage")}
                  </div>
                  <label
                    htmlFor={imageSrcInputId}
                    className="mb-1 block text-[11px] font-medium text-muted-foreground"
                  >
                    {t("notes.knowledgeImageUrlPlaceholder")}
                  </label>
                  <input
                    id={imageSrcInputId}
                    value={imageSrc}
                    onChange={(event) => setImageSrc(event.target.value)}
                    placeholder="https://..."
                    className="mb-2 h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
                  />
                  <label
                    htmlFor={imageAltInputId}
                    className="mb-1 block text-[11px] font-medium text-muted-foreground"
                  >
                    {t("notes.knowledgeImageAltPlaceholder")}
                  </label>
                  <input
                    id={imageAltInputId}
                    value={imageAlt}
                    onChange={(event) => setImageAlt(event.target.value)}
                    placeholder={t("notes.knowledgeImageAltPrompt")}
                    className="h-8 w-full rounded-md border border-border/70 bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/10"
                  />
                  <div className="mt-2.5 flex justify-end gap-1.5">
                    <button
                      type="button"
                      className="h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={() => {
                        setIsImageInsertOpen(false);
                        setImageSrc("");
                        setImageAlt("");
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      className="h-7 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-45"
                      disabled={!imageSrc.trim()}
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ),
        }
      : null,
    allowedCards.length > 0
      ? {
          key: "cards",
          node: (
            <div className="relative">
              <ToolbarButton
                onClick={() => {
                  setIsInsertOpen((open) => !open);
                  setIsImageInsertOpen(false);
                }}
                isActive={isInsertOpen}
                title={t("notes.knowledgeInsertCard", { defaultValue: "Insert card" })}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </ToolbarButton>

              {isInsertOpen && (
                <div className="absolute left-0 top-8 z-20 w-56 rounded-lg border border-border/70 bg-popover p-1.5 shadow-lg">
                  {allowedCards.map((card) => {
                    const Icon = cardIconMap[card.cardType as keyof typeof cardIconMap] ?? Sparkles;
                    return (
                      <button
                        key={card.key}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-popover-foreground transition-colors hover:bg-muted"
                        onClick={() => insertCard(card)}
                      >
                        <Icon className="h-3.5 w-3.5 text-primary" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{card.insertLabel}</span>
                          {card.description ? (
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {card.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ),
        }
      : null,
  ];
  const toolbarGroups = toolbarGroupCandidates.filter(
    (group): group is { key: string; node: ReactNode } => group !== null,
  );

  return (
    <div
      className={cn(
        "group overflow-hidden rounded-lg border border-border/60 bg-background",
        "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 focus-within:ring-offset-1",
        "transition-all duration-200",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 bg-muted/20 px-2 py-1.5">
        {toolbarGroups.map((group, index) => (
          <Fragment key={group.key}>
            {index > 0 ? <ToolbarDivider /> : null}
            {group.node}
          </Fragment>
        ))}
      </div>

      <EditorContent
        editor={editor}
        className={cn(
          "overflow-y-auto px-4 py-3",
          "[&_.ProseMirror]:outline-none",
          "[&_.is-editor-empty:first-child::before]:text-muted-foreground/60",
          "[&_.is-editor-empty:first-child::before]:pointer-events-none",
          "[&_.is-editor-empty:first-child::before]:float-left",
          "[&_.is-editor-empty:first-child::before]:h-0",
          "[&_.is-editor-empty:first-child::before]:text-[13px]",
          contentClassName,
        )}
      />
    </div>
  );
}

function ReadAnyCardView({ node, selected, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const attrs = node.attrs as ReadAnyCardAttrs;
  const cardType = attrs.cardType || "callout";
  const Icon = cardIconMap[cardType as keyof typeof cardIconMap] ?? Sparkles;
  const fallbackTitle = t(`notes.knowledgeCards.${cardType}`, { defaultValue: cardType });
  const title = attrs.title || "";
  const body = attrs.markdown || attrs.text || "";
  const updateTitle = (nextTitle: string) => {
    updateAttributes({ title: nextTitle });
  };
  const updateBody = (nextBody: string) => {
    updateAttributes({ markdown: nextBody, text: nextBody });
  };

  return (
    <NodeViewWrapper
      className={cn(
        "not-prose my-4 rounded-lg border bg-card shadow-sm transition-all duration-200",
        selected
          ? "border-primary/45 ring-2 ring-primary/10"
          : "border-border/65 hover:border-border",
      )}
      data-readany-card-type={cardType}
      contentEditable={false}
    >
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              value={title}
              onChange={(event) => updateTitle(event.target.value)}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              aria-label={t("notes.knowledgeCardTitleLabel", {
                defaultValue: "Card title",
              })}
              placeholder={fallbackTitle}
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/70 focus:text-primary"
            />
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {cardType}
            </span>
          </div>
          <textarea
            value={body}
            onChange={(event) => updateBody(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={t("notes.knowledgeCardBodyLabel", {
              defaultValue: "Card body",
            })}
            placeholder={t("notes.knowledgeCardBodyPlaceholder", {
              defaultValue: "Write directly inside this card...",
            })}
            rows={Math.max(3, Math.min(10, body.split("\n").length + 1))}
            className="mt-2 w-full resize-y rounded-md border border-transparent bg-muted/25 px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/25 focus:bg-background"
          />
          {attrs.sourceTitle && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("notes.knowledgeCardSource", { defaultValue: "Source" })}: {attrs.sourceTitle}
            </p>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

/* --- Toolbar Components --- */

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded p-1 transition-all duration-150",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
        "disabled:cursor-not-allowed disabled:opacity-30",
        isActive
          ? "bg-primary/12 text-primary shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95",
      )}
    >
      {children}
    </button>
  );
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <div className="mx-1 h-4 w-px bg-border/60" />;
}
