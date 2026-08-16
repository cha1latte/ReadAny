/**
 * GitHub Releases update checker — checks for new app versions.
 * Works on both desktop and mobile via IPlatformService.fetch().
 */

import type { IPlatformService } from "../services/platform";

const GITHUB_API_URL = "https://api.github.com/repos/codedogQBY/ReadAny/releases/latest";
const THROTTLE_KEY = "update_last_check_at";
const THROTTLE_HOURS = 24;

export interface ReleaseInfo {
  version: string;
  notes: string;
  htmlUrl: string;
  publishedAt: string;
  assets: Array<{
    name: string;
    downloadUrl: string;
    size: number;
  }>;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  release?: ReleaseInfo;
}

export interface UpdateCheckOptions {
  apiUrl?: string;
  tagPrefix?: string;
  throttleKey?: string;
  /** Required release asset for a dedicated update channel. */
  assetName?: string;
}

/**
 * Check for a new version of the app via GitHub Releases API.
 *
 * @param currentVersion Current app version (e.g. "1.0.0")
 * @param platform Platform service for fetch and KV
 * @param force If true, skip throttle check
 */
export async function checkForUpdate(
  currentVersion: string,
  platform: IPlatformService,
  force = false,
  options: UpdateCheckOptions = {},
): Promise<UpdateCheckResult> {
  const apiUrl = options.apiUrl || GITHUB_API_URL;
  const tagPrefix = options.tagPrefix || "v";
  const throttleKey = options.throttleKey || THROTTLE_KEY;
  const assetName = options.assetName?.trim();

  // Throttle auto-checks to once per day
  if (!force) {
    const lastCheck = await platform.kvGetItem(throttleKey);
    if (lastCheck) {
      const elapsed = Date.now() - Number.parseInt(lastCheck, 10);
      if (elapsed < THROTTLE_HOURS * 60 * 60 * 1000) {
        return { hasUpdate: false, currentVersion };
      }
    }
  }

  const response = await platform.fetch(apiUrl, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const release = await response.json();
  const latestVersion = releaseTagToVersion(release.tag_name || "", tagPrefix);
  if (!latestVersion) {
    return { hasUpdate: false, currentVersion };
  }

  const assets: ReleaseInfo["assets"] = (release.assets || []).map(
    (a: {
      name: string;
      browser_download_url: string;
      size: number;
    }) => ({
      name: a.name,
      downloadUrl: a.browser_download_url,
      size: a.size,
    }),
  );
  const releaseAssets = assetName ? assets.filter((asset) => asset.name === assetName) : assets;
  if (assetName && releaseAssets.length === 0) {
    return { hasUpdate: false, currentVersion };
  }

  await platform.kvSetItem(throttleKey, String(Date.now()));
  const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    release: hasUpdate
      ? {
          version: latestVersion,
          notes: release.body || "",
          htmlUrl: release.html_url || "",
          publishedAt: release.published_at || "",
          assets: releaseAssets,
        }
      : undefined,
  };
}

export function releaseTagToVersion(tag: string, prefix = "v"): string | null {
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : null;
}

function versionParts(value: string): number[] {
  return (value.match(/\d+/g) || []).map(Number);
}

/** Compare two semver version strings. Returns >0 if a > b, <0 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}
