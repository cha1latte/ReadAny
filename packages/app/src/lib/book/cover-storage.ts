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

  const extension = coverBlob.type.includes("png") ? "png" : "jpg";
  const relativePath = `covers/${bookId}.${extension}`;
  const coverPath = await join(libraryRoot, relativePath);
  const arrayBuffer = await coverBlob.arrayBuffer();
  await writeFile(coverPath, new Uint8Array(arrayBuffer));
  return relativePath;
}
