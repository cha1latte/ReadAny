import {
  BoldIcon,
  BookOpenIcon,
  BrainIcon,
  CodeIcon,
  EditIcon,
  HashIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImagePlusIcon,
  ItalicIcon,
  LightbulbIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MessageCirclePlusIcon,
  MinusIcon,
  OctagonXIcon,
  PlusIcon,
  QuoteIcon,
  Redo2Icon,
  ScrollTextIcon,
  SparklesIcon,
  StrikethroughIcon,
  Trash2Icon,
  Undo2Icon,
} from "@/components/ui/Icon";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import {
  disableKnowledgeCardTemplate,
  getKnowledgeCardTemplates,
  upsertKnowledgeCardTemplate,
} from "@readany/core/db/database";
import {
  type KnowledgeEditorFeature,
  type KnowledgeEditorSurface,
  type KnowledgeEditorTier,
  builtInReadAnyCards,
  clearKnowledgeEditorDraft,
  createCustomReadAnyCardTemplate,
  createDefaultReadAnyCardAttrs,
  createKnowledgeEditorDraftKey,
  createReadAnyCardAttrsFromTemplate,
  getKnowledgeEditorFeatureForCardType,
  getKnowledgeEditorProfile,
  getKnowledgeEditorSurfaceProfile,
  getReadAnyCardTemplateDescription,
  getReadAnyCardTemplateInsertLabel,
  hasKnowledgeEditorFeature,
  isKnowledgeEditorDraftRestorable,
  knowledgeEditorDraftFingerprint,
  loadKnowledgeEditorDraft,
  markdownToBasicTiptap,
  normalizeTiptapDocument,
  renderKnowledgeJsonToMarkdown,
  saveKnowledgeEditorDraft,
  updateCustomReadAnyCardTemplate,
} from "@readany/core/knowledge";
import type { KnowledgeEditorDraft } from "@readany/core/knowledge";
import type { JSONValue, KnowledgeCardTemplate } from "@readany/core/types";
import { generateId } from "@readany/core/utils";
import { Asset } from "expo-asset";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
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

function normalizeMobileKnowledgeEditorValue(
  value: MobileKnowledgeEditorValue,
  cardTemplates: KnowledgeCardTemplate[] = [],
): MobileKnowledgeEditorValue {
  const contentJson = normalizeTiptapDocument(value.contentJson, {
    cardTemplates,
  }) as unknown as JSONValue;
  return {
    ...value,
    contentJson,
    contentMd: renderKnowledgeJsonToMarkdown(contentJson, { cardTemplates }),
  };
}

export interface MobileKnowledgeEditorOutlineTarget {
  index: number;
  requestId: number;
}

export interface MobileKnowledgeInternalLinkTarget {
  id: string;
  title: string;
  path?: string;
  targetPath?: string;
  typeLabel?: string;
}

export interface MobileKnowledgeImageInsertAttrs {
  src: string;
  alt?: string;
  title?: string;
  attachmentId?: string;
  fileName?: string;
}

export interface MobileKnowledgeSourceReferenceRequest {
  requestId: number;
  label: string;
  sourceTitle?: string;
  sourceId?: string;
  cfi?: string;
}

interface MobileKnowledgeEditorProps {
  documentId?: string;
  value: MobileKnowledgeEditorValue;
  onChange: (value: MobileKnowledgeEditorValue) => void;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  layout?: "embedded" | "document";
  tier?: KnowledgeEditorTier;
  surface?: KnowledgeEditorSurface;
  isSaved?: boolean;
  outlineTarget?: MobileKnowledgeEditorOutlineTarget | null;
  internalLinkTargets?: MobileKnowledgeInternalLinkTarget[];
  sourceReferenceRequest?: MobileKnowledgeSourceReferenceRequest | null;
  onPickLocalImage?: () => Promise<MobileKnowledgeImageInsertAttrs | null>;
}

