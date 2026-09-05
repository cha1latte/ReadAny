import { describe, expect, it } from "vitest";
import { getChapterPageProgress } from "./pagination";

describe("getChapterPageProgress", () => {
  it("maps every zero-based renderer page to one unique displayed page", () => {
    for (const total of [1, 2, 3, 41, 43]) {
      const displayedPages = Array.from(
        { length: total },
        (_, rendererPage) => getChapterPageProgress(rendererPage, total)?.current,
      );

      expect(displayedPages).toEqual(Array.from({ length: total }, (_, index) => index + 1));
      expect(getChapterPageProgress(total - 1, total)).toEqual({ current: total, total });
    }
  });

  it("rejects unavailable renderer pagination", () => {
    expect(getChapterPageProgress(-1, 43)).toBeNull();
    expect(getChapterPageProgress(0, 0)).toBeNull();
    expect(getChapterPageProgress(43, 43)).toBeNull();
    expect(getChapterPageProgress(Number.NaN, 43)).toBeNull();
  });
});
