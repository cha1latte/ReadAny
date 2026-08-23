import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PaginatorTouchTracker,
  hasActiveTextSelection,
} from "../../../../foliate-js/paginator-touch.js";

const touch = { screenX: 430, screenY: 520 };

describe("paginator touch navigation ownership", () => {
  it("restores the gesture start after movement becomes text selection", () => {
    const tracker = new PaginatorTouchTracker();
    tracker.start(touch, 100, 624);
    tracker.markScrolled();

    expect(
      hasActiveTextSelection([
        {
          doc: {
            getSelection: () => ({ isCollapsed: false, toString: () => "selected text" }),
          },
        },
      ]),
    ).toBe(true);
    expect(tracker.cancel()).toBe(624);
    expect(tracker.state).toBeUndefined();
    expect(tracker.scrolled).toBe(false);
  });

  it("does not request restoration before the paginator moves", () => {
    const tracker = new PaginatorTouchTracker();
    tracker.start(touch, 100, 624);

    expect(tracker.cancel()).toBeNull();
  });

  it("returns the completed swipe state for an ordinary gesture", () => {
    const tracker = new PaginatorTouchTracker();
    const state = tracker.start(touch, 100, 624);
    state.dx = 180;
    state.dt = 300;
    tracker.markScrolled();

    expect(tracker.finish()).toMatchObject({ dx: 180, dt: 300, startPosition: 624 });
    expect(tracker.state).toBeUndefined();
    expect(tracker.scrolled).toBe(false);
  });

  it("ignores collapsed and whitespace-only selections", () => {
    expect(
      hasActiveTextSelection([
        { doc: { getSelection: () => ({ isCollapsed: true, toString: () => "text" }) } },
        { doc: { getSelection: () => ({ isCollapsed: false, toString: () => "   " }) } },
      ]),
    ).toBe(false);
  });
});

const paginatorSource = readFileSync(
  new URL("../../../../foliate-js/paginator.js", import.meta.url),
  "utf8",
);

describe("paginator selection cancellation wiring", () => {
  it("cancels pending navigation at selection start and delayed selection detection", () => {
    expect(paginatorSource).toContain(
      "doc.addEventListener('selectstart', () => this.#cancelTouchNavigation())",
    );
    expect(
      paginatorSource.match(
        /if \(this\.#hasActiveTextSelection\(\)\) \{\s*this\.#cancelTouchNavigation\(\)\s*return\s*\}/g,
      ),
    ).toHaveLength(3);
    expect(paginatorSource).toContain("if (direction === 'backward') await this.prev()");
    expect(paginatorSource).toContain("else await this.next()");
  });
});
