import { getDesktopLibraryRoot } from "@/lib/storage/desktop-library-root";

/** Save a cover under the managed desktop library and return its relative path. */
export async function saveCoverToAppData(bookId: string, coverBlob: Blob): Promise<string> {
  const { writeFile, mkdir } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");

  const libraryRoot = await getDesktopLibraryRoot();
  const coversDir = await join(libraryRoot, "covers");
  try {
    await mkdir(coversDir, { recursive: true });
  } catch {
    // Directory may already exist.
  }

  const extension = await getCoverFileExtension(coverBlob);
  const relativePath = `covers/${bookId}.${extension}`;
  const coverPath = await join(libraryRoot, relativePath);
  const arrayBuffer = await coverBlob.arrayBuffer();
  await writeFile(coverPath, new Uint8Array(arrayBuffer));
  return relativePath;
}

export async function getCoverFileExtension(coverBlob: Blob): Promise<string> {
  const mimeExtension = extensionFromMimeType(coverBlob.type);
  if (mimeExtension) return mimeExtension;

  const bytes = new Uint8Array(await coverBlob.slice(0, 12).arrayBuffer());
  return extensionFromImageBytes(bytes) ?? "jpg";
}

export async function saveExtractedCoverIfStillMissing(
  bookId: string,
  coverBlob: Blob,
  getCurrentCoverUrl: () => string | undefined,
): Promise<string | undefined> {
  if (getCurrentCoverUrl()?.trim()) return undefined;

  const relativePath = await saveCoverToAppData(bookId, coverBlob);
  if (!getCurrentCoverUrl()?.trim()) return relativePath;

  try {
    const { remove } = await import("@tauri-apps/plugin-fs");
    const { join } = await import("@tauri-apps/api/path");
    await remove(await join(await getDesktopLibraryRoot(), relativePath));
  } catch (error) {
    console.warn("[BookMetadata] Failed to clean up rejected extracted cover:", error);
  }
  return undefined;
}

function extensionFromMimeType(mimeType: string): string | null {
  switch (mimeType.toLowerCase().split(";", 1)[0]?.trim()) {
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/png":
      return "png";
    case "image/jpg":
    case "image/jpeg":
      return "jpg";
    default:
      return null;
  }
}

function extensionFromImageBytes(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "gif";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}
