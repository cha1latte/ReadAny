import type { ChapterData } from "@readany/core/rag";
import type { Book } from "@readany/core/types";
import { Asset } from "expo-asset";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { toBookExtractionError } from "../../lib/rag/extractor-error";
import { createExtractorCommand } from "../../lib/rag/extractor-format";

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

interface PendingExtraction {
  requestId: string;
  resolve: (chapters: ChapterData[]) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  bookFormat?: Book["format"];
  signal?: AbortSignal;
  abortHandler?: () => void;
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
  const [ready, setReady] = useState(false);

  // Pending extraction requests
  const pendingRequests = useRef<PendingExtraction[]>([]);

  useEffect(() => {
    return () => {
      for (const pending of pendingRequests.current) {
        clearTimeout(pending.timeoutId);
        if (pending.abortHandler) {
          pending.signal?.removeEventListener("abort", pending.abortHandler);
        }
        pending.reject(
          toBookExtractionError(new Error("Extractor WebView unmounted"), pending.bookFormat),
        );
      }
      pendingRequests.current = [];
    };
  }, []);

  useEffect(() => {
    const loadAsset = async () => {
      try {
        const asset = READER_HTML_ASSET;
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        setHtmlUri(uri);
      } catch (err) {
        console.error("[ExtractorWebView] Failed to load HTML asset:", err);
      }
    };
    loadAsset();
  }, []);

  // biome-ignore lint/suspicious/noExplicitAny: Required for React Native WebView events
  const handleMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "ready") {
        setReady(true);
      } else if (msg.type === "loaded") {
        const pending = pendingRequests.current.find(
          (request) => request.requestId === msg.requestId,
        );
        if (!pending) return;
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
        const index = pendingRequests.current.findIndex(
          (request) => request.requestId === msg.requestId,
        );
        const pending = index >= 0 ? pendingRequests.current.splice(index, 1)[0] : undefined;
        if (!pending) return;

        clearTimeout(pending.timeoutId);
        if (pending.abortHandler) {
          pending.signal?.removeEventListener("abort", pending.abortHandler);
        }
        if (msg.error) {
          pending.reject(toBookExtractionError(new Error(String(msg.error)), pending.bookFormat));
        } else if (msg.chapters) {
          pending.resolve(msg.chapters);
        }
      } else if (msg.type === "debug") {
        console.log("[ExtractorWebView]", msg.message);
      } else if (msg.type === "error") {
        console.error("[ExtractorWebView] WebView error:", msg.message);
        const index = pendingRequests.current.findIndex(
          (request) => request.requestId === msg.requestId,
        );
        const pending = index >= 0 ? pendingRequests.current.splice(index, 1)[0] : undefined;
        if (pending) {
          clearTimeout(pending.timeoutId);
          if (pending.abortHandler) {
            pending.signal?.removeEventListener("abort", pending.abortHandler);
          }
          pending.reject(toBookExtractionError(new Error(String(msg.message)), pending.bookFormat));
        }
      }
    } catch (err) {
      console.warn("[ExtractorWebView] Failed to parse message:", err);
    }
  }, []);

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
        if (!ready || !webViewRef.current) {
          return reject(
            toBookExtractionError(new Error("Extractor WebView not ready"), classificationFormat),
          );
        }

        const timeoutId = setTimeout(() => {
          const index = pendingRequests.current.findIndex((pending) => pending.reject === reject);
          if (index >= 0) pendingRequests.current.splice(index, 1);
          signal?.removeEventListener("abort", abortHandler);
          reject(
            toBookExtractionError(
              new Error("Timed out extracting book content"),
              classificationFormat,
            ),
          );
        }, EXTRACTION_TIMEOUT_MS);

        const abortHandler = () => {
          clearTimeout(timeoutId);
          const index = pendingRequests.current.indexOf(pendingRequest);
          if (index >= 0) pendingRequests.current.splice(index, 1);
          webViewRef.current?.injectJavaScript(`
            window.postMessage(${JSON.stringify(
              JSON.stringify({ type: "cancelExtraction", requestId }),
            )}, "*");
            true;
          `);
          reject(getAbortError(signal as AbortSignal));
        };
        const pendingRequest: PendingExtraction = {
          requestId,
          resolve,
          reject,
          timeoutId,
          bookFormat: classificationFormat,
          signal,
          abortHandler,
        };
        pendingRequests.current.push(pendingRequest);
        signal?.addEventListener("abort", abortHandler, { once: true });

        // Command the webview to open the book first.
        // It will reply with "loaded" when it finishes rendering.
        try {
          webViewRef.current.injectJavaScript(`
            window.postMessage(${JSON.stringify(JSON.stringify(command))}, "*");
            true;
          `);
        } catch (error) {
          clearTimeout(timeoutId);
          const index = pendingRequests.current.indexOf(pendingRequest);
          if (index >= 0) pendingRequests.current.splice(index, 1);
          signal?.removeEventListener("abort", abortHandler);
          reject(toBookExtractionError(error, classificationFormat));
        }
      });
    },
  }));

  if (!htmlUri) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ uri: htmlUri }}
        style={{ width: 0, height: 0, opacity: 0 }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={handleMessage}
      />
    </View>
  );
});
