import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("chapter page progress integration", () => {
  it("uses the shared core calculation on desktop and mobile", () => {
    const desktop = read("packages/app/src/components/reader/FoliateViewer.tsx");
    const buildScript = read("packages/app-expo/scripts/build-reader.js");
    const mobileSources = [
      read("packages/app-expo/assets/reader/reader.template.html"),
      read("packages/app-expo/assets/reader/reader.html"),
    ];

    expect(desktop).toContain("getChapterPageProgress(rendererPage, rendererPages)");
    expect(buildScript).toContain("window.getChapterPageProgress = getChapterPageProgress");
    for (const source of mobileSources) {
      expect(source).toContain("window.getChapterPageProgress(rendererPage, rendererPages)");
      expect(source).not.toContain("rendererPages - 2");
    }
  });
});
