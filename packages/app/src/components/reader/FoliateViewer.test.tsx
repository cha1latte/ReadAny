import type { BookDoc } from "@/lib/reader/document-loader";
import type { ViewSettings } from "@readany/core/types";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StrictMode, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoliateViewer, type FoliateViewerHandle } from "./FoliateViewer";

const mocks = vi.hoisted(() => ({
  wrap: vi.fn(),
  ruby: vi.fn(),
  getRuby: vi.fn(() => "zh-pinyin"),
  selection: vi.fn(),
}));
vi.mock("@/hooks/reader/useFoliateView", () => ({ wrappedFoliateView: mocks.wrap }));
vi.mock("foliate-js/view.js", () => ({}));
vi.mock("foliate-js/overlayer.js", () => ({ Overlayer: {} }));
vi.mock("@/hooks/reader/usePagination", () => ({ usePagination: () => {} }));
vi.mock("@/lib/ai/reading-context-service", () => ({
  readingContextService: { updateSelection: mocks.selection, updateLocation: vi.fn() },
}));
vi.mock("@/lib/reader/iframe-event-handlers", () => ({ registerIframeEventHandlers: vi.fn() }));
vi.mock("@/lib/reader/document-loader", () => ({
  isFixedLayoutBook: (format: string) => format === "PDF",
  getDirection: vi.fn(),
}));
vi.mock("@readany/core/stores/ruby-store", () => ({
  useRubyStore: { getState: () => ({ getBookRuby: mocks.getRuby }) },
}));
vi.mock("@/lib/ruby/pinyin-processor", () => ({ isPinyinDictLoaded: () => true }));
vi.mock("@/lib/ruby/ruby-injector", () => ({ injectRubyAnnotations: mocks.ruby }));

function createView(element: HTMLElement, openGate?: Promise<void>) {
  const doc = document.implementation.createHTMLDocument("Chapter");
  doc.body.innerHTML = '<p data-translate-id="p1">Some chapter text</p>';
  const renderer = Object.assign(document.createElement("div"), {
    setStyles: vi.fn(),
    render: vi.fn(),
    getContents: () => [{ doc, index: 0 }],
    page: 2,
    pages: 8,
    size: 800,
    scrolled: false,
  });
  const view = Object.assign(element, {
    renderer,
    book: { toc: [{ label: "Chapter", subitems: [{ label: "Nested" }] }] },
    open: vi.fn(async () => {
      await openGate;
    }),
    close: vi.fn(),
    init: vi.fn(async () => {}),
    goToFraction: vi.fn(async () => {
      view.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } }));
    }),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    goLeft: vi.fn(),
    goRight: vi.fn(),
    setSearchIndicator: vi.fn(),
    getCFI: () => "epubcfi(/6/2)",
  });
  return view;
}

const settings = {
  fontSize: 18,
  lineHeight: 1.6,
  fontTheme: "sans",
  useBookFonts: false,
  paragraphSpacing: 1,
  viewMode: "paginated",
  paginatedLayout: "double",
  pageMargin: 40,
} as ViewSettings;
let views: ReturnType<typeof createView>[];
let bookDoc: BookDoc;
let gate: Promise<void> | undefined;

