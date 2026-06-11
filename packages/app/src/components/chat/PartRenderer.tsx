/**
 * Message Part Components
 * Renders individual parts of a message (text, reasoning, tool calls, citations)
 */
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  type KnowledgeWriteProposal,
  applyKnowledgeWriteProposal,
  getKnowledgeWriteProposal,
} from "@readany/core/knowledge/proposals";
import type {
  AbortedPart,
  CitationPart,
  MindmapPart,
  Part,
  ReasoningPart,
  TextPart,
  ToolCallPart,
} from "@readany/core/types/message";
import { cn } from "@readany/core/utils";
import {
  Brain,
  CheckCircle,
  ChevronDown,
  Circle,
  Loader2,
  OctagonX,
  Wrench,
  XCircle,
} from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MarkdownRenderer } from "./MarkdownRenderer";

const TEXT_RENDER_THROTTLE_MS = 100;

// Lazy load MindmapView to avoid bundling markmap for non-mindmap messages
const LazyMindmapView = lazy(() =>
  import("@/components/common/MindmapView").then((m) => ({ default: m.MindmapView })),
);

function useThrottledText(text: string): string {
  const [throttledText, setThrottledText] = useState(text);
  const lastUpdateRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;
    const remaining = TEXT_RENDER_THROTTLE_MS - timeSinceLastUpdate;

    if (remaining <= 0) {
      lastUpdateRef.current = now;
      setThrottledText(text);
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      lastUpdateRef.current = Date.now();
      setThrottledText(text);
    }, remaining);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [text]);

  return throttledText;
}

interface PartProps {
  part: Part;
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
}

export function PartRenderer({ part, citations, onCitationClick }: PartProps) {
  switch (part.type) {
    case "text":
      return <TextPartView part={part} citations={citations} onCitationClick={onCitationClick} />;
    case "reasoning":
      return <ReasoningPartView part={part} />;
    case "tool_call":
      return <ToolCallPartView part={part} />;
    case "citation":
      return null;
    case "mindmap":
      return <MindmapPartView part={part} />;
    case "aborted":
      return <AbortedPartView part={part} />;
    default:
      return null;
  }
}

function TextPartView({
  part,
  citations,
  onCitationClick,
}: {
  part: TextPart;
  citations?: CitationPart[];
  onCitationClick?: (citation: CitationPart) => void;
}) {
  const throttledText = useThrottledText(part.text);
  const isStreaming = part.status === "running";

  if (!throttledText.trim()) {
    // Even if no text yet, show cursor when streaming
    if (isStreaming) {
      return (
        <div className="chat-markdown max-w-none text-sm leading-relaxed">
          <span className="inline-block h-4 w-[3px] animate-pulse rounded-sm bg-primary" />
        </div>
      );
    }
    return null;
  }

  return (
    <div className="chat-markdown max-w-none text-sm leading-relaxed">
      <MarkdownRenderer
        content={throttledText}
        isStreaming={isStreaming}
        citations={citations}
        onCitationClick={onCitationClick}
      />
    </div>
  );
}

