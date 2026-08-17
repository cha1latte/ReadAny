import { describe, expect, it } from "vitest";
import { resolveExtractorFormat } from "./extractor-format";

describe("resolveExtractorFormat", () => {
  it.each(["epub", "pdf", "txt", "umd", "mobi", "azw", "azw3"])(
    "prefers the supported stored %s format",
    (bookFormat) => {
      expect(
        resolveExtractorFormat({
          bookFormat,
          mimeType: "application/octet-stream",
          fileName: "misleading.epub",
        }),
      ).toBe(bookFormat);
    },
  );

  it("uses a supported filename extension when the stored format is unavailable", () => {
    expect(
      resolveExtractorFormat({
        bookFormat: undefined,
        mimeType: "application/vnd.amazon.ebook",
        fileName: "x.AZW3",
      }),
    ).toBe("azw3");
  });

  it.each([
    ["application/epub+zip", "epub"],
    ["application/pdf", "pdf"],
    ["text/plain; charset=utf-8", "txt"],
    ["application/x-mobipocket-ebook", "mobi"],
    ["application/vnd.amazon.ebook", "azw3"],
  ])("falls back from %s to %s", (mimeType, format) => {
    expect(resolveExtractorFormat({ mimeType })).toBe(format);
  });

  it("normalizes stored format and ignores query text after the filename extension", () => {
    expect(resolveExtractorFormat({ bookFormat: "MOBI" })).toBe("mobi");
    expect(resolveExtractorFormat({ fileName: "download.AZW?token=1" })).toBe("azw");
  });

  it("rejects KFX and unknown signals", () => {
    expect(
      resolveExtractorFormat({
        bookFormat: "kfx",
        mimeType: "application/octet-stream",
        fileName: "x.kfx",
      }),
    ).toBeNull();
    expect(resolveExtractorFormat({ bookFormat: "unknown" })).toBeNull();
    expect(resolveExtractorFormat({})).toBeNull();
  });
});