beforeEach(() => {
  views = [];
  gate = undefined;
  bookDoc = { sections: [], rendition: {} } as unknown as BookDoc;
  vi.clearAllMocks();
  mocks.wrap.mockImplementation((element: HTMLElement) => {
    const view = createView(element, gate);
    views.push(view);
    return view;
  });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function props() {
  return { bookKey: "book", bookDoc, format: "EPUB" as const, viewSettings: settings };
}
async function opened() {
  await waitFor(() => expect(views[0]?.goToFraction).toHaveBeenCalledOnce());
  return views[0];
}

describe("FoliateViewer lifecycle", () => {
  it("opens once across rerenders and delivers first load, TOC, ruby, and search styling", async () => {
    const onLoaded = vi.fn();
    const onTocReady = vi.fn();
    const ui = render(<FoliateViewer {...props()} onLoaded={onLoaded} onTocReady={onTocReady} />);
    const view = await opened();
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(onTocReady.mock.calls[0][0][0].subitems[0].title).toBe("Nested");
    expect(view.setSearchIndicator).toHaveBeenCalledWith("outline", { color: "#3b82f6" });
    await waitFor(() => expect(mocks.ruby).toHaveBeenCalled());
    const latestLoaded = vi.fn();
    ui.rerender(<FoliateViewer {...props()} lastLocation="updated" onLoaded={latestLoaded} />);
    act(() =>
      view.dispatchEvent(
        new CustomEvent("load", {
          detail: { doc: view.renderer.getContents()[0].doc, index: 0 },
        }),
      ),
    );
    expect(views).toHaveLength(1);
    expect(view.open).toHaveBeenCalledOnce();
    expect(onLoaded).toHaveBeenCalledOnce();
    expect(latestLoaded).toHaveBeenCalledOnce();
  });

  it("cancels an opening reader on unmount without navigation or callbacks", async () => {
    let finish = () => {};
    gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onTocReady = vi.fn();
    const ui = render(<FoliateViewer {...props()} onTocReady={onTocReady} />);
    await waitFor(() => expect(views).toHaveLength(1));
    const view = views[0];
    ui.unmount();
    await act(async () => {
      finish();
      await gate;
    });
    expect(view.isConnected).toBe(false);
    expect(view.close).toHaveBeenCalled();
    expect(view.goToFraction).not.toHaveBeenCalled();
    expect(onTocReady).not.toHaveBeenCalled();
  });

  it("survives StrictMode setup and cleanup without duplicate readers", async () => {
    const onLoaded = vi.fn();
    const ui = render(
      <StrictMode>
        <FoliateViewer {...props()} onLoaded={onLoaded} />
      </StrictMode>,
    );
    await opened();
    expect(ui.container.querySelectorAll("foliate-view")).toHaveLength(1);
    expect(onLoaded).toHaveBeenCalledOnce();
  });

  it("replaces a book and ignores events from the disposed reader", async () => {
    const onLoaded = vi.fn();
    const ui = render(<FoliateViewer {...props()} onLoaded={onLoaded} />);
    const oldView = await opened();
    const nextBook = { ...bookDoc };
    ui.rerender(
      <FoliateViewer
        {...props()}
        bookKey="next"
        bookDoc={nextBook}
        lastLocation="epubcfi(/6/4)"
        onLoaded={onLoaded}
      />,
    );
    await waitFor(() =>
      expect(views[1]?.init).toHaveBeenCalledWith({ lastLocation: "epubcfi(/6/4)" }),
    );
    expect(oldView.close).toHaveBeenCalledOnce();
    expect(oldView.isConnected).toBe(false);
    act(() =>
      oldView.dispatchEvent(
        new CustomEvent("load", {
          detail: { doc: oldView.renderer.getContents()[0].doc, index: 0 },
        }),
      ),
    );
    expect(onLoaded).toHaveBeenCalledOnce();
  });

  it("uses the latest selection callback without registering a second listener", async () => {
    const oldSelection = vi.fn();
    const newSelection = vi.fn();
    const ui = render(<FoliateViewer {...props()} onSelection={oldSelection} />);
    const view = await opened();
    const doc = view.renderer.getContents()[0].doc;
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    Object.assign(range, { getClientRects: () => [new DOMRect(0, 0, 100, 20)] });
    vi.spyOn(doc, "getSelection").mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => "Some chapter text",
    } as unknown as Selection);
    ui.rerender(<FoliateViewer {...props()} onSelection={newSelection} />);
    act(() => doc.dispatchEvent(new MouseEvent("pointerup")));
    await waitFor(() => expect(newSelection).toHaveBeenCalledOnce());
    expect(oldSelection).not.toHaveBeenCalled();
    expect(newSelection.mock.calls[0][0].text).toBe("Some chapter text");
  });

  it("updates theme and fixed-layout zoom without reopening the book", async () => {
    const ui = render(<FoliateViewer {...props()} format="PDF" />);
    await waitFor(() => expect(views[0]?.init).toHaveBeenCalledOnce());
    const view = views[0];
    ui.rerender(
      <FoliateViewer
        {...props()}
        format="PDF"
        viewSettings={{ ...settings, fixedLayoutZoom: 1.5, paginatedLayout: "single" }}
      />,
    );
    expect(view.renderer.getAttribute("zoom-factor")).toBe("1.5");
    expect(view.renderer.getAttribute("spread")).toBe("none");
    view.renderer.setStyles.mockClear();
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "sepia");
    });
    await waitFor(() => expect(view.renderer.setStyles).toHaveBeenCalled());
    expect(view.renderer.setStyles.mock.lastCall?.[0]).toContain("#f0e6d2");
    expect(view.open).toHaveBeenCalledOnce();
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies relevant settings without reopening or repaginating unrelated updates", async () => {
    const ui = render(<FoliateViewer {...props()} />);
    const view = await opened();
    view.renderer.setStyles.mockClear();
    view.renderer.render.mockClear();
    ui.rerender(<FoliateViewer {...props()} viewSettings={{ ...settings }} />);
    expect(view.renderer.setStyles).not.toHaveBeenCalled();
    expect(view.renderer.render).not.toHaveBeenCalled();
    ui.rerender(<FoliateViewer {...props()} viewSettings={{ ...settings, fontSize: 24 }} />);
    expect(view.renderer.setStyles).toHaveBeenCalled();
    expect(view.renderer.render).not.toHaveBeenCalled();
    ui.rerender(<FoliateViewer {...props()} viewSettings={{ ...settings, pageMargin: 60 }} />);
    expect(view.renderer.getAttribute("margin-top")).toBe("60px");
    expect(view.renderer.render).toHaveBeenCalledOnce();
    expect(view.open).toHaveBeenCalledOnce();
  });

  it("uses current settings and callbacks when opening completes after a rerender", async () => {
    let finish = () => {};
    gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const oldToc = vi.fn();
    const newToc = vi.fn();
    const ui = render(<FoliateViewer {...props()} onTocReady={oldToc} />);
    await waitFor(() => expect(views).toHaveLength(1));
    ui.rerender(
      <FoliateViewer
        {...props()}
        onTocReady={newToc}
        viewSettings={{ ...settings, pageMargin: 70 }}
      />,
    );
    await act(async () => {
      finish();
      await gate;
    });
    const view = await opened();
    expect(view.renderer.getAttribute("margin-top")).toBe("70px");
    expect(oldToc).not.toHaveBeenCalled();
    expect(newToc).toHaveBeenCalledOnce();
  });

  it("keeps one selection listener per document and removes it on unmount", async () => {
    const post = vi.spyOn(window, "postMessage");
    const ui = render(<FoliateViewer {...props()} />);
    const view = await opened();
    const doc = view.renderer.getContents()[0].doc;
    act(() => view.dispatchEvent(new CustomEvent("load", { detail: { doc, index: 0 } })));
    act(() => doc.dispatchEvent(new MouseEvent("pointerup", { clientX: 100, clientY: 100 })));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    act(() => doc.dispatchEvent(new MouseEvent("pointerup", { clientX: 100, clientY: 100 })));
    ui.unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(post).toHaveBeenCalledOnce();
    act(() => doc.dispatchEvent(new MouseEvent("pointerup", { clientX: 100, clientY: 100 })));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(post).toHaveBeenCalledOnce();
  });

  it("preserves translation visibility, remote fonts and imperative navigation", async () => {
    const ref = createRef<FoliateViewerHandle>();
    const ui = render(<FoliateViewer {...props()} ref={ref} />);
    const view = await opened();
    const doc = view.renderer.getContents()[0].doc;
    doc.body.insertAdjacentHTML("beforeend", '<div class="readany-translation">Translated</div>');
    ref.current?.applyChapterTranslationVisibility(false, true);
    expect(doc.querySelector("p")?.getAttribute("data-original-hidden")).toBe("true");
    expect(doc.querySelector(".readany-translation")?.getAttribute("data-solo")).toBe("true");
    ref.current?.removeChapterTranslations();
    expect(doc.querySelector(".readany-translation")).toBeNull();
    ui.rerender(
      <FoliateViewer
        {...props()}
        ref={ref}
        viewSettings={{ ...settings, customFontCssUrls: ["https://example.com/font.css"] }}
      />,
    );
    expect(doc.querySelectorAll("link[data-readany-remote-font-link]")).toHaveLength(1);
    ui.rerender(<FoliateViewer {...props()} ref={ref} />);
    expect(doc.querySelectorAll("link[data-readany-remote-font-link]")).toHaveLength(0);
    ref.current?.goNext();
    expect(view.next).toHaveBeenCalledOnce();
  });

  it("provides a keyboard control action without doubling reader shortcuts", async () => {
    const post = vi.spyOn(window, "postMessage");
    const ui = render(<FoliateViewer {...props()} />);
    const view = await opened();
    fireEvent.click(ui.getByRole("button", { name: "Toggle reader controls" }));
    expect(post).toHaveBeenCalledOnce();
    fireEvent.keyDown(ui.container.querySelector(".foliate-viewer") as HTMLElement, {
      key: "ArrowRight",
    });
    expect(view.goRight).toHaveBeenCalledOnce();
  });
});
