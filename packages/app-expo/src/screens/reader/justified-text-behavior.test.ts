// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "../../../assets/reader/justified-text.js"), "utf8");
function fixture() {
  document.documentElement.innerHTML = `<html><head><style>
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
        apply: (doc: Document, enabled: boolean, unsupported: boolean) => void;
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
    for (const id of ["publisher", "inline", "prose", "breaks", "right"]) {
      expect(alignment(id), id).toBe("justify");
    }
    expect(alignment("center")).toBe("center");
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
});
