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
    expect(releaseTagToVersion("shlai-preview-v1.3.6.12", "shlai-preview-v")).toBe("1.3.6.12");
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.1")).toBeGreaterThan(0);
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.2")).toBe(0);
  });

  it("rejects a release tag outside the configured channel", () => {
    expect(releaseTagToVersion("v99.0.0", "shlai-v")).toBeNull();
  });

  it.each([
    ["v1.2", "v"],
    ["v1.2.3.4", "v"],
    ["v1.2.3-beta.1", "v"],
    ["v01.2.3", "v"],
    ["shlai-v1.2.3", "shlai-v"],
    ["shlai-v1.2.3.0", "shlai-v"],
    ["shlai-v1.2.3.4-extra", "shlai-v"],
    ["shlai-v1.02.3.4", "shlai-v"],
  ])("rejects malformed complete release tag %s", (tag, prefix) => {
    expect(releaseTagToVersion(tag, prefix)).toBeNull();
  });

  it("accepts only complete official and Shlai versions", () => {
    expect(releaseTagToVersion("v0.12.3")).toBe("0.12.3");
    expect(releaseTagToVersion("shlai-v1.3.5.27", "shlai-v")).toBe("1.3.5.27");
  });

  it("does not throttle a malformed tag inside the configured channel", async () => {
    const platform = makeReleasePlatform({
      tag_name: "shlai-v1.3.5.2-extra",
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

  it("selects the greatest canonical preview prerelease across GitHub pages", async () => {
    const firstPage = [
      {
        tag_name: "shlai-preview-v1.3.6.1",
        draft: false,
        prerelease: true,
        body: "First",
        html_url: "https://github.com/cha1latte/ReadAny/releases/tag/shlai-preview-v1.3.6.1",
        published_at: "2026-08-17T00:00:00Z",
        assets: [
          {
            name: "ReadAny-Shlai-Preview.apk",
            browser_download_url:
              "https://github.com/cha1latte/ReadAny/releases/download/shlai-preview-v1.3.6.1/ReadAny-Shlai-Preview.apk",
            size: 42,
          },
          {
            name: "ReadAny-Shlai-Preview.apk.sha256",
            browser_download_url:
              "https://github.com/cha1latte/ReadAny/releases/download/shlai-preview-v1.3.6.1/ReadAny-Shlai-Preview.apk.sha256",
            size: 100,
          },
        ],
      },
      {
        tag_name: "shlai-preview-v9.0.0.1",
        draft: true,
        prerelease: true,
        assets: [],
      },
      { tag_name: "shlai-preview-v1.3.6.01", draft: false, prerelease: true, assets: [] },
      { tag_name: "shlai-v9.9.9.9", draft: false, prerelease: false, assets: [] },
    ];
    const secondPage = [
      {
        tag_name: "shlai-preview-v1.3.6.3",
        draft: false,
        prerelease: true,
        body: "Latest",
        html_url: "https://github.com/cha1latte/ReadAny/releases/tag/shlai-preview-v1.3.6.3",
        published_at: "2026-08-17T01:00:00Z",
        assets: [
          {
            name: "ReadAny-Shlai-Preview.apk",
            browser_download_url:
              "https://github.com/cha1latte/ReadAny/releases/download/shlai-preview-v1.3.6.3/ReadAny-Shlai-Preview.apk",
            size: 43,
          },
          {
            name: "ReadAny-Shlai-Preview.apk.sha256",
            browser_download_url:
              "https://github.com/cha1latte/ReadAny/releases/download/shlai-preview-v1.3.6.3/ReadAny-Shlai-Preview.apk.sha256",
            size: 101,
          },
        ],
      },
    ];
    const platform = {
      kvGetItem: vi.fn().mockResolvedValue(null),
      kvSetItem: vi.fn().mockResolvedValue(undefined),
      fetch: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            Link: '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next"',
          }),
          json: async () => firstPage,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => secondPage,
        }),
    } as unknown as IPlatformService;

    const result = await checkForUpdate("1.3.6-shlai.1", platform, true, {
      apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100",
      tagPrefix: "shlai-preview-v",
      throttleKey: "shlai_preview_update_last_check_at",
      releaseMode: "canonical-prerelease-list",
      assetName: "ReadAny-Shlai-Preview.apk",
      checksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
    });

    expect(platform.fetch).toHaveBeenCalledTimes(2);
    expect(platform.fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(result.latestVersion).toBe("1.3.6.3");
    expect(result.release?.assets.map((asset) => asset.name)).toEqual([
      "ReadAny-Shlai-Preview.apk",
      "ReadAny-Shlai-Preview.apk.sha256",
    ]);
    expect(platform.kvSetItem).toHaveBeenCalledWith(
      "shlai_preview_update_last_check_at",
      expect.any(String),
    );
  });

  it("does not throttle preview history missing the exact checksum", async () => {
    const platform = makeReleasePlatform([
      {
        tag_name: "shlai-preview-v1.3.6.2",
        draft: false,
        prerelease: true,
        assets: [
          {
            name: "ReadAny-Shlai-Preview.apk",
            browser_download_url: "https://example.test/preview.apk",
            size: 42,
          },
        ],
      },
    ]);

    await expect(
      checkForUpdate("1.3.6-shlai.1", platform, false, {
        tagPrefix: "shlai-preview-v",
        releaseMode: "canonical-prerelease-list",
        assetName: "ReadAny-Shlai-Preview.apk",
        checksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
      }),
    ).resolves.toEqual({ hasUpdate: false, currentVersion: "1.3.6-shlai.1" });
    expect(platform.kvSetItem).not.toHaveBeenCalled();
  });

  it.each([
    "http://api.github.com/repositories/1/releases?page=2",
    "https://evil.test/repositories/1/releases?page=2",
  ])("rejects an unsafe GitHub pagination link %s without throttling", async (nextUrl) => {
    const platform = {
      kvGetItem: vi.fn().mockResolvedValue(null),
      kvSetItem: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ Link: `<${nextUrl}>; rel="next"` }),
        json: async () => [],
      }),
    } as unknown as IPlatformService;

    await expect(
      checkForUpdate("1.3.6-shlai.1", platform, false, {
        releaseMode: "canonical-prerelease-list",
        tagPrefix: "shlai-preview-v",
      }),
    ).rejects.toThrow("Unsafe GitHub pagination URL");
    expect(platform.kvSetItem).not.toHaveBeenCalled();
  });

  it("compares canonical versions without Number precision loss", () => {
    expect(compareVersions("1.3.6.9007199254740993", "1.3.6.9007199254740992")).toBeGreaterThan(0);
  });
});
