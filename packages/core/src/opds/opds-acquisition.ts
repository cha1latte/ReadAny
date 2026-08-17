import type { IPlatformService } from "../services/platform";
import type { BookFormat, BookMeta } from "../types/book";
import { normalizeIsbn } from "../utils/book-metadata";
import { type OpdsAssetResponse, type OpdsClient, OpdsError } from "./opds-client";
import type { OpdsAcquisition, OpdsCredentials, OpdsPublication } from "./opds-types";

const FORMAT_BY_MEDIA_TYPE: Readonly<Record<string, BookFormat>> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/x-mobipocket-ebook": "mobi",
  "application/vnd.amazon.ebook": "azw",
  "application/vnd.amazon.mobi8-ebook": "azw3",
  "application/x-fictionbook+xml": "fb2",
  "application/x-fictionbook+zip": "fbz",
  "application/x-zip-compressed-fb2": "fbz",
  "application/vnd.comicbook+zip": "cbz",
  "application/x-cbz": "cbz",
  "text/plain": "txt",
  "application/x-umd": "umd",
};

const SUPPORTED_FORMATS = new Set<BookFormat>([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "fb2",
  "fbz",
  "cbz",
  "txt",
  "umd",
]);

const DIRECT_ACQUISITION_REL = "http://opds-spec.org/acquisition";

export interface SupportedOpdsAcquisition extends OpdsAcquisition {
  format: BookFormat;
  suggestedFileName: string;
}

export interface OpdsDownloadProgress {
  loaded: number;
  total: number;
}

export interface DownloadOpdsAcquisitionInput {
  publication: OpdsPublication;
  acquisition?: OpdsAcquisition;
  client: Pick<OpdsClient, "fetchAsset">;
  platform: Pick<IPlatformService, "writeFile">;
  catalogOrigin: string;
  credentials?: OpdsCredentials;
  destinationPath: string;
  signal?: AbortSignal;
  onProgress?: (progress: OpdsDownloadProgress) => void;
}

export interface DownloadOpdsAcquisitionResult {
  acquisition: SupportedOpdsAcquisition;
  destinationPath: string;
  suggestedFileName: string;
  bytesWritten: number;
}

function mediaType(type: string | undefined): string {
  return type?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function extensionFromUrl(url: string): string | undefined {
  try {
    return new URL(url).pathname.match(/\.([^.\/]+)$/)?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

function getSupportedFormat(acquisition: OpdsAcquisition): BookFormat | undefined {
  const normalizedMediaType = mediaType(acquisition.type);
  const extension = extensionFromUrl(acquisition.url) as BookFormat | undefined;
  if (normalizedMediaType === "application/vnd.amazon.ebook" && extension === "azw3") {
    return "azw3";
  }
  const advertised = FORMAT_BY_MEDIA_TYPE[normalizedMediaType];
  if (advertised) return advertised;
  if (extension && SUPPORTED_FORMATS.has(extension)) return extension;
  if (acquisition.format && SUPPORTED_FORMATS.has(acquisition.format)) return acquisition.format;
  return undefined;
}

function isDirectAcquisition(acquisition: OpdsAcquisition): boolean {
  return acquisition.rel.some(
    (rel) => rel === DIRECT_ACQUISITION_REL || rel.startsWith(`${DIRECT_ACQUISITION_REL}/`),
  );
}

export function sanitizeOpdsFileName(title: string, format: BookFormat): string {
  const withoutControls = Array.from(title, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? "" : character;
  }).join("");
  const base = withoutControls
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^[ .-]+|[ .]+$/g, "")
    .slice(0, 120)
    .replace(/[ .]+$/g, "");
  const safeBase = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base) ? `_${base}` : base;
  return `${safeBase || "book"}.${format}`;
}

export function listSupportedAcquisitions(
  publication: OpdsPublication,
): SupportedOpdsAcquisition[] {
  return publication.acquisitions.flatMap((acquisition) => {
    if (!isDirectAcquisition(acquisition)) return [];
    const format = getSupportedFormat(acquisition);
    if (!format) return [];
    return [
      {
        ...acquisition,
        format,
        suggestedFileName: sanitizeOpdsFileName(publication.title, format),
      },
    ];
  });
}

