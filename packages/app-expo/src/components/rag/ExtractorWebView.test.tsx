import React, { createRef, createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { download, inject } = vi.hoisted(() => ({
  download: vi.fn(async () => {}),
  inject: vi.fn(),
}));
await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const assetPath = require.resolve("../../../assets/reader/reader.html");
  require.cache[assetPath] = { exports: "reader-asset" } as NodeModule;
});
vi.mock("expo-asset", () => ({
  Asset: { fromModule: () => ({ downloadAsync: download, localUri: "file:///reader.html" }) },
}));
vi.mock("react-native", () => ({ View: "View", StyleSheet: { create: (s: unknown) => s } }));
vi.mock("react-native-webview", async () => {
  const React = await import("react");
  return {
    WebView: React.forwardRef((props, ref) => {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: inject }));
      return React.createElement("MockWebView", props);
    }),
  };
});
import { type ExtractorRef, ExtractorWebView } from "./ExtractorWebView";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const ref = createRef<ExtractorRef>();
function extractor() {
  if (!ref.current) throw new Error("Extractor not mounted");
  return ref.current;
}
let renderer: TestRenderer.ReactTestRenderer;
const views = () => renderer.root.findAllByType("MockWebView" as never);
const message = (type: string, extra = {}) =>
  views()[0].props.onMessage({ nativeEvent: { data: JSON.stringify({ type, ...extra }) } });
const requestIds = () =>
  inject.mock.calls
    .filter(([code]) => code.includes("openBook"))
    .map(
      ([code]) =>
        JSON.parse(JSON.parse(code.match(/window\.postMessage\((.*), "\*"\)/s)[1])).requestId,
    );
const chapters = [{ index: 0, title: "Chapter", content: "Text", segments: [] }];

beforeEach(async () => {
  vi.useFakeTimers();
  inject.mockReset();
  download.mockReset().mockResolvedValue(undefined);
  await act(async () => {
    renderer = TestRenderer.create(createElement(ExtractorWebView, { ref }));
  });
});
afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
  vi.useRealTimers();
});

describe("request-scoped extractor WebView", () => {
  it("mounts only on demand, waits for ready, and releases after the result", async () => {
    expect(views()).toHaveLength(0);
    expect(download).not.toHaveBeenCalled();
    let result!: ReturnType<ExtractorRef["extractChapters"]>;
    await act(async () => {
      result = extractor().extractChapters("book", undefined, "epub");
    });
    expect(views()).toHaveLength(1);
    expect(views()[0].props.source.uri).toBe("file:///reader.html#readany-extractor");
    expect(inject).not.toHaveBeenCalled();
    await act(async () => {
      message("ready");
    });
    const [requestId] = requestIds();
    expect(requestId).toBeTruthy();
    await act(async () => {
      message("loaded", { requestId });
    });
    expect(inject.mock.lastCall?.[0]).toContain("handleExtractChapters");
    await act(async () => {
      message("chaptersExtracted", { requestId, chapters });
    });
    await expect(result).resolves.toEqual(chapters);
    expect(views()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a concurrent request alive when another is cancelled", async () => {
    const abort = new AbortController();
    let first!: Promise<unknown>;
    let second!: ReturnType<ExtractorRef["extractChapters"]>;
    await act(async () => {
      first = extractor()
        .extractChapters("A", undefined, "epub", undefined, abort.signal)
        .catch((e) => e);
      second = extractor().extractChapters("B", undefined, "epub");
    });
    await act(async () => {
      message("ready");
    });
    const [, requestId] = requestIds();
    await act(async () => {
      abort.abort();
    });
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(views()).toHaveLength(1);
    await act(async () => {
      message("chaptersExtracted", { requestId, chapters });
    });
    await expect(second).resolves.toEqual(chapters);
    expect(views()).toHaveLength(0);
  });

  it("cancels during asset loading and ignores its late completion", async () => {
    let finish!: () => void;
    download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const abort = new AbortController();
    let result!: Promise<unknown>;
    await act(async () => {
      result = extractor()
        .extractChapters("book", undefined, "epub", undefined, abort.signal)
        .catch((e) => e);
    });
    await act(async () => {
      abort.abort();
    });
    expect(await result).toMatchObject({ name: "AbortError" });
    await act(async () => {
      finish();
    });
    expect(views()).toHaveLength(0);
    expect(inject).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out waiting for readiness and lets the next request start fresh", async () => {
    let result!: Promise<unknown>;
    await act(async () => {
      result = extractor()
        .extractChapters("book", undefined, "epub")
        .catch((e) => e);
    });
    const oldMessage = views()[0].props.onMessage;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(await result).toMatchObject({ message: expect.stringContaining("Timed out") });
    expect(views()).toHaveLength(0);
    const abort = new AbortController();
    await act(async () => {
      result = extractor()
        .extractChapters("new", undefined, "epub", undefined, abort.signal)
        .catch((e) => e);
    });
    inject.mockClear();
    await act(async () => {
      oldMessage({ nativeEvent: { data: '{"type":"ready"}' } });
    });
    expect(inject).not.toHaveBeenCalled();
    await act(async () => {
      message("ready");
    });
    expect(requestIds()).toHaveLength(1);
    await act(async () => {
      abort.abort();
    });
    await result;
  });

  it("rejects a native loading failure and releases the host", async () => {
    let result!: Promise<unknown>;
    await act(async () => {
      result = extractor()
        .extractChapters("book", undefined, "epub")
        .catch((e) => e);
    });
    await act(async () => {
      views()[0].props.onError({ nativeEvent: { description: "Load failed" } });
    });
    expect(await result).toMatchObject({ message: expect.stringContaining("Load failed") });
    expect(views()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects pending work on unmount", async () => {
    let result!: Promise<unknown>;
    await act(async () => {
      result = extractor()
        .extractChapters("book", undefined, "epub")
        .catch((e) => e);
    });
    await act(async () => {
      renderer.unmount();
    });
    expect(await result).toMatchObject({ message: expect.stringContaining("unmounted") });
    expect(vi.getTimerCount()).toBe(0);
  });
});
