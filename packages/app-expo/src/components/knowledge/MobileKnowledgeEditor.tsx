import {
  BoldIcon,
  BookOpenIcon,
  BrainIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LightbulbIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  MessageCirclePlusIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  ScrollTextIcon,
  SparklesIcon,
  StrikethroughIcon,
  Undo2Icon,
} from "@/components/ui/Icon";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import {
  type KnowledgeEditorFeature,
  type KnowledgeEditorSurface,
  type KnowledgeEditorTier,
  builtInReadAnyCards,
  clearKnowledgeEditorDraft,
  createDefaultReadAnyCardAttrs,
  createKnowledgeEditorDraftKey,
  getKnowledgeEditorFeatureForCardType,
  getKnowledgeEditorProfile,
  getKnowledgeEditorSurfaceProfile,
  hasKnowledgeEditorFeature,
  isKnowledgeEditorDraftRestorable,
  knowledgeEditorDraftFingerprint,
  loadKnowledgeEditorDraft,
  markdownToBasicTiptap,
  renderKnowledgeJsonToMarkdown,
  saveKnowledgeEditorDraft,
} from "@readany/core/knowledge";
import type { KnowledgeEditorDraft } from "@readany/core/knowledge";
import type { JSONValue } from "@readany/core/types";
import { Asset } from "expo-asset";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView, { type WebViewMessageEvent } from "react-native-webview";

const EDITOR_HTML_ASSET = Asset.fromModule(require("../../../assets/editor/knowledge-editor.html"));

export interface MobileKnowledgeEditorValue {
  contentJson: JSONValue;
  contentMd: string;
  plainText: string;
}

interface MobileKnowledgeEditorProps {
  documentId?: string;
  value: MobileKnowledgeEditorValue;
  onChange: (value: MobileKnowledgeEditorValue) => void;
  placeholder?: string;
  autoFocus?: boolean;
  tier?: KnowledgeEditorTier;
  surface?: KnowledgeEditorSurface;
  isSaved?: boolean;
}

interface SelectionState {
  marks: {
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    code?: boolean;
    bulletList?: boolean;
    orderedList?: boolean;
    blockquote?: boolean;
    link?: boolean;
  };
  linkHref: string | null;
  headingLevel: number | null;
  canUndo: boolean;
  canRedo: boolean;
}

type EditorBridgeMessage =
  | { type: "loaded" }
  | { type: "ready" }
  | { type: "heightChanged"; height?: unknown }
  | { type: "contentChanged"; contentJson?: unknown; plainText?: unknown }
  | {
      type: "selectionChanged";
      marks?: SelectionState["marks"];
      linkHref?: string | null;
      headingLevel?: number | null;
      canUndo?: boolean;
      canRedo?: boolean;
    }
  | { type: "error"; code?: string; message?: string };

type EditorCommand =
  | {
      type: "init";
      contentJson: JSONValue;
      theme: EditorTheme;
      placeholder?: string;
      readOnly?: boolean;
    }
  | { type: "setContent"; contentJson: JSONValue }
  | { type: "setTheme"; theme: EditorTheme }
  | { type: "runCommand"; command: string; attrs?: Record<string, unknown> };

interface EditorTheme {
  background: string;
  foreground: string;
  card: string;
  border: string;
  muted: string;
  mutedForeground: string;
  primary: string;
}

const MIN_EDITOR_HEIGHT = 260;
const MAX_EDITOR_HEIGHT = 560;
const EDITOR_READY_TIMEOUT_MS = 8000;
const DRAFT_SAVE_DELAY_MS = 650;
const cardIconMap: Record<string, typeof SparklesIcon> = {
  bookQuote: QuoteIcon,
  callout: LightbulbIcon,
  bookMetadata: BookOpenIcon,
  aiSummary: SparklesIcon,
  qa: MessageCirclePlusIcon,
  review: ScrollTextIcon,
  mindmap: BrainIcon,
  mermaid: BrainIcon,
  relatedNotes: BrainIcon,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function parseBridgeMessage(data: string): EditorBridgeMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
    return parsed as EditorBridgeMessage;
  } catch {
    return null;
  }
}

