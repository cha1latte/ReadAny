import { useLibraryStore } from "@/stores/library-store";
import { useVectorModelStore } from "@/stores/vector-model-store";
import {
  resetBookVectorization as coreResetBookVectorization,
  triggerVectorizeBook as coreTriggerVectorizeBook,
} from "@readany/core/rag";
import type {
  ChapterData,
  VectorizeStatusCallback,
  VectorizeTriggerConfig,
} from "@readany/core/rag";

export type { VectorizeStatusCallback };

export async function resetBookVectorization(bookId: string): Promise<void> {
  await coreResetBookVectorization(bookId, {
    onBookUpdate: useLibraryStore.getState().updateBookStrict,
  });
}

export async function triggerVectorizeBook(
  bookId: string,
  _filePath: string,
  chapters: ChapterData[],
  onProgress?: VectorizeStatusCallback,
): Promise<void> {
  const vmState = useVectorModelStore.getState();

  // 1. Build configuration for the core pipeline
  const config: VectorizeTriggerConfig = {
    vectorModelEnabled: vmState.vectorModelEnabled,
    vectorModelMode: vmState.vectorModelMode,
    selectedBuiltinModelId: vmState.selectedBuiltinModelId,
    remoteModel: (() => {
      const selected = vmState.getSelectedVectorModel();
      if (!selected) return null;
      return {
        url: selected.url,
        apiKey: selected.apiKey,
        modelId: selected.modelId,
      };
    })(),
  };

  // 2. Build callbacks for state updates
  const callbacks = {
    onBookUpdate: useLibraryStore.getState().updateBookStrict,
  };

  // 3. Delegate to core vectorization pipeline which does the chunking & embedding
  await coreTriggerVectorizeBook(bookId, chapters, config, callbacks, onProgress);
}
