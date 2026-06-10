import {
  type KnowledgeEditorFeature,
  type KnowledgeEditorTier,
  type ReadAnyCardAttrs,
  builtInReadAnyCards,
  getKnowledgeEditorProfile,
  hasKnowledgeEditorFeature,
  normalizeTiptapDocument,
  renderKnowledgeJsonToMarkdown,
} from "@readany/core/knowledge";
import type { JSONValue } from "@readany/core/types";
import { cn } from "@readany/core/utils";
import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  mergeAttributes,
  useEditor,
} from "@tiptap/react";
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
  Italic,
  Link2,
  List,
  ListOrdered,
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
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function contentJsonEquals(left: JSONValue, right: JSONValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createDefaultCardAttrs(
  cardType: string,
  title: string,
  version: number,
): ReadAnyCardAttrs {
  if (cardType === "mermaid") {
    return {
      cardType,
      version,
      title,
      markdown: "graph TD\n  A[Idea] --> B[Note]",
    };
  }
  if (cardType === "mindmap") {
    return {
      cardType,
      version,
      title,
      markdown: "# Topic\n## Branch",
    };
  }
  return {
    cardType,
    version,
    title,
    markdown: "",
  };
}

export function KnowledgeEditor({
  value,
  onChange,
  placeholder,
  className,
  contentClassName,
  autoFocus = false,
  tier = "knowledge_doc",
}: KnowledgeEditorProps) {
  const { t } = useTranslation();
  const [isInsertOpen, setIsInsertOpen] = useState(false);
  const isInternalUpdate = useRef(false);
  const editorProfile = useMemo(() => getKnowledgeEditorProfile(tier), [tier]);
  const canUse = useCallback(
    (feature: KnowledgeEditorFeature) => hasKnowledgeEditorFeature(editorProfile, feature),
    [editorProfile],
  );

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        dropcursor: false,
        gapcursor: false,
      }),
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

  const insertCard = useCallback(
    (cardType: string) => {
      if (!editor || !canUse("readAnyCards")) return;
      const definition = builtInReadAnyCards.find((card) => card.cardType === cardType);
      if (!definition) return;
      const title = t(`notes.knowledgeCards.${cardType}`, {
        defaultValue: definition.insertLabel,
      });

      editor
        .chain()
        .focus()
        .insertContent({
          type: "readanyCard",
          attrs: createDefaultCardAttrs(cardType, title, definition.version),
        })
        .run();
      setIsInsertOpen(false);
    },
    [canUse, editor, t],
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
    canUse("readAnyCards")
      ? {
          key: "cards",
          node: (
            <div className="relative">
              <ToolbarButton
                onClick={() => setIsInsertOpen((open) => !open)}
                isActive={isInsertOpen}
                title={t("notes.knowledgeInsertCard", { defaultValue: "Insert card" })}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </ToolbarButton>

              {isInsertOpen && (
                <div className="absolute left-0 top-8 z-20 w-56 rounded-lg border border-border/70 bg-popover p-1.5 shadow-lg">
                  {builtInReadAnyCards.map((card) => {
                    const Icon = cardIconMap[card.cardType as keyof typeof cardIconMap] ?? Sparkles;
                    return (
                      <button
                        key={card.cardType}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-popover-foreground transition-colors hover:bg-muted"
                        onClick={() => insertCard(card.cardType)}
                      >
                        <Icon className="h-3.5 w-3.5 text-primary" />
                        <span className="font-medium">
                          {t(`notes.knowledgeCards.${card.cardType}`, {
                            defaultValue: card.insertLabel,
                          })}
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

function ReadAnyCardView({ node }: { node: { attrs: ReadAnyCardAttrs } }) {
  const { t } = useTranslation();
  const attrs = node.attrs;
  const cardType = attrs.cardType || "callout";
  const Icon = cardIconMap[cardType as keyof typeof cardIconMap] ?? Sparkles;
  const title = attrs.title || t(`notes.knowledgeCards.${cardType}`, { defaultValue: cardType });
  const body = attrs.markdown || attrs.text || "";

  return (
    <NodeViewWrapper
      className="not-prose my-3 rounded-lg border border-border/70 bg-card p-3 shadow-sm"
      data-readany-card-type={cardType}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{title}</p>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {cardType}
            </span>
          </div>
          {body ? (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {body}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground/80">
              {t("notes.knowledgeCardEmpty", { defaultValue: "Empty card, ready to edit later." })}
            </p>
          )}
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