function fingerprintJson(value: JSONValue): string {
  return knowledgeEditorDraftFingerprint(value);
}

function clampEditorHeight(height: number): number {
  return Math.min(Math.max(Math.ceil(height), MIN_EDITOR_HEIGHT), MAX_EDITOR_HEIGHT);
}

export function MobileKnowledgeEditor({
  documentId,
  value,
  onChange,
  placeholder,
  autoFocus = false,
  tier = "knowledge_doc",
  surface,
  isSaved,
}: MobileKnowledgeEditorProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const webViewRef = useRef<WebView>(null);
  const latestValueRef = useRef(value);
  const localFingerprintRef = useRef(fingerprintJson(value.contentJson));
  const baseFingerprintRef = useRef(fingerprintJson(value.contentJson));
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWrittenDraftFingerprintRef = useRef<string | null>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [isBridgeReady, setIsBridgeReady] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [useMarkdownFallback, setUseMarkdownFallback] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<KnowledgeEditorDraft | null>(null);
  const [selection, setSelection] = useState<SelectionState>({
    marks: {},
    linkHref: null,
    headingLevel: null,
    canUndo: false,
    canRedo: false,
  });
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showCardMenu, setShowCardMenu] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
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
    () => builtInReadAnyCards.filter((card) => canInsertCard(card.cardType)),
    [canInsertCard],
  );

  const theme = useMemo<EditorTheme>(
    () => ({
      background: colors.background,
      foreground: colors.foreground,
      card: colors.card,
      border: colors.border,
      muted: colors.muted,
      mutedForeground: colors.mutedForeground,
      primary: colors.primary,
    }),
    [colors],
  );

  const valueFingerprint = useMemo(() => fingerprintJson(value.contentJson), [value.contentJson]);
  const draftKey = useMemo(
    () => (documentId ? createKnowledgeEditorDraftKey(documentId, "mobile") : null),
    [documentId],
  );
  const webViewInstanceKey = useMemo(
    () => `${documentId ?? "knowledge-editor"}-${editorReloadKey}`,
    [documentId, editorReloadKey],
  );
  const previousDraftKeyRef = useRef(draftKey);
  const readyAttemptRef = useRef(webViewInstanceKey);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (previousDraftKeyRef.current === draftKey) return;
    previousDraftKeyRef.current = draftKey;
    baseFingerprintRef.current = valueFingerprint;
    localFingerprintRef.current = valueFingerprint;
    lastWrittenDraftFingerprintRef.current = null;
    setPendingDraft(null);
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
  }, [draftKey, valueFingerprint]);

  useEffect(() => {
    let mounted = true;
    if (!draftKey) return;

    const initialFingerprint = baseFingerprintRef.current;
    const loadDraft = async () => {
      const draft = await loadKnowledgeEditorDraft(draftKey);
      if (!mounted) return;
      if (isKnowledgeEditorDraftRestorable(draft, initialFingerprint)) {
        setPendingDraft(draft);
      } else if (draft) {
        void clearKnowledgeEditorDraft(draftKey);
      }
    };

    void loadDraft();
    return () => {
      mounted = false;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !isSaved) return;
    if (lastWrittenDraftFingerprintRef.current !== valueFingerprint) return;

    lastWrittenDraftFingerprintRef.current = null;
    baseFingerprintRef.current = valueFingerprint;
    setPendingDraft((draft) => (draft?.contentFingerprint === valueFingerprint ? null : draft));
    void clearKnowledgeEditorDraft(draftKey);
  }, [draftKey, isSaved, valueFingerprint]);

  useEffect(() => {
    let mounted = true;
    const loadAsset = async () => {
      try {
        const asset = EDITOR_HTML_ASSET;
        await asset.downloadAsync();
        if (!mounted) return;
        setHtmlUri(asset.localUri || asset.uri);
      } catch (error) {
        console.error("[MobileKnowledgeEditor] Failed to load editor asset:", error);
        if (!mounted) return;
        setErrorMessage(t("notes.knowledgeEditorLoadFailed", "编辑器加载失败"));
        setUseMarkdownFallback(true);
      }
    };
    void loadAsset();
    return () => {
      mounted = false;
    };
  }, [t]);

  useEffect(() => {
    if (!htmlUri || isEditorReady || useMarkdownFallback) return;
    readyAttemptRef.current = webViewInstanceKey;
    const attemptKey = webViewInstanceKey;
    const timeout = setTimeout(() => {
      if (readyAttemptRef.current !== attemptKey) return;
      setErrorMessage(
        (current) =>
          current ?? t("notes.knowledgeEditorTimeout", "编辑器启动超时，可以重试或使用备用编辑器"),
      );
    }, EDITOR_READY_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [htmlUri, isEditorReady, t, useMarkdownFallback, webViewInstanceKey]);

  const scheduleDraftSave = useCallback(
    (nextValue: MobileKnowledgeEditorValue) => {
      if (!draftKey) return;
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);

      const nextFingerprint = fingerprintJson(nextValue.contentJson);
      if (nextFingerprint === baseFingerprintRef.current) {
        lastWrittenDraftFingerprintRef.current = null;
        void clearKnowledgeEditorDraft(draftKey);
        return;
      }

      draftSaveTimerRef.current = setTimeout(() => {
        void saveKnowledgeEditorDraft(draftKey, nextValue, {
          baseFingerprint: baseFingerprintRef.current,
        })
          .then((draft) => {
            lastWrittenDraftFingerprintRef.current = draft.contentFingerprint;
          })
          .catch((error) => {
            console.warn("[MobileKnowledgeEditor] Failed to save editor draft:", error);
          });
      }, DRAFT_SAVE_DELAY_MS);
    },
    [draftKey],
  );

  const retryEditor = useCallback(() => {
    setErrorMessage(null);
    setUseMarkdownFallback(false);
    setIsBridgeReady(false);
    setIsEditorReady(false);
    setEditorReloadKey((key) => key + 1);
    webViewRef.current?.reload();
  }, []);

  const injectCommand = useCallback((command: EditorCommand) => {
    const script = `
      window.__ReadAnyKnowledgeEditor && window.__ReadAnyKnowledgeEditor.receive(${JSON.stringify(command)});
      true;
    `;
    webViewRef.current?.injectJavaScript(script);
  }, []);

  const sendInit = useCallback(() => {
    const current = latestValueRef.current;
    localFingerprintRef.current = fingerprintJson(current.contentJson);
    injectCommand({
      type: "init",
      contentJson: current.contentJson,
      placeholder,
      readOnly: false,
      theme,
    });
    if (autoFocus) {
      injectCommand({ type: "runCommand", command: "focus", attrs: { position: "end" } });
    }
  }, [autoFocus, injectCommand, placeholder, theme]);

  useEffect(() => {
    if (!isBridgeReady) return;
    injectCommand({ type: "setTheme", theme });
  }, [injectCommand, isBridgeReady, theme]);

  useEffect(() => {
    if (!isBridgeReady || !isEditorReady) return;
    if (valueFingerprint === localFingerprintRef.current) return;
    localFingerprintRef.current = valueFingerprint;
    injectCommand({ type: "setContent", contentJson: value.contentJson });
  }, [injectCommand, isBridgeReady, isEditorReady, value.contentJson, valueFingerprint]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case "loaded":
          setIsBridgeReady(true);
          setErrorMessage(null);
          sendInit();
          break;
        case "ready":
          setIsEditorReady(true);
          setErrorMessage(null);
          break;
        case "heightChanged":
          if (typeof message.height === "number" && Number.isFinite(message.height)) {
            setEditorHeight(clampEditorHeight(message.height));
          }
          break;
        case "selectionChanged":
          setSelection({
            marks: message.marks ?? {},
            linkHref: typeof message.linkHref === "string" ? message.linkHref : null,
            headingLevel: typeof message.headingLevel === "number" ? message.headingLevel : null,
            canUndo: message.canUndo === true,
            canRedo: message.canRedo === true,
          });
          break;
        case "contentChanged": {
          if (!isJsonValue(message.contentJson)) return;
          localFingerprintRef.current = fingerprintJson(message.contentJson);
          const nextValue = {
            contentJson: message.contentJson,
            contentMd: renderKnowledgeJsonToMarkdown(message.contentJson),
            plainText: typeof message.plainText === "string" ? message.plainText : "",
          };
          scheduleDraftSave(nextValue);
          onChange(nextValue);
          break;
        }
        case "error":
          console.error("[MobileKnowledgeEditor] WebView error:", message);
          setErrorMessage(message.message || t("notes.knowledgeEditorError", "编辑器出错了"));
          break;
      }
    },
    [onChange, scheduleDraftSave, sendInit, t],
  );

  const runCommand = useCallback(
    (command: string, attrs?: Record<string, unknown>) => {
      injectCommand({ type: "runCommand", command, attrs });
    },
    [injectCommand],
  );

  const restorePendingDraft = useCallback(() => {
    if (!pendingDraft) return;
    const nextValue = pendingDraft.value;
    setPendingDraft(null);
    lastWrittenDraftFingerprintRef.current = pendingDraft.contentFingerprint;
    onChange(nextValue);

    if (isBridgeReady && isEditorReady) {
      localFingerprintRef.current = pendingDraft.contentFingerprint;
      injectCommand({ type: "setContent", contentJson: nextValue.contentJson });
    }
  }, [injectCommand, isBridgeReady, isEditorReady, onChange, pendingDraft]);

  const discardPendingDraft = useCallback(() => {
    if (!draftKey) return;
    setPendingDraft(null);
    lastWrittenDraftFingerprintRef.current = null;
    void clearKnowledgeEditorDraft(draftKey);
  }, [draftKey]);

  const openLinkModal = useCallback(() => {
    if (!canUse("link")) return;
    setLinkUrl(selection.linkHref ?? "");
    setShowLinkModal(true);
  }, [canUse, selection.linkHref]);

  const applyLink = useCallback(() => {
    const href = linkUrl.trim();
    runCommand(href ? "setLink" : "unsetLink", href ? { href } : undefined);
    setShowLinkModal(false);
    setLinkUrl("");
  }, [linkUrl, runCommand]);

  const insertCard = useCallback(
    (cardType: string) => {
      if (!canInsertCard(cardType)) return;
      const definition = builtInReadAnyCards.find((card) => card.cardType === cardType);
      if (!definition) return;
      const title = t(`notes.knowledgeCards.${cardType}`, {
        defaultValue: definition.insertLabel,
      });
      const attrs = createDefaultReadAnyCardAttrs(cardType, {
        title,
        version: definition.version,
      });
      runCommand("insertCard", attrs as Record<string, unknown>);
      setShowCardMenu(false);
    },
    [canInsertCard, runCommand, t],
  );

  const handleFallbackChange = useCallback(
    (markdown: string) => {
      const contentJson = markdownToBasicTiptap(markdown) as unknown as JSONValue;
      const nextValue = {
        contentJson,
        contentMd: markdown,
        plainText: markdown,
      };
      scheduleDraftSave(nextValue);
      onChange(nextValue);
    },
    [onChange, scheduleDraftSave],
  );

  const toolbarGroupCandidates: ({ key: string; node: React.ReactNode } | null)[] = [
    canUse("undo") || canUse("redo")
      ? {
          key: "history",
          node: (
            <Fragment>
              {canUse("undo") ? (
                <ToolbarButton
                  onPress={() => runCommand("undo")}
                  disabled={!selection.canUndo || !isEditorReady}
                  styles={styles}
                >
                  <Undo2Icon size={15} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
              {canUse("redo") ? (
                <ToolbarButton
                  onPress={() => runCommand("redo")}
                  disabled={!selection.canRedo || !isEditorReady}
                  styles={styles}
                >
                  <Redo2Icon size={15} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
            </Fragment>
          ),
        }
      : null,
    canUse("heading1") || canUse("heading2") || canUse("heading3")
      ? {
          key: "headings",
          node: (
            <Fragment>
              {canUse("heading1") ? (
                <ToolbarButton
                  onPress={() => runCommand("heading", { level: 1 })}
                  isActive={selection.headingLevel === 1}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <Heading1Icon
                    size={15}
                    color={selection.headingLevel === 1 ? colors.primary : colors.mutedForeground}
                  />
                </ToolbarButton>
              ) : null}
              {canUse("heading2") ? (
                <ToolbarButton
                  onPress={() => runCommand("heading", { level: 2 })}
                  isActive={selection.headingLevel === 2}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <Heading2Icon
                    size={15}
                    color={selection.headingLevel === 2 ? colors.primary : colors.mutedForeground}
                  />
                </ToolbarButton>
              ) : null}
              {canUse("heading3") ? (
                <ToolbarButton
                  onPress={() => runCommand("heading", { level: 3 })}
                  isActive={selection.headingLevel === 3}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <Heading3Icon
                    size={15}
                    color={selection.headingLevel === 3 ? colors.primary : colors.mutedForeground}
                  />
                </ToolbarButton>
              ) : null}
            </Fragment>
          ),
        }
      : null,
    {
      key: "inline",
      node: (
        <Fragment>
          {canUse("bold") ? (
            <ToolbarButton
              onPress={() => runCommand("bold")}
              isActive={selection.marks.bold}
              disabled={!isEditorReady}
              styles={styles}
            >
              <BoldIcon
                size={15}
                color={selection.marks.bold ? colors.primary : colors.mutedForeground}
              />
            </ToolbarButton>
          ) : null}
          {canUse("italic") ? (
            <ToolbarButton
              onPress={() => runCommand("italic")}
              isActive={selection.marks.italic}
              disabled={!isEditorReady}
              styles={styles}
            >
              <ItalicIcon
                size={15}
                color={selection.marks.italic ? colors.primary : colors.mutedForeground}
              />
            </ToolbarButton>
          ) : null}
          {canUse("strike") ? (
            <ToolbarButton
              onPress={() => runCommand("strike")}
              isActive={selection.marks.strike}
              disabled={!isEditorReady}
              styles={styles}
            >
              <StrikethroughIcon
                size={15}
                color={selection.marks.strike ? colors.primary : colors.mutedForeground}
              />
            </ToolbarButton>
          ) : null}
          {canUse("inlineCode") ? (
            <ToolbarButton
              onPress={() => runCommand("code")}
              isActive={selection.marks.code}
              disabled={!isEditorReady}
              styles={styles}
            >
              <CodeIcon
                size={15}
                color={selection.marks.code ? colors.primary : colors.mutedForeground}
              />
            </ToolbarButton>
          ) : null}
          {canUse("link") ? (
            <ToolbarButton
              onPress={openLinkModal}
              isActive={selection.marks.link}
              disabled={!isEditorReady}
              styles={styles}
            >
              <Link2Icon
                size={15}
                color={selection.marks.link ? colors.primary : colors.mutedForeground}
              />
            </ToolbarButton>
          ) : null}
        </Fragment>
      ),
    },
    canUse("bulletList") ||
    canUse("orderedList") ||
    canUse("blockquote") ||
    canUse("horizontalRule")
      ? {
          key: "blocks",
          node: (
            <Fragment>
              {canUse("bulletList") ? (
                <ToolbarButton
                  onPress={() => runCommand("bulletList")}
                  isActive={selection.marks.bulletList}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <ListIcon
                    size={15}
                    color={selection.marks.bulletList ? colors.primary : colors.mutedForeground}
                  />
                </ToolbarButton>
              ) : null}
              {canUse("orderedList") ? (
                <ToolbarButton
                  onPress={() => runCommand("orderedList")}
                  isActive={selection.marks.orderedList}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <ListOrderedIcon
                    size={15}
                    color={selection.marks.orderedList ? colors.primary : colors.mutedForeground}
                  />
                </ToolbarButton>
              ) : null}
              {canUse("blockquote") ? (
                <ToolbarButton
                  onPress={() => runCommand("blockquote")}
                  isActive={selection.marks.blockquote}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <QuoteIcon
                    size={15}
                    color={selection.marks.blockquote ? colors.primary : colors.mutedForeground}
                  />
                </ToolbarButton>
              ) : null}
              {canUse("horizontalRule") ? (
                <ToolbarButton
                  onPress={() => runCommand("horizontalRule")}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <MinusIcon size={15} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
            </Fragment>
          ),
        }
      : null,
    allowedCards.length > 0
      ? {
          key: "cards",
          node: (
            <ToolbarButton
              onPress={() => setShowCardMenu(true)}
              disabled={!isEditorReady}
              styles={styles}
            >
              <SparklesIcon size={15} color={colors.mutedForeground} />
            </ToolbarButton>
          ),
        }
      : null,
  ];
  const toolbarGroups = toolbarGroupCandidates.filter(
    (group): group is { key: string; node: React.ReactNode } => group !== null,
  );

  if (useMarkdownFallback) {
    return (
      <View style={styles.fallbackWrap}>
        {pendingDraft ? (
          <View style={styles.draftBanner}>
            <View style={styles.draftBannerTextBlock}>
              <Text style={styles.draftBannerTitle}>
                {t("notes.knowledgeEditorDraftFound", "发现未恢复的草稿")}
              </Text>
              <Text style={styles.draftBannerHint}>
                {t("notes.knowledgeEditorDraftHint", "可以恢复上次未保存的编辑内容。")}
              </Text>
            </View>
            <View style={styles.draftBannerActions}>
              <TouchableOpacity
                style={styles.draftGhostButton}
                activeOpacity={0.75}
                onPress={discardPendingDraft}
              >
                <Text style={styles.draftGhostText}>
                  {t("notes.knowledgeEditorDraftDiscard", "丢弃")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.draftPrimaryButton}
                activeOpacity={0.82}
                onPress={restorePendingDraft}
              >
                <Text style={styles.draftPrimaryText}>
                  {t("notes.knowledgeEditorDraftRestore", "恢复")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        <RichTextEditor
          tier={tier}
          surface={surface}
          initialContent={value.contentMd}
          onChange={handleFallbackChange}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbar}
        contentContainerStyle={styles.toolbarContent}
      >
        {toolbarGroups.map((group, index) => (
          <Fragment key={group.key}>
            {index > 0 ? <ToolbarDivider styles={styles} /> : null}
            {group.node}
          </Fragment>
        ))}
      </ScrollView>

      {pendingDraft ? (
        <View style={styles.draftBanner}>
          <View style={styles.draftBannerTextBlock}>
            <Text style={styles.draftBannerTitle}>
              {t("notes.knowledgeEditorDraftFound", "发现未恢复的草稿")}
            </Text>
            <Text style={styles.draftBannerHint}>
              {t("notes.knowledgeEditorDraftHint", "可以恢复上次未保存的编辑内容。")}
            </Text>
          </View>
          <View style={styles.draftBannerActions}>
            <TouchableOpacity
              style={styles.draftGhostButton}
              activeOpacity={0.75}
              onPress={discardPendingDraft}
            >
              <Text style={styles.draftGhostText}>
                {t("notes.knowledgeEditorDraftDiscard", "丢弃")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.draftPrimaryButton}
              activeOpacity={0.82}
              onPress={restorePendingDraft}
            >
              <Text style={styles.draftPrimaryText}>
                {t("notes.knowledgeEditorDraftRestore", "恢复")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={[styles.webViewFrame, { height: editorHeight }]}>
        {!htmlUri ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>
              {t("notes.knowledgeEditorLoading", "正在准备编辑器...")}
            </Text>
          </View>
        ) : (
          <>
            <WebView
              key={webViewInstanceKey}
              ref={webViewRef}
              source={{ uri: htmlUri }}
              style={styles.webView}
              originWhitelist={["*"]}
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              scrollEnabled
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              onMessage={handleMessage}
              onError={(event) => {
                console.error("[MobileKnowledgeEditor] WebView load error:", event.nativeEvent);
                setErrorMessage(t("notes.knowledgeEditorLoadFailed", "编辑器加载失败"));
                setUseMarkdownFallback(true);
              }}
              onContentProcessDidTerminate={() => {
                setErrorMessage(t("notes.knowledgeEditorReloading", "编辑器正在恢复..."));
                setIsBridgeReady(false);
                setIsEditorReady(false);
                setEditorReloadKey((key) => key + 1);
              }}
            />
            {!isEditorReady && (
              <View style={styles.readyOverlay}>
                <ActivityIndicator size="small" color={colors.primary} />
                {errorMessage ? (
                  <>
                    <Text style={styles.readyOverlayText}>{errorMessage}</Text>
                    <View style={styles.readyOverlayActions}>
                      <TouchableOpacity
                        style={styles.readyGhostButton}
                        activeOpacity={0.75}
                        onPress={() => setUseMarkdownFallback(true)}
                      >
                        <Text style={styles.readyGhostText}>
                          {t("notes.knowledgeEditorFallback", "使用备用编辑器")}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.readyPrimaryButton}
                        activeOpacity={0.82}
                        onPress={retryEditor}
                      >
                        <Text style={styles.readyPrimaryText}>
                          {t("notes.knowledgeEditorRetry", "重试")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}
              </View>
            )}
          </>
        )}
      </View>

      {errorMessage && isEditorReady ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <Modal
        visible={showLinkModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLinkModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.linkModal}>
            <Text style={styles.linkModalTitle}>{t("common.insertLink", "插入链接")}</Text>
            <TextInput
              value={linkUrl}
              onChangeText={setLinkUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={t("common.enterLinkUrl", "输入链接地址")}
              placeholderTextColor={colors.mutedForeground}
              style={styles.linkInput}
            />
            <View style={styles.linkActions}>
              <TouchableOpacity
                style={styles.linkGhostButton}
                onPress={() => {
                  setShowLinkModal(false);
                  setLinkUrl("");
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.linkGhostText}>{t("common.cancel", "取消")}</Text>
              </TouchableOpacity>
              {selection.marks.link ? (
                <TouchableOpacity
                  style={styles.linkGhostButton}
                  onPress={() => {
                    runCommand("unsetLink");
                    setShowLinkModal(false);
                    setLinkUrl("");
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.linkDangerText}>{t("common.remove", "移除")}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.linkPrimaryButton}
                onPress={applyLink}
                activeOpacity={0.82}
              >
                <Text style={styles.linkPrimaryText}>{t("common.confirm", "确定")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showCardMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCardMenu(false)}
      >
        <View style={styles.cardSheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowCardMenu(false)}
          />
          <View style={[styles.cardSheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.cardSheetHandle} />
            <View style={styles.cardSheetHeader}>
              <Text style={styles.cardSheetTitle}>
                {t("notes.knowledgeCardPickerTitle", "插入知识卡片")}
              </Text>
              <Text style={styles.cardSheetHint}>
                {t("notes.knowledgeCardPickerHint", "选择一种结构，插入后会随知识文档同步和导出。")}
              </Text>
            </View>
            <ScrollView
              style={styles.cardOptionScroll}
              contentContainerStyle={styles.cardOptionList}
              showsVerticalScrollIndicator={false}
            >
              {allowedCards.map((card) => {
                const Icon = cardIconMap[card.cardType] ?? SparklesIcon;
                return (
                  <TouchableOpacity
                    key={card.cardType}
                    style={styles.cardOption}
                    activeOpacity={0.78}
                    onPress={() => insertCard(card.cardType)}
                  >
                    <View style={styles.cardOptionIcon}>
                      <Icon size={18} color={colors.primary} />
                    </View>
                    <View style={styles.cardOptionText}>
                      <Text style={styles.cardOptionTitle}>
                        {t(`notes.knowledgeCards.${card.cardType}`, {
                          defaultValue: card.insertLabel,
                        })}
                      </Text>
                      <Text style={styles.cardOptionDescription} numberOfLines={2}>
                        {t(`notes.knowledgeCardDescriptions.${card.cardType}`, {
                          defaultValue: "",
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ToolbarButton({
  onPress,
  children,
  styles,
  isActive,
  disabled,
}: {
  onPress: () => void;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
  isActive?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.toolbarButton,
        isActive && styles.toolbarButtonActive,
        disabled && styles.toolbarButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      {children}
    </TouchableOpacity>
  );
}

function ToolbarDivider({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return <View style={styles.toolbarDivider} />;
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      minHeight: MIN_EDITOR_HEIGHT,
      overflow: "hidden",
      borderRadius: radius.lg,
      backgroundColor: colors.background,
    },
    fallbackWrap: {
      minHeight: 360,
      gap: 8,
    },
    toolbar: {
      minHeight: 45,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.muted,
    },
    toolbarContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    toolbarButton: {
      width: 31,
      height: 31,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
    },
    toolbarButtonActive: {
      backgroundColor: withOpacity(colors.primary, 0.12),
    },
    toolbarButtonDisabled: {
      opacity: 0.32,
    },
    toolbarDivider: {
      width: StyleSheet.hairlineWidth,
      height: 20,
      marginHorizontal: 5,
      backgroundColor: colors.border,
    },
    webViewFrame: {
      minHeight: MIN_EDITOR_HEIGHT,
      backgroundColor: colors.background,
    },
    webView: {
      flex: 1,
      backgroundColor: colors.background,
    },
    loadingWrap: {
      flex: 1,
      minHeight: MIN_EDITOR_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    loadingText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      fontWeight: fontWeight.medium,
    },
    readyOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      paddingHorizontal: 22,
      backgroundColor: withOpacity(colors.background, 0.72),
    },
    readyOverlayText: {
      color: colors.foreground,
      fontSize: fontSize.xs,
      lineHeight: 18,
      textAlign: "center",
    },
    readyOverlayActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    readyGhostButton: {
      minHeight: 34,
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
    },
    readyGhostText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    readyPrimaryButton: {
      minHeight: 34,
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: 13,
    },
    readyPrimaryText: {
      color: colors.primaryForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    errorText: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: fontSize.xs,
      lineHeight: 17,
      color: colors.destructive,
      backgroundColor: withOpacity(colors.destructive, 0.08),
    },
    draftBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: withOpacity(colors.primary, 0.08),
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    draftBannerTextBlock: {
      minWidth: 0,
      flex: 1,
      gap: 2,
    },
    draftBannerTitle: {
      color: colors.foreground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    draftBannerHint: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      lineHeight: 16,
    },
    draftBannerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    draftGhostButton: {
      minHeight: 32,
      justifyContent: "center",
      borderRadius: radius.md,
      paddingHorizontal: 9,
    },
    draftGhostText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    draftPrimaryButton: {
      minHeight: 32,
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: 10,
    },
    draftPrimaryText: {
      color: colors.primaryForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
    },
    modalOverlay: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 24,
      backgroundColor: withOpacity("#000000", 0.42),
    },
    linkModal: {
      gap: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      padding: 16,
      shadowColor: "#000000",
      shadowOpacity: 0.16,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    },
    linkModalTitle: {
      color: colors.foreground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    linkInput: {
      minHeight: 44,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      paddingHorizontal: 12,
      color: colors.foreground,
      fontSize: fontSize.sm,
    },
    linkActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: 8,
    },
    linkGhostButton: {
      minHeight: 36,
      justifyContent: "center",
      borderRadius: radius.md,
      paddingHorizontal: 12,
    },
    linkGhostText: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    linkDangerText: {
      color: colors.destructive,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    linkPrimaryButton: {
      minHeight: 36,
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
    },
    linkPrimaryText: {
      color: colors.primaryForeground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    cardSheetOverlay: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: withOpacity("#000000", 0.4),
    },
    cardSheet: {
      maxHeight: "76%",
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: 0,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 16,
      paddingTop: 10,
      shadowColor: "#000000",
      shadowOpacity: 0.18,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -10 },
      elevation: 12,
    },
    cardSheetHandle: {
      alignSelf: "center",
      width: 34,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: withOpacity(colors.mutedForeground, 0.28),
    },
    cardSheetHeader: {
      gap: 5,
      paddingTop: 14,
      paddingBottom: 12,
    },
    cardSheetTitle: {
      color: colors.foreground,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0,
    },
    cardSheetHint: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      lineHeight: 18,
    },
    cardOptionScroll: {
      flexGrow: 0,
    },
    cardOptionList: {
      gap: 8,
      paddingBottom: 2,
    },
    cardOption: {
      minHeight: 66,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.background,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    cardOptionIcon: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    cardOptionText: {
      minWidth: 0,
      flex: 1,
      gap: 3,
    },
    cardOptionTitle: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    cardOptionDescription: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      lineHeight: 17,
    },
  });
