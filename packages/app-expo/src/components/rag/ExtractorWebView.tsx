import type { ChapterData } from "@readany/core/rag";
import type { Book } from "@readany/core/types";
import { Asset } from "expo-asset";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { toBookExtractionError } from "../../lib/rag/extractor-error";
import { createExtractorCommand } from "../../lib/rag/extractor-format";
import { ExtractorRequestBoundary } from "../../lib/rag/extractor-request-boundary";

const READER_HTML_ASSET = Asset.fromModule(require("../../../assets/reader/reader.html"));
const EXTRACTION_TIMEOUT_MS = 45_000;

export interface ExtractorRef {
  extractChapters: (
    base64BookData: string,
    mimeType?: string,
    bookFormat?: Book["format"],
    fileName?: string,
    signal?: AbortSignal,
  ) => Promise<ChapterData[]>;
}

function getAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    if (reason.name !== "AbortError") reason.name = "AbortError";
    return reason;
  }
  const error = new Error("Vectorization cancelled");
  error.name = "AbortError";
  return error;
}

export const ExtractorWebView = forwardRef<ExtractorRef>((_, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const generationRef = useRef<number | null>(null);
  const nextGenerationRef = useRef(0);
  const disposedRef = useRef(false);
  const [generation, setGeneration] = useState<number | null>(null);
  const queuedCommandsRef = useRef(new Map<string, () => void>());
  const [requestBoundary] = useState(
    () =>
      new ExtractorRequestBoundary<ChapterData[], Book["format"] | undefined>({
        timeoutMs: EXTRACTION_TIMEOUT_MS,
        sendCancel: (requestId) => {
          if (activeRequestRef.current !== requestId) return;
          webViewRef.current?.injectJavaScript(`
            window.postMessage(${JSON.stringify(
              JSON.stringify({ type: "cancelExtraction", requestId }),
            )}, "*");
            true;
          `);
        },
        onCancelError: (requestId, error) => {
          console.warn(`[ExtractorWebView] Failed to cancel request ${requestId}:`, error);
        },
      }),
  );

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      generationRef.current = null;
      activeRequestRef.current = null;
      queuedCommandsRef.current.clear();
      requestBoundary.rejectAll();
    };
  }, [requestBoundary]);

  const startNextRequest = useCallback(() => {
    if (disposedRef.current || activeRequestRef.current !== null) return;
    const next = queuedCommandsRef.current.keys().next();
    if (next.done) return;
    activeRequestRef.current = next.value;
    // A fresh document gives this request exclusive ownership of parser state,
    // even if an earlier book's cancelled async work has not stopped yet.
    generationRef.current = ++nextGenerationRef.current;
    setHtmlUri(null);
    setGeneration(generationRef.current);
  }, []);

  const releaseRequest = useCallback(
    (requestId: string) => {
      queuedCommandsRef.current.delete(requestId);
      if (activeRequestRef.current !== requestId) return;
      activeRequestRef.current = null;
      generationRef.current = null;
      if (disposedRef.current) return;
      setGeneration(null);
      setHtmlUri(null);
      startNextRequest();
    },
    [startNextRequest],
  );

  useEffect(() => {
    if (generation === null) return;
    let active = true;
    const loadAsset = async () => {
      try {
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        if (active && generationRef.current === generation) setHtmlUri(uri);
      } catch (err) {
        if (active && generationRef.current === generation) {
          requestBoundary.rejectAll(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };
    void loadAsset();
    return () => {
      active = false;
    };
  }, [generation, requestBoundary]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      if (generation === null || generationRef.current !== generation) return;
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === "ready") {
          const requestId = activeRequestRef.current;
          if (requestId !== null) {
            const dispatch = queuedCommandsRef.current.get(requestId);
            queuedCommandsRef.current.delete(requestId);
            if (requestBoundary.has(requestId)) dispatch?.();
          }
        } else if (msg.type === "loaded") {
          if (msg.requestId !== activeRequestRef.current || !requestBoundary.has(msg.requestId))
            return;
          // Trigger extraction once the book is fully loaded
          webViewRef.current?.injectJavaScript(`
          if (window.handleExtractChapters) {
             window.handleExtractChapters(${JSON.stringify(msg.requestId)});
          } else {
             window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'chaptersExtracted', requestId: ${JSON.stringify(msg.requestId)}, error: 'Extraction not supported' }));
          }
          true;
        `);
        } else if (msg.type === "chaptersExtracted") {
          if (msg.requestId !== activeRequestRef.current) return;
          const classificationFormat = requestBoundary.getContext(msg.requestId);
          if (msg.error) {
            requestBoundary.reject(
              msg.requestId,
              toBookExtractionError(new Error(String(msg.error)), classificationFormat),
            );
          } else if (msg.chapters) {
            requestBoundary.resolve(msg.requestId, msg.chapters);
          }
        } else if (msg.type === "debug") {
          console.log("[ExtractorWebView]", msg.message);
        } else if (msg.type === "error") {
          if (msg.requestId !== activeRequestRef.current || !requestBoundary.has(msg.requestId))
            return;
          console.error("[ExtractorWebView] WebView error:", msg.message);
          const classificationFormat = requestBoundary.getContext(msg.requestId);
          requestBoundary.reject(
            msg.requestId,
            toBookExtractionError(new Error(String(msg.message)), classificationFormat),
          );
        }
      } catch (err) {
        console.warn("[ExtractorWebView] Failed to parse message:", err);
      }
    },
    [generation, requestBoundary],
  );

  useImperativeHandle(ref, () => ({
    extractChapters: (
      base64BookData: string,
      mimeType = "application/epub+zip",
      bookFormat?: Book["format"],
      fileName?: string,
      signal?: AbortSignal,
    ) => {
      const requestId = `extract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const baseCommand = createExtractorCommand({
        base64BookData,
        mimeType,
        bookFormat,
        fileName,
      });
      const command = { ...baseCommand, requestId };
      const classificationFormat = command.bookFormat ?? undefined;
      return new Promise<ChapterData[]>((resolve, reject) => {
        if (signal?.aborted) return reject(getAbortError(signal));
        if (disposedRef.current) {
          return reject(
            toBookExtractionError(new Error("Extractor WebView unmounted"), classificationFormat),
          );
        }

        requestBoundary.add({
          requestId,
          resolve: (chapters) => {
            releaseRequest(requestId);
            resolve(chapters);
          },
          reject: (error) => {
            releaseRequest(requestId);
            reject(
              error.name === "AbortError"
                ? error
                : toBookExtractionError(error, classificationFormat),
            );
          },
          context: classificationFormat,
          signal,
          abortError: () => getAbortError(signal as AbortSignal),
          timeoutError: () =>
            toBookExtractionError(
              new Error("Timed out extracting book content"),
              classificationFormat,
            ),
          disposeError: () =>
            toBookExtractionError(new Error("Extractor WebView unmounted"), classificationFormat),
        });

        if (!requestBoundary.has(requestId)) return;
        const dispatch = () => {
          try {
            if (!webViewRef.current) throw new Error("Extractor WebView unavailable");
            webViewRef.current.injectJavaScript(`
              window.postMessage(${JSON.stringify(JSON.stringify(command))}, "*");
              true;
            `);
          } catch (error) {
            requestBoundary.reject(requestId, toBookExtractionError(error, classificationFormat));
          }
        };
        queuedCommandsRef.current.set(requestId, dispatch);
        startNextRequest();
      });
    },
  }));

  if (generation === null || !htmlUri) return null;

  return (
    <View style={styles.host} pointerEvents="none">
      <WebView
        key={generation}
        ref={webViewRef}
        // The shared HTML disables loading UI before first paint in extraction mode.
        source={{ uri: `${htmlUri}#readany-extractor` }}
        style={styles.webView}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={handleMessage}
        onError={(event) => {
          if (generationRef.current === generation) {
            requestBoundary.rejectAll(new Error(event.nativeEvent.description));
          }
        }}
        onRenderProcessGone={() => {
          if (generationRef.current === generation) {
            requestBoundary.rejectAll(new Error("Extractor WebView process terminated"));
          }
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0.01,
  },
  webView: {
    width: 1,
    height: 1,
  },
});
