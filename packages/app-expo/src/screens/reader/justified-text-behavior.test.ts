// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface BookPolicy {
  decision: "pending" | "apply" | "preserve";
}

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../assets/reader/justified-text.js"),
  "utf8",
);
function fixture() {
  document.documentElement.replaceChildren();
  document.documentElement.innerHTML = `<html><head><style>
    body, p { text-align: left; }
    #publisher { text-align: left !important; }
    .center { text-align: center; }
  </style></head><body>
    <p id="publisher">Publisher paragraph</p>
    <p id="inline" style="text-align: left !important">Inline paragraph</p>
    <div id="prose">Div prose<br>Second line</div>
    <p id="breaks">Paragraph<br>Second line</p>
    <div class="center" id="center">Centered text</div>
    <p id="right" style="text-align: right">Right text</p>
    <pre id="code">Preserved code</pre>
  </body></html>`;
  const context: Record<string, unknown> = {};
  runInNewContext(source, context);
  const doc = window.document;
  const api = (
    context as {
      ReadAnyJustifiedText: {
        apply: (doc: Document, enabled: boolean, unsupported: boolean, policy?: BookPolicy) => void;
        createBookPolicy: () => BookPolicy;
      };
    }
  ).ReadAnyJustifiedText;
  const alignment = (id: string) => {
    const element = doc.getElementById(id);
    if (!element) throw new Error(`Missing fixture element: ${id}`);
    return window.getComputedStyle(element).textAlign;
  };
  return { doc, api, alignment };
}

