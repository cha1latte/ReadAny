import { describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "../services/platform";
import { checkForUpdate, compareVersions, releaseTagToVersion } from "./update-checker";

function makePlatform() {
  return {
    kvGetItem: vi.fn().mockResolvedValue(null),
    kvSetItem: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "shlai-v1.3.5.2",
        body: "Visible input fix",
        html_url: "https://github.com/cha1latte/ReadAny/releases/tag/shlai-v1.3.5.2",
        published_at: "2026-08-16T00:00:00Z",
        assets: [
          {
            name: "ReadAny-Shlai.apk",
            browser_download_url: "https://example.test/shlai.apk",
            size: 42,
          },
        ],
      }),
    }),
  } as unknown as IPlatformService;
}

function makeReleasePlatform(release: Record<string, unknown>) {
  return {
    kvGetItem: vi.fn().mockResolvedValue(null),
    kvSetItem: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => release }),
  } as unknown as IPlatformService;
}

describe("Shlai update routing", () => {
  it("normalizes Shlai release tags and prerelease-style app versions", () => {
    expect(releaseTagToVersion("shlai-v1.3.5.2", "shlai-v")).toBe("1.3.5.2");
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.1")).toBeGreaterThan(0);
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.2")).toBe(0);
  });

  it("rejects a release tag outside the configured channel", () => {
    expect(releaseTagToVersion("v99.0.0", "shlai-v")).toBeNull();
  });

  it("uses the fork API and a fork-specific throttle key", async () => {
    const platform = makePlatform();
    const result = await checkForUpdate("1.3.5-shlai.1", platform, false, {
      apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      tagPrefix: "shlai-v",
      throttleKey: "shlai_update_last_check_at",
    });
    expect(platform.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      expect.any(Object),
    );
    expect(platform.kvSetItem).toHaveBeenCalledWith(
      "shlai_update_last_check_at",
      expect.any(String),
    );
    expect(result.latestVersion).toBe("1.3.5.2");
    expect(result.hasUpdate).toBe(true);
  });

  it("does not throttle an invalid release tag", async () => {
    const platform = makeReleasePlatform({
      tag_name: "v99.0.0",
      assets: [
        {
          name: "ReadAny-Shlai.apk",
          browser_download_url: "https://example.test/shlai.apk",
          size: 42,
        },
      ],
    });

    await expect(
      checkForUpdate("1.3.5-shlai.1", platform, false, {
        tagPrefix: "shlai-v",
        assetName: "ReadAny-Shlai.apk",
      }),
    ).resolves.toEqual({ hasUpdate: false, currentVersion: "1.3.5-shlai.1" });
    expect(platform.kvSetItem).not.toHaveBeenCalled();
  });

  it("requires the configured APK before surfacing a Shlai update", async () => {
    const platform = makeReleasePlatform({
      tag_name: "shlai-v1.3.5.2",
      assets: [
        {
          name: "ReadAny.apk",
          browser_download_url: "https://example.test/official.apk",
          size: 42,
        },
        {
          name: "ReadAny-Shlai-trojan.apk",
          browser_download_url: "https://example.test/trojan.apk",
          size: 42,
        },
      ],
    });

    await expect(
      checkForUpdate("1.3.5-shlai.1", platform, false, {
        tagPrefix: "shlai-v",
        assetName: "ReadAny-Shlai.apk",
      }),
    ).resolves.toEqual({ hasUpdate: false, currentVersion: "1.3.5-shlai.1" });
    expect(platform.kvSetItem).not.toHaveBeenCalled();
  });

  it("surfaces only the configured Shlai APK", async () => {
    const platform = makeReleasePlatform({
      tag_name: "shlai-v1.3.5.2",
      assets: [
        {
          name: "ReadAny-Shlai-trojan.apk",
          browser_download_url: "https://example.test/trojan.apk",
          size: 42,
        },
        {
          name: "ReadAny-Shlai.apk",
          browser_download_url: "https://example.test/shlai.apk",
          size: 42,
        },
      ],
    });

    const result = await checkForUpdate("1.3.5-shlai.1", platform, false, {
      tagPrefix: "shlai-v",
      assetName: "ReadAny-Shlai.apk",
    });

    expect(result.release?.assets).toEqual([
      { name: "ReadAny-Shlai.apk", downloadUrl: "https://example.test/shlai.apk", size: 42 },
    ]);
  });

  it("keeps official defaults compatible when no asset is configured", async () => {
    const platform = makeReleasePlatform({
      tag_name: "v1.3.6",
      assets: [
        {
          name: "ReadAny.apk",
          browser_download_url: "https://example.test/official.apk",
          size: 42,
        },
      ],
    });

    const result = await checkForUpdate("1.3.5", platform);

    expect(result.hasUpdate).toBe(true);
    expect(result.release?.assets).toEqual([
      { name: "ReadAny.apk", downloadUrl: "https://example.test/official.apk", size: 42 },
    ]);
  });
});
