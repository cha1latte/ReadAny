import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { APP_VARIANTS } = require("../../scripts/app-variant.js");
const { getShlaiVersionConfig } = require("../../scripts/shlai-version.js");

describe("ReadAny Shlai app configuration", () => {
  it("uses isolated identities for every Android variant", () => {
    expect(APP_VARIANTS).toEqual({
      development: {
        key: "development",
        name: "ReadAny Shlai Dev",
        bundleIdentifier: "io.github.cha1latte.readanyshlai.dev",
        androidPackage: "io.github.cha1latte.readanyshlai.dev",
        scheme: "readany-shlai-dev",
      },
      preview: {
        key: "preview",
        name: "ReadAny Shlai Preview",
        bundleIdentifier: "io.github.cha1latte.readanyshlai.preview",
        androidPackage: "io.github.cha1latte.readanyshlai.preview",
        scheme: "readany-shlai-preview",
      },
      production: {
        key: "production",
        name: "ReadAny Shlai",
        bundleIdentifier: "io.github.cha1latte.readanyshlai",
        androidPackage: "io.github.cha1latte.readanyshlai",
        scheme: "readany-shlai",
      },
    });
  });

  it("derives the release tag, display version, and Android build number", () => {
    expect(
      getShlaiVersionConfig({
        SHLAI_UPSTREAM_VERSION: "1.3.5",
        SHLAI_REVISION: "2",
        SHLAI_VERSION_CODE: "9",
      }),
    ).toEqual({
      upstreamVersion: "1.3.5",
      revision: 2,
      version: "1.3.5-shlai.2",
      tag: "shlai-v1.3.5.2",
      versionCode: 9,
    });
  });

  it.each([
    [{ SHLAI_UPSTREAM_VERSION: "one" }, "Invalid SHLAI_UPSTREAM_VERSION"],
    [{ SHLAI_REVISION: "-1" }, "Invalid SHLAI_REVISION"],
    [{ SHLAI_VERSION_CODE: "0" }, "Invalid SHLAI_VERSION_CODE"],
  ])("rejects invalid release metadata", (env, message) => {
    expect(() => getShlaiVersionConfig(env)).toThrow(message);
  });
});
