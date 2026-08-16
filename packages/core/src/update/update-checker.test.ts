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
        assets: [{ name: "ReadAny-Shlai.apk", browser_download_url: "https://example.test/shlai.apk", size: 42 }],
      }),
    }),
  } as unknown as IPlatformService;
}

describe("Shlai update routing", () => {
  it("normalizes Shlai release tags and prerelease-style app versions", () => {
    expect(releaseTagToVersion("shlai-v1.3.5.2", "shlai-v")).toBe("1.3.5.2");
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.1")).toBeGreaterThan(0);
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.2")).toBe(0);
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
    expect(platform.kvSetItem).toHaveBeenCalledWith("shlai_update_last_check_at", expect.any(String));
    expect(result.latestVersion).toBe("1.3.5.2");
    expect(result.hasUpdate).toBe(true);
  });
});
