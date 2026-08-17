import { DOMParser } from "@xmldom/xmldom";
import { getOpenSearch, getSearch } from "foliate-js/opds.js";
import type { FetchOptions, IPlatformService } from "../services/platform";
import { parseOpdsDocument } from "./opds-parser";
import { classifyOpdsUrl } from "./opds-security";
import type { OpdsCredentials, OpdsErrorCode, OpdsFeed, OpdsSearchDescriptor } from "./opds-types";

const CATALOG_ACCEPT =
  "application/opds+json, application/atom+xml;profile=opds-catalog, application/xml;q=0.8";
const OPENSEARCH_ACCEPT = "application/opensearchdescription+xml, application/xml;q=0.8";
const CATALOG_MEDIA_TYPES = new Set([
  "application/opds+json",
  "application/json",
  "application/atom+xml",
  "application/xml",
  "text/xml",
]);
const OPENSEARCH_MEDIA_TYPES = new Set([
  "application/opensearchdescription+xml",
  "application/xml",
  "text/xml",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;

const ERROR_MESSAGES: Record<OpdsErrorCode, string> = {
  unauthorized: "Catalog authentication failed.",
  "unsupported-auth": "The catalog requires an unsupported authentication method.",
  "insecure-url": "The catalog URL is not allowed.",
  unreachable: "The catalog could not be reached.",
  "invalid-catalog": "The response is not a valid OPDS catalog.",
  cancelled: "The catalog request was cancelled.",
  "too-large": "The catalog response is too large.",
};

interface SearchDocument {
  search(values: Map<string | null, Map<string, string>>): string;
  params: Array<{ name: string; ns?: string | null }>;
}

interface RequestResult {
  response: Response;
  finalUrl: string;
}

interface RequestOptions {
  accept: string;
  responseType: "text" | "arraybuffer";
  credentials?: OpdsCredentials;
  catalogOrigin?: string;
  signal?: AbortSignal;
}

type OpdsFetchPlatform = Pick<IPlatformService, "fetch">;

export type { OpdsCredentials, OpdsErrorCode } from "./opds-types";

export class OpdsError extends Error {
  readonly code: OpdsErrorCode;

  constructor(code: OpdsErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "OpdsError";
    this.code = code;
  }
}

function asOpdsError(error: unknown, signal?: AbortSignal): OpdsError {
  if (error instanceof OpdsError) return error;
  if (signal?.aborted) return new OpdsError("cancelled");
  return new OpdsError("unreachable");
}

function normalizeAllowedOrigin(value: string): string {
  const classification = classifyOpdsUrl(value);
  if (!classification.allowed) throw new OpdsError("insecure-url");
  try {
    return new URL(value).origin;
  } catch {
    throw new OpdsError("insecure-url");
  }
}

function encodeBase64(value: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new TextEncoder().encode(value);
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(bits >> 18) & 63];
    encoded += alphabet[(bits >> 12) & 63];
    encoded += second === undefined ? "=" : alphabet[(bits >> 6) & 63];
    encoded += third === undefined ? "=" : alphabet[bits & 63];
  }
  return encoded;
}

function getAuthOrigin(credentials?: OpdsCredentials, override?: string): string | undefined {
  if (!credentials) return undefined;
  return normalizeAllowedOrigin(override ?? credentials.catalogOrigin);
}

function getHeaders(
  current: URL,
  accept: string,
  credentials?: OpdsCredentials,
  authOrigin?: string,
): Headers {
  const headers = new Headers({ Accept: accept });
  if (credentials && authOrigin === current.origin) {
    headers.set(
      "Authorization",
      `Basic ${encodeBase64(`${credentials.username}:${credentials.password}`)}`,
    );
  }
  return headers;
}

function authError(response: Response): OpdsError | undefined {
  if (response.status !== 401) return undefined;
  const challenge = response.headers.get("WWW-Authenticate");
  if (!challenge || /(?:^|,)\s*basic(?:\s|$)/i.test(challenge)) {
    return new OpdsError("unauthorized");
  }
  return new OpdsError("unsupported-auth");
}

function checkUrl(value: string): URL {
  const classification = classifyOpdsUrl(value);
  if (!classification.allowed) throw new OpdsError("insecure-url");
  try {
    return new URL(value);
  } catch {
    throw new OpdsError("insecure-url");
  }
}

function runPlatformFetch(
  platform: OpdsFetchPlatform,
  url: string,
  options: FetchOptions,
  userSignal?: AbortSignal,
): Promise<Response> {
  if (userSignal?.aborted) return Promise.reject(new OpdsError("cancelled"));

  const controller = new AbortController();
  let timedOut = false;
  const onUserAbort = () => controller.abort();
  userSignal?.addEventListener("abort", onUserAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abortPromise = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new OpdsError(timedOut ? "unreachable" : "cancelled")),
      { once: true },
    );
  });

  return Promise.race([
    platform.fetch(url, { ...options, signal: controller.signal }),
    abortPromise,
  ]).finally(() => {
    clearTimeout(timeout);
    userSignal?.removeEventListener("abort", onUserAbort);
  });
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_CATALOG_BYTES) {
      throw new OpdsError("too-large");
    }
  }

  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_CATALOG_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // The bounded read has already failed safely; cancellation is best effort.
          }
          throw new OpdsError("too-large");
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } catch (error) {
      if (error instanceof OpdsError) throw error;
      throw new OpdsError("unreachable");
    }
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new OpdsError("unreachable");
  }
  if (new TextEncoder().encode(body).byteLength > MAX_CATALOG_BYTES) {
    throw new OpdsError("too-large");
  }
  return body;
}

