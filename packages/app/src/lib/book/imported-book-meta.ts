import type { BookMeta } from "@readany/core/types";
import { type ExtractedBookMetadata, mergeBookMetadataSources } from "@readany/core/utils";

type EmbeddedBookMetadata = ExtractedBookMetadata & { coverUrl?: string };

export function buildImportedBookMeta(input: {
  existing?: Partial<BookMeta>;
  opds?: Partial<BookMeta>;
  embedded?: EmbeddedBookMetadata;
  fallbackTitle: string;
}): BookMeta {
  const merged = mergeBookMetadataSources(input.existing, input.opds, input.embedded, {
    title: input.fallbackTitle,
    author: "",
  });

  return {
    ...input.existing,
    ...merged,
    title: merged.title || input.existing?.title || "Untitled",
    author: merged.author || input.existing?.author || "",
  };
}

export function fromDocumentMetadata(
  meta: Record<string, unknown> | undefined,
): ExtractedBookMetadata {
  const authorValue = meta?.author;
  const subjectValues = Array.isArray(meta?.subject)
    ? meta.subject
    : meta?.subject == null
      ? []
      : [meta.subject];
  const subjects = subjectValues
    .map((value) =>
      typeof value === "string" ? value : String((value as { name?: string }).name || ""),
    )
    .filter(Boolean);

  return {
    title:
      typeof meta?.title === "string"
        ? meta.title
        : String(Object.values((meta?.title as object) || {})[0] || ""),
    author:
      typeof authorValue === "string"
        ? authorValue
        : String((authorValue as { name?: string } | undefined)?.name || ""),
    publisher: typeof meta?.publisher === "string" ? meta.publisher : undefined,
    language: typeof meta?.language === "string" ? meta.language : undefined,
    isbn: typeof meta?.identifier === "string" ? meta.identifier : undefined,
    publishDate: typeof meta?.published === "string" ? meta.published : undefined,
    description: typeof meta?.description === "string" ? meta.description : undefined,
    subjects,
  };
}
