/**
 * Message Part Components
 * Renders individual parts of a message (text, reasoning, tool calls, citations)
 */
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  getKnowledgeToolResultDisplay,
  getToolResultError,
  maybeCompressKnowledgeDocumentsById,
} from "@readany/core/ai";
import { useSettingsStore } from "@/stores/settings-store";
import type { KnowledgeToolResultDisplay } from "@readany/core/ai";
import {
  type KnowledgeWriteProposal,
  applyKnowledgeWriteProposal,
  createKnowledgeWriteProposalPreview,
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
import { cn, providerRequiresApiKey } from "@readany/core/utils";
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

function queueKnowledgeProposalSummaryMaintenance(documentId: string | undefined): void {
  if (!documentId) return;

  const { aiConfig } = useSettingsStore.getState();
  const endpoint = aiConfig.endpoints.find((item) => item.id === aiConfig.activeEndpointId);
  const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
  if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) return;

  void maybeCompressKnowledgeDocumentsById([documentId], aiConfig).catch((error) => {
    console.warn("[KnowledgeProposal] Background summary maintenance failed:", error);
  });
}

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
  getKnowledgeDocument: "toolLabels.getKnowledgeDocument",
  getBookKnowledge: "toolLabels.getBookKnowledge",
  proposeKnowledgeDocumentCreate: "toolLabels.proposeKnowledgeDocumentCreate",
  proposeKnowledgeDocumentUpdate: "toolLabels.proposeKnowledgeDocumentUpdate",
  proposeKnowledgeDocumentTagsUpdate: "toolLabels.proposeKnowledgeDocumentTagsUpdate",
  proposeKnowledgeLinkCreate: "toolLabels.proposeKnowledgeLinkCreate",
  compressKnowledgeDocumentSummary: "toolLabels.compressKnowledgeDocumentSummary",
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

function KnowledgeToolResultDocumentRows({
  documents,
  max = 5,
}: {
  documents: KnowledgeToolResultDisplay["documents"];
  max?: number;
}) {
  const { t } = useTranslation();

  return (
    <>
      {documents.slice(0, max).map((document) => (
        <div
          key={document.id ?? `${document.title}-${document.path}`}
          className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{document.title}</div>
              {document.path ? (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {document.path}
                </div>
              ) : null}
            </div>
            {document.type ? (
              <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t(`knowledgeToolResult.types.${document.type}`, {
                  defaultValue: document.type,
                })}
              </span>
            ) : null}
          </div>
          {document.snippet ? (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {document.snippet}
            </p>
          ) : null}
        </div>
      ))}
    </>
  );
}

