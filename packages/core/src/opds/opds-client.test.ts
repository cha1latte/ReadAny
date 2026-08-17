import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchOptions } from "../services/platform";
import { OpdsClient, type OpdsCredentials, type OpdsError } from "./opds-client";

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Catalog</title>
  <entry>
    <title>Book</title>
    <link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />
  </entry>
</feed>`;

const OPENSEARCH = `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Catalog search</ShortName>
  <Url type="application/atom+xml;profile=opds-catalog" template="https://catalog.test/search?q={searchTerms}" />
</OpenSearchDescription>`;

const credentials: OpdsCredentials = {
  username: "reader",
  password: "secret-password",
  catalogOrigin: "https://catalog.test",
};

interface FetchCall {
  url: string;
  options?: FetchOptions;
}

function response(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? { "Content-Type": "application/atom+xml" },
  });
}

function fakePlatform(
  handler: (
    url: string,
    options: FetchOptions | undefined,
    call: number,
  ) => Promise<Response> | Response,
): { fetch: (url: string, options?: FetchOptions) => Promise<Response>; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    async fetch(url, options) {
      calls.push({ url, options });
      return handler(url, options, calls.length);
    },
  };
}

function authorization(call: FetchCall): string | null {
  return new Headers(call.options?.headers).get("Authorization");
}

function stalledBodyResponse(contentType = "application/atom+xml") {
  let startReading: (() => void) | undefined;
  let cancelled = false;
  const readingStarted = new Promise<void>((resolve) => {
    startReading = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    pull() {
      startReading?.();
      return new Promise<void>(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { headers: { "Content-Type": contentType } }),
    readingStarted,
    wasCancelled: () => cancelled,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

async function expectOpdsError(promise: Promise<unknown>, code: OpdsError["code"]): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "OpdsError", code });
}

describe("OpdsClient catalog requests", () => {
  it("sends Basic auth only to the configured catalog origin", async () => {
    const platform = fakePlatform(() => response(ATOM));
    const client = new OpdsClient(platform);

    await client.open("https://catalog.test/root/feed.xml", credentials);
    await client.open("https://other.test/feed.xml", credentials);

    expect(authorization(platform.calls[0] as FetchCall)).toBe(
      "Basic cmVhZGVyOnNlY3JldC1wYXNzd29yZA==",
    );
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
  });

  it("does not send Authorization for anonymous requests", async () => {
    const platform = fakePlatform(() => response(ATOM));

    await new OpdsClient(platform).open("https://catalog.test/feed.xml");

    expect(authorization(platform.calls[0] as FetchCall)).toBeNull();
  });

  it("uses manual redirects and strips Authorization after a cross-origin redirect", async () => {
    const platform = fakePlatform((url) =>
      url === "https://catalog.test/feed.xml"
        ? response("", { status: 302, headers: { Location: "https://cdn.test/feed.xml" } })
        : response(ATOM),
    );

    await new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    expect(platform.calls.map((call) => call.url)).toEqual([
      "https://catalog.test/feed.xml",
      "https://cdn.test/feed.xml",
    ]);
    expect(authorization(platform.calls[0] as FetchCall)).not.toBeNull();
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
    expect(platform.calls.every((call) => call.options?.redirect === "manual")).toBe(true);
  });

  it("rejects HTTPS-to-HTTP redirect downgrades before making the target request", async () => {
    const platform = fakePlatform(() =>
      response("", { status: 302, headers: { Location: "http://127.0.0.1/feed.xml" } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials),
      "insecure-url",
    );
    expect(platform.calls).toHaveLength(1);
  });

  it("reclassifies redirect targets and rejects embedded credentials", async () => {
    const platform = fakePlatform(() =>
      response("", {
        status: 302,
        headers: { Location: "https://reader:secret-password@catalog.test/private" },
      }),
    );

    const request = new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    await expectOpdsError(request, "insecure-url");
    await expect(request).rejects.not.toThrow("secret-password");
    expect(platform.calls).toHaveLength(1);
  });

  it("follows no more than five redirects", async () => {
    const platform = fakePlatform((_url, _options, call) =>
      response("", { status: 302, headers: { Location: `/redirect-${call}` } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
    expect(platform.calls).toHaveLength(6);
  });

  it("maps Basic challenges to unauthorized", async () => {
    const platform = fakePlatform(() =>
      response("", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Books"' } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials),
      "unauthorized",
    );
  });

  it("maps a 401 without a challenge to unauthorized", async () => {
    const platform = fakePlatform(() => response("", { status: 401 }));

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "unauthorized",
    );
  });

  it("maps unsupported authentication challenges separately", async () => {
    const platform = fakePlatform(() =>
      response("", { status: 401, headers: { "WWW-Authenticate": 'Digest realm="Books"' } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials),
      "unsupported-auth",
    );
  });

  it("passes the 15 second timeout through the platform and maps timeout failures", async () => {
    const platform = fakePlatform(() => Promise.reject(new Error("request timed out")));

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "unreachable",
    );
    expect(platform.calls[0]?.options?.timeoutMs).toBe(15_000);
  });

  it("keeps the 15 second timeout active while a catalog body is stalled", async () => {
    vi.useFakeTimers();
    const stalled = stalledBodyResponse();
    const platform = fakePlatform(() => stalled.response);
    let rejection: unknown;
    const request = new OpdsClient(platform)
      .open("https://catalog.test/feed.xml")
      .catch((error: unknown) => {
        rejection = error;
      });
    await stalled.readingStarted;

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(rejection).toMatchObject({ name: "OpdsError", code: "unreachable" });
    expect(stalled.wasCancelled()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await request;
  });

  it("keeps user cancellation active while a catalog body is stalled", async () => {
    const stalled = stalledBodyResponse();
    const platform = fakePlatform(() => stalled.response);
    const controller = new AbortController();
    const request = new OpdsClient(platform).open(
      "https://catalog.test/feed.xml",
      undefined,
      controller.signal,
    );
    await stalled.readingStarted;

    controller.abort();

    const outcome = await Promise.race([
      request.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "pending" }>((resolve) =>
        setTimeout(() => resolve({ kind: "pending" }), 0),
      ),
    ]);
    expect(outcome).toMatchObject({
      kind: "rejected",
      error: { name: "OpdsError", code: "cancelled" },
    });
    expect(stalled.wasCancelled()).toBe(true);
  });

  it("removes its abort listener and timer after body completion", async () => {
    vi.useFakeTimers();
    const platform = fakePlatform(() => response(ATOM));
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await new OpdsClient(platform).open(
      "https://catalog.test/feed.xml",
      undefined,
      controller.signal,
    );

    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a pre-cancelled request without starting network work", async () => {
    const platform = fakePlatform(() => response(ATOM));
    const controller = new AbortController();
    controller.abort();

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml", undefined, controller.signal),
      "cancelled",
    );
    expect(platform.calls).toHaveLength(0);
  });

  it("maps cancellation during platform fetch without exposing its error", async () => {
    const controller = new AbortController();
    const platform = fakePlatform(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("secret-password")));
        }),
    );
    const request = new OpdsClient(platform).open(
      "https://catalog.test/feed.xml",
      credentials,
      controller.signal,
    );

    controller.abort();

    await expectOpdsError(request, "cancelled");
    await expect(request).rejects.not.toThrow("secret-password");
  });

  it("rejects oversized catalogs from Content-Length without reading the body", async () => {
    let cancelled = false;
    const oversized = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
      {
        headers: { "Content-Type": "application/atom+xml", "Content-Length": "5242881" },
      },
    );
    const platform = fakePlatform(() => oversized);

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "too-large",
    );
    expect(cancelled).toBe(true);
  });

  it("rejects oversized decoded catalog text", async () => {
    const platform = fakePlatform(() =>
      response("x".repeat(5 * 1024 * 1024 + 1), {
        headers: { "Content-Type": "application/atom+xml" },
      }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "too-large",
    );
  });

  it("stops reading a streamed catalog as soon as it exceeds the size limit", async () => {
    let reads = 0;
    let cancelled = false;
    const oversized = response(ATOM);
    Object.defineProperty(oversized, "body", {
      value: {
        getReader: () => ({
          async read() {
            reads += 1;
            if (reads <= 2) return { done: false, value: new Uint8Array(3 * 1024 * 1024) };
            throw new Error("read beyond the limit");
          },
          async cancel() {
            cancelled = true;
          },
        }),
      },
    });
    Object.defineProperty(oversized, "text", {
      value: async () => {
        throw new Error("text fallback used");
      },
    });
    const platform = fakePlatform(() => oversized);

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "too-large",
    );
    expect(reads).toBe(2);
    expect(cancelled).toBe(true);
  });

  it("rejects unsupported content types even when the body looks like OPDS", async () => {
    const platform = fakePlatform(() =>
      response(ATOM, { headers: { "Content-Type": "text/html" } }),
    );

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
  });

  it("cancels the response stream when the content type is unsupported", async () => {
    let cancelled = false;
    const invalid = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Type": "text/html" } },
    );
    const platform = fakePlatform(() => invalid);

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
    expect(cancelled).toBe(true);
  });

  it("maps malformed supported content to invalid-catalog", async () => {
    const platform = fakePlatform(() => response("<not-a-feed />"));

    await expectOpdsError(
      new OpdsClient(platform).open("https://catalog.test/feed.xml"),
      "invalid-catalog",
    );
  });

  it("does not expose passwords from network failures", async () => {
    const platform = fakePlatform(() => Promise.reject(new Error("secret-password")));
    const request = new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    await expectOpdsError(request, "unreachable");
    await expect(request).rejects.not.toThrow("secret-password");
  });

  it("does not expose passwords from response body failures", async () => {
    const unreadable = response(ATOM);
    Object.defineProperty(unreadable, "body", { value: null });
    Object.defineProperty(unreadable, "text", {
      value: async () => {
        throw new Error("secret-password");
      },
    });
    const platform = fakePlatform(() => unreadable);
    const request = new OpdsClient(platform).open("https://catalog.test/feed.xml", credentials);

    await expectOpdsError(request, "unreachable");
    await expect(request).rejects.not.toThrow("secret-password");
  });
});

describe("OpdsClient assets", () => {
  it("rejects mismatched credential and catalog origins without sending a request", async () => {
    const platform = fakePlatform(() => response("asset", { headers: {} }));

    await expectOpdsError(
      new OpdsClient(platform).fetchAsset(
        "https://other.test/cover.jpg",
        "https://other.test",
        credentials,
      ),
      "insecure-url",
    );
    expect(platform.calls).toHaveLength(0);
  });

  it("sends credentials to cover and acquisition assets only on the exact catalog origin", async () => {
    const platform = fakePlatform(() => response("asset", { headers: {} }));
    const client = new OpdsClient(platform);

    await client.fetchAsset("https://catalog.test/cover.jpg", "https://catalog.test", credentials);
    await client.fetchAsset("https://cdn.test/book.epub", "https://catalog.test", credentials);

    expect(authorization(platform.calls[0] as FetchCall)).not.toBeNull();
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
    expect(platform.calls.every((call) => call.options?.responseType === "arraybuffer")).toBe(true);
  });

  it("strips credentials when an authenticated asset redirects across origins", async () => {
    const platform = fakePlatform((url) =>
      url === "https://catalog.test/cover.jpg"
        ? response("", { status: 302, headers: { Location: "https://cdn.test/cover.jpg" } })
        : response("asset", { headers: {} }),
    );

    await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/cover.jpg",
      "https://catalog.test",
      credentials,
    );

    expect(authorization(platform.calls[0] as FetchCall)).not.toBeNull();
    expect(authorization(platform.calls[1] as FetchCall)).toBeNull();
  });

  it("keeps user cancellation active while an asset body is being consumed", async () => {
    const stalled = stalledBodyResponse("application/epub+zip");
    const platform = fakePlatform(() => stalled.response);
    const controller = new AbortController();
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
      undefined,
      controller.signal,
    );
    const reading = asset.arrayBuffer();
    await stalled.readingStarted;

    controller.abort();

    const outcome = await Promise.race([
      reading.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "pending" }>((resolve) =>
        setTimeout(() => resolve({ kind: "pending" }), 0),
      ),
    ]);
    expect(outcome).toMatchObject({
      kind: "rejected",
      error: { name: "OpdsError", code: "cancelled" },
    });
  });

  it("keeps the timeout active while an asset body is being consumed", async () => {
    vi.useFakeTimers();
    const stalled = stalledBodyResponse("application/epub+zip");
    const platform = fakePlatform(() => stalled.response);
    const asset = await new OpdsClient(platform).fetchAsset(
      "https://catalog.test/book.epub",
      "https://catalog.test",
    );
    let rejection: unknown;
    const reading = asset.arrayBuffer().catch((error: unknown) => {
      rejection = error;
    });
    await stalled.readingStarted;

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(rejection).toMatchObject({ name: "OpdsError", code: "unreachable" });
    expect(vi.getTimerCount()).toBe(0);
    await reading;
  });
});

describe("OpdsClient search", () => {
  it("fetches an advertised OPDS 1 OpenSearch descriptor and encodes the query", async () => {
    const platform = fakePlatform((url) => {
      if (url === "https://catalog.test/open-search.xml") {
        return response(OPENSEARCH, {
          headers: { "Content-Type": "application/opensearchdescription+xml" },
        });
      }
      if (url === "https://catalog.test/search?q=cats%20%26%20dogs") return response(ATOM);
      throw new Error(`Unexpected test URL: ${url}`);
    });

    const feed = await new OpdsClient(platform).search(
      {
        kind: "openSearch",
        descriptorUrl: "https://catalog.test/open-search.xml",
      },
      "cats & dogs",
      credentials,
    );

    expect(feed.title).toBe("Catalog");
    expect(platform.calls.map((call) => call.url)).toEqual([
      "https://catalog.test/open-search.xml",
      "https://catalog.test/search?q=cats%20%26%20dogs",
    ]);
    expect(platform.calls.map(authorization)).toEqual([
      "Basic cmVhZGVyOnNlY3JldC1wYXNzd29yZA==",
      "Basic cmVhZGVyOnNlY3JldC1wYXNzd29yZA==",
    ]);
  });

  it("expands an advertised OPDS 2 URI template without allowing query injection", async () => {
    const platform = fakePlatform((url) => {
      if (url === "https://catalog.test/search?query=a%26admin%3Dtrue%23fragment") {
        return response(ATOM);
      }
      throw new Error(`Unexpected test URL: ${url}`);
    });

    await new OpdsClient(platform).search(
      { kind: "template", urlTemplate: "https://catalog.test/search{?query}" },
      "a&admin=true#fragment",
      credentials,
    );

    expect(platform.calls).toHaveLength(1);
  });

  it("does not guess search parameters for a feed without advertised search", async () => {
    const platform = fakePlatform(() => response(ATOM));

    const feed = await new OpdsClient(platform).open("https://catalog.test/feed.xml");

    expect(feed.search).toBeUndefined();
    expect(platform.calls.map((call) => call.url)).toEqual(["https://catalog.test/feed.xml"]);
  });
});
