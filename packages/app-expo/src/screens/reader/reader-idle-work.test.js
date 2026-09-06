import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const template = readFileSync(
  resolve(import.meta.dirname, "../../../assets/reader/reader.template.html"),
  "utf8",
);

describe("extractor loading UI", () => {
  for (const [hash, display] of [
    ["", "flex"],
    ["#readany-extractor", "none"],
  ]) {
    it(`uses loading display ${display} for ${hash || "the visible reader"}`, () => {
      const dom = new JSDOM(template, {
        url: `file:///reader.html${hash}`,
        runScripts: "outside-only",
      });
      try {
        for (const script of dom.window.document.head.querySelectorAll("script")) {
          dom.window.eval(script.textContent);
        }
        expect(
          dom.window.getComputedStyle(dom.window.document.getElementById("loading")).display,
        ).toBe(display);
      } finally {
        dom.window.close();
      }
    });
  }
});

function tapDocument() {
  const start = template.indexOf("    function attachTapListener(doc) {");
  const end = template.indexOf("    function attachPullBookmarkListener(doc) {", start);
  const listeners = new Map();
  const doc = { addEventListener: (name, callback) => listeners.set(name, callback) };
  const postToRN = vi.fn();
  const context = {
    doc,
    postToRN,
    bookmarkPullGestureActive: false,
    isPointInNoteRange: () => false,
    isPointInAnnotationRange: () => null,
  };
  runInNewContext(
    `${template.slice(start, end)}; attachTapListener(doc); attachTapListener(doc);`,
    context,
  );
  return { listeners, postToRN };
}

describe("reader gesture activity", () => {
  it("reports one activity message for a real page-touch or scrolling gesture, not its movement", () => {
    const { listeners, postToRN } = tapDocument();
    listeners.get("touchstart")({ isTrusted: true, touches: [{ clientX: 20, clientY: 20 }] });
    for (let i = 0; i < 10; i++) {
      listeners.get("touchmove")({ isTrusted: true, touches: [{ clientX: 60 + i, clientY: 20 }] });
    }
    expect(postToRN.mock.calls).toEqual([["activity", {}]]);
  });

  it("does not report synthetic input or layout relocation as reading activity", () => {
    const { listeners, postToRN } = tapDocument();
    listeners.get("touchstart")({ isTrusted: false, touches: [{ clientX: 20, clientY: 20 }] });
    listeners.get("relocate")?.({ isTrusted: true });
    expect(postToRN).not.toHaveBeenCalled();
  });
});
