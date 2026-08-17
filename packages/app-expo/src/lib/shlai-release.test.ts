import { describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

import { getShlaiReleaseConfigForExtra, shouldShowPublicUpdateControls } from "./shlai-release";
import { selectReleaseAsset } from "./shlai-release-asset";

describe("selectReleaseAsset", () => {
  it("selects only the exact configured stable APK", () => {
    expect(
      selectReleaseAsset(
        [
          {
            name: "ReadAny-Shlai-trojan.apk",
            downloadUrl: "https://example.test/trojan.apk",
            size: 1,
          },
          { name: "ReadAny-Shlai.apk", downloadUrl: "https://example.test/shlai.apk", size: 2 },
        ],
        "ReadAny-Shlai.apk",
      ),
    ).toEqual({
      name: "ReadAny-Shlai.apk",
      downloadUrl: "https://example.test/shlai.apk",
      size: 2,
    });
  });
});

describe("getShlaiReleaseConfigForExtra", () => {
  it("disables public update discovery for development", () => {
    const config = getShlaiReleaseConfigForExtra({ appVariant: "development" });
    expect(config).toBeNull();
    expect(shouldShowPublicUpdateControls(config)).toBe(false);
  });

  it("routes preview builds only to canonical preview prereleases", () => {
    const config = getShlaiReleaseConfigForExtra({ appVariant: "preview" });
    expect(config).toEqual({
      apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100",
      tagPrefix: "shlai-preview-v",
      throttleKey: "shlai_preview_update_last_check_at",
      releaseMode: "canonical-prerelease-list",
      assetName: "ReadAny-Shlai-Preview.apk",
      checksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
      maxPages: 10,
    });
    expect(shouldShowPublicUpdateControls(config)).toBe(true);
  });

  it("keeps production on the existing stable release family", () => {
    expect(getShlaiReleaseConfigForExtra({ appVariant: "production" })).toEqual({
      apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      tagPrefix: "shlai-v",
      throttleKey: "shlai_update_last_check_at",
      releaseMode: "single",
      assetName: "ReadAny-Shlai.apk",
    });
  });
});
