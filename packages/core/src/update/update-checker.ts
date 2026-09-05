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
  assets: Array<{ name: string; downloadUrl: string; size: number }>;
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
  releaseMode?: "single" | "canonical-prerelease-list";
  assetName?: string;
  checksumAssetName?: string;
  maxPages?: number;
}

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  assets?: unknown;
}

function releaseAssets(release: GitHubRelease): ReleaseInfo["assets"] {
  if (!Array.isArray(release.assets)) return [];
  return release.assets.flatMap((candidate: GitHubAsset) => {
    if (
      typeof candidate?.name !== "string" ||
      typeof candidate.browser_download_url !== "string" ||
      typeof candidate.size !== "number"
    ) {
      return [];
    }
    return [
      { name: candidate.name, downloadUrl: candidate.browser_download_url, size: candidate.size },
    ];
  });
}

function nextLink(headers: Headers | undefined): string | null {
  const value = headers?.get("link");
  if (!value) return null;
  for (const part of value.split(",")) {
    const match = part.trim().match(/^<([^>]+)>\s*;\s*rel="?next"?(?:\s*;.*)?$/i);
    if (match) return match[1];
  }
  return null;
}

function assertSafeGitHubPaginationUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.github.com") {
    throw new Error("Unsafe GitHub pagination URL");
  }
  return parsed.href;
}

async function fetchReleaseList(
  platform: IPlatformService,
  apiUrl: string,
  maxPages: number,
): Promise<GitHubRelease[]> {
  const releases: GitHubRelease[] = [];
  let url: string | null = apiUrl;
  for (let page = 0; url && page < maxPages; page += 1) {
    const response = await platform.fetch(url, {
      headers: { Accept: "application/vnd.github.v3+json" },
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("Invalid GitHub releases response");
    releases.push(...(payload as GitHubRelease[]));
    const next = nextLink(response.headers);
    if (next && page === maxPages - 1) {
      throw new Error("GitHub release history exceeds pagination limit");
    }
    url = next ? assertSafeGitHubPaginationUrl(next) : null;
  }
  return releases;
}

function selectCanonicalPrerelease(
  releases: GitHubRelease[],
  tagPrefix: string,
  requiredAssets: readonly string[],
): GitHubRelease | null {
  let selected: GitHubRelease | null = null;
  let selectedVersion: string | null = null;
  for (const release of releases) {
    if (release.draft !== false || release.prerelease !== true) continue;
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    const version = releaseTagToVersion(tag, tagPrefix);
    if (!version) continue;
    const names = new Set(releaseAssets(release).map((asset) => asset.name));
    if (!requiredAssets.every((name) => names.has(name))) continue;
    if (!selectedVersion || compareVersions(version, selectedVersion) > 0) {
      selected = release;
      selectedVersion = version;
    }
  }
  return selected;
}

export async function checkForUpdate(
  currentVersion: string,
  platform: IPlatformService,
  force = false,
  options: UpdateCheckOptions = {},
): Promise<UpdateCheckResult> {
  const apiUrl = options.apiUrl || GITHUB_API_URL;
  const tagPrefix = options.tagPrefix || "v";
  const throttleKey = options.throttleKey || THROTTLE_KEY;
  const releaseMode = options.releaseMode ?? "single";
  const assetName = options.assetName?.trim();
  const checksumAssetName = options.checksumAssetName?.trim();
  const requiredAssets = [assetName, checksumAssetName].filter((name): name is string =>
    Boolean(name),
  );

  if (!force) {
    const lastCheck = await platform.kvGetItem(throttleKey);
    if (lastCheck) {
      const elapsed = Date.now() - Number.parseInt(lastCheck, 10);
      if (elapsed < THROTTLE_HOURS * 60 * 60 * 1000) {
        return { hasUpdate: false, currentVersion };
      }
    }
  }

  let release: GitHubRelease | null;
  if (releaseMode === "canonical-prerelease-list") {
    const maxPages = options.maxPages ?? 10;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10) {
      throw new Error("Invalid GitHub release pagination limit");
    }
    const releases = await fetchReleaseList(platform, apiUrl, maxPages);
    release = selectCanonicalPrerelease(releases, tagPrefix, requiredAssets);
  } else {
    const response = await platform.fetch(apiUrl, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
    const payload: unknown = await response.json();
    release = payload && typeof payload === "object" ? (payload as GitHubRelease) : null;
  }

  if (!release) return { hasUpdate: false, currentVersion };
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const latestVersion = releaseTagToVersion(tag, tagPrefix);
  if (!latestVersion) return { hasUpdate: false, currentVersion };
  const assets = releaseAssets(release);
  const selectedAssets = requiredAssets.length
    ? assets.filter((asset) => requiredAssets.includes(asset.name))
    : assets;
  if (requiredAssets.some((name) => !selectedAssets.some((asset) => asset.name === name))) {
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
          notes: typeof release.body === "string" ? release.body : "",
          htmlUrl: typeof release.html_url === "string" ? release.html_url : "",
          publishedAt: typeof release.published_at === "string" ? release.published_at : "",
          assets: selectedAssets,
        }
      : undefined,
  };
}

export function releaseTagToVersion(tag: string, prefix = "v"): string | null {
  const canonicalComponent = "(?:0|[1-9]\\d*)";
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionPattern =
    prefix === "shlai-v" || prefix === "shlai-preview-v"
      ? `${canonicalComponent}\\.${canonicalComponent}\\.${canonicalComponent}\\.[1-9]\\d*`
      : `${canonicalComponent}\\.${canonicalComponent}\\.${canonicalComponent}`;
  const match = tag.match(new RegExp(`^${escapedPrefix}(${versionPattern})$`));
  return match?.[1] ?? null;
}

function versionParts(value: string): string[] {
  return value.match(/\d+/g) || [];
}

function compareIntegerStrings(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, "");
  const normalizedRight = right.replace(/^0+(?=\d)/, "");
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  }
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const compared = compareIntegerStrings(left[index] || "0", right[index] || "0");
    if (compared !== 0) return compared;
  }
  return 0;
}