function ReasoningPartView({ part }: { part: ReasoningPart }) {
  const { t } = useTranslation();
  // Start expanded when streaming; keep expanded after completion
  const [isOpen, setIsOpen] = useState(part.status === "running" || part.status === "completed");
  const throttledText = useThrottledText(part.text);

  // Expand when streaming starts
  useEffect(() => {
    if (part.status === "running") {
      setIsOpen(true);
    }
  }, [part.status]);

  if (!throttledText.trim()) return null;

  return (
    <div className="my-1">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="overflow-hidden rounded-lg border border-primary/20 bg-primary/5">
          <CollapsibleTrigger asChild>
            <div className="flex h-auto w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-primary/10">
              <div className="flex flex-1 items-center gap-2 overflow-hidden">
                {part.status === "running" ? (
                  <div className="flex h-4 w-4 items-center justify-center">
                    <div className="h-3 w-3 animate-pulse rounded-full bg-primary/60" />
                  </div>
                ) : (
                  <Brain className="h-4 w-4 text-primary" />
                )}
                <span className="text-sm font-medium text-foreground">
                  {part.status === "running"
                    ? t("streaming.reasoningRunning")
                    : t("streaming.reasoningDone")}
                </span>
                {part.thinkingType && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {part.thinkingType}
                  </span>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-48 overflow-y-auto border-t border-border/50 bg-muted/30 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {throttledText}
              </p>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

const TOOL_LABEL_KEYS: Record<string, string> = {
  ragSearch: "toolLabels.ragSearch",
  ragToc: "toolLabels.ragToc",
  ragContext: "toolLabels.ragContext",
  summarize: "toolLabels.summarize",
  extractEntities: "toolLabels.extractEntities",
  analyzeArguments: "toolLabels.analyzeArguments",
  findQuotes: "toolLabels.findQuotes",
  getAnnotations: "toolLabels.getAnnotations",
  addCitation: "toolLabels.addCitation",
  compareSections: "toolLabels.compareSections",
  getCurrentChapter: "toolLabels.getCurrentChapter",
  getSelection: "toolLabels.getSelection",
  getReadingProgress: "toolLabels.getReadingProgress",
  getRecentHighlights: "toolLabels.getRecentHighlights",
  getSurroundingContext: "toolLabels.getSurroundingContext",
  listBooks: "toolLabels.listBooks",
  searchAllHighlights: "toolLabels.searchAllHighlights",
  searchAllNotes: "toolLabels.searchAllNotes",
  getReadingStats: "toolLabels.getReadingStats",
  getSkills: "toolLabels.getSkills",
  mindmap: "toolLabels.mindmap",
  fallbackToc: "toolLabels.fallbackToc",
  fallbackSearch: "toolLabels.fallbackSearch",
  fallbackChapterContext: "toolLabels.fallbackChapterContext",
  searchKnowledgeBase: "toolLabels.searchKnowledgeBase",
  getBookKnowledge: "toolLabels.getBookKnowledge",
  proposeKnowledgeDocumentCreate: "toolLabels.proposeKnowledgeDocumentCreate",
  proposeKnowledgeDocumentUpdate: "toolLabels.proposeKnowledgeDocumentUpdate",
  proposeKnowledgeLinkCreate: "toolLabels.proposeKnowledgeLinkCreate",
};

type KnowledgeProposalApplyState = "idle" | "applying" | "applied";

const KNOWLEDGE_DOCUMENT_TYPE_KEYS: Record<string, string> = {
  book_home: "knowledgeProposal.types.bookHome",
  folder: "knowledgeProposal.types.folder",
  standalone_note: "knowledgeProposal.types.standaloneNote",
  highlight_note: "knowledgeProposal.types.highlightNote",
  review: "knowledgeProposal.types.review",
  summary: "knowledgeProposal.types.summary",
  imported_markdown: "knowledgeProposal.types.importedMarkdown",
};

const KNOWLEDGE_CHANGED_FIELD_KEYS: Record<string, string> = {
  parentId: "knowledgeProposal.fields.parentFolder",
  title: "knowledgeProposal.fields.title",
  contentMd: "knowledgeProposal.fields.content",
  contentJson: "knowledgeProposal.fields.content",
  excerpt: "knowledgeProposal.fields.content",
  tags: "knowledgeProposal.fields.tags",
};

function formatKnowledgeChangedFields(
  fields: string[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  return [
    ...new Set(
      fields.map((field) =>
        t(KNOWLEDGE_CHANGED_FIELD_KEYS[field] ?? `knowledgeProposal.fields.${field}`, {
          defaultValue: field,
        }),
      ),
    ),
  ];
}

function ToolCallPartView({ part }: { part: ToolCallPart }) {
  const { t } = useTranslation();
  const hasError = part.status === "error" || Boolean(part.error);
  const proposal = useMemo(() => getKnowledgeWriteProposal(part.result), [part.result]);

  const [isOpen, setIsOpen] = useState(hasError || Boolean(proposal));
  const [proposalApplyState, setProposalApplyState] = useState<KnowledgeProposalApplyState>("idle");

  const getStatusIcon = () => {
    switch (part.status) {
      case "pending":
        return <Circle className="h-4 w-4 text-muted-foreground/50" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Circle className="h-4 w-4 text-muted-foreground/50" />;
    }
  };

  const label = TOOL_LABEL_KEYS[part.name] ? t(TOOL_LABEL_KEYS[part.name]) : part.name;
  const queryText = part.args.query ? String(part.args.query) : "";
  const scopeText = part.args.scope ? String(part.args.scope) : "";
  const errorMessage =
    part.error ||
    (part.result && typeof part.result === "object"
      ? String((part.result as Record<string, unknown>).error || "")
      : "");

  useEffect(() => {
    if (hasError || proposal) setIsOpen(true);
    setProposalApplyState("idle");
  }, [hasError, proposal]);

  const handleApplyProposal = async () => {
    if (!proposal || proposalApplyState !== "idle") return;
    setProposalApplyState("applying");
    try {
      await applyKnowledgeWriteProposal(proposal);
      setProposalApplyState("applied");
      toast.success(t("knowledgeProposal.applySuccess"));
    } catch (error) {
      setProposalApplyState("idle");
      console.error("[KnowledgeProposal] Failed to apply proposal:", error);
      toast.error(error instanceof Error ? error.message : t("knowledgeProposal.applyFailed"));
    }
  };

  return (
    <div className="my-1">
      <div
        className={cn(
          "overflow-hidden rounded-lg border",
          hasError ? "border-destructive/30 bg-destructive/5" : "border-border",
        )}
      >
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <div
              className={cn(
                "flex h-auto w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50",
                hasError && "hover:bg-destructive/10",
              )}
            >
              <div className="flex flex-1 items-center gap-2 overflow-hidden">
                {getStatusIcon()}
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{label}</span>
                {hasError && (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                    {t("streaming.toolFailed")}
                  </span>
                )}
                {proposal && !hasError && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                    {proposalApplyState === "applied"
                      ? t("knowledgeProposal.savedBadge")
                      : t("knowledgeProposal.pendingBadge")}
                  </span>
                )}
                {queryText && (
                  <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                    {queryText.slice(0, 50)}
                  </span>
                )}
                {scopeText && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {scopeText}
                  </span>
                )}
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 border-t border-border bg-muted/30 p-3">
              {part.reasoning && (
                <div className="rounded border border-primary/20 bg-primary/5 p-2">
                  <p className="text-xs text-foreground">{part.reasoning}</p>
                </div>
              )}

              {Object.keys(part.args).length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {t("common.params")}
                  </h4>
                  <div className="rounded border border-border bg-background p-2 font-mono text-xs break-all">
                    {Object.entries(part.args).map(([key, value]) => (
                      <div key={key} className="mb-0.5 last:mb-0">
                        <span className="text-muted-foreground">{key}:</span>{" "}
                        <span className="text-foreground">
                          {typeof value === "string" && value.length > 100
                            ? `${value.slice(0, 100)}...`
                            : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {part.result !== undefined && (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">
                    {t("common.result")}
                  </h4>
                  {proposal ? (
                    <KnowledgeProposalCard
                      proposal={proposal}
                      applyState={proposalApplyState}
                      onApply={handleApplyProposal}
                    />
                  ) : (
                    <div className="max-h-48 overflow-auto rounded border border-border bg-background p-2 font-mono text-xs">
                      <pre className="whitespace-pre-wrap text-foreground">
                        {typeof part.result === "string" && part.result.length > 500
                          ? `${part.result.slice(0, 500)}...`
                          : JSON.stringify(part.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {hasError && (
                <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs leading-relaxed text-destructive">
                  <div className="mb-1 font-medium">{t("streaming.toolFailedDetail")}</div>
                  <div className="break-words">{errorMessage || t("streaming.toolFailed")}</div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function KnowledgeProposalCard({
  proposal,
  applyState,
  onApply,
}: {
  proposal: KnowledgeWriteProposal;
  applyState: KnowledgeProposalApplyState;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  let actionLabel = t("knowledgeProposal.link");
  let title = "";
  let typeLabel = t("knowledgeProposal.types.knowledgeLink");
  let tags: string[] = [];
  let preview = "";
  let changedFields: string[] = [];

  if (proposal.action === "create") {
    actionLabel = t("knowledgeProposal.create");
    title = proposal.draft.title ?? "";
    typeLabel = t(KNOWLEDGE_DOCUMENT_TYPE_KEYS[proposal.draft.type], {
      defaultValue: proposal.draft.type,
    });
    tags = proposal.draft.tags ?? [];
    preview = proposal.draft.excerpt || proposal.draft.contentMd || "";
  } else if (proposal.action === "update") {
    actionLabel = t("knowledgeProposal.update");
    title = proposal.patch.title ?? proposal.current?.title ?? proposal.documentId;
    typeLabel = proposal.current?.type
      ? t(KNOWLEDGE_DOCUMENT_TYPE_KEYS[proposal.current.type], {
          defaultValue: proposal.current.type,
        })
      : t("knowledgeProposal.types.knowledgeDocument");
    tags = proposal.patch.tags ?? proposal.current?.tags ?? [];
    preview = proposal.patch.excerpt || proposal.patch.contentMd || proposal.current?.excerpt || "";
    changedFields = proposal.changedFields;
  } else {
    title = proposal.link.label || `${proposal.link.relation}: ${proposal.link.toId}`;
    preview = [
      `${proposal.link.relation} -> ${proposal.link.toKind}: ${proposal.link.toId}`,
      proposal.link.cfi ? `CFI: ${proposal.link.cfi}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    changedFields = [proposal.link.relation];
  }
  const changedFieldLabels = formatKnowledgeChangedFields(changedFields, t);

  return (
    <div className="overflow-hidden rounded-md border border-primary/20 bg-background">
      <div className="border-b border-border/70 bg-primary/[0.04] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-primary">{actionLabel}</div>
            <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          </div>
          <div className="shrink-0 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            {typeLabel}
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("knowledgeProposal.safeHint")}
        </p>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 6).map((tag) => (
              <span key={tag} className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
            {tags.length > 6 && (
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                +{tags.length - 6}
              </span>
            )}
          </div>
        )}

        {changedFieldLabels.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("knowledgeProposal.changes")}
            </div>
            <div className="text-xs text-foreground">{changedFieldLabels.join(", ")}</div>
          </div>
        )}

        {preview && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("knowledgeProposal.contentPreview")}
            </div>
            <div className="max-h-28 overflow-auto rounded border border-border bg-muted/30 p-2 text-xs leading-relaxed text-foreground">
              {preview.length > 520 ? `${preview.slice(0, 520)}...` : preview}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onApply}
            disabled={applyState !== "idle"}
            className="h-8"
          >
            {applyState === "applying"
              ? t("knowledgeProposal.applying")
              : applyState === "applied"
                ? t("knowledgeProposal.applied")
                : t("knowledgeProposal.apply")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MindmapPartView({ part }: { part: MindmapPart }) {
  const { t } = useTranslation();
  return (
    <div className="my-2">
      <Suspense
        fallback={
          <div className="p-4 text-sm text-muted-foreground">{t("streaming.loadingMindmap")}</div>
        }
      >
        <LazyMindmapView markdown={part.markdown} title={part.title} />
      </Suspense>
    </div>
  );
}

function AbortedPartView({ part }: { part: AbortedPart }) {
  return (
    <div className="my-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <OctagonX className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <span className="text-sm text-amber-600 dark:text-amber-400">{part.reason}</span>
    </div>
  );
}
