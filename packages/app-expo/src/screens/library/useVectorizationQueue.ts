import type { ExtractorRef } from "@/components/rag/ExtractorWebView";
import { inspectMobileBookForVectorize } from "@/lib/rag/auto-vectorize-book";
import { getBookExtractionErrorMessageKeys } from "@/lib/rag/extractor-error";
import { MOBILE_VECTORIZE_UNSUPPORTED_FORMAT_DESCRIPTION } from "@/lib/rag/mobile-vectorize-capability";
import { runVectorizeQueueJob } from "@/lib/rag/vectorize-queue-job";
import { resetBookVectorization, triggerVectorizeBook } from "@/lib/rag/vectorize-trigger";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useVectorModelStore } from "@/stores/vector-model-store";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { Book, VectorizeProgress } from "@readany/core/types";
import * as FileSystem from "expo-file-system/legacy";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface UseVectorizationQueueOptions {
  extractorRef: React.RefObject<ExtractorRef | null>;
  nav: Nav;
}

export function useVectorizationQueue({ extractorRef, nav }: UseVectorizationQueueOptions) {
  const { t } = useTranslation();
  const [vectorQueue, setVectorQueue] = useState<Book[]>([]);
  const vectorQueueRef = useRef<Book[]>([]);
  const [vectorizingBookId, setVectorizingBookId] = useState<string | null>(null);
  const [vectorizingBookTitle, setVectorizingBookTitle] = useState("");
  const [vectorProgress, setVectorProgress] = useState<VectorizeProgress | null>(null);
  const isProcessingRef = useRef(false);

  const processOneBook = useCallback(
    async (book: Book) => {
      setVectorizingBookId(book.id);
      setVectorizingBookTitle(book.meta.title);
      const result = await runVectorizeQueueJob<VectorizeProgress>({
        format: book.format,
        extract: async () => {
          if (!extractorRef.current) throw new Error("Extractor WebView not ready");

          const info = await inspectMobileBookForVectorize(book);
          if (!info.canVectorize || !info.mimeType) {
            throw new Error(`Book cannot be vectorized on mobile: ${info.reason ?? "unknown"}`);
          }

          const base64 = await FileSystem.readAsStringAsync(info.absPath, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return extractorRef.current.extractChapters(
            base64,
            info.mimeType,
            book.format,
            info.absPath,
          );
        },
        vectorize: (chapters, onProgress) =>
          triggerVectorizeBook(book.id, book.filePath, chapters, onProgress),
        cleanup: () => resetBookVectorization(book.id),
        onEvent: (event) => {
          if (event.status === "extracting") {
            setVectorProgress({
              bookId: book.id,
              status: "chunking",
              processedChunks: 0,
              totalChunks: 0,
            });
          } else if (event.status === "vectorizing") {
            if (event.progress) setVectorProgress({ ...event.progress });
          } else if (event.status === "completed") {
            setVectorProgress({
              bookId: book.id,
              status: "completed",
              processedChunks: 1,
              totalChunks: 1,
            });
          } else {
            console.error(
              `[useVectorizationQueue] Vectorization failed for "${book.meta.title}":`,
              event.error,
            );
            if (event.cleanupError) {
              console.error(
                `[useVectorizationQueue] Failed to clean up "${book.meta.title}":`,
                event.cleanupError,
              );
            }
            setVectorProgress({
              bookId: book.id,
              status: "error",
              processedChunks: 0,
              totalChunks: 0,
            });

            if (event.errorCategory) {
              const keys = getBookExtractionErrorMessageKeys(event.errorCategory);
              Alert.alert(t(keys.title), t(keys.description));
            } else {
              Alert.alert(
                t("vectorize.vectorizationFailedTitle"),
                t("vectorize.vectorizationFailedDesc"),
              );
            }
          }
        },
      });

      await new Promise((resolve) => setTimeout(resolve, result.ok ? 800 : 1500));
    },
    [extractorRef, t],
  );

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      while (vectorQueueRef.current.length > 0) {
        const [nextBook, ...remainingBooks] = vectorQueueRef.current;
        if (!nextBook) break;
        vectorQueueRef.current = remainingBooks;
        setVectorQueue([...vectorQueueRef.current]);
        await processOneBook(nextBook);
      }
    } finally {
      isProcessingRef.current = false;
      setVectorizingBookId(null);
      setVectorProgress(null);
    }
  }, [processOneBook]);

  const handleVectorize = useCallback(
    (book: Book) => {
      const prepareAndQueue = async () => {
        const info = await inspectMobileBookForVectorize(book);
        if (info.reason === "unsupported-format") {
          Alert.alert(
            t("vectorize.unsupportedFormatTitle", "Unsupported format"),
            t("vectorize.unsupportedFormatDesc", MOBILE_VECTORIZE_UNSUPPORTED_FORMAT_DESCRIPTION),
          );
          return;
        }
        if (info.reason === "missing-file") {
          Alert.alert(
            t("common.error", "Error"),
            t(
              "vectorize.missingFileDesc",
              "The local book file is missing. Please download or re-import it.",
            ),
          );
          return;
        }
        const alreadyQueued = vectorQueueRef.current.some((b) => b.id === book.id);
        if (alreadyQueued || vectorizingBookId === book.id) return;

        vectorQueueRef.current = [...vectorQueueRef.current, book];
        setVectorQueue([...vectorQueueRef.current]);

        if (!isProcessingRef.current) {
          processQueue();
        }
      };

      const hasCapability = useVectorModelStore.getState().hasVectorCapability();
      if (!hasCapability) {
        Alert.alert(t("settings.vectorModel"), t("vectorize.notConfiguredDesc"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("vectorize.goSettings"),
            onPress: () => nav.navigate("VectorModelSettings"),
          },
        ]);
        return;
      }

      prepareAndQueue().catch((err) => {
        console.error(`[useVectorizationQueue] Failed to prepare "${book.meta.title}":`, err);
        Alert.alert(
          t("common.error", "Error"),
          t("vectorize.prepareFailed", "Failed to prepare vectorization."),
        );
      });
    },
    [nav, t, vectorizingBookId, processQueue],
  );

  return {
    vectorQueue,
    vectorizingBookId,
    vectorizingBookTitle,
    vectorProgress,
    handleVectorize,
  };
}
