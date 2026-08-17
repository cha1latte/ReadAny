import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  type OpdsAcquisition,
  type OpdsAssetResponse,
  type OpdsCredentials,
  OpdsError,
  type OpdsErrorCode,
  type OpdsFeed,
  type OpdsPublication,
  listSupportedAcquisitions,
  sanitizeOpdsDescription,
} from "@readany/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { opdsMobileRuntime } from "./opds-mobile-runtime";
import {
  type OpdsLoadMode,
  canSearchOpds,
  createInitialOpdsViewState,
  getOpdsPagination,
  opdsViewReducer,
  selectOpdsFeed,
  shouldEditOpdsCredentials,
} from "./opds-view-state";
import { useOpdsDownload } from "./useOpdsDownload";

type Props = NativeStackScreenProps<RootStackParamList, "OpdsBrowser">;

interface BrowserOperation {
  key: string;
  mode: OpdsLoadMode;
  execute(credentials: OpdsCredentials | undefined, signal: AbortSignal): Promise<OpdsFeed>;
}

interface FormatChoice {
  publication: OpdsPublication;
  acquisitions: ReturnType<typeof listSupportedAcquisitions>;
}

const MAX_COVER_BYTES = 4 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += second === undefined ? "=" : alphabet[(value >> 6) & 63];
    output += third === undefined ? "=" : alphabet[value & 63];
  }
  return output;
}

async function assetDataUri(response: OpdsAssetResponse, signal: AbortSignal): Promise<string> {
  const advertisedLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_COVER_BYTES) {
    await response.cancel();
    throw new Error("cover-too-large");
  }
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
  if (!contentType?.startsWith("image/")) {
    await response.cancel();
    throw new Error("not-an-image");
  }
  if (signal.aborted) throw new Error("cancelled");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted || bytes.byteLength > MAX_COVER_BYTES) throw new Error("cover-too-large");
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

function plainDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;
  const sanitized = sanitizeOpdsDescription(description);
  const text = sanitized
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

function toErrorCode(error: unknown): OpdsErrorCode {
  return error instanceof OpdsError ? error.code : "unreachable";
}

function getContentSnapshot(state: ReturnType<typeof createInitialOpdsViewState>) {
  if (state.content.status === "ready") return state.content;
  if (state.content.status === "loading" || state.content.status === "error") {
    return state.content.previous;
  }
  return undefined;
}

