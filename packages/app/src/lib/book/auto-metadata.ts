import { resolveDesktopDataPath } from "@/lib/storage/desktop-library-root";
import type { Book } from "@readany/core/types";
import type { ExtractedBookMetadata } from "@readany/core/utils";
import { saveCoverToAppData } from "./cover-storage";
import { fromDocumentMetadata } from "./imported-book-meta";

export async function extractLocalBookMetadata(book: Book): Promise<ExtractedBookMetadata | null> {
  if (book.syncStatus === "remote" || !isRepairableFormat(book.format) || !book.filePath) {
    return null;
  }

  try {
    const filePath = await resolveDesktopDataPath(book.filePath);
    const { exists, readFile } = await import("@tauri-apps/plugin-fs");
    if (!(await exists(filePath))) return null;
    const bytes = await readFile(filePath);
    const fileName = book.filePath.split(/[\\/]/).pop() || `${book.id}.${book.format}`;
    const file = new File([bytes], fileName, { type: "application/octet-stream" });
    const { DocumentLoader } = await import("@/lib/reader/document-loader");
    const { book: document } = await new DocumentLoader(file).open();
    const metadata = fromDocumentMetadata(document.metadata as unknown as Record<string, unknown>);
    if (book.meta.coverUrl?.trim()) return metadata;

    try {
      const coverBlob = await document.getCover?.();
      if (!coverBlob) return metadata;
      return { ...metadata, coverUrl: await saveCoverToAppData(book.id, coverBlob) };
    } catch (error) {
      console.warn("[BookMetadata] Failed to extract or persist local cover:", error);
      return metadata;
    }
  } catch (error) {
    console.warn("[BookMetadata] Failed to extract local metadata:", error);
    return null;
  }
}

function isRepairableFormat(format: Book["format"]): boolean {
  return format === "epub" || format === "mobi" || format === "azw" || format === "azw3";
}