export function toBookMeta(publication: OpdsPublication): Partial<BookMeta> {
  const isbn = normalizeIsbn(publication.identifier);
  return {
    title: publication.title,
    author: publication.authors.join(", "),
    ...(publication.publisher ? { publisher: publication.publisher } : {}),
    ...(publication.language ? { language: publication.language } : {}),
    ...(isbn ? { isbn } : {}),
    ...(publication.published ? { publishDate: publication.published } : {}),
    ...(publication.description ? { description: publication.description } : {}),
    ...(publication.subjects.length > 0 ? { subjects: [...publication.subjects] } : {}),
  };
}

function sameAcquisition(left: OpdsAcquisition, right: OpdsAcquisition): boolean {
  return (
    left.url === right.url &&
    mediaType(left.type) === mediaType(right.type) &&
    left.rel.length === right.rel.length &&
    left.rel.every((rel, index) => rel === right.rel[index])
  );
}

function selectAcquisition(input: DownloadOpdsAcquisitionInput): SupportedOpdsAcquisition {
  const supported = listSupportedAcquisitions(input.publication);
  if (!input.acquisition) {
    if (supported.length === 1) return supported[0];
    throw new OpdsError("unsupported-acquisition");
  }
  const requested = input.acquisition;
  const selected = supported.find((choice) => sameAcquisition(choice, requested));
  if (!selected) throw new OpdsError("unsupported-acquisition");
  return selected;
}

function parseContentLength(response: OpdsAssetResponse): number {
  const value = Number(response.headers.get("Content-Length"));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OpdsError("cancelled");
}

function mapDownloadError(error: unknown): OpdsError {
  if (error instanceof OpdsError) {
    if (
      error.code === "cancelled" ||
      error.code === "insecure-url" ||
      error.code === "unauthorized" ||
      error.code === "unsupported-auth" ||
      error.code === "unsupported-acquisition"
    ) {
      return error;
    }
  }
  return new OpdsError("download-failed");
}

async function readAsset(
  response: OpdsAssetResponse,
  signal: AbortSignal | undefined,
  onProgress: ((progress: OpdsDownloadProgress) => void) | undefined,
): Promise<Uint8Array> {
  const total = parseContentLength(response);
  let loaded = 0;
  onProgress?.({ loaded, total });
  throwIfCancelled(signal);

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    throwIfCancelled(signal);
    loaded = bytes.byteLength;
    onProgress?.({ loaded: total > 0 ? Math.min(loaded, total) : loaded, total });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      throwIfCancelled(signal);
      const { done, value } = await reader.read();
      throwIfCancelled(signal);
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded: total > 0 ? Math.min(loaded, total) : loaded, total });
    }
  } catch (error) {
    await response.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadOpdsAcquisition(
  input: DownloadOpdsAcquisitionInput,
): Promise<DownloadOpdsAcquisitionResult> {
  const acquisition = selectAcquisition(input);
  if (!input.destinationPath.trim()) throw new OpdsError("download-failed");
  throwIfCancelled(input.signal);

  let response: OpdsAssetResponse | undefined;
  try {
    response = await input.client.fetchAsset(
      acquisition.url,
      input.catalogOrigin,
      input.credentials,
      input.signal,
    );
    const bytes = await readAsset(response, input.signal, input.onProgress);
    throwIfCancelled(input.signal);
    await input.platform.writeFile(input.destinationPath, bytes);
    throwIfCancelled(input.signal);
    return {
      acquisition,
      destinationPath: input.destinationPath,
      suggestedFileName: acquisition.suggestedFileName,
      bytesWritten: bytes.byteLength,
    };
  } catch (error) {
    if (input.signal?.aborted) {
      await response?.cancel().catch(() => {});
      throw new OpdsError("cancelled");
    }
    throw mapDownloadError(error);
  }
}