function AuthenticatedCover({
  publication,
  load,
  style,
}: {
  publication: OpdsPublication;
  load: (url: string, signal: AbortSignal) => Promise<string>;
  style: object;
}) {
  const [uri, setUri] = useState<string>();
  const imageUrl = publication.images[0]?.url;

  useEffect(() => {
    setUri(undefined);
    if (!imageUrl) return;
    const controller = new AbortController();
    void load(imageUrl, controller.signal)
      .then((nextUri) => {
        if (!controller.signal.aborted) setUri(nextUri);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [imageUrl, load]);

  return uri ? <Image source={{ uri }} style={style} resizeMode="cover" /> : null;
}

export function OpdsBrowserScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const layout = useResponsiveLayout();
  const catalogId = route.params.catalogId;
  const store = useMemo(() => opdsMobileRuntime.getCatalogStore(), []);
  const client = useMemo(() => opdsMobileRuntime.getClient(), []);
  const [state, dispatch] = useReducer(opdsViewReducer, undefined, createInitialOpdsViewState);
  const [catalogName, setCatalogName] = useState("");
  const [catalogUrl, setCatalogUrl] = useState("");
  const [query, setQuery] = useState("");
  const [expandedPublication, setExpandedPublication] = useState<string>();
  const [formatChoice, setFormatChoice] = useState<FormatChoice>();
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  const lifecycleGeneration = useRef(0);
  const requestController = useRef<AbortController | undefined>(undefined);
  const operations = useRef(new Map<string, BrowserOperation>());
  const lastOperation = useRef<BrowserOperation | undefined>(undefined);
  const activeDownloadId = useRef<number | undefined>(undefined);
  const lastDownload = useRef<
    { publication: OpdsPublication; acquisition: OpdsAcquisition } | undefined
  >(undefined);
  const { download, cancel, progress } = useOpdsDownload();
  const feed = selectOpdsFeed(state);
  const pagination = getOpdsPagination(state);

  const executeOperation = useCallback(
    async (operation: BrowserOperation, requestId: number) => {
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      lastOperation.current = operation;
      operations.current.set(operation.key, operation);
      try {
        const credentials = await store.getCredentials(catalogId);
        if (controller.signal.aborted) return;
        const nextFeed = await operation.execute(credentials, controller.signal);
        if (!controller.signal.aborted && mounted.current) {
          dispatch({ type: "loadSucceeded", requestId, feed: nextFeed });
        }
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) {
          dispatch({ type: "loadFailed", requestId, error: toErrorCode(error) });
        }
      }
    },
    [catalogId, store],
  );

  const startOperation = useCallback(
    (operation: BrowserOperation) => {
      const requestId = ++requestSequence.current;
      dispatch({
        type: "loadStarted",
        requestId,
        url: operation.key,
        mode: operation.mode,
      });
      void executeOperation(operation, requestId);
    },
    [executeOperation],
  );

  const openUrl = useCallback(
    (url: string, mode: OpdsLoadMode) => {
      startOperation({
        key: url,
        mode,
        execute: (credentials, signal) => client.open(url, credentials, signal),
      });
    },
    [client, startOperation],
  );

  const initializeCatalog = useCallback(
    async (generation: number) => {
      try {
        await opdsMobileRuntime.ensureCatalogsLoaded();
        if (!mounted.current || lifecycleGeneration.current !== generation) return;
        const catalog = store.getCatalog(catalogId);
        if (!catalog || !catalog.enabled) throw new Error("catalog-unavailable");
        setCatalogName(catalog.name);
        setCatalogUrl(catalog.url);
        openUrl(catalog.url, "replace");
      } catch (error) {
        if (!mounted.current || lifecycleGeneration.current !== generation) return;
        const requestId = ++requestSequence.current;
        dispatch({ type: "loadStarted", requestId, url: "catalog", mode: "replace" });
        dispatch({ type: "loadFailed", requestId, error: toErrorCode(error) });
      }
    },
    [catalogId, openUrl, store],
  );

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    mounted.current = true;
    void initializeCatalog(generation);
    return () => {
      mounted.current = false;
      if (lifecycleGeneration.current === generation) lifecycleGeneration.current += 1;
      requestController.current?.abort();
      cancel();
    };
  }, [cancel, initializeCatalog]);

  useEffect(() => {
    const requestId = activeDownloadId.current;
    if (!requestId || !progress) return;
    dispatch({
      type: "downloadProgress",
      requestId,
      loaded: progress.loaded,
      total: progress.total,
    });
  }, [progress]);

  const loadCover = useCallback(
    async (url: string, signal: AbortSignal) => {
      const credentials = await store.getCredentials(catalogId);
      const origin = new URL(catalogUrl).origin;
      const response = await client.fetchAsset(url, origin, credentials, signal);
      return assetDataUri(response, signal);
    },
    [catalogId, catalogUrl, client, store],
  );

  const runDownload = useCallback(
    async (publication: OpdsPublication, acquisition: OpdsAcquisition) => {
      if (activeDownloadId.current !== undefined) return;
      const requestId = ++requestSequence.current;
      activeDownloadId.current = requestId;
      lastDownload.current = { publication, acquisition };
      dispatch({
        type: "downloadStarted",
        requestId,
        publicationTitle: publication.title,
      });
      try {
        const credentials = await store.getCredentials(catalogId);
        if (!mounted.current) return;
        const result = await download({
          publication,
          acquisition,
          catalogOrigin: new URL(catalogUrl).origin,
          credentials,
        });
        if (mounted.current) {
          dispatch({
            type: "downloadSucceeded",
            requestId,
            importedCount: result.importResult.imported.length,
          });
        }
      } catch (error) {
        if (mounted.current) {
          dispatch({ type: "downloadFailed", requestId, error: toErrorCode(error) });
        }
      } finally {
        if (activeDownloadId.current === requestId) activeDownloadId.current = undefined;
      }
    },
    [catalogId, catalogUrl, download, store],
  );

  const chooseDownload = (publication: OpdsPublication) => {
    const acquisitions = listSupportedAcquisitions(publication);
    if (acquisitions.length === 0) return;
    if (acquisitions.length === 1) {
      void runDownload(publication, acquisitions[0]);
      return;
    }
    setFormatChoice({ publication, acquisitions });
  };

  const handleSearch = () => {
    const descriptor = feed?.search;
    const trimmed = query.trim();
    if (!descriptor || !trimmed) return;
    const key = `opds-search:${encodeURIComponent(trimmed)}`;
    startOperation({
      key,
      mode: "push",
      execute: (credentials, signal) => client.search(descriptor, trimmed, credentials, signal),
    });
  };

  const handleBack = () => {
    const snapshot = getContentSnapshot(state);
    const target = snapshot?.history.at(-1);
    if (!target) {
      navigation.goBack();
      return;
    }
    const operation = operations.current.get(target);
    if (operation) startOperation({ ...operation, mode: "back" });
    else openUrl(target, "back");
  };

  const handleRefresh = () => {
    const snapshot = getContentSnapshot(state);
    const operation = snapshot ? operations.current.get(snapshot.currentUrl) : undefined;
    if (operation) startOperation({ ...operation, mode: "refresh" });
  };

  const handleRetry = () => {
    const operation = lastOperation.current;
    if (state.content.status !== "error") return;
    if (!operation) {
      void initializeCatalog(lifecycleGeneration.current);
      return;
    }
    const requestId = ++requestSequence.current;
    dispatch({ type: "retryStarted", requestId });
    void executeOperation(operation, requestId);
  };

  const cancelDownload = () => {
    const requestId = activeDownloadId.current;
    cancel();
    if (requestId) dispatch({ type: "downloadCancelled", requestId });
    activeDownloadId.current = undefined;
  };

  const retryDownload = () => {
    const retry = lastDownload.current;
    if (retry) void runDownload(retry.publication, retry.acquisition);
  };

  const errorMessage = (code: OpdsErrorCode) =>
    t(`library.opds.errors.${code}`, {
      defaultValue:
        code === "unauthorized"
          ? "The catalog rejected the saved sign-in."
          : code === "unsupported-auth"
            ? "This catalog uses an authentication method ReadAny does not support yet."
            : code === "invalid-catalog"
              ? "This address did not return a valid OPDS catalog."
              : code === "unsupported-acquisition"
                ? "This book does not offer a format ReadAny can import."
                : code === "import-failed"
                  ? "The book downloaded, but could not be added to your library."
                  : code === "asset-too-large"
                    ? "This book is too large to download safely."
                    : code === "download-failed"
                      ? "The book download failed."
                      : "The catalog could not be reached.",
    });

  const s = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        header: {
          paddingHorizontal: layout.horizontalPadding,
          paddingTop: 12,
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: withOpacity(colors.border, 0.9),
          alignItems: "center",
        },
        headerInner: { width: "100%", maxWidth: layout.centeredContentWidth, gap: 12 },
        headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
        iconButton: {
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: colors.card,
          alignItems: "center",
          justifyContent: "center",
        },
        headerCopy: { flex: 1, minWidth: 0 },
        eyebrow: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          color: colors.mutedForeground,
          textTransform: "uppercase",
          letterSpacing: 0.7,
        },
        title: {
          marginTop: 2,
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        searchRow: {
          minHeight: 46,
          paddingHorizontal: 12,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
        },
        searchInput: {
          flex: 1,
          minWidth: 0,
          padding: 0,
          fontSize: fontSize.base,
          color: colors.foreground,
        },
        searchButton: {
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
        },
        scrollContent: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.horizontalPadding,
          paddingTop: 16,
          paddingBottom: 130,
          gap: 16,
        },
        feedIntro: { paddingHorizontal: 2 },
        feedTitle: {
          fontSize: fontSize.lg,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        feedSubtitle: {
          marginTop: 4,
          fontSize: fontSize.sm,
          lineHeight: 21,
          color: colors.mutedForeground,
        },
        errorBox: {
          padding: 14,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.destructive, 0.22),
          backgroundColor: withOpacity(colors.destructive, 0.08),
          gap: 10,
        },
        errorText: { fontSize: fontSize.sm, lineHeight: 20, color: colors.foreground },
        errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        smallButton: {
          minHeight: 44,
          paddingHorizontal: 14,
          borderRadius: radius.full,
          backgroundColor: colors.card,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
        },
        smallButtonText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        section: { gap: 9 },
        sectionTitle: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          color: colors.mutedForeground,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          paddingHorizontal: 2,
        },
        linkCard: {
          minHeight: 54,
          paddingHorizontal: 14,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          backgroundColor: colors.card,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        linkText: {
          flex: 1,
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        publication: {
          borderRadius: radius.xxl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          overflow: "hidden",
        },
        publicationMain: { minHeight: 94, padding: 14, flexDirection: "row", gap: 13 },
        cover: {
          width: 56,
          height: 78,
          borderRadius: radius.md,
          backgroundColor: withOpacity(colors.primary, 0.08),
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        },
        coverImage: { position: "absolute", top: 0, left: 0, width: 56, height: 78 },
        publicationCopy: { flex: 1, minWidth: 0 },
        publicationTitle: {
          fontSize: fontSize.base,
          lineHeight: 21,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        publicationAuthor: { marginTop: 4, fontSize: fontSize.sm, color: colors.mutedForeground },
        publicationMeta: { marginTop: 7, fontSize: fontSize.xs, color: colors.mutedForeground },
        details: {
          paddingHorizontal: 14,
          paddingBottom: 14,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: withOpacity(colors.border, 0.82),
          gap: 12,
        },
        description: {
          paddingTop: 12,
          fontSize: fontSize.sm,
          lineHeight: 21,
          color: colors.foreground,
        },
        subjectRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        subject: {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: radius.full,
          backgroundColor: colors.muted,
        },
        subjectText: { fontSize: fontSize.xs, color: colors.mutedForeground },
        downloadButton: {
          minHeight: 46,
          borderRadius: radius.xl,
          backgroundColor: colors.primary,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        },
        downloadText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.primaryForeground,
        },
        unsupported: { fontSize: fontSize.sm, lineHeight: 20, color: colors.mutedForeground },
        pagination: { flexDirection: "row", gap: 10 },
        pageButton: {
          flex: 1,
          minHeight: 46,
          borderRadius: radius.xl,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        },
        pageText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        centerState: {
          minHeight: 360,
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
        },
        centerTitle: {
          marginTop: 14,
          fontSize: fontSize.lg,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        centerText: {
          marginTop: 7,
          fontSize: fontSize.sm,
          lineHeight: 21,
          textAlign: "center",
          color: colors.mutedForeground,
        },
        downloadPanel: {
          position: "absolute",
          left: layout.horizontalPadding,
          right: layout.horizontalPadding,
          bottom: 16,
          alignItems: "center",
        },
        downloadInner: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          padding: 14,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.14,
          shadowRadius: 18,
          elevation: 7,
          gap: 9,
        },
        downloadRow: { flexDirection: "row", alignItems: "center", gap: 10 },
        downloadCopy: { flex: 1, minWidth: 0 },
        downloadTitle: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        downloadMeta: { marginTop: 2, fontSize: fontSize.xs, color: colors.mutedForeground },
        progressTrack: {
          height: 4,
          borderRadius: radius.full,
          backgroundColor: colors.muted,
          overflow: "hidden",
        },
        progressFill: {
          height: "100%",
          borderRadius: radius.full,
          backgroundColor: colors.primary,
        },
        overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
        picker: {
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: 28,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          backgroundColor: colors.background,
          gap: 12,
        },
        pickerHandle: {
          alignSelf: "center",
          width: 38,
          height: 4,
          borderRadius: radius.full,
          backgroundColor: colors.border,
        },
        pickerTitle: {
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        pickerSubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground },
        formatButton: {
          minHeight: 52,
          paddingHorizontal: 14,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          backgroundColor: colors.card,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        formatText: {
          flex: 1,
          fontSize: fontSize.base,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
          textTransform: "uppercase",
        },
      }),
    [colors, layout.centeredContentWidth, layout.horizontalPadding],
  );

  const renderPublication = (publication: OpdsPublication, keyPrefix = "publication") => {
    const key = `${keyPrefix}:${publication.id ?? publication.title}`;
    const expanded = expandedPublication === key;
    const formats = listSupportedAcquisitions(publication);
    const description = plainDescription(publication.description);
    return (
      <View key={key} style={s.publication}>
        <TouchableOpacity
          style={s.publicationMain}
          onPress={() => setExpandedPublication(expanded ? undefined : key)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={t("library.opds.publicationDetails", {
            defaultValue: "Details for {{title}}",
            title: publication.title,
          })}
        >
          <View style={s.cover}>
            <BookOpenIcon size={21} color={colors.mutedForeground} />
            <AuthenticatedCover publication={publication} load={loadCover} style={s.coverImage} />
          </View>
          <View style={s.publicationCopy}>
            <Text style={s.publicationTitle}>{publication.title}</Text>
            <Text style={s.publicationAuthor} numberOfLines={2}>
              {publication.authors.join(", ") ||
                t("library.opds.unknownAuthor", { defaultValue: "Unknown author" })}
            </Text>
            <Text style={s.publicationMeta} numberOfLines={1}>
              {formats.length > 0
                ? formats.map((item) => item.format.toUpperCase()).join(" · ")
                : t("library.opds.noCompatibleFormat", {
                    defaultValue: "No compatible download format",
                  })}
            </Text>
          </View>
          <ChevronRightIcon size={17} color={colors.mutedForeground} />
        </TouchableOpacity>
        {expanded ? (
          <View style={s.details}>
            {description ? <Text style={s.description}>{description}</Text> : null}
            {publication.subjects.length > 0 ? (
              <View style={s.subjectRow}>
                {publication.subjects.slice(0, 8).map((subject) => (
                  <View key={subject} style={s.subject}>
                    <Text style={s.subjectText}>{subject}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {formats.length > 0 ? (
              <TouchableOpacity
                style={s.downloadButton}
                onPress={() => chooseDownload(publication)}
                disabled={state.download.status === "downloading"}
                accessibilityRole="button"
                accessibilityLabel={t("library.opds.downloadTitle", {
                  defaultValue: "Download {{title}}",
                  title: publication.title,
                })}
              >
                <BookOpenIcon size={18} color={colors.primaryForeground} />
                <Text style={s.downloadText}>
                  {formats.length > 1
                    ? t("library.opds.chooseFormat", { defaultValue: "Choose format" })
                    : t("library.opds.downloadAndImport", { defaultValue: "Download & import" })}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.unsupported}>
                {t("library.opds.unsupportedExplanation", {
                  defaultValue:
                    "This entry does not advertise a direct book format that ReadAny can import.",
                })}
              </Text>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const contentError = state.content.status === "error" ? state.content.error : undefined;
  const initialLoading =
    state.content.status === "idle" || (state.content.status === "loading" && !feed);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={s.headerInner}>
          <View style={s.headerRow}>
            <TouchableOpacity
              style={s.iconButton}
              onPress={handleBack}
              accessibilityRole="button"
              accessibilityLabel={t("common.back", { defaultValue: "Back" })}
            >
              <ChevronLeftIcon size={20} color={colors.foreground} />
            </TouchableOpacity>
            <View style={s.headerCopy}>
              <Text style={s.eyebrow} numberOfLines={1}>
                {catalogName || t("library.opds.catalog", { defaultValue: "Catalog" })}
              </Text>
              <Text style={s.title} numberOfLines={1}>
                {feed?.title ?? t("library.opds.loading", { defaultValue: "Loading…" })}
              </Text>
            </View>
            <TouchableOpacity
              style={s.iconButton}
              onPress={handleRefresh}
              disabled={!feed || state.content.status === "loading"}
              accessibilityRole="button"
              accessibilityState={{
                disabled: !feed,
                busy: state.content.status === "ready" && state.content.refreshing,
              }}
              accessibilityLabel={t("common.refresh", { defaultValue: "Refresh" })}
            >
              {state.content.status === "ready" && state.content.refreshing ? (
                <ActivityIndicator size="small" color={colors.foreground} />
              ) : (
                <RefreshCwIcon size={18} color={colors.foreground} />
              )}
            </TouchableOpacity>
          </View>
          {canSearchOpds(state) ? (
            <View style={s.searchRow}>
              <SearchIcon size={18} color={colors.mutedForeground} />
              <TextInput
                style={s.searchInput}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
                placeholder={t("library.opds.searchPlaceholder", {
                  defaultValue: "Search this catalog",
                })}
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={t("library.opds.searchPlaceholder", {
                  defaultValue: "Search this catalog",
                })}
              />
              <TouchableOpacity
                style={s.searchButton}
                onPress={handleSearch}
                disabled={!query.trim()}
                accessibilityRole="button"
                accessibilityLabel={t("common.search", { defaultValue: "Search" })}
              >
                <ChevronRightIcon
                  size={18}
                  color={query.trim() ? colors.foreground : colors.mutedForeground}
                />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>

      {initialLoading ? (
        <View style={s.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.centerTitle}>
            {t("library.opds.loading", { defaultValue: "Loading catalog…" })}
          </Text>
          <Text style={s.centerText}>
            {t("library.opds.loadingHint", {
              defaultValue: "Opening the shelf and checking its available collections.",
            })}
          </Text>
        </View>
      ) : !feed && contentError ? (
        <View style={s.centerState}>
          <GlobeIcon size={30} color={colors.destructive} />
          <Text style={s.centerTitle}>
            {t("library.opds.loadFailed", { defaultValue: "Catalog unavailable" })}
          </Text>
          <Text style={s.centerText}>{errorMessage(contentError)}</Text>
          <View style={s.errorActions}>
            <TouchableOpacity style={s.smallButton} onPress={handleRetry}>
              <Text style={s.smallButtonText}>{t("common.retry", { defaultValue: "Retry" })}</Text>
            </TouchableOpacity>
            {shouldEditOpdsCredentials(state) ? (
              <TouchableOpacity
                style={s.smallButton}
                onPress={() => navigation.navigate("OpdsCatalogs", { editCatalogId: catalogId })}
              >
                <Text style={s.smallButtonText}>
                  {t("library.opds.editCredentials", { defaultValue: "Edit credentials" })}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          {feed ? (
            <View style={s.feedIntro}>
              <Text style={s.feedTitle}>{feed.title}</Text>
              {feed.subtitle ? <Text style={s.feedSubtitle}>{feed.subtitle}</Text> : null}
            </View>
          ) : null}

          {contentError ? (
            <View style={s.errorBox} accessibilityRole="alert">
              <Text style={s.errorText}>{errorMessage(contentError)}</Text>
              <View style={s.errorActions}>
                <TouchableOpacity style={s.smallButton} onPress={handleRetry}>
                  <Text style={s.smallButtonText}>
                    {t("common.retry", { defaultValue: "Retry" })}
                  </Text>
                </TouchableOpacity>
                {shouldEditOpdsCredentials(state) ? (
                  <TouchableOpacity
                    style={s.smallButton}
                    onPress={() =>
                      navigation.navigate("OpdsCatalogs", { editCatalogId: catalogId })
                    }
                  >
                    <Text style={s.smallButtonText}>
                      {t("library.opds.editCredentials", { defaultValue: "Edit credentials" })}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}

          {feed?.navigation.length ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>
                {t("library.opds.collections", { defaultValue: "Collections" })}
              </Text>
              {feed.navigation.map((item) => (
                <TouchableOpacity
                  key={`${item.title}:${item.url}`}
                  style={s.linkCard}
                  onPress={() => openUrl(item.url, "push")}
                >
                  <GlobeIcon size={18} color={colors.primary} />
                  <Text style={s.linkText}>{item.title}</Text>
                  <ChevronRightIcon size={17} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {feed?.facets.map((facet) => (
            <View key={facet.title} style={s.section}>
              <Text style={s.sectionTitle}>{facet.title}</Text>
              {facet.links.map((link) => (
                <TouchableOpacity
                  key={`${link.title ?? link.url}:${link.url}`}
                  style={s.linkCard}
                  onPress={() => openUrl(link.url, "push")}
                >
                  <Text style={s.linkText}>{link.title ?? link.url}</Text>
                  <ChevronRightIcon size={17} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
            </View>
          ))}

          {feed?.publications.length ? (
            <View style={s.section}>
              <Text style={s.sectionTitle}>
                {t("library.opds.books", { defaultValue: "Books" })}
              </Text>
              {feed.publications.map((publication) => renderPublication(publication))}
            </View>
          ) : null}

          {feed?.groups.map((group, groupIndex) => (
            <View key={`${group.title}:${groupIndex}`} style={s.section}>
              <Text style={s.sectionTitle}>{group.title}</Text>
              {group.navigation.map((item) => (
                <TouchableOpacity
                  key={`${item.title}:${item.url}`}
                  style={s.linkCard}
                  onPress={() => openUrl(item.url, "push")}
                >
                  <Text style={s.linkText}>{item.title}</Text>
                  <ChevronRightIcon size={17} color={colors.mutedForeground} />
                </TouchableOpacity>
              ))}
              {group.publications.map((publication) =>
                renderPublication(publication, `group-${groupIndex}`),
              )}
            </View>
          ))}

          {feed &&
          feed.navigation.length === 0 &&
          feed.publications.length === 0 &&
          feed.groups.length === 0 ? (
            <View style={s.centerState}>
              <BookOpenIcon size={30} color={colors.mutedForeground} />
              <Text style={s.centerTitle}>
                {t("library.opds.empty", { defaultValue: "Nothing on this shelf yet" })}
              </Text>
              <Text style={s.centerText}>
                {t("library.opds.emptyHint", {
                  defaultValue: "Try another collection or go back one level.",
                })}
              </Text>
            </View>
          ) : null}

          {pagination.previousUrl || pagination.nextUrl ? (
            <View style={s.pagination}>
              {pagination.previousUrl ? (
                <TouchableOpacity
                  style={s.pageButton}
                  onPress={() => openUrl(pagination.previousUrl as string, "push")}
                >
                  <ChevronLeftIcon size={17} color={colors.foreground} />
                  <Text style={s.pageText}>
                    {t("common.previous", { defaultValue: "Previous" })}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {pagination.nextUrl ? (
                <TouchableOpacity
                  style={s.pageButton}
                  onPress={() => openUrl(pagination.nextUrl as string, "push")}
                >
                  <Text style={s.pageText}>{t("common.next", { defaultValue: "Next" })}</Text>
                  <ChevronRightIcon size={17} color={colors.foreground} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {state.download.status !== "idle" ? (
        <View style={s.downloadPanel}>
          <View style={s.downloadInner}>
            <View style={s.downloadRow}>
              {state.download.status === "downloading" ? (
                <Loader2Icon size={20} color={colors.primary} />
              ) : state.download.status === "success" ? (
                <BookOpenIcon size={20} color={colors.emerald} />
              ) : (
                <XIcon size={20} color={colors.destructive} />
              )}
              <View style={s.downloadCopy}>
                <Text style={s.downloadTitle} numberOfLines={1}>
                  {state.download.publicationTitle}
                </Text>
                <Text style={s.downloadMeta}>
                  {state.download.status === "downloading"
                    ? t("library.opds.downloading", {
                        defaultValue:
                          state.download.total > 0 ? "Downloading {{percent}}%" : "Downloading…",
                        percent:
                          state.download.total > 0
                            ? Math.round((state.download.loaded / state.download.total) * 100)
                            : 0,
                      })
                    : state.download.status === "success"
                      ? state.download.importedCount > 0
                        ? t("library.opds.imported", { defaultValue: "Imported to your library" })
                        : t("library.opds.alreadyImported", {
                            defaultValue: "This book is already in your library",
                          })
                      : errorMessage(state.download.error)}
                </Text>
              </View>
              {state.download.status === "downloading" ? (
                <TouchableOpacity style={s.smallButton} onPress={cancelDownload}>
                  <Text style={s.smallButtonText}>
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Text>
                </TouchableOpacity>
              ) : state.download.status === "error" && lastDownload.current ? (
                <TouchableOpacity style={s.smallButton} onPress={retryDownload}>
                  <Text style={s.smallButtonText}>
                    {t("common.retry", { defaultValue: "Retry" })}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={s.smallButton}
                  onPress={() => dispatch({ type: "downloadReset" })}
                >
                  <Text style={s.smallButtonText}>
                    {t("common.done", { defaultValue: "Done" })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {state.download.status === "downloading" ? (
              <View style={s.progressTrack}>
                <View
                  style={[
                    s.progressFill,
                    {
                      width: `${state.download.total > 0 ? Math.min(100, (state.download.loaded / state.download.total) * 100) : 8}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <Modal
        visible={!!formatChoice}
        transparent
        animationType="slide"
        onRequestClose={() => setFormatChoice(undefined)}
      >
        <Pressable style={s.overlay} onPress={() => setFormatChoice(undefined)}>
          <Pressable style={s.picker} onPress={(event) => event.stopPropagation()}>
            <View style={s.pickerHandle} />
            <Text style={s.pickerTitle}>
              {t("library.opds.chooseFormat", { defaultValue: "Choose format" })}
            </Text>
            <Text style={s.pickerSubtitle} numberOfLines={2}>
              {formatChoice?.publication.title}
            </Text>
            {formatChoice?.acquisitions.map((acquisition) => (
              <TouchableOpacity
                key={`${acquisition.format}:${acquisition.url}`}
                style={s.formatButton}
                onPress={() => {
                  const publication = formatChoice.publication;
                  setFormatChoice(undefined);
                  void runDownload(publication, acquisition);
                }}
                accessibilityRole="button"
                accessibilityLabel={t("library.opds.downloadFormat", {
                  defaultValue: "Download {{format}}",
                  format: acquisition.format.toUpperCase(),
                })}
              >
                <BookOpenIcon size={19} color={colors.primary} />
                <Text style={s.formatText}>{acquisition.format}</Text>
                <ChevronRightIcon size={17} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
