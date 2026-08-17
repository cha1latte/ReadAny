/// <reference path="./foliate-opds.d.ts" />

import { DOMParser } from "@xmldom/xmldom";
import { SYMBOL, getFeed } from "foliate-js/opds.js";
import type { BookFormat } from "../types/book";
import { sanitizeOpdsDescription } from "./opds-sanitize";
import type {
  OpdsAcquisition,
  OpdsFeed,
  OpdsLink,
  OpdsPublication,
  OpdsSearchDescriptor,
} from "./opds-types";

const ACQUISITION_REL = "http://opds-spec.org/acquisition";
const IMAGE_RELS = new Set([
  "cover",
  "thumbnail",
  "http://opds-spec.org/cover",
  "http://opds-spec.org/image",
  "http://opds-spec.org/thumbnail",
  "http://opds-spec.org/image/thumbnail",
]);

const FORMAT_BY_MEDIA_TYPE: Readonly<Record<string, BookFormat>> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "application/x-mobipocket-ebook": "mobi",
  "application/vnd.amazon.ebook": "azw",
  "application/x-fictionbook+xml": "fb2",
  "application/x-cbz": "cbz",
  "application/vnd.comicbook+zip": "cbz",
  "text/plain": "txt",
  "application/x-umd": "umd",
};

const SUPPORTED_EXTENSIONS = new Set<BookFormat>([
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "cbz",
  "fb2",
  "fbz",
  "txt",
  "umd",
]);

type UnknownRecord = Record<PropertyKey, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid OPDS 2 catalog");
  return value;
}

function normalizeRel(value: unknown): string[] {
  if (typeof value === "string") return value.trim().split(/\s+/).filter(Boolean);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return [];
}

function resolveUrl(href: string, documentUrl: string, templated = false): string {
  try {
    if (!templated) return new URL(href, documentUrl).href;

    const expressions: string[] = [];
    const protectedHref = href.replace(/\{[^}]+}/g, (expression) => {
      expressions.push(expression);
      return `__OPDS_TEMPLATE_${expressions.length - 1}__`;
    });
    let resolved = new URL(protectedHref, documentUrl).href;
    expressions.forEach((expression, index) => {
      resolved = resolved.replace(`__OPDS_TEMPLATE_${index}__`, expression);
    });
    return resolved;
  } catch {
    throw new Error("Invalid OPDS catalog URL");
  }
}

function mapLink(value: unknown, documentUrl: string): OpdsLink | undefined {
  if (!isRecord(value)) return undefined;
  const href = optionalString(value.href) ?? optionalString(value.url);
  if (!href) return undefined;
  const rel = normalizeRel(value.rel);
  const link: OpdsLink = {
    rel,
    url: resolveUrl(href, documentUrl),
  };
  const type = optionalString(value.type);
  const title = optionalString(value.title);
  if (type) link.type = type;
  if (title) link.title = title;
  return link;
}

function asRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getMetadata(value: UnknownRecord): UnknownRecord {
  return isRecord(value.metadata) ? value.metadata : {};
}

function normalizeNames(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    if (!isRecord(item)) return [];
    const name = optionalString(item.name);
    return name ? [name] : [];
  });
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string");
  if (isRecord(value)) return optionalString(value.name);
  return undefined;
}

function normalizeSubjects(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    if (!isRecord(item)) return [];
    const name =
      optionalString(item.name) ?? optionalString(item.label) ?? optionalString(item.code);
    return name ? [name] : [];
  });
}

function getDescription(metadata: UnknownRecord): string | undefined {
  const description = optionalString(metadata.description);
  if (description) return sanitizeOpdsDescription(description);

  const content = metadata[SYMBOL.CONTENT];
  if (!isRecord(content)) return undefined;
  const value = optionalString(content.value);
  return value ? sanitizeOpdsDescription(value) : undefined;
}

function getBookFormat(type: string | undefined, url: string): BookFormat | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/, 1)[0] ?? "";
  }
  const extension = pathname.match(/\.([^.\/]+)$/)?.[1]?.toLowerCase() as BookFormat | undefined;
  if (extension && SUPPORTED_EXTENSIONS.has(extension)) return extension;

  const mediaType = type?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType ? (FORMAT_BY_MEDIA_TYPE[mediaType] ?? null) : null;
}

function mapAcquisition(value: unknown, documentUrl: string): OpdsAcquisition | undefined {
  const link = mapLink(value, documentUrl);
  if (!link || !link.rel.some((rel) => rel.startsWith(ACQUISITION_REL))) return undefined;
  return { ...link, format: getBookFormat(link.type, link.url) };
}

