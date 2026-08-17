import type { Book } from "@readany/core/types";

const SUPPORTED_FORMATS = new Set<Book["format"]>([
  "epub",
  "pdf",
  "txt",
  "umd",
  "mobi",
  "azw",
  "azw3",
]);

const FORMAT_BY_MIME_TYPE: Partial<Record<string, Book["format"]>> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/vnd.amazon.ebook": "azw3",
  "application/x-mobipocket-ebook": "mobi",
  "text/plain": "txt",
};

function asSupportedFormat(value: string | undefined): Book["format"] | null {
  const normalized = value?.trim().toLowerCase() as Book["format"] | undefined;
  return normalized && SUPPORTED_FORMATS.has(normalized) ? normalized : null;
}

export function resolveExtractorFormat(input: {
  bookFormat?: string;
  mimeType?: string;
  fileName?: string;
}): Book["format"] | null {
  const storedFormat = asSupportedFormat(input.bookFormat);
  if (storedFormat) return storedFormat;

  const cleanFileName = input.fileName?.split(/[?#]/, 1)[0];
  const extension = cleanFileName?.split(".").pop();
  const fileFormat = asSupportedFormat(extension);
  if (fileFormat) return fileFormat;

  const normalizedMimeType = input.mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  return normalizedMimeType ? FORMAT_BY_MIME_TYPE[normalizedMimeType] || null : null;
}
