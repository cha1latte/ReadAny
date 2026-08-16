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

  const extension = coverMimeType?.includes("png") ? "png" : "jpg";
  const relativePath = `covers/${bookId}.${extension}`;
  const absolutePath = await platform.joinPath(appData, relativePath);
  await platform.writeFile(absolutePath, coverBytes);
  return relativePath;
}