function mapPublication(
  value: unknown,
  documentUrl: string,
  atomIds?: ReadonlyMap<string, string>,
): OpdsPublication {
  if (!isRecord(value)) throw new Error("Invalid OPDS 2 catalog");
  const metadata = getMetadata(value);
  const title = requiredString(metadata.title);
  const rawLinks = asRecords(value.links);
  const acquisitions = rawLinks.flatMap((item) => {
    const acquisition = mapAcquisition(item, documentUrl);
    return acquisition ? [acquisition] : [];
  });
  const imageValues = Array.isArray(value.images)
    ? value.images
    : rawLinks.filter((link) => normalizeRel(link.rel).some((rel) => IMAGE_RELS.has(rel)));
  const images = imageValues.flatMap((item) => {
    const image = mapLink(item, documentUrl);
    return image ? [image] : [];
  });

  const rawAcquisitionHref = rawLinks.find((item) =>
    normalizeRel(item.rel).some((rel) => rel.startsWith(ACQUISITION_REL)),
  )?.href;
  const atomId =
    typeof rawAcquisitionHref === "string" ? atomIds?.get(rawAcquisitionHref) : undefined;
  const identifier = optionalString(metadata.identifier);
  const publication: OpdsPublication = {
    title,
    authors: normalizeNames(metadata.author),
    subjects: normalizeSubjects(metadata.subject),
    images,
    acquisitions,
  };
  const id = atomId ?? optionalString(value.id) ?? identifier;
  const publisher = firstString(metadata.publisher);
  const language = firstString(metadata.language);
  const published = optionalString(metadata.published);
  const description = getDescription(metadata);
  if (id) publication.id = id;
  if (publisher) publication.publisher = publisher;
  if (language) publication.language = language;
  if (identifier) publication.identifier = identifier;
  if (published) publication.published = published;
  if (description) publication.description = description;
  return publication;
}

function findLink(links: UnknownRecord[], relName: string): UnknownRecord | undefined {
  return links.find((link) => normalizeRel(link.rel).includes(relName));
}

function mapSearch(links: UnknownRecord[], documentUrl: string): OpdsSearchDescriptor | undefined {
  const link = findLink(links, "search");
  if (!link) return undefined;
  const href = optionalString(link.href);
  if (!href) return undefined;
  const type = optionalString(link.type);
  const title = optionalString(link.title);
  if (link.templated === true || href.includes("{")) {
    return {
      kind: "template",
      urlTemplate: resolveUrl(href, documentUrl, true),
      ...(title ? { title } : {}),
      ...(type ? { type } : {}),
    };
  }
  if (type?.split(";", 1)[0]?.trim().toLowerCase() === "application/opensearchdescription+xml") {
    return {
      kind: "openSearch",
      descriptorUrl: resolveUrl(href, documentUrl),
      ...(title ? { title } : {}),
      type,
    };
  }
  return undefined;
}

function mapFeed(
  value: unknown,
  documentUrl: string,
  atomIds?: ReadonlyMap<string, string>,
): OpdsFeed {
  if (!isRecord(value)) throw new Error("Invalid OPDS 2 catalog");
  const metadata = getMetadata(value);
  const title = requiredString(metadata.title);
  const links = asRecords(value.links);
  const next = findLink(links, "next");
  const previous = findLink(links, "previous");
  const nextHref = next ? optionalString(next.href) : undefined;
  const previousHref = previous ? optionalString(previous.href) : undefined;

  const feed: OpdsFeed = {
    title,
    navigation: asRecords(value.navigation).map((item) => ({
      title: requiredString(item.title),
      url: resolveUrl(requiredString(item.href), documentUrl),
    })),
    publications: asRecords(value.publications).map((publication) =>
      mapPublication(publication, documentUrl, atomIds),
    ),
    groups: asRecords(value.groups).map((group) => mapFeed(group, documentUrl, atomIds)),
    facets: asRecords(value.facets).map((facet) => ({
      title: requiredString(getMetadata(facet).title),
      links: asRecords(facet.links).flatMap((item) => {
        const link = mapLink(item, documentUrl);
        return link ? [link] : [];
      }),
    })),
  };
  const subtitle = optionalString(metadata.subtitle);
  const search = mapSearch(links, documentUrl);
  if (subtitle) feed.subtitle = subtitle;
  if (nextHref) feed.nextUrl = resolveUrl(nextHref, documentUrl);
  if (previousHref) feed.previousUrl = resolveUrl(previousHref, documentUrl);
  if (search) feed.search = search;
  return feed;
}