function getMediaType(response: Response): string {
  return response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function removeDoctypeAndEntityReferences(body: string): string {
  const withoutDoctype = body.replace(/<!DOCTYPE(?:[^<>\[]|\[[\s\S]*?\])*>/gi, "");
  return withoutDoctype.replace(/&(?!(?:amp|lt|gt|quot|apos);)[A-Za-z_][\w.:-]*;/g, "");
}

function parseOpenSearch(body: string): SearchDocument {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => errors.push(message),
      error: (message) => errors.push(message),
      fatalError: (message) => errors.push(message),
    },
  }).parseFromString(removeDoctypeAndEntityReferences(body), "application/xml");
  if (errors.length > 0) throw new OpdsError("invalid-catalog");
  try {
    const result = getOpenSearch(document as unknown as Document) as Partial<SearchDocument>;
    if (typeof result.search !== "function" || !Array.isArray(result.params)) {
      throw new OpdsError("invalid-catalog");
    }
    return result as SearchDocument;
  } catch {
    throw new OpdsError("invalid-catalog");
  }
}

async function expandTemplate(
  descriptor: Extract<OpdsSearchDescriptor, { kind: "template" }>,
  query: string,
) {
  try {
    const search = (await getSearch({
      href: descriptor.urlTemplate,
      title: descriptor.title,
      type: descriptor.type,
    })) as Partial<SearchDocument>;
    if (typeof search.search !== "function" || !Array.isArray(search.params)) {
      throw new OpdsError("invalid-catalog");
    }
    const names = new Set(search.params.map((param) => param.name));
    if (!names.has("query") && !names.has("searchTerms")) {
      throw new OpdsError("invalid-catalog");
    }
    const values = new Map<string, string>([
      ["query", query],
      ["searchTerms", query],
    ]);
    return search.search(new Map([[null, values]]));
  } catch (error) {
    if (error instanceof OpdsError) throw error;
    throw new OpdsError("invalid-catalog");
  }
}

export class OpdsClient {
  constructor(private readonly platform: OpdsFetchPlatform) {}

  private async request(url: string, options: RequestOptions): Promise<RequestResult> {
    const authOrigin = getAuthOrigin(options.credentials, options.catalogOrigin);
    let current = checkUrl(url);

    for (let redirects = 0; ; redirects += 1) {
      if (options.signal?.aborted) throw new OpdsError("cancelled");
      const headers = getHeaders(current, options.accept, options.credentials, authOrigin);
      let response: Response;
      try {
        response = await runPlatformFetch(
          this.platform,
          current.href,
          {
            headers,
            redirect: "manual",
            timeoutMs: REQUEST_TIMEOUT_MS,
            responseType: options.responseType,
          },
          options.signal,
        );
      } catch (error) {
        throw asOpdsError(error, options.signal);
      }

      const authenticationError = authError(response);
      if (authenticationError) throw authenticationError;
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (!response.ok) throw new OpdsError("unreachable");
        return { response, finalUrl: current.href };
      }
      if (redirects >= MAX_REDIRECTS) throw new OpdsError("invalid-catalog");

      const location = response.headers.get("Location");
      if (!location) throw new OpdsError("invalid-catalog");
      let next: URL;
      try {
        next = checkUrl(new URL(location, current).href);
      } catch (error) {
        if (error instanceof OpdsError) throw error;
        throw new OpdsError("insecure-url");
      }
      if (current.protocol === "https:" && next.protocol === "http:") {
        throw new OpdsError("insecure-url");
      }
      current = next;
    }
  }

  async open(url: string, credentials?: OpdsCredentials, signal?: AbortSignal): Promise<OpdsFeed> {
    const { response, finalUrl } = await this.request(url, {
      accept: CATALOG_ACCEPT,
      responseType: "text",
      credentials,
      signal,
    });
    const contentType = getMediaType(response);
    if (!CATALOG_MEDIA_TYPES.has(contentType)) throw new OpdsError("invalid-catalog");
    const body = await readLimitedText(response);
    try {
      return parseOpdsDocument(body, contentType, finalUrl);
    } catch (error) {
      if (error instanceof OpdsError) throw error;
      throw new OpdsError("invalid-catalog");
    }
  }

  async search(
    descriptor: OpdsSearchDescriptor,
    query: string,
    credentials?: OpdsCredentials,
    signal?: AbortSignal,
  ): Promise<OpdsFeed> {
    if (descriptor.kind === "template") {
      const searchUrl = await expandTemplate(descriptor, query);
      return this.open(searchUrl, credentials, signal);
    }

    const { response, finalUrl } = await this.request(descriptor.descriptorUrl, {
      accept: OPENSEARCH_ACCEPT,
      responseType: "text",
      credentials,
      signal,
    });
    if (!OPENSEARCH_MEDIA_TYPES.has(getMediaType(response))) {
      throw new OpdsError("invalid-catalog");
    }
    const search = parseOpenSearch(await readLimitedText(response));
    if (!search.params.some((param) => param.name === "searchTerms" && !param.ns)) {
      throw new OpdsError("invalid-catalog");
    }
    let searchUrl: string;
    try {
      searchUrl = new URL(
        search.search(new Map([[null, new Map([["searchTerms", query]])]])),
        finalUrl,
      ).href;
    } catch {
      throw new OpdsError("invalid-catalog");
    }
    return this.open(searchUrl, credentials, signal);
  }

  async fetchAsset(
    url: string,
    catalogOrigin: string,
    credentials?: OpdsCredentials,
    signal?: AbortSignal,
  ): Promise<Response> {
    const { response } = await this.request(url, {
      accept: "*/*",
      responseType: "arraybuffer",
      credentials,
      catalogOrigin,
      signal,
    });
    return response;
  }
}
