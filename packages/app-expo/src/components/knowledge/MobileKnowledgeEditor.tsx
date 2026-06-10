import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  Link2Icon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  Undo2Icon,
} from "@/components/ui/Icon";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import {
  type KnowledgeEditorFeature,
  type KnowledgeEditorTier,
  getKnowledgeEditorProfile,
  hasKnowledgeEditorFeature,
  markdownToBasicTiptap,
  renderKnowledgeJsonToMarkdown,
} from "@readany/core/knowledge";
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
  return JSON.stringify(value);
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
}: MobileKnowledgeEditorProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const webViewRef = useRef<WebView>(null);
  const latestValueRef = useRef(value);
  const localFingerprintRef = useRef(fingerprintJson(value.contentJson));
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [isBridgeReady, setIsBridgeReady] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [useMarkdownFallback, setUseMarkdownFallback] = useState(false);
  const [selection, setSelection] = useState<SelectionState>({
    marks: {},
    linkHref: null,
    headingLevel: null,
    canUndo: false,
    canRedo: false,
  });
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const editorProfile = useMemo(() => getKnowledgeEditorProfile(tier), [tier]);
  const canUse = useCallback(
    (feature: KnowledgeEditorFeature) => hasKnowledgeEditorFeature(editorProfile, feature),
    [editorProfile],
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

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

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
        case "contentChanged":
          if (!isJsonValue(message.contentJson)) return;
          localFingerprintRef.current = fingerprintJson(message.contentJson);
          onChange({
            contentJson: message.contentJson,
            contentMd: renderKnowledgeJsonToMarkdown(message.contentJson),
            plainText: typeof message.plainText === "string" ? message.plainText : "",
          });
          break;
        case "error":
          console.error("[MobileKnowledgeEditor] WebView error:", message);
          setErrorMessage(message.message || t("notes.knowledgeEditorError", "编辑器出错了"));
          break;
      }
    },
    [onChange, sendInit, t],
  );

  const runCommand = useCallback(
    (command: string, attrs?: Record<string, unknown>) => {
      injectCommand({ type: "runCommand", command, attrs });
    },
    [injectCommand],
  );

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

  const handleFallbackChange = useCallback(
    (markdown: string) => {
      const contentJson = markdownToBasicTiptap(markdown) as unknown as JSONValue;
      onChange({
        contentJson,
        contentMd: markdown,
        plainText: markdown,
      });
    },
    [onChange],
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
  ];
  const toolbarGroups = toolbarGroupCandidates.filter(
    (group): group is { key: string; node: React.ReactNode } => group !== null,
  );

  if (useMarkdownFallback) {
    return (
      <View style={styles.fallbackWrap}>
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        <RichTextEditor
          tier={tier}
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
              key={documentId ?? "knowledge-editor"}
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
                webViewRef.current?.reload();
              }}
            />
            {!isEditorReady && (
              <View style={styles.readyOverlay}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </>
        )}
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

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
      backgroundColor: withOpacity(colors.background, 0.72),
    },
    errorText: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: fontSize.xs,
      lineHeight: 17,
      color: colors.destructive,
      backgroundColor: withOpacity(colors.destructive, 0.08),
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
  });
