import { MermaidView } from "@/components/common/MermaidView";
import { MindmapView } from "@/components/common/MindmapView";
import { BrainIcon, CheckIcon, ChevronDownIcon, OctagonXIcon, XIcon } from "@/components/ui/Icon";
import { useThrottledValue } from "@/hooks";
import { fontSize as fs, fontWeight as fw, radius, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import { getToolResultError } from "@readany/core/ai";
import {
  type KnowledgeWriteProposal,
  applyKnowledgeWriteProposal,
  getKnowledgeWriteProposal,
} from "@readany/core/knowledge/proposals";
import type {
  AbortedPart,
  CitationPart,
  MermaidPart,
  MindmapPart,
  Part,
  ReasoningPart,
  TextPart,
  ToolCallPart,
} from "@readany/core/types/message";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
    case "mermaid":
      return <MermaidPartView part={part} />;
    case "aborted":
      return <AbortedPartView part={part} />;
    default:
      return null;
  }
}

function MindmapPartView({ part }: { part: MindmapPart }) {
  return <MindmapView markdown={part.markdown} title={part.title} />;
}

function MermaidPartView({ part }: { part: MermaidPart }) {
  return <MermaidView chart={part.chart} title={part.title} />;
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
  const throttledText = useThrottledValue(part.text, 100);
  const isStreaming = part.status === "running";

  if (!throttledText.trim()) {
    return null;
  }

  return (
    <MarkdownRenderer
      content={throttledText}
      isStreaming={isStreaming}
      citations={citations}
      onCitationClick={onCitationClick}
    />
  );
}

