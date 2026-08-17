import {
  type ImportBooksResult,
  type OpdsAcquisition,
  OpdsClient,
  type OpdsCredentials,
  type OpdsDownloadProgress,
  OpdsError,
  type OpdsPublication,
  downloadOpdsAcquisition,
  listSupportedAcquisitions,
  toBookMeta,
} from "@readany/core";
import { type IPlatformService, getPlatformService } from "@readany/core/services";
import { useCallback, useRef, useState } from "react";
import type { DesktopImportFile } from "../../lib/book/imported-book-meta";
import { useLibraryStore } from "../../stores/library-store";

type OpdsDownloadPlatform = Pick<
  IPlatformService,
  "writeFile" | "deleteFile" | "mkdir" | "joinPath"
>;

export interface OpdsDownloadRequest {
  publication: OpdsPublication;
  acquisition?: OpdsAcquisition;
  catalogOrigin: string;
  credentials?: OpdsCredentials;
  signal?: AbortSignal;
  onProgress?: (progress: OpdsDownloadProgress) => void;
}

export interface OpdsImportDownloadResult {
  importResult: ImportBooksResult;
  cleanupFailed: boolean;
}

export interface OpdsDownloadAdapterDependencies {
  platform: OpdsDownloadPlatform;
  client: Pick<OpdsClient, "fetchAsset">;
  importBooks(files: DesktopImportFile[]): Promise<ImportBooksResult>;
  getTempDirectory(): Promise<string>;
  createId?(): string;
  onCleanupError?(cleanupError: unknown, primaryError: unknown): void;
}

let temporaryFileSequence = 0;

function nextTemporaryName(format: string, createId?: () => string): string {
  temporaryFileSequence += 1;
  const id = createId?.() ?? crypto.randomUUID();
  return `opds-${Date.now()}-${temporaryFileSequence}-${id}.${format}`;
}

function selectedFormat(request: OpdsDownloadRequest) {
  const supported = listSupportedAcquisitions(request.publication);
  if (!request.acquisition) {
    if (supported.length === 1) return supported[0];
    throw new OpdsError("unsupported-acquisition");
  }
  const selected = supported.find(
    (choice) =>
      choice.url === request.acquisition?.url &&
      choice.type === request.acquisition.type &&
      choice.rel.join("\u0000") === request.acquisition.rel.join("\u0000"),
  );
  if (!selected) throw new OpdsError("unsupported-acquisition");
  return selected;
}

export function createOpdsDownloadAdapter(dependencies: OpdsDownloadAdapterDependencies) {
  return async (request: OpdsDownloadRequest): Promise<OpdsImportDownloadResult> => {
    const choice = selectedFormat(request);
    const tempRoot = await dependencies.getTempDirectory();
    const workspace = await dependencies.platform.joinPath(tempRoot, "readany-opds-import");
    await dependencies.platform.mkdir(workspace);
    const temporaryPath = await dependencies.platform.joinPath(
      workspace,
      nextTemporaryName(choice.format, dependencies.createId),
    );

    let primaryError: unknown;
    let importResult: ImportBooksResult | undefined;
    let cleanupFailed = false;
    try {
      await downloadOpdsAcquisition({
        ...request,
        acquisition: request.acquisition,
        client: dependencies.client,
        platform: dependencies.platform,
        destinationPath: temporaryPath,
      });
      try {
        importResult = await dependencies.importBooks([
          { path: temporaryPath, metadata: toBookMeta(request.publication) },
        ]);
      } catch {
        throw new OpdsError("import-failed");
      }
      if (importResult.failures.length > 0) throw new OpdsError("import-failed");
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        await dependencies.platform.deleteFile(temporaryPath);
      } catch (cleanupError) {
        cleanupFailed = true;
        dependencies.onCleanupError?.(cleanupError, primaryError);
      }
    }

    if (primaryError) throw primaryError;
    if (!importResult) throw new OpdsError("import-failed");
    return { importResult, cleanupFailed };
  };
}

export function useOpdsDownload() {
  const importBooks = useLibraryStore((state) => state.importBooks);
  const [progress, setProgress] = useState<OpdsDownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const download = useCallback(
    async (request: Omit<OpdsDownloadRequest, "signal" | "onProgress">) => {
      const platform = getPlatformService();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsDownloading(true);
      setProgress(null);
      try {
        const adapter = createOpdsDownloadAdapter({
          platform,
          client: new OpdsClient(platform),
          importBooks,
          getTempDirectory: async () => (await import("@tauri-apps/api/path")).tempDir(),
          onCleanupError: () => {
            console.warn("[OPDS] Temporary download cleanup failed.");
          },
        });
        return await adapter({
          ...request,
          signal: controller.signal,
          onProgress: setProgress,
        });
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        setIsDownloading(false);
      }
    },
    [importBooks],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  return { download, cancel, progress, isDownloading };
}