function KnowledgeToolResultCard({ display }: { display: KnowledgeToolResultDisplay }) {
  const { t } = useTranslation();
  const toolLabel =
    display.toolName && TOOL_LABEL_KEYS[display.toolName]
      ? t(TOOL_LABEL_KEYS[display.toolName])
      : display.toolName;
  const title =
    display.kind === "failure"
      ? t("knowledgeToolResult.failureTitle", {
          tool: toolLabel || t("knowledgeToolResult.tool", { defaultValue: "Knowledge tool" }),
          defaultValue: `${toolLabel || "Knowledge tool"} failed`,
        })
      : display.kind === "search"
        ? t("knowledgeToolResult.searchTitle", { defaultValue: "Knowledge search results" })
        : display.kind === "document"
          ? t("knowledgeToolResult.documentTitle", { defaultValue: "Knowledge document read" })
        : display.kind === "bookKnowledge"
          ? t("knowledgeToolResult.bookKnowledgeTitle", { defaultValue: "Book knowledge read" })
          : t("knowledgeToolResult.summaryTitle", { defaultValue: "Knowledge memory updated" });

  const countText =
    display.kind === "failure"
      ? [
          display.status
            ? t("knowledgeToolResult.status", {
                status: display.status,
                defaultValue: `Status: ${display.status}`,
              })
            : null,
          display.documentId
            ? t("knowledgeToolResult.documentId", {
                id: display.documentId,
                defaultValue: `Document: ${display.documentId}`,
              })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : display.kind === "summary"
        ? [
            display.status
              ? t("knowledgeToolResult.status", {
                  status: display.status,
                  defaultValue: `Status: ${display.status}`,
                })
              : null,
            display.persisted !== undefined
              ? display.persisted
                ? t("knowledgeToolResult.persisted", { defaultValue: "Persisted" })
                : t("knowledgeToolResult.notPersisted", { defaultValue: "Not persisted" })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : display.kind === "document"
          ? display.documentId
            ? t("knowledgeToolResult.documentId", {
                id: display.documentId,
                defaultValue: `Document: ${display.documentId}`,
              })
            : ""
        : t("knowledgeToolResult.count", {
            total: display.total ?? display.documents.length,
            showing: display.showing ?? display.documents.length,
            defaultValue: `${display.documents.length} document(s)`,
          });

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-background",
        display.kind === "failure" ? "border-destructive/30" : "border-border",
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-3 border-b px-3 py-2",
          display.kind === "failure"
            ? "border-destructive/20 bg-destructive/5"
            : "border-border/60 bg-muted/25",
        )}
      >
        <div className="min-w-0">
          <div
            className={cn(
              "text-xs font-medium",
              display.kind === "failure" ? "text-destructive" : "text-primary",
            )}
          >
            {title}
          </div>
          {countText ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{countText}</div>
          ) : null}
        </div>
        {display.kind === "summary" && display.sourceChars ? (
          <div className="shrink-0 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("knowledgeToolResult.sourceChars", {
              count: display.sourceChars,
              defaultValue: `${display.sourceChars} chars`,
            })}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 p-3">
        {display.kind === "failure" ? (
          <>
            <div className="rounded-md border border-destructive/25 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
              <div className="font-semibold">
                {display.error ||
                  t("knowledgeToolResult.failureUnknown", {
                    defaultValue: "Tool execution failed",
                  })}
              </div>
              {display.reason ? (
                <div className="mt-1 text-destructive/85">
                  {t("knowledgeToolResult.reason", {
                    reason: display.reason,
                    defaultValue: `Reason: ${display.reason}`,
                  })}
                </div>
              ) : null}
              <div className="mt-2 text-destructive/75">
                {t("knowledgeToolResult.failureSafeHint", {
                  defaultValue:
                    display.safeNoWriteHint ||
                    "This failed tool call did not write to the knowledge base or change your documents.",
                })}
              </div>
            </div>
            {display.documents.length > 0 ? (
              <KnowledgeToolResultDocumentRows documents={display.documents} max={3} />
            ) : null}
          </>
        ) : display.kind === "summary" ? (
          <>
            {display.documents.length > 0 ? (
              <KnowledgeToolResultDocumentRows documents={display.documents} max={1} />
            ) : display.documentId ? (
              <div className="break-all rounded border border-border bg-muted/25 p-2 text-xs text-muted-foreground">
                {t("knowledgeToolResult.documentId", {
                  id: display.documentId,
                  defaultValue: `Document: ${display.documentId}`,
                })}
              </div>
            ) : null}
            {display.reason ? (
              <p className="text-xs text-muted-foreground">
                {t("knowledgeToolResult.reason", {
                  reason: display.reason,
                  defaultValue: `Reason: ${display.reason}`,
                })}
              </p>
            ) : null}
            {display.summaryPreview ? (
              <div className="max-h-28 overflow-auto rounded border border-border bg-muted/30 p-2 text-xs leading-relaxed text-foreground">
                {display.summaryPreview}
              </div>
            ) : null}
          </>
        ) : display.documents.length === 0 ? (
          <p className="rounded border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground">
            {t("knowledgeToolResult.empty", { defaultValue: "No matching knowledge documents." })}
          </p>
        ) : (
          <KnowledgeToolResultDocumentRows documents={display.documents} />
        )}

        {display.documents.length > 5 ? (
          <div className="text-xs text-muted-foreground">
            {t("knowledgeToolResult.more", {
              count: display.documents.length - 5,
              defaultValue: `+${display.documents.length - 5} more`,
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolCallPartView({ part }: { part: ToolCallPart }) {
  const { t } = useTranslation();
  const toolResultError = useMemo(() => getToolResultError(part.result), [part.result]);
  const hasError = part.status === "error" || Boolean(part.error) || Boolean(toolResultError);
  const proposal = useMemo(() => getKnowledgeWriteProposal(part.result), [part.result]);
  const errorMessage = part.error || toolResultError || "";
  const knowledgeResult = useMemo(
    () => getKnowledgeToolResultDisplay(part.name, part.result, { error: errorMessage }),
    [errorMessage, part.name, part.result],
  );

  const [isOpen, setIsOpen] = useState(hasError || Boolean(proposal) || Boolean(knowledgeResult));
  const [proposalApplyState, setProposalApplyState] = useState<KnowledgeProposalApplyState>("idle");

  const getStatusIcon = () => {
    if (hasError) return <XCircle className="h-4 w-4 text-destructive" />;

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
  useEffect(() => {
    if (hasError || proposal || knowledgeResult) setIsOpen(true);
    setProposalApplyState("idle");
  }, [hasError, proposal, knowledgeResult]);

  const handleApplyProposal = async () => {
    if (!proposal || proposalApplyState !== "idle") return;
    setProposalApplyState("applying");
    try {
      const result = await applyKnowledgeWriteProposal(proposal);
      if (proposal.action !== "link") {
        queueKnowledgeProposalSummaryMaintenance(result.documentId);
      }
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
              {hasError && knowledgeResult?.kind !== "failure" && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
                  <div className="mb-1 font-semibold">{t("streaming.toolFailedDetail")}</div>
                  <div className="break-words">{errorMessage || t("streaming.toolFailed")}</div>
                  <div className="mt-2 text-destructive/80">{t("streaming.toolFailedHint")}</div>
                </div>
              )}

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
                  ) : knowledgeResult ? (
                    <KnowledgeToolResultCard display={knowledgeResult} />
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
  const preview = createKnowledgeWriteProposalPreview(proposal);
  const actionLabel =
    preview.action === "create"
      ? t("knowledgeProposal.create")
      : preview.action === "update"
        ? t("knowledgeProposal.update")
        : t("knowledgeProposal.link");
  const typeLabel = preview.documentType
    ? t(KNOWLEDGE_DOCUMENT_TYPE_KEYS[preview.documentType], {
        defaultValue: preview.documentType,
      })
    : t(
        preview.action === "link"
          ? "knowledgeProposal.types.knowledgeLink"
          : "knowledgeProposal.types.knowledgeDocument",
      );
  const changedFieldLabels = formatKnowledgeChangedFields(preview.changedFields, t);

  return (
    <div className="overflow-hidden rounded-md border border-primary/20 bg-background">
      <div className="border-b border-border/70 bg-primary/[0.04] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-primary">{actionLabel}</div>
            <div className="truncate text-sm font-semibold text-foreground">{preview.title}</div>
            {preview.visiblePath ? (
              <div
                className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground"
                title={preview.visiblePath}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/55" />
                <span className="truncate font-mono">{preview.visiblePath}</span>
              </div>
            ) : null}
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

        {preview.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {preview.tags.slice(0, 6).map((tag) => (
              <span key={tag} className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
            {preview.tags.length > 6 && (
              <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                +{preview.tags.length - 6}
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

        {preview.visiblePath && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("knowledgeProposal.location")}
            </div>
            {preview.hasPathChange ? (
              <div className="space-y-1.5 rounded-md border border-border bg-muted/25 p-2 text-xs leading-relaxed">
                <div className="break-words font-mono text-muted-foreground">
                  {preview.currentPath}
                </div>
                <div className="break-words border-t border-border/55 pt-1.5 font-mono text-primary">
                  → {preview.targetPath}
                </div>
              </div>
            ) : (
              <div className="break-words rounded-md border border-border bg-muted/25 p-2 font-mono text-xs leading-relaxed text-foreground">
                {preview.visiblePath}
              </div>
            )}
          </div>
        )}

        {preview.contentPreview && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("knowledgeProposal.contentPreview")}
            </div>
            <div className="max-h-28 overflow-auto rounded border border-border bg-muted/30 p-2 text-xs leading-relaxed text-foreground">
              {preview.contentPreview.length > 520
                ? `${preview.contentPreview.slice(0, 520)}...`
                : preview.contentPreview}
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
