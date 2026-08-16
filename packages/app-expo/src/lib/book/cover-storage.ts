import { getPlatformService } from "@readany/core/services";

export async function saveCoverBytesToAppData(
  bookId: string,
  coverBytes: Uint8Array,
  coverMimeType?: string | null,
): Promise<string> {
  const platform = getPlatformService();
  const appData = await platform.getAppDataDir();
  const coversDir = await platform.joinPath(appData, "covers");
  try {
    await platform.mkdir(coversDir);
  } catch {
    // Directory may already exist.
  }

  const extension = getCoverFileExtension(coverBytes, coverMimeType);
  const relativePath = `covers/${bookId}.${extension}`;
  const absolutePath = await platform.joinPath(appData, relativePath);
  await platform.writeFile(absolutePath, coverBytes);
  return relativePath;
}

export function getCoverFileExtension(
  coverBytes: Uint8Array,
  coverMimeType?: string | null,
): string {
  switch (coverMimeType?.toLowerCase().split(";", 1)[0]?.trim()) {
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/png":
      return "png";
    case "image/jpg":
    case "image/jpeg":
      return "jpg";
  }

  if (coverBytes[0] === 0xff && coverBytes[1] === 0xd8 && coverBytes[2] === 0xff) return "jpg";
  if (
    coverBytes[0] === 0x89 &&
    coverBytes[1] === 0x50 &&
    coverBytes[2] === 0x4e &&
    coverBytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    coverBytes[0] === 0x47 &&
    coverBytes[1] === 0x49 &&
    coverBytes[2] === 0x46 &&
    coverBytes[3] === 0x38
  ) {
    return "gif";
  }
  if (
    coverBytes[0] === 0x52 &&
    coverBytes[1] === 0x49 &&
    coverBytes[2] === 0x46 &&
    coverBytes[3] === 0x46 &&
    coverBytes[8] === 0x57 &&
    coverBytes[9] === 0x45 &&
    coverBytes[10] === 0x42 &&
    coverBytes[11] === 0x50
  ) {
    return "webp";
  }
  return "jpg";
}

export async function saveExtractedCoverIfStillMissing(
  bookId: string,
  coverBytes: Uint8Array,
  coverMimeType: string | null | undefined,
  getCurrentCoverUrl: () => string | undefined,
): Promise<string | undefined> {
  if (getCurrentCoverUrl()?.trim()) return undefined;

  const relativePath = await saveCoverBytesToAppData(bookId, coverBytes, coverMimeType);
  if (!getCurrentCoverUrl()?.trim()) return relativePath;

  try {
    const platform = getPlatformService();
    const appData = await platform.getAppDataDir();
    await platform.deleteFile(await platform.joinPath(appData, relativePath));
  } catch (error) {
    console.warn("[BookMetadata] Failed to clean up rejected extracted cover:", error);
  }
  return undefined;
}
