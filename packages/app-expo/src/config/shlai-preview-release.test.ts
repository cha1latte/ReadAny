import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const scriptPath = resolve(import.meta.dirname, "../../scripts/shlai-preview-release.js");
const fixturePath = resolve(import.meta.dirname, "fixtures/no-preview-releases.json");
const { derivePreviewRelease } = require(scriptPath) as {
  derivePreviewRelease: (input: {
    upstreamVersion: string;
    releases: unknown[];
    baselineVersionCode: number;
  }) => {
    revision: number;
    tag: string;
    version: string;
    versionCode: number;
  };
};

function canonicalRelease(
  tag: string,
  versionCode: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: true,
    body: `Unofficial preview\n\nAndroid versionCode: ${versionCode}`,
    ...overrides,
  };
}

describe("derivePreviewRelease", () => {
  it("starts the installed preview lineage at revision 1 and versionCode 2", () => {
    expect(
      derivePreviewRelease({
        upstreamVersion: "1.3.6",
        releases: [],
        baselineVersionCode: 1,
      }),
    ).toEqual({
      revision: 1,
      tag: "shlai-preview-v1.3.6.1",
      version: "1.3.6-shlai.1",
      versionCode: 2,
    });
  });

  it("increments the greatest canonical release and ignores unrelated families", () => {
    expect(
      derivePreviewRelease({
        upstreamVersion: "1.3.6",
        baselineVersionCode: 1,
        releases: [
          canonicalRelease("shlai-preview-v1.3.6.2", 6),
          canonicalRelease("shlai-preview-v1.3.6.4", 8),
          { tag_name: "v9.9.9", draft: false, prerelease: false, body: "" },
        ],
      }),
    ).toEqual({
      revision: 5,
      tag: "shlai-preview-v1.3.6.5",
      version: "1.3.6-shlai.5",
      versionCode: 9,
    });
  });

  it("restarts the revision at 1 after an upstream version increase", () => {
    expect(
      derivePreviewRelease({
        upstreamVersion: "1.4.0",
        baselineVersionCode: 1,
        releases: [canonicalRelease("shlai-preview-v1.3.6.9", 20)],
      }),
    ).toEqual({
      revision: 1,
      tag: "shlai-preview-v1.4.0.1",
      version: "1.4.0-shlai.1",
      versionCode: 21,
    });
  });

  it.each([
    [" 1.3.6", "Invalid upstream version"],
    ["01.3.6", "Invalid upstream version"],
    ["1.3", "Invalid upstream version"],
  ])("rejects noncanonical upstream version %s", (upstreamVersion, message) => {
    expect(() =>
      derivePreviewRelease({ upstreamVersion, releases: [], baselineVersionCode: 1 }),
    ).toThrow(message);
  });

  it.each([
    [canonicalRelease("shlai-preview-v1.3.6.0", 2), "Malformed preview release"],
    [canonicalRelease("shlai-preview-v1.3.6.01", 2), "Malformed preview release"],
    [canonicalRelease("shlai-preview-v1.3.6.1 ", 2), "Malformed preview release"],
    [canonicalRelease("shlai-preview-v1.3.6.1", 2, { draft: true }), "Malformed preview release"],
    [
      canonicalRelease("shlai-preview-v1.3.6.1", 2, { prerelease: false }),
      "Malformed preview release",
    ],
    [canonicalRelease("shlai-preview-v1.3.6.1", 2, { body: "No build number" }), "versionCode"],
    [
      canonicalRelease("shlai-preview-v1.3.6.1", 2, {
        body: "Android versionCode: 2\nAndroid versionCode: 3",
      }),
      "versionCode",
    ],
    [
      canonicalRelease("shlai-preview-v1.3.6.1", 2, { body: "Android versionCode: 02" }),
      "versionCode",
    ],
    [canonicalRelease("shlai-preview-v1.3.6.1", 2_100_000_001), "versionCode"],
  ])("rejects malformed preview history", (release, message) => {
    expect(() =>
      derivePreviewRelease({
        upstreamVersion: "1.3.6",
        releases: [release],
        baselineVersionCode: 1,
      }),
    ).toThrow(message);
  });

  it("rejects duplicate canonical tags", () => {
    expect(() =>
      derivePreviewRelease({
        upstreamVersion: "1.3.6",
        baselineVersionCode: 1,
        releases: [
          canonicalRelease("shlai-preview-v1.3.6.1", 2),
          canonicalRelease("shlai-preview-v1.3.6.1", 3),
        ],
      }),
    ).toThrow("Duplicate preview tag");
  });

  it("rejects a repository version behind published preview history", () => {
    expect(() =>
      derivePreviewRelease({
        upstreamVersion: "1.3.5",
        baselineVersionCode: 1,
        releases: [canonicalRelease("shlai-preview-v1.3.6.1", 2)],
      }),
    ).toThrow("must be newer than prior preview release");
  });

  it("rejects revision and Android versionCode overflow", () => {
    expect(() =>
      derivePreviewRelease({
        upstreamVersion: "1.3.6",
        baselineVersionCode: 1,
        releases: [
          canonicalRelease(`shlai-preview-v1.3.6.${Number.MAX_SAFE_INTEGER}`, 2_100_000_000),
        ],
      }),
    ).toThrow("cannot increase");
  });

  it("flattens paginated GitHub API arrays", () => {
    expect(
      derivePreviewRelease({
        upstreamVersion: "1.3.6",
        baselineVersionCode: 1,
        releases: [
          [canonicalRelease("shlai-preview-v1.3.6.1", 2)],
          [canonicalRelease("shlai-preview-v1.3.6.2", 3)],
        ],
      }),
    ).toMatchObject({ revision: 3, versionCode: 4 });
  });
});

describe("shlai-preview-release CLI", () => {
  it("writes GitHub output fields for the first combined release", () => {
    expect(
      execFileSync(
        process.execPath,
        [
          scriptPath,
          "derive",
          "--version",
          "1.3.6",
          "--releases",
          fixturePath,
          "--baseline-version-code",
          "1",
        ],
        { encoding: "utf8" },
      ),
    ).toBe("revision=1\ntag=shlai-preview-v1.3.6.1\nversion=1.3.6-shlai.1\nversion_code=2\n");
  });
});
