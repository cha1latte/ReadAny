import { describe, expect, it, vi } from "vitest";
import {
  type ShlaiApkInstallerDependencies,
  installShlaiPreviewUpdate,
} from "./shlai-apk-installer";

const TAG = "shlai-preview-v1.3.6.2";
const APK_NAME = "ReadAny-Shlai-Preview.apk";
const CHECKSUM_NAME = `${APK_NAME}.sha256`;
const APK_URL = `https://github.com/cha1latte/ReadAny/releases/download/${TAG}/${APK_NAME}`;
const CHECKSUM_URL = `https://github.com/cha1latte/ReadAny/releases/download/${TAG}/${CHECKSUM_NAME}`;
const DIGEST = "a".repeat(64);

function input(overrides: Record<string, unknown> = {}) {
  return {
    tag: TAG,
    apkAsset: { name: APK_NAME, downloadUrl: APK_URL, size: 100 },
    checksumAsset: { name: CHECKSUM_NAME, downloadUrl: CHECKSUM_URL, size: 100 },
    ...overrides,
  };
}

function dependencies(overrides: Partial<ShlaiApkInstallerDependencies> = {}) {
  const calls: string[] = [];
  const deps: ShlaiApkInstallerDependencies = {
    cacheFilePath: "file:///cache/ReadAny-Shlai-Preview.apk",
    deleteFile: vi.fn(async () => calls.push("delete-stale-apk")),
    downloadText: vi.fn(async () => {
      calls.push("download-checksum");
      return `${DIGEST}  ${APK_NAME}\n`;
    }),
    downloadFile: vi.fn(async (_url, _path, onProgress) => {
      calls.push("download-apk");
      onProgress?.(50, 100);
    }),
    hashFile: vi.fn(async () => {
      calls.push("hash-apk");
      return DIGEST;
    }),
    getContentUri: vi.fn(async () => {
      calls.push("content-uri");
      return "content://preview.apk";
    }),
    launchInstaller: vi.fn(async () => calls.push("launch-installer")),
    ...overrides,
  };
  return { calls, deps };
}

describe("installShlaiPreviewUpdate", () => {
  it("verifies the exact checksum before opening Android's installer", async () => {
    const { calls, deps } = dependencies();
    const states: string[] = [];

    await installShlaiPreviewUpdate(input(), deps, (state) => states.push(state.status));

    expect(calls).toEqual([
      "delete-stale-apk",
      "download-checksum",
      "download-apk",
      "hash-apk",
      "content-uri",
      "launch-installer",
    ]);
    expect(states).toEqual(["downloading", "downloading", "verifying", "opening-installer"]);
    expect(deps.downloadFile).toHaveBeenCalledWith(
      APK_URL,
      deps.cacheFilePath,
      expect.any(Function),
    );
    expect(deps.launchInstaller).toHaveBeenCalledWith("content://preview.apk");
  });

  it.each([
    [
      "http://github.com/cha1latte/ReadAny/releases/download/x/a.apk",
      "Unexpected Shlai update source",
    ],
    [
      "https://evil.test/cha1latte/ReadAny/releases/download/x/a.apk",
      "Unexpected Shlai update source",
    ],
    [
      `https://github.com/other/ReadAny/releases/download/${TAG}/${APK_NAME}`,
      "Unexpected Shlai update source",
    ],
    [
      `https://github.com/cha1latte/ReadAny/releases/download/wrong/${APK_NAME}`,
      "Unexpected Shlai update source",
    ],
  ])("rejects an untrusted APK URL before any download", async (downloadUrl, message) => {
    const { deps } = dependencies();
    await expect(
      installShlaiPreviewUpdate(
        input({ apkAsset: { name: APK_NAME, downloadUrl, size: 100 } }),
        deps,
      ),
    ).rejects.toThrow(message);
    expect(deps.downloadText).not.toHaveBeenCalled();
    expect(deps.downloadFile).not.toHaveBeenCalled();
  });

  it.each([
    [`${DIGEST} ${APK_NAME}\n`, "Malformed Shlai checksum"],
    [`${DIGEST.toUpperCase()}  ${APK_NAME}\n`, "Malformed Shlai checksum"],
    [`${DIGEST}  wrong.apk\n`, "Malformed Shlai checksum"],
    [`${DIGEST}  ${APK_NAME}\n${"b".repeat(64)}  ${APK_NAME}\n`, "Malformed Shlai checksum"],
  ])("rejects malformed checksum text %s", async (checksum, message) => {
    const { deps } = dependencies({ downloadText: vi.fn(async () => checksum) });
    await expect(installShlaiPreviewUpdate(input(), deps)).rejects.toThrow(message);
    expect(deps.downloadFile).not.toHaveBeenCalled();
    expect(deps.launchInstaller).not.toHaveBeenCalled();
  });

  it("deletes a mismatched APK and never opens the installer", async () => {
    const { deps } = dependencies({ hashFile: vi.fn(async () => "b".repeat(64)) });
    await expect(installShlaiPreviewUpdate(input(), deps)).rejects.toThrow(
      "Downloaded Shlai APK checksum mismatch",
    );
    expect(deps.deleteFile).toHaveBeenCalledTimes(2);
    expect(deps.getContentUri).not.toHaveBeenCalled();
    expect(deps.launchInstaller).not.toHaveBeenCalled();
  });
});
