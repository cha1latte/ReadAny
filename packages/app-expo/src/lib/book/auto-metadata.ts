import {
  createRangeReadableFile,
  extractBookMetadataFromFile,
} from "@/lib/book/metadata-extractor";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import type { ExtractedBookMetadata } from "@readany/core/utils";
import { saveCoverBytesToAppData } from "./cover-storage";

export async function extractLocalBookMetadata(book: Book): Promise<ExtractedBookMetadata | null> {
  if (book.syncStatus === "remote" || !isRepairableFormat(book.format) || !book.filePath) {
    return null;
  }

  try {
    const platform = getPlatformService();
    const appData = await platform.getAppDataDir();
    const filePath = isRelativeAppPath(book.filePath)
      ? await platform.joinPath(appData, book.filePath)
      : book.filePath;
    const fileSize = await getMobileFileSize(filePath);
    if (fileSize == null) return null;

    const fileName = book.filePath.split(/[\\/]/).pop() || `${book.id}.${book.format}`;
    const rangeReadable = await createRangeReadableFile(filePath, fileSize);
    const metadata = await extractBookMetadataFromFile(rangeReadable, book.format, fileName);
    if (book.meta.coverUrl?.trim() || !metadata.coverBytes?.length) return metadata;

    try {
      const coverUrl = await saveCoverBytesToAppData(
        book.id,
        metadata.coverBytes,
        metadata.coverMimeType,
      );
      return { ...metadata, coverUrl };
    } catch (error) {
      console.warn("[BookMetadata] Failed to persist extracted cover:", error);
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

function isRelativeAppPath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.startsWith("file://") &&
    !path.startsWith("asset://") &&
    !path.startsWith("http")
  );
}

async function getMobileFileSize(path: string): Promise<number | null> {
  const LegacyFileSystem = await import("expo-file-system/legacy");
  const info = await LegacyFileSystem.getInfoAsync(path);
  return info.exists && !info.isDirectory ? (info.size ?? 0) : null;
}
