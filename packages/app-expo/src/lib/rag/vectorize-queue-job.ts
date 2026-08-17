import type { ChapterData } from "@readany/core/rag";
import {
  BookExtractionError,
  type BookExtractionErrorCategory,
  toBookExtractionError,
} from "./extractor-error";

export type VectorizeQueueJobEvent<Progress> =
  | { status: "extracting" }
  | { status: "vectorizing"; progress?: Progress }
  | { status: "completed" }
  | {
      status: "error";
      error: unknown;
      errorCategory?: BookExtractionErrorCategory;
      cleanupError?: unknown;
    };

export type VectorizeQueueJobResult =
  | { ok: true }
  | { ok: false; error: unknown; cleanupError?: unknown };

interface VectorizeQueueJobOptions<Progress> {
  format?: string;
  extract: () => Promise<ChapterData[]>;
  vectorize: (chapters: ChapterData[], onProgress?: (progress: Progress) => void) => Promise<void>;
  cleanup: () => Promise<void>;
  onEvent: (event: VectorizeQueueJobEvent<Progress>) => void;
}

function isCompletedProgress(progress: unknown): boolean {
  return (
    typeof progress === "object" &&
    progress !== null &&
    "status" in progress &&
    progress.status === "completed"
  );
}

export async function runVectorizeQueueJob<Progress>(
  options: VectorizeQueueJobOptions<Progress>,
): Promise<VectorizeQueueJobResult> {
  let phase: "extracting" | "vectorizing" = "extracting";
  options.onEvent({ status: "extracting" });

  try {
    const chapters = await options.extract();
    if (!chapters.length) {
      throw toBookExtractionError(new Error("No chapters extracted from book"), options.format);
    }

    phase = "vectorizing";
    options.onEvent({ status: "vectorizing" });
    await options.vectorize(chapters, (progress) => {
      if (!isCompletedProgress(progress)) {
        options.onEvent({ status: "vectorizing", progress });
      }
    });

    options.onEvent({ status: "completed" });
    return { ok: true };
  } catch (error) {
    const failure = phase === "extracting" ? toBookExtractionError(error, options.format) : error;
    let cleanupError: unknown;
    try {
      await options.cleanup();
    } catch (errorDuringCleanup) {
      cleanupError = errorDuringCleanup;
    }

    options.onEvent({
      status: "error",
      error: failure,
      errorCategory: failure instanceof BookExtractionError ? failure.category : undefined,
      cleanupError,
    });
    return cleanupError
      ? { ok: false, error: failure, cleanupError }
      : { ok: false, error: failure };
  }
}
