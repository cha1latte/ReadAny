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
      const document = React.useRef({ book: "" });
      React.useImperativeHandle(ref, () => ({
        injectJavaScript: (code: string) => inject(code, document.current),
      }));
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
  it.each(["before ready", "during load", "during extraction"])(
    "isolates distinct book contents when the second request arrives %s",
    async (arrival) => {
      const opens: Array<{ requestId: string; base64: string; document: { book: string } }> = [];
      const extractionResults: Array<() => void> = [];
      inject.mockImplementation((code: string, document: { book: string }) => {
        if (code.includes("openBook")) {
          const command = JSON.parse(
            JSON.parse(code.match(/window\.postMessage\((.*), "\*"\)/s)?.[1] ?? "null"),
          );
          opens.push({ ...command, document });
        } else if (code.includes("handleExtractChapters")) {
          const requestId = JSON.parse(
            code.match(/window\.handleExtractChapters\((.*?)\)/)?.[1] ?? "null",
          );
          const onMessage = views()[0].props.onMessage;
          // The extraction callback reads the document's current book, just as
          // the shared reader does; request IDs do not isolate that state.
          extractionResults.push(() =>
            onMessage({
              nativeEvent: {
                data: JSON.stringify({
                  type: "chaptersExtracted",
                  requestId,
                  chapters: [{ ...chapters[0], content: document.book }],
                }),
              },
            }),
          );
        }
      });
      let first!: Promise<unknown>;
      let second!: Promise<unknown>;
      const startSecond = () => {
        second = extractor()
          .extractChapters("Book B")
          .catch((e) => e);
      };
      await act(async () => {
        first = extractor()
          .extractChapters("Book A")
          .catch((e) => e);
        if (arrival === "before ready") startSecond();
      });
      await act(async () => message("ready"));
      await act(async () => {
        if (arrival === "during load") startSecond();
        opens[0].document.book = opens[0].base64;
        message("loaded", { requestId: opens[0].requestId });
        if (arrival === "during extraction") startSecond();
      });
      expect(opens).toHaveLength(1);
      await act(async () => extractionResults[0]());
      expect(await first).toEqual([{ ...chapters[0], content: "Book A" }]);
      expect(views()).toHaveLength(1);
      await act(async () => message("ready"));
      expect(opens).toHaveLength(2);
      expect(opens[1].document).not.toBe(opens[0].document);
      await act(async () => {
        opens[1].document.book = opens[1].base64;
        message("loaded", { requestId: opens[1].requestId });
      });
      await act(async () => extractionResults[1]());
      expect(await second).toEqual([{ ...chapters[0], content: "Book B" }]);
      expect(views()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

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
    const oldMessage = views()[0].props.onMessage;
    await act(async () => {
      abort.abort();
    });
    expect(await first).toMatchObject({ name: "AbortError" });
    expect(views()).toHaveLength(1);
    await act(async () => message("ready"));
    const [, requestId] = requestIds();
    await act(async () => {
      oldMessage({
        nativeEvent: {
          data: JSON.stringify({ type: "chaptersExtracted", requestId, chapters: [] }),
        },
      });
      message("chaptersExtracted", { requestId, chapters });
    });
    await expect(second).resolves.toEqual(chapters);
    expect(views()).toHaveLength(0);
  });

  it("cancels a queued request without disturbing the active document", async () => {
    const abort = new AbortController();
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = extractor()
        .extractChapters("A")
        .catch((e) => e);
      second = extractor()
        .extractChapters("B", undefined, "epub", undefined, abort.signal)
        .catch((e) => e);
    });
    await act(async () => message("ready"));
    const activeView = views()[0];
    const [requestId] = requestIds();
    inject.mockClear();
    await act(async () => abort.abort());
    expect(await second).toMatchObject({ name: "AbortError" });
    expect(inject).not.toHaveBeenCalled();
    expect(views()[0]).toBe(activeView);
    await act(async () => message("chaptersExtracted", { requestId, chapters }));
    expect(await first).toEqual(chapters);
    expect(views()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases all pending requests after native process termination and can restart", async () => {
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = extractor()
        .extractChapters("A")
        .catch((e) => e);
      second = extractor()
        .extractChapters("B")
        .catch((e) => e);
    });
    const oldError = views()[0].props.onRenderProcessGone;
    await act(async () => oldError());
    expect(await first).toMatchObject({ message: expect.stringContaining("process terminated") });
    expect(await second).toMatchObject({ message: expect.stringContaining("process terminated") });
    expect(views()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    for (let i = 0; i < 3; i++) {
      let result!: Promise<unknown>;
      await act(async () => {
        result = extractor()
          .extractChapters("new")
          .catch((e) => e);
      });
      await act(async () => {
        oldError();
        message("ready");
      });
      const requestId = requestIds().at(-1);
      await act(async () => message("chaptersExtracted", { requestId, chapters }));
      expect(await result).toEqual(chapters);
      expect(views()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    }
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