function ReasoningPartView({ part }: { part: ReasoningPart }) {
  const [isOpen, setIsOpen] = useState(part.status === "running" || part.status === "completed");
  const throttledText = useThrottledValue(part.text, 100);
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeReasoningStyles(colors);

  useEffect(() => {
    if (part.status === "running") setIsOpen(true);
  }, [part.status]);

  if (!part.text?.trim()) return null;

  return (
    <View style={s.container}>
      <TouchableOpacity style={s.header} onPress={() => setIsOpen(!isOpen)} activeOpacity={0.7}>
        <View style={s.headerLeft}>
          {part.status === "running" ? (
            <View style={s.pulsingDot} />
          ) : (
            <BrainIcon size={14} color={colors.mutedForeground} />
          )}
          <Text style={s.headerText}>
            {part.status === "running"
              ? t("streaming.reasoningRunning", "思考中...")
              : t("streaming.reasoningDone", "思考完成")}
          </Text>
        </View>
        <View style={[s.chevron, isOpen && s.chevronOpen]}>
          <ChevronDownIcon size={14} color={colors.mutedForeground} />
        </View>
      </TouchableOpacity>
      {isOpen && (
        <View style={s.body}>
          <ScrollView
            style={s.bodyScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator={true}
            scrollEventThrottle={16}
          >
            <Text style={s.bodyText}>{throttledText}</Text>
          </ScrollView>
        </View>
      )}
    </View>
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
  const toolResultError = useMemo(() => getToolResultError(part.result), [part.result]);
  const hasError = part.status === "error" || Boolean(part.error) || Boolean(toolResultError);
  const proposal = useMemo(() => getKnowledgeWriteProposal(part.result), [part.result]);

  const [isOpen, setIsOpen] = useState(hasError || Boolean(proposal));
  const [proposalApplyState, setProposalApplyState] = useState<KnowledgeProposalApplyState>("idle");
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeToolStyles(colors);

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
    } catch (error) {
      setProposalApplyState("idle");
      console.error("[KnowledgeProposal] Failed to apply proposal:", error);
      Alert.alert(
        t("knowledgeProposal.applyFailed", "应用失败"),
        error instanceof Error ? error.message : t("knowledgeProposal.applyFailed", "应用失败"),
      );
    }
  };

  const getStatusIcon = () => {
    if (hasError) return <XIcon size={14} color={colors.destructive} />;

    switch (part.status) {
      case "pending":
        return <View style={[s.dot, { backgroundColor: colors.mutedForeground }]} />;
      case "running":
        return <ActivityIndicator size="small" color={colors.blue} />;
      case "completed":
        return <CheckIcon size={14} color={colors.emerald} />;
      case "error":
        return <XIcon size={14} color={colors.destructive} />;
      default:
        return <View style={[s.dot, { backgroundColor: colors.mutedForeground }]} />;
    }
  };

  const label = TOOL_LABEL_KEYS[part.name] ? t(TOOL_LABEL_KEYS[part.name]) : part.name;
  const queryText = part.args.query ? String(part.args.query) : "";
  const errorMessage = part.error || toolResultError || "";

  return (
    <View style={[s.container, hasError && s.errorContainer]}>
      <TouchableOpacity style={s.header} onPress={() => setIsOpen(!isOpen)} activeOpacity={0.7}>
        <View style={s.headerLeft}>
          {getStatusIcon()}
          <Text style={s.headerText} numberOfLines={1}>
            {label}
          </Text>
          {hasError ? (
            <View style={s.errorBadge}>
              <Text style={s.errorBadgeText}>{t("streaming.toolFailed", "调用失败")}</Text>
            </View>
          ) : null}
          {proposal && !hasError ? (
            <View style={s.proposalBadge}>
              <Text style={s.proposalBadgeText}>
                {proposalApplyState === "applied"
                  ? t("knowledgeProposal.savedBadge", "已应用")
                  : t("knowledgeProposal.pendingBadge", "待确认")}
              </Text>
            </View>
          ) : null}
          {queryText ? (
            <Text style={s.queryText} numberOfLines={1}>
              {queryText.slice(0, 30)}
            </Text>
          ) : null}
        </View>
        <View style={[s.chevron, isOpen && s.chevronOpen]}>
          <ChevronDownIcon size={14} color={colors.mutedForeground} />
        </View>
      </TouchableOpacity>
      {isOpen && (
        <View style={s.body}>
          {hasError ? (
            <View style={s.errorBlock}>
              <Text style={s.errorTitle}>{t("streaming.toolFailedDetail", "工具调用失败")}</Text>
              <Text style={s.errorText}>
                {errorMessage || t("streaming.toolFailed", "调用失败")}
              </Text>
              <Text style={s.errorHintText}>
                {t(
                  "streaming.toolFailedHint",
                  "请检查参数和结果详情。失败的工具不会写入知识库或修改数据。",
                )}
              </Text>
            </View>
          ) : null}

          {Object.keys(part.args).length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t("common.params", "参数")}</Text>
              <View style={s.codeBlock}>
                {Object.entries(part.args).map(([key, value]) => (
                  <Text key={key} style={s.codeText}>
                    <Text style={s.codeKey}>{key}: </Text>
                    {typeof value === "string" && value.length > 80
                      ? `${value.slice(0, 80)}...`
                      : String(value)}
                  </Text>
                ))}
              </View>
            </View>
          )}
          {part.result !== undefined && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t("common.result", "结果")}</Text>
              {proposal ? (
                <KnowledgeProposalCard
                  proposal={proposal}
                  applyState={proposalApplyState}
                  onApply={handleApplyProposal}
                />
              ) : (
                <View style={s.codeBlockScroll}>
                  <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                    <Text style={s.codeText}>
                      {typeof part.result === "string" && part.result.length > 500
                        ? `${part.result.slice(0, 500)}...`
                        : JSON.stringify(part.result, null, 2)}
                    </Text>
                  </ScrollView>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
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
  const colors = useColors();
  const s = makeToolStyles(colors);
  let actionLabel = t("knowledgeProposal.link", "建立知识关联");
  let title = "";
  let typeLabel = t("knowledgeProposal.types.knowledgeLink", "知识关联");
  let tags: string[] = [];
  let preview = "";
  let changedFields: string[] = [];

  if (proposal.action === "create") {
    actionLabel = t("knowledgeProposal.create", "创建知识文档");
    title = proposal.draft.title ?? "";
    typeLabel = t(KNOWLEDGE_DOCUMENT_TYPE_KEYS[proposal.draft.type], {
      defaultValue: proposal.draft.type,
    });
    tags = proposal.draft.tags ?? [];
    preview = proposal.draft.excerpt || proposal.draft.contentMd || "";
  } else if (proposal.action === "update") {
    actionLabel = t("knowledgeProposal.update", "更新知识文档");
    title = proposal.patch.title ?? proposal.current?.title ?? proposal.documentId;
    typeLabel = proposal.current?.type
      ? t(KNOWLEDGE_DOCUMENT_TYPE_KEYS[proposal.current.type], {
          defaultValue: proposal.current.type,
        })
      : t("knowledgeProposal.types.knowledgeDocument", "知识文档");
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
    <View style={s.proposalCard}>
      <View style={s.proposalHeader}>
        <View style={s.proposalTitleWrap}>
          <Text style={s.proposalActionText}>{actionLabel}</Text>
          <Text style={s.proposalTitleText} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <View style={s.proposalTypeBadge}>
          <Text style={s.proposalTypeText} numberOfLines={1}>
            {typeLabel}
          </Text>
        </View>
      </View>

      <View style={s.proposalBody}>
        <Text style={s.proposalHintText}>
          {t("knowledgeProposal.safeHint", "AI 只生成了草稿，确认后才会写入你的知识库。")}
        </Text>

        {tags.length > 0 ? (
          <View style={s.proposalTagRow}>
            {tags.slice(0, 6).map((tag) => (
              <View key={tag} style={s.proposalTag}>
                <Text style={s.proposalTagText}>{tag}</Text>
              </View>
            ))}
            {tags.length > 6 ? (
              <View style={s.proposalTag}>
                <Text style={s.proposalTagText}>+{tags.length - 6}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {changedFieldLabels.length > 0 ? (
          <View style={s.proposalMetaBlock}>
            <Text style={s.proposalMetaLabel}>{t("knowledgeProposal.changes", "变更")}</Text>
            <Text style={s.proposalMetaText}>{changedFieldLabels.join(", ")}</Text>
          </View>
        ) : null}

        {preview ? (
          <View style={s.proposalPreviewBlock}>
            <Text style={s.proposalMetaLabel}>
              {t("knowledgeProposal.contentPreview", "内容预览")}
            </Text>
            <Text style={s.proposalPreviewText} numberOfLines={6}>
              {preview.length > 520 ? `${preview.slice(0, 520)}...` : preview}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[s.proposalApplyButton, applyState !== "idle" && s.proposalApplyButtonDisabled]}
          onPress={onApply}
          disabled={applyState !== "idle"}
          activeOpacity={0.8}
        >
          <Text style={s.proposalApplyText}>
            {applyState === "applying"
              ? t("knowledgeProposal.applying", "应用中...")
              : applyState === "applied"
                ? t("knowledgeProposal.applied", "已应用")
                : t("knowledgeProposal.apply", "应用到知识库")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AbortedPartView({ part }: { part: AbortedPart }) {
  const colors = useColors();
  return (
    <View
      style={{
        marginVertical: 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: withOpacity(colors.amber, 0.3),
        backgroundColor: withOpacity(colors.amber, 0.1),
      }}
    >
      <OctagonXIcon size={16} color={colors.amber} />
      <Text style={{ fontSize: fs.sm, color: colors.amber }}>{part.reason}</Text>
    </View>
  );
}

const makeReasoningStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginVertical: 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: withOpacity(colors.muted, 0.5),
      overflow: "hidden",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flex: 1,
    },
    pulsingDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
      opacity: 0.6,
    },
    headerText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
    },
    chevron: {},
    chevronOpen: { transform: [{ rotate: "180deg" }] },
    body: {
      borderTopWidth: 0.5,
      borderTopColor: colors.border,
      backgroundColor: withOpacity(colors.card, 0.5),
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    bodyScroll: {
      maxHeight: 300,
    },
    bodyText: {
      fontSize: fs.sm,
      lineHeight: 18,
      color: colors.foreground,
      opacity: 0.85,
    },
  });

const makeToolStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginVertical: 4,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    errorContainer: {
      borderColor: withOpacity(colors.destructive, 0.35),
      backgroundColor: withOpacity(colors.destructive, 0.04),
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    headerLeft: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flex: 1,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    headerText: {
      fontSize: fs.sm,
      fontWeight: fw.medium,
      color: colors.foreground,
    },
    queryText: {
      flex: 1,
      fontSize: fs.xs,
      fontFamily: "Menlo",
      color: colors.mutedForeground,
    },
    errorBadge: {
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.destructive, 0.1),
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    errorBadgeText: {
      fontSize: fs.xs,
      color: colors.destructive,
      fontWeight: fw.medium,
    },
    proposalBadge: {
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.primary, 0.1),
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    proposalBadgeText: {
      fontSize: fs.xs,
      color: colors.primary,
      fontWeight: fw.medium,
    },
    chevron: {},
    chevronOpen: { transform: [{ rotate: "180deg" }] },
    body: {
      borderTopWidth: 0.5,
      borderTopColor: colors.border,
      backgroundColor: colors.muted,
      padding: 10,
      gap: 8,
    },
    section: { gap: 4 },
    sectionTitle: {
      fontSize: fs.xs,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
    },
    codeBlock: {
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: radius.sm,
      padding: 8,
    },
    codeBlockScroll: {
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: radius.sm,
      padding: 8,
      maxHeight: 200,
    },
    codeText: {
      fontSize: fs.xs,
      fontFamily: "Menlo",
      color: colors.foreground,
      lineHeight: 16,
    },
    codeKey: { color: colors.mutedForeground },
    proposalCard: {
      overflow: "hidden",
      borderWidth: 0.5,
      borderColor: withOpacity(colors.primary, 0.24),
      backgroundColor: colors.card,
      borderRadius: radius.md,
    },
    proposalHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 10,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      backgroundColor: withOpacity(colors.primary, 0.04),
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    proposalTitleWrap: {
      flex: 1,
      gap: 3,
    },
    proposalActionText: {
      fontSize: fs.xs,
      fontWeight: fw.medium,
      color: colors.primary,
    },
    proposalTitleText: {
      fontSize: fs.sm,
      lineHeight: 18,
      fontWeight: fw.semibold,
      color: colors.foreground,
    },
    proposalTypeBadge: {
      maxWidth: 110,
      borderRadius: radius.sm,
      backgroundColor: colors.muted,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    proposalTypeText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
    proposalBody: {
      gap: 9,
      padding: 10,
    },
    proposalHintText: {
      fontSize: fs.xs,
      lineHeight: 17,
      color: colors.mutedForeground,
    },
    proposalTagRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    proposalTag: {
      borderRadius: radius.sm,
      backgroundColor: colors.muted,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    proposalTagText: {
      fontSize: fs.xs,
      color: colors.mutedForeground,
    },
    proposalMetaBlock: {
      gap: 3,
    },
    proposalMetaLabel: {
      fontSize: fs.xs,
      fontWeight: fw.medium,
      color: colors.mutedForeground,
    },
    proposalMetaText: {
      fontSize: fs.xs,
      color: colors.foreground,
    },
    proposalPreviewBlock: {
      gap: 5,
    },
    proposalPreviewText: {
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: withOpacity(colors.muted, 0.45),
      borderRadius: radius.sm,
      padding: 8,
      fontSize: fs.xs,
      lineHeight: 17,
      color: colors.foreground,
    },
    proposalApplyButton: {
      alignSelf: "flex-end",
      minHeight: 34,
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    proposalApplyButtonDisabled: {
      opacity: 0.65,
    },
    proposalApplyText: {
      fontSize: fs.xs,
      fontWeight: fw.semibold,
      color: colors.primaryForeground,
    },
    errorBlock: {
      borderWidth: 0.5,
      borderColor: colors.destructive,
      backgroundColor: withOpacity(colors.destructive, 0.05),
      borderRadius: radius.sm,
      padding: 8,
    },
    errorText: {
      fontSize: fs.xs,
      color: colors.destructive,
      lineHeight: 16,
    },
    errorHintText: {
      marginTop: 6,
      fontSize: fs.xs,
      color: withOpacity(colors.destructive, 0.78),
      lineHeight: 16,
    },
    errorTitle: {
      marginBottom: 4,
      fontSize: fs.xs,
      fontWeight: fw.medium,
      color: colors.destructive,
    },
  });