interface SelectionState {
  marks: {
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    code?: boolean;
    bulletList?: boolean;
    orderedList?: boolean;
    taskList?: boolean;
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
  | {
      type: "contentChanged";
      requestId?: unknown;
      contentJson?: unknown;
      plainText?: unknown;
    }
  | {
      type: "selectionChanged";
      marks?: SelectionState["marks"];
      linkHref?: string | null;
      headingLevel?: number | null;
      canUndo?: boolean;
      canRedo?: boolean;
    }
  | { type: "focusChanged"; focused?: unknown }
  | { type: "error"; code?: string; message?: string };

type EditorIssueKind = "asset" | "timeout" | "bridge" | "webview" | "process";

interface EditorIssue {
  kind: EditorIssueKind;
  code?: string;
  message: string;
}

interface BridgeParseResult {
  message: EditorBridgeMessage | null;
  error?: "invalid_json" | "missing_type";
}

type EditorCommand =
  | {
      type: "init";
      contentJson: JSONValue;
      theme: EditorTheme;
      placeholder?: string;
      cardBodyPlaceholder?: string;
      cardConvertToTextLabel?: string;
      imageUnavailableTitle?: string;
      imageUnavailableHint?: string;
      readOnly?: boolean;
    }
  | { type: "setContent"; contentJson: JSONValue }
  | { type: "focus"; position?: "start" | "end" }
  | { type: "blur" }
  | { type: "setEditable"; editable: boolean }
  | { type: "setTheme"; theme: EditorTheme }
  | { type: "requestContent"; requestId: string }
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

interface InsertableCardItem {
  key: string;
  cardType: string;
  insertLabel: string;
  description?: string;
  template?: KnowledgeCardTemplate;
  createAttrs: () => Record<string, unknown>;
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
  aiToolFailure: OctagonXIcon,
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

function parseBridgeMessage(data: string): BridgeParseResult {
  try {
    const parsed = JSON.parse(data);
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      return { message: null, error: "missing_type" };
    }
    return { message: parsed as EditorBridgeMessage };
  } catch {
    return { message: null, error: "invalid_json" };
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
  readOnly = false,
  layout = "embedded",
  tier = "knowledge_doc",
  surface,
  isSaved,
  outlineTarget,
  internalLinkTargets = [],
  sourceReferenceRequest,
  onPickLocalImage,
}: MobileKnowledgeEditorProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const isDocumentLayout = layout === "document";
  const [cardTemplates, setCardTemplates] = useState<KnowledgeCardTemplate[]>([]);
  const normalizedContentJson = useMemo(
    () =>
      normalizeTiptapDocument(value.contentJson, {
        cardTemplates,
      }) as unknown as JSONValue,
    [cardTemplates, value.contentJson],
  );
  const normalizedContentMd = useMemo(
    () => renderKnowledgeJsonToMarkdown(normalizedContentJson, { cardTemplates }),
    [cardTemplates, normalizedContentJson],
  );
  const normalizedValue = useMemo(
    () => ({
      contentJson: normalizedContentJson,
      contentMd: normalizedContentMd,
      plainText: value.plainText,
    }),
    [normalizedContentJson, normalizedContentMd, value.plainText],
  );
  const webViewRef = useRef<WebView>(null);
  const latestValueRef = useRef(normalizedValue);
  const localFingerprintRef = useRef(fingerprintJson(normalizedValue.contentJson));
  const baseFingerprintRef = useRef(fingerprintJson(normalizedValue.contentJson));
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWrittenDraftFingerprintRef = useRef<string | null>(null);
  const handledSourceReferenceRequestIdRef = useRef<number | null>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [isBridgeReady, setIsBridgeReady] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const [editorReloadKey, setEditorReloadKey] = useState(0);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const [editorIssue, setEditorIssue] = useState<EditorIssue | null>(null);
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
  const [showInternalLinkModal, setShowInternalLinkModal] = useState(false);
  const [showBlockInsertMenu, setShowBlockInsertMenu] = useState(false);
  const [showCardMenu, setShowCardMenu] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [internalLinkQuery, setInternalLinkQuery] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [isPickingLocalImage, setIsPickingLocalImage] = useState(false);
  const [isTemplateFormOpen, setIsTemplateFormOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateMarkdown, setTemplateMarkdown] = useState("");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const errorMessage = editorIssue?.message ?? null;
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
            }) as Record<string, unknown>,
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
          template,
          createAttrs: () =>
            createReadAnyCardAttrsFromTemplate(template) as Record<string, unknown>,
        })),
    ],
    [canInsertCard, cardTemplates, t],
  );
  const visibleInternalLinkTargets = useMemo(() => {
    const query = internalLinkQuery.trim().toLowerCase();
    const source = query
      ? internalLinkTargets.filter((target) =>
          [target.title, target.path ?? "", target.typeLabel ?? "", target.id]
            .join(" ")
            .toLowerCase()
            .includes(query),
        )
      : internalLinkTargets;
    return source.slice(0, 10);
  }, [internalLinkQuery, internalLinkTargets]);

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

  const valueFingerprint = useMemo(
    () => fingerprintJson(normalizedValue.contentJson),
    [normalizedValue.contentJson],
  );
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
    latestValueRef.current = normalizedValue;
  }, [normalizedValue]);

  useEffect(() => {
    if (readOnly || fingerprintJson(value.contentJson) === valueFingerprint) return;
    localFingerprintRef.current = valueFingerprint;
    onChange(normalizedValue);
  }, [normalizedValue, onChange, readOnly, value.contentJson, valueFingerprint]);

  useEffect(() => {
    let mounted = true;
    void getKnowledgeCardTemplates()
      .then((templates) => {
        if (mounted) setCardTemplates(templates.filter((template) => !template.builtIn));
      })
      .catch((error) => {
        console.warn("[MobileKnowledgeEditor] Failed to load card templates:", error);
      });

    return () => {
      mounted = false;
    };
  }, []);

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
    if (!draftKey || readOnly) {
      setPendingDraft(null);
      return;
    }

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
  }, [draftKey, readOnly]);

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
        setEditorIssue({
          kind: "asset",
          message: t("notes.knowledgeEditorLoadFailed", "编辑器加载失败"),
        });
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
      setEditorIssue((current) =>
        current
          ? current
          : {
              kind: "timeout",
              code: "editor_ready_timeout",
              message: t(
                "notes.knowledgeEditorTimeout",
                "编辑器启动超时，可以重试或使用备用编辑器",
              ),
            },
      );
    }, EDITOR_READY_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [htmlUri, isEditorReady, t, useMarkdownFallback, webViewInstanceKey]);

  const scheduleDraftSave = useCallback(
    (nextValue: MobileKnowledgeEditorValue) => {
      if (readOnly || !draftKey) return;
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
    [draftKey, readOnly],
  );

  const retryEditor = useCallback(() => {
    setEditorIssue(null);
    setUseMarkdownFallback(false);
    setIsBridgeReady(false);
    setIsEditorReady(false);
    setIsEditorFocused(false);
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
      cardBodyPlaceholder: t("notes.knowledgeCardBodyPlaceholder", "直接在卡片里书写..."),
      cardConvertToTextLabel: t("notes.knowledgeCardConvertToText", "转成普通正文"),
      imageUnavailableTitle: t(
        "notes.knowledgeAttachmentUnavailable",
        "图片附件暂时无法在这台设备显示。",
      ),
      imageUnavailableHint: t(
        "notes.knowledgeAttachmentUnavailableHint",
        "重新同步，或让原设备保持在线后再试。",
      ),
      readOnly,
      theme,
    });
    if (autoFocus && !readOnly) {
      injectCommand({ type: "focus", position: "end" });
    }
  }, [autoFocus, injectCommand, placeholder, readOnly, t, theme]);

  useEffect(() => {
    if (!isBridgeReady) return;
    injectCommand({ type: "setTheme", theme });
  }, [injectCommand, isBridgeReady, theme]);

  useEffect(() => {
    if (!isBridgeReady || !isEditorReady) return;
    injectCommand({ type: "setEditable", editable: !readOnly });
    if (readOnly) {
      injectCommand({ type: "blur" });
      setShowBlockInsertMenu(false);
      setShowCardMenu(false);
      setShowImageModal(false);
      setShowInternalLinkModal(false);
      setShowLinkModal(false);
      setIsTemplateFormOpen(false);
    }
  }, [injectCommand, isBridgeReady, isEditorReady, readOnly]);

  useEffect(() => {
    if (!isBridgeReady || !isEditorReady) return;
    if (valueFingerprint === localFingerprintRef.current) return;
    localFingerprintRef.current = valueFingerprint;
    injectCommand({ type: "setContent", contentJson: normalizedValue.contentJson });
  }, [injectCommand, isBridgeReady, isEditorReady, normalizedValue.contentJson, valueFingerprint]);

  useEffect(() => {
    if (!outlineTarget || !isBridgeReady || !isEditorReady || useMarkdownFallback) return;
    injectCommand({
      type: "runCommand",
      command: "scrollToOutline",
      attrs: { index: outlineTarget.index },
    });
  }, [injectCommand, isBridgeReady, isEditorReady, outlineTarget, useMarkdownFallback]);

  useEffect(() => {
    if (
      readOnly ||
      !sourceReferenceRequest ||
      !isBridgeReady ||
      !isEditorReady ||
      useMarkdownFallback
    ) {
      return;
    }
    if (handledSourceReferenceRequestIdRef.current === sourceReferenceRequest.requestId) return;
    const label = sourceReferenceRequest.label.trim();
    if (!label) return;
    handledSourceReferenceRequestIdRef.current = sourceReferenceRequest.requestId;
    injectCommand({
      type: "runCommand",
      command: "insertSourceReference",
      attrs: {
        label,
        sourceTitle: sourceReferenceRequest.sourceTitle?.trim() || label,
        sourceId: sourceReferenceRequest.sourceId?.trim() || null,
        cfi: sourceReferenceRequest.cfi?.trim() || null,
      },
    });
  }, [
    injectCommand,
    isBridgeReady,
    isEditorReady,
    readOnly,
    sourceReferenceRequest,
    useMarkdownFallback,
  ]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const { message, error } = parseBridgeMessage(event.nativeEvent.data);
      if (!message) {
        if (error) {
          console.error("[MobileKnowledgeEditor] Invalid bridge message:", {
            error,
            data: event.nativeEvent.data.slice(0, 160),
          });
          setEditorIssue({
            kind: "bridge",
            code: `bridge_${error}`,
            message: t(
              "notes.knowledgeEditorBridgeError",
              "编辑器通信异常，可以重试或使用备用编辑器",
            ),
          });
        }
        return;
      }

      switch (message.type) {
        case "loaded":
          setIsBridgeReady(true);
          setEditorIssue(null);
          sendInit();
          break;
        case "ready":
          setIsEditorReady(true);
          setEditorIssue(null);
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
          if (readOnly) return;
          if (!isJsonValue(message.contentJson)) {
            console.error("[MobileKnowledgeEditor] Invalid contentChanged payload:", message);
            setEditorIssue({
              kind: "bridge",
              code: "bridge_invalid_content",
              message: t(
                "notes.knowledgeEditorBridgeError",
                "编辑器通信异常，可以重试或使用备用编辑器",
              ),
            });
            return;
          }
          const contentJson = normalizeTiptapDocument(message.contentJson, {
            cardTemplates,
          }) as unknown as JSONValue;
          localFingerprintRef.current = fingerprintJson(contentJson);
          const nextValue = {
            contentJson,
            contentMd: renderKnowledgeJsonToMarkdown(contentJson, { cardTemplates }),
            plainText: typeof message.plainText === "string" ? message.plainText : "",
          };
          scheduleDraftSave(nextValue);
          onChange(nextValue);
          break;
        }
        case "focusChanged":
          setIsEditorFocused(message.focused === true);
          break;
        case "error":
          console.error("[MobileKnowledgeEditor] WebView error:", message);
          setEditorIssue({
            kind: "bridge",
            code: message.code,
            message:
              message.message ||
              t("notes.knowledgeEditorBridgeError", "编辑器通信异常，可以重试或使用备用编辑器"),
          });
          break;
      }
    },
    [cardTemplates, onChange, readOnly, scheduleDraftSave, sendInit, t],
  );

  const runCommand = useCallback(
    (command: string, attrs?: Record<string, unknown>) => {
      if (readOnly) return;
      injectCommand({ type: "runCommand", command, attrs });
    },
    [injectCommand, readOnly],
  );

  const restorePendingDraft = useCallback(() => {
    if (readOnly || !pendingDraft) return;
    const nextValue = normalizeMobileKnowledgeEditorValue(pendingDraft.value, cardTemplates);
    setPendingDraft(null);
    const nextFingerprint = fingerprintJson(nextValue.contentJson);
    lastWrittenDraftFingerprintRef.current = nextFingerprint;
    onChange(nextValue);

    if (isBridgeReady && isEditorReady) {
      localFingerprintRef.current = nextFingerprint;
      injectCommand({ type: "setContent", contentJson: nextValue.contentJson });
    }
  }, [
    cardTemplates,
    injectCommand,
    isBridgeReady,
    isEditorReady,
    onChange,
    pendingDraft,
    readOnly,
  ]);

  const discardPendingDraft = useCallback(() => {
    if (!draftKey) return;
    setPendingDraft(null);
    lastWrittenDraftFingerprintRef.current = null;
    void clearKnowledgeEditorDraft(draftKey);
  }, [draftKey]);

  const openLinkModal = useCallback(() => {
    if (readOnly || !canUse("link")) return;
    setLinkUrl(selection.linkHref ?? "");
    setShowLinkModal(true);
  }, [canUse, readOnly, selection.linkHref]);

  const applyLink = useCallback(() => {
    const href = linkUrl.trim();
    runCommand(href ? "setLink" : "unsetLink", href ? { href } : undefined);
    setShowLinkModal(false);
    setLinkUrl("");
  }, [linkUrl, runCommand]);

  const insertInternalLink = useCallback(
    (target?: MobileKnowledgeInternalLinkTarget) => {
      if (readOnly || !canUse("internalLink")) return;
      const label = (target?.title ?? internalLinkQuery).trim();
      if (!label) return;
      runCommand("insertInternalLink", {
        label,
        title: label,
        ...(target?.id ? { documentId: target.id } : {}),
        ...(target?.targetPath ? { targetPath: target.targetPath } : {}),
      });
      setShowInternalLinkModal(false);
      setInternalLinkQuery("");
    },
    [canUse, internalLinkQuery, readOnly, runCommand],
  );

  const openImageModal = useCallback(() => {
    if (readOnly || !canUse("image")) return;
    setImageUrl("");
    setImageAlt("");
    setShowBlockInsertMenu(false);
    setShowImageModal(true);
  }, [canUse, readOnly]);

  const insertImageAttrs = useCallback(
    (attrs: MobileKnowledgeImageInsertAttrs) => {
      const src = attrs.src.trim();
      if (!src) return;
      runCommand("insertImage", {
        src,
        alt: attrs.alt?.trim() ?? "",
        title: attrs.title?.trim() ?? "",
        attachmentId: attrs.attachmentId?.trim() ?? "",
        fileName: attrs.fileName?.trim() ?? "",
      });
      setShowImageModal(false);
      setImageUrl("");
      setImageAlt("");
    },
    [runCommand],
  );

  const applyImage = useCallback(() => {
    const src = imageUrl.trim();
    if (!src) return;
    insertImageAttrs({ src, alt: imageAlt });
  }, [imageAlt, imageUrl, insertImageAttrs]);

  const pickLocalImage = useCallback(async () => {
    if (readOnly || !onPickLocalImage || isPickingLocalImage) return;
    setIsPickingLocalImage(true);
    try {
      const attrs = await onPickLocalImage();
      if (attrs) insertImageAttrs(attrs);
    } finally {
      setIsPickingLocalImage(false);
    }
  }, [insertImageAttrs, isPickingLocalImage, onPickLocalImage, readOnly]);

  const insertCard = useCallback(
    (card: InsertableCardItem) => {
      if (!canInsertCard(card.cardType)) return;
      runCommand("insertCard", card.createAttrs());
      setShowCardMenu(false);
      setShowBlockInsertMenu(false);
    },
    [canInsertCard, runCommand],
  );

  const resetTemplateForm = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateName("");
    setTemplateDescription("");
    setTemplateMarkdown("");
    setTemplateSaveError(null);
  }, []);

  const openNewTemplateForm = useCallback(() => {
    if (readOnly) return;
    resetTemplateForm();
    setIsTemplateFormOpen(true);
  }, [readOnly, resetTemplateForm]);

  const openTemplateEditForm = useCallback((template: KnowledgeCardTemplate) => {
    if (readOnly) return;
    const attrs = createReadAnyCardAttrsFromTemplate(template);
    setEditingTemplateId(template.id);
    setTemplateName(getReadAnyCardTemplateInsertLabel(template));
    setTemplateDescription(getReadAnyCardTemplateDescription(template) ?? "");
    setTemplateMarkdown((attrs.markdown ?? attrs.text ?? "") as string);
    setTemplateSaveError(null);
    setIsTemplateFormOpen(true);
  }, [readOnly]);

  const saveTemplate = useCallback(async () => {
    if (readOnly || !canUse("readAnyCards") || isSavingTemplate) return;
    const name = templateName.trim();
    if (!name) return;

    setIsSavingTemplate(true);
    setTemplateSaveError(null);
    try {
      const editingTemplate = editingTemplateId
        ? cardTemplates.find((template) => template.id === editingTemplateId)
        : null;
      if (editingTemplateId && !editingTemplate) {
        throw new Error(t("notes.knowledgeCustomCardMissing", "这个自定义卡片模板已经不存在"));
      }
      const template = editingTemplate
        ? updateCustomReadAnyCardTemplate({
            template: editingTemplate,
            name,
            description: templateDescription,
            markdown: templateMarkdown,
          })
        : createCustomReadAnyCardTemplate({
            id: `card-template-${generateId()}`,
            name,
            description: templateDescription,
            markdown: templateMarkdown,
          });

      await upsertKnowledgeCardTemplate(template);
      setCardTemplates((current) =>
        [...current.filter((item) => item.id !== template.id), template].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
      if (!editingTemplate) {
        runCommand(
          "insertCard",
          createReadAnyCardAttrsFromTemplate(template) as Record<string, unknown>,
        );
        setShowCardMenu(false);
        setShowBlockInsertMenu(false);
      }
      resetTemplateForm();
      setIsTemplateFormOpen(false);
    } catch (error) {
      console.warn("[MobileKnowledgeEditor] Failed to save card template:", error);
      setTemplateSaveError(
        error instanceof Error
          ? error.message
          : t("notes.knowledgeCustomCardCreateFailed", "保存自定义卡片失败"),
      );
    } finally {
      setIsSavingTemplate(false);
    }
  }, [
    canUse,
    cardTemplates,
    editingTemplateId,
    isSavingTemplate,
    readOnly,
    resetTemplateForm,
    runCommand,
    t,
    templateDescription,
    templateMarkdown,
    templateName,
  ]);
  const disableTemplate = useCallback(
    (template: KnowledgeCardTemplate) => {
      if (readOnly) return;
      Alert.alert(
        t("notes.knowledgeCustomCardDisable", "移除自定义卡片"),
        t(
          "notes.knowledgeCustomCardDisableConfirm",
          `从插入菜单移除「${template.name}」？已经插入到文档里的卡片不会变化。`,
          { name: template.name },
        ),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("common.confirm", "确认"),
            style: "destructive",
            onPress: () => {
              void (async () => {
                try {
                  await disableKnowledgeCardTemplate(template.id);
                  setCardTemplates((current) =>
                    current.filter((item) => item.id !== template.id),
                  );
                  if (editingTemplateId === template.id) {
                    resetTemplateForm();
                    setIsTemplateFormOpen(false);
                  }
                } catch (error) {
                  console.warn("[MobileKnowledgeEditor] Failed to disable card template:", error);
                  setTemplateSaveError(
                    error instanceof Error
                      ? error.message
                      : t("notes.knowledgeCustomCardDisableFailed", "移除自定义卡片失败"),
                  );
                }
              })();
            },
          },
        ],
      );
    },
    [editingTemplateId, readOnly, resetTemplateForm, t],
  );

  const handleFallbackChange = useCallback(
    (markdown: string) => {
      if (readOnly) return;
      const contentJson = markdownToBasicTiptap(markdown, {
        cardTemplates,
      }) as unknown as JSONValue;
      const nextValue = {
        contentJson,
        contentMd: markdown,
        plainText: markdown,
      };
      scheduleDraftSave(nextValue);
      onChange(nextValue);
    },
    [cardTemplates, onChange, readOnly, scheduleDraftSave],
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
          {canUse("internalLink") ? (
            <ToolbarButton
              onPress={() => {
                setInternalLinkQuery("");
                setShowInternalLinkModal(true);
              }}
              disabled={!isEditorReady}
              styles={styles}
            >
              <HashIcon size={15} color={colors.mutedForeground} />
            </ToolbarButton>
          ) : null}
        </Fragment>
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
              {canUse("taskList") ? (
                <ToolbarButton
                  onPress={() => runCommand("taskList")}
                  isActive={selection.marks.taskList}
                  disabled={!isEditorReady}
                  styles={styles}
                >
                  <ListTodoIcon
                    size={15}
                    color={selection.marks.taskList ? colors.primary : colors.mutedForeground}
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
            <Fragment>
              {canUse("image") ? (
                <ToolbarButton onPress={openImageModal} disabled={!isEditorReady} styles={styles}>
                  <ImagePlusIcon size={15} color={colors.mutedForeground} />
                </ToolbarButton>
              ) : null}
              <ToolbarButton
                onPress={() => setShowCardMenu(true)}
                disabled={!isEditorReady}
                styles={styles}
              >
                <SparklesIcon size={15} color={colors.mutedForeground} />
              </ToolbarButton>
            </Fragment>
          ),
        }
      : canUse("image")
        ? {
            key: "media",
            node: (
              <ToolbarButton onPress={openImageModal} disabled={!isEditorReady} styles={styles}>
                <ImagePlusIcon size={15} color={colors.mutedForeground} />
              </ToolbarButton>
            ),
          }
        : null,
  ];
  const toolbarGroups = readOnly
    ? []
    : toolbarGroupCandidates.filter(
        (group): group is { key: string; node: React.ReactNode } => group !== null,
      );
  const hasBlockInsertItems =
    canUse("heading1") ||
    canUse("heading2") ||
    canUse("bulletList") ||
    canUse("taskList") ||
    canUse("blockquote") ||
    canUse("codeBlock") ||
    canUse("horizontalRule") ||
    canUse("image") ||
    allowedCards.length > 0;

  if (useMarkdownFallback) {
    return (
      <View style={[styles.fallbackWrap, isDocumentLayout && styles.fallbackWrapDocument]}>
        {!readOnly && pendingDraft ? (
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
        {editorIssue ? (
          <EditorIssueBanner issue={editorIssue} fallbackActive styles={styles} />
        ) : null}
        {readOnly ? (
          <ScrollView
            style={styles.readOnlyFallback}
            contentContainerStyle={styles.readOnlyFallbackContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.readOnlyFallbackText}>
              {normalizedValue.plainText || normalizedValue.contentMd}
            </Text>
          </ScrollView>
        ) : (
          <RichTextEditor
            tier={tier}
            surface={surface}
            initialContent={value.contentMd}
            onChange={handleFallbackChange}
            placeholder={placeholder}
            autoFocus={autoFocus}
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, isDocumentLayout && styles.documentContainer]}>
      {toolbarGroups.length > 0 || (!readOnly && hasBlockInsertItems) ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.toolbar}
          contentContainerStyle={styles.toolbarContent}
        >
          {!readOnly && hasBlockInsertItems ? (
            <>
              <ToolbarButton
                onPress={() => setShowBlockInsertMenu(true)}
                disabled={!isEditorReady}
                styles={styles}
              >
                <PlusIcon size={15} color={colors.primary} />
              </ToolbarButton>
              <ToolbarDivider styles={styles} />
            </>
          ) : null}
          {toolbarGroups.map((group, index) => (
            <Fragment key={group.key}>
              {index > 0 ? <ToolbarDivider styles={styles} /> : null}
              {group.node}
            </Fragment>
          ))}
        </ScrollView>
      ) : null}

      {!readOnly && pendingDraft ? (
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

      <View
        style={[
          styles.webViewFrame,
          isDocumentLayout ? styles.webViewFrameDocument : { height: editorHeight },
          isEditorFocused && styles.webViewFrameFocused,
        ]}
      >
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
                setEditorIssue({
                  kind: "webview",
                  code: event.nativeEvent.code ? String(event.nativeEvent.code) : undefined,
                  message: t("notes.knowledgeEditorLoadFailed", "编辑器加载失败"),
                });
                setIsEditorFocused(false);
                setUseMarkdownFallback(true);
              }}
              onContentProcessDidTerminate={() => {
                setEditorIssue({
                  kind: "process",
                  code: "content_process_terminated",
                  message: t("notes.knowledgeEditorReloading", "编辑器正在恢复..."),
                });
                setIsBridgeReady(false);
                setIsEditorReady(false);
                setIsEditorFocused(false);
                setEditorReloadKey((key) => key + 1);
              }}
            />
            {!isEditorReady && (
              <View style={styles.readyOverlay}>
                <ActivityIndicator size="small" color={colors.primary} />
                {errorMessage ? (
                  <>
                    <Text style={styles.readyOverlayText}>{errorMessage}</Text>
                    {editorIssue?.code ? (
                      <Text style={styles.readyOverlayCode}>
                        {t("notes.knowledgeEditorErrorCode", {
                          code: editorIssue.code,
                          defaultValue: `Code: ${editorIssue.code}`,
                        })}
                      </Text>
                    ) : null}
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

      {editorIssue && isEditorReady ? (
        <EditorIssueBanner issue={editorIssue} styles={styles} />
      ) : null}

      <Modal
        visible={showBlockInsertMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowBlockInsertMenu(false)}
      >
        <View style={styles.cardSheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowBlockInsertMenu(false)}
          />
          <View style={[styles.cardSheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.cardSheetHandle} />
            <View style={styles.cardSheetHeader}>
              <Text style={styles.cardSheetTitle}>{t("notes.knowledgeInsertBlock", "插入块")}</Text>
              <Text style={styles.cardSheetHint}>
                {t("notes.knowledgeInsertBlockHint", "插入标题、列表、引用、图片或知识卡片。")}
              </Text>
            </View>
            <ScrollView
              style={styles.cardOptionScroll}
              contentContainerStyle={styles.cardOptionList}
              showsVerticalScrollIndicator={false}
            >
              {canUse("heading1") ? (
                <BlockSheetOption
                  icon={<Heading1Icon size={18} color={colors.primary} />}
                  title={t("editor.heading1", "一级标题")}
                  hint={t("notes.knowledgeInsertHeadingHint", "开始一个章节")}
                  styles={styles}
                  onPress={() => {
                    runCommand("heading", { level: 1 });
                    setShowBlockInsertMenu(false);
                  }}
                />
              ) : null}
              {canUse("heading2") ? (
                <BlockSheetOption
                  icon={<Heading2Icon size={18} color={colors.primary} />}
                  title={t("editor.heading2", "二级标题")}
                  hint={t("notes.knowledgeInsertSubheadingHint", "拆出一个小节")}
                  styles={styles}
                  onPress={() => {
                    runCommand("heading", { level: 2 });
                    setShowBlockInsertMenu(false);
                  }}
                />
              ) : null}
              {canUse("bulletList") ? (
                <BlockSheetOption
                  icon={<ListIcon size={18} color={colors.primary} />}
                  title={t("editor.bulletList", "无序列表")}
                  hint={t("notes.knowledgeInsertListHint", "整理要点")}
                  styles={styles}
                  onPress={() => {
                    runCommand("bulletList");
                    setShowBlockInsertMenu(false);
                  }}
                />
              ) : null}
              {canUse("taskList") ? (
                <BlockSheetOption
                  icon={<ListTodoIcon size={18} color={colors.primary} />}
                  title={t("editor.taskList", "任务列表")}
                  hint={t("notes.knowledgeInsertTaskHint", "记录后续阅读动作")}
                  styles={styles}
                  onPress={() => {
                    runCommand("taskList");
                    setShowBlockInsertMenu(false);
                  }}
                />
              ) : null}
              {canUse("blockquote") ? (
                <BlockSheetOption
                  icon={<QuoteIcon size={18} color={colors.primary} />}
                  title={t("editor.blockquote", "引用")}
                  hint={t("notes.knowledgeInsertQuoteHint", "突出想法或引文")}
                  styles={styles}
                  onPress={() => {
                    runCommand("blockquote");
                    setShowBlockInsertMenu(false);
                  }}
                />
              ) : null}
              {canUse("codeBlock") ? (
                <BlockSheetOption
                  icon={<CodeIcon size={18} color={colors.primary} />}
                  title={t("editor.codeBlock", "代码块")}
                  hint={t("notes.knowledgeInsertCodeBlockHint", "记录代码、提示词或结构化片段")}
                  styles={styles}
                  onPress={() => {
                    runCommand("codeBlock");
                    setShowBlockInsertMenu(false);
                  }}
                />
              ) : null}
              {canUse("horizontalRule") ? (
                <BlockSheetOption
                  icon={<MinusIcon size={18} color={colors.primary} />}
                  title={t("editor.horizontalRule", "分割线")}
                  hint={t("notes.knowledgeInsertDividerHint", "分隔两个段落")}
                  styles={styles}
                  onPress={() => {
                    runCommand("horizontalRule");
                    setShowBlockInsertMenu(false);
                  }}
                />
              ) : null}
              {canUse("image") ? (
                <BlockSheetOption
                  icon={<ImagePlusIcon size={18} color={colors.primary} />}
                  title={t("notes.knowledgeInsertImage", "插入图片")}
                  hint={t("notes.knowledgeInsertImageHint", "添加可同步的图片附件")}
                  styles={styles}
                  onPress={openImageModal}
                />
              ) : null}
              {allowedCards.length > 0 ? (
                <>
                  {allowedCards.slice(0, 4).map((card) => {
                    const Icon = cardIconMap[card.cardType] ?? SparklesIcon;
                    return (
                      <BlockSheetOption
                        key={card.key}
                        icon={<Icon size={18} color={colors.primary} />}
                        title={card.insertLabel}
                        hint={card.description || t("notes.knowledgeInsertCard", "插入卡片")}
                        styles={styles}
                        onPress={() => insertCard(card)}
                      />
                    );
                  })}
                  {allowedCards.length > 4 ? (
                    <BlockSheetOption
                      icon={<SparklesIcon size={18} color={colors.primary} />}
                      title={t("notes.knowledgeCardPickerTitle", "插入知识卡片")}
                      hint={t(
                        "notes.knowledgeCardPickerHint",
                        "选择一种结构，插入后会随知识文档同步和导出。",
                      )}
                      styles={styles}
                      onPress={() => {
                        setShowBlockInsertMenu(false);
                        setShowCardMenu(true);
                      }}
                    />
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showLinkModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLinkModal(false)}
      >
        <View style={styles.cardSheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              setShowLinkModal(false);
              setLinkUrl("");
            }}
          />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View
              style={[
                styles.cardSheet,
                styles.inputSheet,
                { paddingBottom: Math.max(insets.bottom, 14) },
              ]}
            >
              <View style={styles.cardSheetHandle} />
              <View style={styles.cardSheetHeader}>
                <Text style={styles.cardSheetTitle}>{t("common.insertLink", "插入链接")}</Text>
                <Text style={styles.cardSheetHint}>{t("common.enterLinkUrl", "输入链接地址")}</Text>
              </View>
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
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={showInternalLinkModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInternalLinkModal(false)}
      >
        <View style={styles.cardSheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              setShowInternalLinkModal(false);
              setInternalLinkQuery("");
            }}
          />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View
              style={[
                styles.cardSheet,
                styles.inputSheet,
                { paddingBottom: Math.max(insets.bottom, 14) },
              ]}
            >
              <View style={styles.cardSheetHandle} />
              <View style={styles.cardSheetHeader}>
                <Text style={styles.cardSheetTitle}>
                  {t("notes.knowledgeInsertInternalLink", "插入内部链接")}
                </Text>
                <Text style={styles.cardSheetHint}>
                  {t("notes.knowledgeInternalLinkHint", "连接到当前知识库里的另一篇文档")}
                </Text>
              </View>
              <TextInput
                value={internalLinkQuery}
                onChangeText={setInternalLinkQuery}
                placeholder={t(
                  "notes.knowledgeInternalLinkSearchPlaceholder",
                  "搜索文档或输入标题",
                )}
                placeholderTextColor={colors.mutedForeground}
                style={styles.linkInput}
                returnKeyType="done"
                onSubmitEditing={() => insertInternalLink(visibleInternalLinkTargets[0])}
              />
              <ScrollView
                style={styles.internalLinkResultScroll}
                contentContainerStyle={styles.internalLinkResultList}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {visibleInternalLinkTargets.map((target) => (
                  <TouchableOpacity
                    key={target.id}
                    activeOpacity={0.78}
                    style={styles.internalLinkResult}
                    onPress={() => insertInternalLink(target)}
                  >
                    <View style={styles.internalLinkResultIcon}>
                      <HashIcon size={14} color={colors.primary} />
                    </View>
                    <View style={styles.internalLinkResultText}>
                      <Text style={styles.internalLinkResultTitle} numberOfLines={1}>
                        {target.title}
                      </Text>
                      <Text style={styles.internalLinkResultMeta} numberOfLines={1}>
                        {[target.typeLabel, target.path].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {internalLinkQuery.trim() ? (
                  <TouchableOpacity
                    activeOpacity={0.78}
                    style={[styles.internalLinkResult, styles.internalLinkLooseResult]}
                    onPress={() => insertInternalLink()}
                  >
                    <View style={styles.internalLinkResultIcon}>
                      <HashIcon size={14} color={colors.mutedForeground} />
                    </View>
                    <View style={styles.internalLinkResultText}>
                      <Text style={styles.internalLinkResultTitle} numberOfLines={1}>
                        {t("notes.knowledgeInsertLooseInternalLink", {
                          title: internalLinkQuery.trim(),
                        })}
                      </Text>
                      <Text style={styles.internalLinkResultMeta} numberOfLines={1}>
                        {t("notes.knowledgeInternalLinkLooseHint", "作为 Obsidian 风格链接保留")}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
              <View style={styles.linkActions}>
                <TouchableOpacity
                  style={styles.linkGhostButton}
                  onPress={() => {
                    setShowInternalLinkModal(false);
                    setInternalLinkQuery("");
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.linkGhostText}>{t("common.cancel", "取消")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        visible={showImageModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowImageModal(false)}
      >
        <View style={styles.cardSheetOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => {
              setShowImageModal(false);
              setImageUrl("");
              setImageAlt("");
            }}
          />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View
              style={[
                styles.cardSheet,
                styles.inputSheet,
                { paddingBottom: Math.max(insets.bottom, 14) },
              ]}
            >
              <View style={styles.cardSheetHandle} />
              <View style={styles.cardSheetHeader}>
                <Text style={styles.cardSheetTitle}>
                  {t("notes.knowledgeInsertImage", "插入图片")}
                </Text>
                <Text style={styles.cardSheetHint}>
                  {t("notes.knowledgeImageUrlPlaceholder", "图片 URL")}
                </Text>
              </View>
              {onPickLocalImage ? (
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={[styles.localImageButton, isPickingLocalImage && styles.disabledButton]}
                  onPress={pickLocalImage}
                  disabled={isPickingLocalImage}
                >
                  <View style={styles.localImageButtonIcon}>
                    <ImagePlusIcon size={15} color={colors.primary} />
                  </View>
                  <Text style={styles.localImageButtonText} numberOfLines={1}>
                    {isPickingLocalImage
                      ? t("common.loading", "加载中")
                      : t("notes.knowledgeInsertLocalImage", "选择本地图片")}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TextInput
                value={imageUrl}
                onChangeText={setImageUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder={t("notes.knowledgeImageUrlPlaceholder", "图片 URL")}
                placeholderTextColor={colors.mutedForeground}
                style={styles.linkInput}
              />
              <TextInput
                value={imageAlt}
                onChangeText={setImageAlt}
                placeholder={t("notes.knowledgeImageAltPlaceholder", "图片描述")}
                placeholderTextColor={colors.mutedForeground}
                style={styles.linkInput}
              />
              <View style={styles.linkActions}>
                <TouchableOpacity
                  style={styles.linkGhostButton}
                  onPress={() => {
                    setShowImageModal(false);
                    setImageUrl("");
                    setImageAlt("");
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.linkGhostText}>{t("common.cancel", "取消")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.linkPrimaryButton,
                    (!imageUrl.trim() || isPickingLocalImage) && styles.disabledButton,
                  ]}
                  onPress={applyImage}
                  activeOpacity={0.82}
                  disabled={!imageUrl.trim() || isPickingLocalImage}
                >
                  <Text style={styles.linkPrimaryText}>{t("common.confirm", "确定")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
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
            onPress={() => {
              setShowCardMenu(false);
              setTemplateSaveError(null);
            }}
          />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={[styles.cardSheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
              <View style={styles.cardSheetHandle} />
              <View style={styles.cardSheetHeader}>
                <Text style={styles.cardSheetTitle}>
                  {t("notes.knowledgeCardPickerTitle", "插入知识卡片")}
                </Text>
                <Text style={styles.cardSheetHint}>
                  {t(
                    "notes.knowledgeCardPickerHint",
                    "选择一种结构，插入后会随知识文档同步和导出。",
                  )}
                </Text>
              </View>
              <ScrollView
                style={styles.cardOptionScroll}
                contentContainerStyle={styles.cardOptionList}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {allowedCards.map((card) => {
                  const Icon = cardIconMap[card.cardType] ?? SparklesIcon;
                  return (
                    <View
                      key={card.key}
                      style={styles.cardOption}
                    >
                      <TouchableOpacity
                        style={styles.cardOptionMain}
                        activeOpacity={0.78}
                        onPress={() => insertCard(card)}
                      >
                        <View style={styles.cardOptionIcon}>
                          <Icon size={18} color={colors.primary} />
                        </View>
                        <View style={styles.cardOptionText}>
                          <Text style={styles.cardOptionTitle}>{card.insertLabel}</Text>
                          {card.description ? (
                            <Text style={styles.cardOptionDescription} numberOfLines={2}>
                              {card.description}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                      {card.template ? (
                        <View style={styles.cardTemplateActions}>
                          <TouchableOpacity
                            style={styles.cardTemplateEditButton}
                            activeOpacity={0.72}
                            onPress={() => openTemplateEditForm(card.template!)}
                            accessibilityLabel={t(
                              "notes.knowledgeCustomCardEdit",
                              "编辑自定义卡片",
                            )}
                          >
                            <EditIcon size={15} color={colors.primary} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.cardTemplateRemoveButton}
                            activeOpacity={0.72}
                            onPress={() => disableTemplate(card.template!)}
                            accessibilityLabel={t(
                              "notes.knowledgeCustomCardDisable",
                              "移除自定义卡片",
                            )}
                          >
                            <Trash2Icon size={15} color={colors.destructive} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {canUse("readAnyCards") ? (
                  <View style={styles.cardTemplateSection}>
                    {isTemplateFormOpen ? (
                      <View style={styles.cardTemplateForm}>
                        <View style={styles.cardTemplateFormHeader}>
                          <Text style={styles.cardTemplateFormTitle}>
                            {editingTemplateId
                              ? t("notes.knowledgeCustomCardEdit", "编辑自定义卡片")
                              : t("notes.knowledgeCustomCardNew", "新建自定义卡片")}
                          </Text>
                          <Text style={styles.cardTemplateFormHint}>
                            {editingTemplateId
                              ? t(
                                  "notes.knowledgeCustomCardEditHint",
                                  "只影响之后插入的卡片，文档里已有的卡片保持不变。",
                                )
                              : t(
                                  "notes.knowledgeCustomCardNewHint",
                                  "创建一个可同步复用的结构。",
                                )}
                          </Text>
                        </View>
                        <Text style={styles.cardTemplateLabel}>
                          {t("notes.knowledgeCustomCardName", "卡片名称")}
                        </Text>
                        <TextInput
                          value={templateName}
                          onChangeText={(text) => {
                            setTemplateName(text);
                            setTemplateSaveError(null);
                          }}
                          placeholder={t(
                            "notes.knowledgeCustomCardNamePlaceholder",
                            "概念、时间线、阅读问题...",
                          )}
                          placeholderTextColor={colors.mutedForeground}
                          style={styles.linkInput}
                        />
                        <Text style={styles.cardTemplateLabel}>
                          {t("notes.knowledgeCustomCardDescription", "描述")}
                        </Text>
                        <TextInput
                          value={templateDescription}
                          onChangeText={setTemplateDescription}
                          placeholder={t(
                            "notes.knowledgeCustomCardDescriptionPlaceholder",
                            "这个结构用来记录什么",
                          )}
                          placeholderTextColor={colors.mutedForeground}
                          style={styles.linkInput}
                        />
                        <Text style={styles.cardTemplateLabel}>
                          {t("notes.knowledgeCustomCardDefaultBody", "默认正文")}
                        </Text>
                        <TextInput
                          value={templateMarkdown}
                          onChangeText={setTemplateMarkdown}
                          placeholder={t(
                            "notes.knowledgeCustomCardBodyPlaceholder",
                            "问题：\n回答：\n来源：",
                          )}
                          placeholderTextColor={colors.mutedForeground}
                          multiline
                          textAlignVertical="top"
                          style={[styles.linkInput, styles.cardTemplateBodyInput]}
                        />
                        {templateSaveError ? (
                          <Text style={styles.cardTemplateError}>{templateSaveError}</Text>
                        ) : null}
                        <View style={styles.linkActions}>
                          <TouchableOpacity
                            style={styles.linkGhostButton}
                            onPress={() => {
                              resetTemplateForm();
                              setIsTemplateFormOpen(false);
                            }}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.linkGhostText}>{t("common.cancel", "取消")}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.linkPrimaryButton,
                              (!templateName.trim() || isSavingTemplate) && styles.disabledButton,
                            ]}
                            onPress={saveTemplate}
                            activeOpacity={0.82}
                            disabled={!templateName.trim() || isSavingTemplate}
                          >
                            <Text style={styles.linkPrimaryText}>
                              {isSavingTemplate
                                ? t("common.saving", "保存中...")
                                : editingTemplateId
                                  ? t("notes.knowledgeCustomCardSave", "保存卡片")
                                  : t("notes.knowledgeCustomCardCreate", "创建卡片")}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.cardOption, styles.customCardOption]}
                        activeOpacity={0.78}
                        onPress={openNewTemplateForm}
                      >
                        <View style={styles.cardOptionIcon}>
                          <SparklesIcon size={18} color={colors.primary} />
                        </View>
                        <View style={styles.cardOptionText}>
                          <Text style={styles.cardOptionTitle}>
                            {t("notes.knowledgeCustomCardNew", "新建自定义卡片")}
                          </Text>
                          <Text style={styles.cardOptionDescription} numberOfLines={2}>
                            {t("notes.knowledgeCustomCardNewHint", "创建一个可同步复用的结构。")}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
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

function EditorIssueBanner({
  issue,
  fallbackActive,
  styles,
}: {
  issue: EditorIssue;
  fallbackActive?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.issueBanner}>
      <Text style={styles.issueTitle}>
        {fallbackActive
          ? t("notes.knowledgeEditorFallbackActive", "已切换到备用编辑器")
          : t("notes.knowledgeEditorError", "编辑器出错了")}
      </Text>
      <Text style={styles.issueText}>{issue.message}</Text>
      {issue.code ? (
        <Text style={styles.issueCode}>
          {t("notes.knowledgeEditorErrorCode", {
            code: issue.code,
            defaultValue: `Code: ${issue.code}`,
          })}
        </Text>
      ) : null}
      {fallbackActive ? (
        <Text style={styles.issueHint}>
          {t(
            "notes.knowledgeEditorFallbackHint",
            "备用编辑器会保留 Markdown 内容；恢复后可以重试所见所得编辑器。",
          )}
        </Text>
      ) : null}
    </View>
  );
}

function BlockSheetOption({
  icon,
  title,
  hint,
  onPress,
  styles,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={styles.blockOption} activeOpacity={0.78} onPress={onPress}>
      <View style={styles.blockOptionIcon}>{icon}</View>
      <View style={styles.blockOptionText}>
        <Text style={styles.blockOptionTitle} numberOfLines={1}>
          {title}
        </Text>
        {hint ? (
          <Text style={styles.blockOptionHint} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    container: {
      minHeight: MIN_EDITOR_HEIGHT,
      overflow: "hidden",
      borderRadius: radius.lg,
      backgroundColor: colors.background,
    },
    documentContainer: {
      flex: 1,
      minHeight: 0,
      borderRadius: 0,
    },
    fallbackWrap: {
      minHeight: 360,
      gap: 8,
    },
    fallbackWrapDocument: {
      flex: 1,
      minHeight: 0,
    },
    readOnlyFallback: {
      flex: 1,
      minHeight: MIN_EDITOR_HEIGHT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.background,
    },
    readOnlyFallbackContent: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    readOnlyFallbackText: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      lineHeight: 22,
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
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    webViewFrameFocused: {
      borderTopColor: withOpacity(colors.primary, 0.42),
    },
    webViewFrameDocument: {
      flex: 1,
      minHeight: 0,
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
    readyOverlayCode: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 15,
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
    issueBanner: {
      gap: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: withOpacity(colors.destructive, 0.06),
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    issueTitle: {
      color: colors.foreground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      lineHeight: 16,
    },
    issueText: {
      color: colors.destructive,
      fontSize: fontSize.xs,
      lineHeight: 17,
    },
    issueCode: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 15,
    },
    issueHint: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      lineHeight: 17,
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
    inputSheet: {
      gap: 14,
      paddingBottom: 14,
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
    localImageButton: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.primary, 0.3),
      borderRadius: radius.md,
      backgroundColor: withOpacity(colors.primary, 0.07),
      paddingHorizontal: 11,
    },
    localImageButtonIcon: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    localImageButtonText: {
      minWidth: 0,
      flex: 1,
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    internalLinkResultScroll: {
      flexGrow: 0,
      maxHeight: 260,
    },
    internalLinkResultList: {
      gap: 7,
      paddingBottom: 2,
    },
    internalLinkResult: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    internalLinkLooseResult: {
      borderStyle: "dashed",
      backgroundColor: withOpacity(colors.primary, 0.05),
    },
    internalLinkResultIcon: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    internalLinkResultText: {
      minWidth: 0,
      flex: 1,
    },
    internalLinkResultTitle: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      lineHeight: 18,
    },
    internalLinkResultMeta: {
      marginTop: 2,
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      lineHeight: 16,
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
    disabledButton: {
      opacity: 0.48,
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
    cardTemplateSection: {
      gap: 8,
      marginTop: 2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: 10,
    },
    cardTemplateForm: {
      gap: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: withOpacity(colors.muted, 0.28),
      padding: 10,
    },
    cardTemplateFormHeader: {
      gap: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: withOpacity(colors.border, 0.75),
      borderRadius: radius.md,
      backgroundColor: withOpacity(colors.background, 0.74),
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    cardTemplateFormTitle: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    cardTemplateFormHint: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      lineHeight: 17,
    },
    cardTemplateLabel: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
    },
    cardTemplateBodyInput: {
      minHeight: 96,
      paddingTop: 10,
      paddingBottom: 10,
      lineHeight: 19,
    },
    cardTemplateError: {
      color: colors.destructive,
      fontSize: fontSize.xs,
      lineHeight: 17,
    },
    customCardOption: {
      borderStyle: "dashed",
      backgroundColor: withOpacity(colors.primary, 0.05),
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
    cardOptionMain: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
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
    cardTemplateActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    cardTemplateEditButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.primary, 0.09),
    },
    cardTemplateRemoveButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.destructive, 0.08),
    },
    blockOption: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.background,
      paddingHorizontal: 11,
      paddingVertical: 9,
    },
    blockOptionIcon: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.sm,
      backgroundColor: withOpacity(colors.primary, 0.1),
    },
    blockOptionText: {
      minWidth: 0,
      flex: 1,
      gap: 2,
    },
    blockOptionTitle: {
      color: colors.foreground,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      lineHeight: 18,
    },
    blockOptionHint: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      lineHeight: 16,
    },
  });
