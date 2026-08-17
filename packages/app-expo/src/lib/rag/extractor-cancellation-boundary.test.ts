import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("extractor cancellation boundary", () => {
  it("routes request ids and checks cancellation inside reader extraction", () => {
    const template = readFileSync(
      resolve(process.cwd(), "assets/reader/reader.template.html"),
      "utf8",
    );

    expect(template).toContain("case 'cancelExtraction'");
    expect(template).toContain("throwIfExtractionCancelled(requestId)");
    expect(template).toMatch(/postToRN\('chaptersExtracted', \{[^}]*requestId/s);
  });
});