function validateArrayProperty(value: UnknownRecord, name: string): void {
  if (name in value && !Array.isArray(value[name])) throw new Error("Invalid OPDS 2 catalog");
}

function getArrayProperty(value: UnknownRecord, name: string): unknown[] {
  validateArrayProperty(value, name);
  const property = value[name];
  return Array.isArray(property) ? property : [];
}

function validateLink(value: unknown): void {
  if (!isRecord(value) || typeof value.href !== "string") throw new Error("Invalid OPDS 2 catalog");
  if (
    "rel" in value &&
    typeof value.rel !== "string" &&
    !(Array.isArray(value.rel) && value.rel.every((item) => typeof item === "string"))
  ) {
    throw new Error("Invalid OPDS 2 catalog");
  }
}

function validateFeed(value: unknown): asserts value is UnknownRecord {
  if (!isRecord(value) || !isRecord(value.metadata) || typeof value.metadata.title !== "string") {
    throw new Error("Invalid OPDS 2 catalog");
  }
  for (const name of ["links", "navigation", "publications", "groups", "facets"]) {
    validateArrayProperty(value, name);
  }
  for (const link of getArrayProperty(value, "links")) validateLink(link);
  for (const item of getArrayProperty(value, "navigation")) {
    validateLink(item);
    if (!isRecord(item) || typeof item.title !== "string")
      throw new Error("Invalid OPDS 2 catalog");
  }
  for (const publication of getArrayProperty(value, "publications")) {
    if (
      !isRecord(publication) ||
      !isRecord(publication.metadata) ||
      typeof publication.metadata.title !== "string"
    ) {
      throw new Error("Invalid OPDS 2 catalog");
    }
    for (const link of getArrayProperty(publication, "links")) validateLink(link);
    for (const image of getArrayProperty(publication, "images")) validateLink(image);
  }
  for (const group of getArrayProperty(value, "groups")) validateFeed(group);
  for (const facet of getArrayProperty(value, "facets")) {
    if (!isRecord(facet) || !isRecord(facet.metadata) || typeof facet.metadata.title !== "string") {
      throw new Error("Invalid OPDS 2 catalog");
    }
    for (const link of getArrayProperty(facet, "links")) validateLink(link);
  }
}

function removeDoctypeAndEntityReferences(body: string): string {
  const withoutDoctype = body.replace(/<!DOCTYPE(?:[^<>\[]|\[[\s\S]*?\])*>/gi, "");
  return withoutDoctype.replace(/&(?!(?:amp|lt|gt|quot|apos);)[A-Za-z_][\w.:-]*;/g, "");
}

function getElementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function getAtomIds(document: Document): Map<string, string> {
  const result = new Map<string, string>();
  const entries = Array.from(
    document.getElementsByTagNameNS("http://www.w3.org/2005/Atom", "entry"),
  );
  for (const entry of entries) {
    const children = getElementChildren(entry);
    const id = children.find((child) => child.localName === "id")?.textContent;
    if (!id) continue;
    for (const link of children.filter((child) => child.localName === "link")) {
      const rel = link.getAttribute("rel") ?? "";
      const href = link.getAttribute("href");
      if (href && rel.split(/\s+/).some((item) => item.startsWith(ACQUISITION_REL))) {
        result.set(href, id);
      }
    }
  }
  return result;
}

function parseXml(body: string, documentUrl: string): OpdsFeed {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => errors.push(message),
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(removeDoctypeAndEntityReferences(body), "application/xml");
  if (errors.length > 0 || document.documentElement.localName !== "feed") {
    throw new Error("Invalid OPDS XML document");
  }

  try {
    const normalized = getFeed(document as unknown as Document);
    return mapFeed(normalized, documentUrl, getAtomIds(document as unknown as Document));
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid OPDS XML document") throw error;
    throw new Error("Invalid OPDS XML document");
  }
}

function parseJson(body: string, documentUrl: string): OpdsFeed {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Invalid OPDS JSON document");
  }
  validateFeed(value);
  return mapFeed(value, documentUrl);
}

export function parseOpdsDocument(
  body: string,
  contentType: string,
  documentUrl: string,
): OpdsFeed {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/opds+json" || mediaType === "application/json") {
    return parseJson(body, documentUrl);
  }
  return parseXml(body, documentUrl);
}