describe("reader-side justified text helper", () => {
  it("overrides publisher alignment and supports div prose and line breaks", () => {
    const { api, doc, alignment } = fixture();
    expect(alignment("publisher")).toBe("left");
    api.apply(doc, true, false);
    for (const id of ["publisher", "inline", "prose", "breaks"]) {
      expect(alignment(id), id).toBe("justify");
    }
    expect(alignment("center")).toBe("center");
    expect(alignment("right")).toBe("right");
    expect(alignment("code")).not.toBe("justify");
  });

  it("restores original declarations across repeated toggles and unsupported layouts", () => {
    const { api, doc, alignment } = fixture();
    for (const unsupported of [false, true]) {
      api.apply(doc, true, false);
      api.apply(doc, true, false);
      expect(alignment("center")).toBe("center");
      api.apply(doc, unsupported, unsupported);
      expect(alignment("publisher")).toBe("left");
      expect(alignment("inline")).toBe("left");
      expect(alignment("right")).toBe("right");
      expect(doc.getElementById("inline")?.style.getPropertyPriority("text-align")).toBe(
        "important",
      );
      expect(doc.getElementById("prose")?.hasAttribute("style")).toBe(false);
    }
  });
  it("re-reads publisher styles and leaves unsupported layouts untouched", () => {
    const { api, doc, alignment } = fixture();
    api.apply(doc, true, true);
    expect(doc.querySelectorAll("[data-readany-justify-body]")).toHaveLength(0);
    api.apply(doc, true, false);
    const publisher = doc.getElementById("publisher");
    if (!publisher) throw new Error("Missing publisher fixture");
    publisher.style.setProperty("color", "red");
    const style = doc.createElement("style");
    style.textContent = "#publisher { text-align: center !important; }";
    doc.head.appendChild(style);
    api.apply(doc, true, false);
    expect(alignment("publisher")).toBe("center");
    api.apply(doc, false, false);
    expect(publisher.style.color).toBe("red");
    expect(alignment("publisher")).toBe("center");
  });
  it("does not mutate already-justified prose when toggled or reapplied", () => {
    const { api, doc } = fixture();
    doc.head.innerHTML = "<style>body, p { text-align: justify; }</style>";
    doc.body.innerHTML =
      '<p>Publisher-justified prose<br>Next line</p><p style="text-align: justify !important">Inline justification</p>';
    const original = doc.documentElement.outerHTML;
    const mutations = new MutationObserver(() => {});
    mutations.observe(doc.documentElement, { attributes: true, childList: true, subtree: true });
    try {
      api.apply(doc, true, false);
      api.apply(doc, true, false);
      api.apply(doc, false, false);
      expect(mutations.takeRecords()).toHaveLength(0);
      expect(doc.documentElement.outerHTML).toBe(original);
    } finally {
      mutations.disconnect();
    }
  });
  it("preserves the whole book if the opening chapter contains justified prose", () => {
    const { api, doc } = fixture();
    doc.body.insertAdjacentHTML("beforeend", '<p style="text-align:justify">Publisher prose</p>');
    const policy = api.createBookPolicy();
    const original = doc.documentElement.outerHTML;
    const mutations = new MutationObserver(() => {});
    mutations.observe(doc.documentElement, { attributes: true, childList: true, subtree: true });
    api.apply(doc, true, false, policy);
    expect(policy.decision).toBe("preserve");
    expect(mutations.takeRecords()).toHaveLength(0);
    mutations.disconnect();
    expect(doc.documentElement.outerHTML).toBe(original);

    doc.body.innerHTML = '<p style="text-align:left">Later prose</p>';
    const computed = vi.spyOn(window, "getComputedStyle");
    const scan = vi.spyOn(doc, "querySelectorAll");
    try {
      api.apply(doc, true, false, policy);
      api.apply(doc, false, false, policy);
      expect(computed).not.toHaveBeenCalled();
      expect(scan).not.toHaveBeenCalled();
      expect(doc.body.innerHTML).toBe('<p style="text-align:left">Later prose</p>');
    } finally {
      computed.mockRestore();
      scan.mockRestore();
    }
  });

  it("decides once using the opening chapter and resets for another book", () => {
    const { api, doc } = fixture();
    const policy = api.createBookPolicy();
    api.apply(doc, false, false, policy);
    expect(policy.decision).toBe("pending");
    api.apply(doc, true, true, policy);
    expect(policy.decision).toBe("pending");
    api.apply(doc, true, false, policy);
    expect(policy.decision).toBe("apply");
    doc.body.innerHTML =
      '<p style="text-align:justify">Later justified prose</p><p id="later" style="text-align:left">Later left prose</p>';
    api.apply(doc, true, false, policy);
    expect(policy.decision).toBe("apply");
    expect(doc.getElementById("later")?.style.textAlign).toBe("justify");
    expect(api.createBookPolicy().decision).toBe("pending");
  });

  it("does not treat headings, captions, code, empty blocks or wrappers as justified prose", () => {
    const { api, doc } = fixture();
    doc.body.innerHTML =
      '<h1 style="text-align:justify">Heading</h1><figcaption style="text-align:justify">Caption</figcaption><pre style="text-align:justify">Code</pre><p style="text-align:justify"> </p><div style="text-align:justify"><p style="text-align:left">Actual prose</p></div>';
    const policy = api.createBookPolicy();
    api.apply(doc, true, false, policy);
    expect(policy.decision).toBe("apply");
  });

  it("reuses the normal style pass for detection instead of scanning twice", () => {
    const { api, doc } = fixture();
    const computed = vi.spyOn(window, "getComputedStyle");
    try {
      api.apply(doc, true, false, api.createBookPolicy());
      const elements = computed.mock.calls.map(([element]) => element);
      expect(elements.length).toBeGreaterThan(0);
      expect(new Set(elements).size).toBe(elements.length);
    } finally {
      computed.mockRestore();
    }
  });
  it("preserves headings, navigation, lists, captions and structural wrappers", () => {
    const { api, doc, alignment } = fixture();
    doc.body.innerHTML =
      '<h1 id="heading" style="text-align:left">Heading</h1><nav id="nav" style="text-align:right"><p>Contents</p></nav><ul id="list" style="text-align:left"><li>Item</li></ul><blockquote id="quote" style="text-align:right">Quotation</blockquote><figcaption id="caption" style="text-align:left">Caption</figcaption><div id="wrapper" style="text-align:left"><p id="nested">Prose</p></div><div id="div-prose" style="text-align:left">Div prose<br>More prose</div>';
    const preserved = ["heading", "nav", "list", "quote", "caption", "wrapper"];
    const before = preserved.map(alignment);
    api.apply(doc, true, false, api.createBookPolicy());
    expect(preserved.map(alignment)).toEqual(before);
    for (const id of preserved) {
      expect(doc.getElementById(id)?.hasAttribute("data-readany-justify-body")).toBe(false);
    }
    expect(alignment("nested")).toBe("justify");
    expect(alignment("div-prose")).toBe("justify");
  });

  it.each(["right", "end"])("preserves %s prose across repeated toggles", (authored) => {
    const { api, doc, alignment } = fixture();
    doc.body.innerHTML = `<p id="prose" dir="rtl" style="text-align:${authored}">Body prose</p>`;
    const policy = api.createBookPolicy();
    for (let i = 0; i < 2; i++) {
      api.apply(doc, true, false, policy);
      expect(alignment("prose")).toBe(authored);
      api.apply(doc, false, false, policy);
      expect(alignment("prose")).toBe(authored);
    }
    doc.body.insertAdjacentHTML(
      "beforeend",
      '<p style="text-align:justify">Publisher-justified prose</p>',
    );
    const exempt = api.createBookPolicy();
    api.apply(doc, true, false, exempt);
    expect(exempt.decision).toBe("preserve");
    expect(alignment("prose")).toBe(authored);
  });
});
