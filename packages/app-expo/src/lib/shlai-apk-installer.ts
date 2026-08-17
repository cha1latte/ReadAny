import { getPlatformService } from "@readany/core/services";

const APK_NAME = "ReadAny-Shlai-Preview.apk";
const CHECKSUM_NAME = `${APK_NAME}.sha256`;
const TAG_PATTERN = /^shlai-preview-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.([1-9]\d*)$/;

export interface ShlaiInstallerAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface ShlaiPreviewInstallInput {
  tag: string;
  apkAsset: ShlaiInstallerAsset;
  checksumAsset: ShlaiInstallerAsset;
}

export type UpdateInstallState =
  | { status: "idle" }
  | { status: "downloading"; progress: number | null }
  | { status: "verifying" }
  | { status: "opening-installer" }
  | { status: "error"; message: string };

export interface ShlaiApkInstallerDependencies {
  cacheFilePath: string;
  deleteFile: (path: string) => Promise<unknown>;
  downloadText: (url: string) => Promise<string>;
  downloadFile: (
    url: string,
    path: string,
    onProgress?: (loaded: number, total: number) => void,
  ) => Promise<unknown>;
  hashFile: (path: string) => Promise<string>;
  getContentUri: (path: string) => Promise<string>;
  launchInstaller: (contentUri: string) => Promise<unknown>;
}

export interface UpdateInstallOwner {
  run: (operation: () => Promise<unknown>) => Promise<boolean>;
}

export function createUpdateInstallOwner(): UpdateInstallOwner {
  let active = false;
  return {
    async run(operation) {
      if (active) return false;
      active = true;
      try {
        await operation();
        return true;
      } finally {
        active = false;
      }
    },
  };
}

function validateAssetUrl(tag: string, asset: ShlaiInstallerAsset, expectedName: string): void {
  if (!TAG_PATTERN.test(tag) || asset.name !== expectedName) {
    throw new Error("Unexpected Shlai update source");
  }
  const parsed = new URL(asset.downloadUrl);
  const expectedPath = `/cha1latte/ReadAny/releases/download/${tag}/${expectedName}`;
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== expectedPath
  ) {
    throw new Error("Unexpected Shlai update source");
  }
}

function parseChecksum(text: string): string {
  const match = text.match(new RegExp(`^([0-9a-f]{64})  ${APK_NAME.replace(".", "\\.")}\\n?$`));
  if (!match) throw new Error("Malformed Shlai checksum");
  return match[1];
}

function equalDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function installShlaiPreviewUpdate(
  input: ShlaiPreviewInstallInput,
  dependencies: ShlaiApkInstallerDependencies,
  onState: (state: UpdateInstallState) => void = () => {},
): Promise<void> {
  validateAssetUrl(input.tag, input.apkAsset, APK_NAME);
  validateAssetUrl(input.tag, input.checksumAsset, CHECKSUM_NAME);
  await dependencies.deleteFile(dependencies.cacheFilePath);
  const expectedDigest = parseChecksum(
    await dependencies.downloadText(input.checksumAsset.downloadUrl),
  );
  onState({ status: "downloading", progress: null });
  await dependencies.downloadFile(
    input.apkAsset.downloadUrl,
    dependencies.cacheFilePath,
    (loaded, total) => {
      onState({ status: "downloading", progress: total > 0 ? loaded / total : null });
    },
  );
  onState({ status: "verifying" });
  const actualDigest = (await dependencies.hashFile(dependencies.cacheFilePath)).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(actualDigest) || !equalDigest(expectedDigest, actualDigest)) {
    await dependencies.deleteFile(dependencies.cacheFilePath);
    throw new Error("Downloaded Shlai APK checksum mismatch");
  }
  const contentUri = await dependencies.getContentUri(dependencies.cacheFilePath);
  onState({ status: "opening-installer" });
  await dependencies.launchInstaller(contentUri);
}

async function createExpoDependencies(): Promise<ShlaiApkInstallerDependencies> {
  const platform = getPlatformService();
  const downloadFile = platform.downloadFile;
  if (!downloadFile) throw new Error("APK downloads are unavailable on this device");
  const [FileSystem, IntentLauncher, ReactNativeFs] = await Promise.all([
    import("expo-file-system/legacy"),
    import("expo-intent-launcher"),
    import("@dr.pogodin/react-native-fs"),
  ]);
  if (!FileSystem.cacheDirectory) throw new Error("APK cache is unavailable on this device");
  const cacheFilePath = `${FileSystem.cacheDirectory}${APK_NAME}`;
  return {
    cacheFilePath,
    deleteFile: async (path) => platform.deleteFile(path),
    downloadText: async (url) => {
      const response = await platform.fetch(url, {
        headers: { Accept: "text/plain" },
        responseType: "text",
      });
      if (!response.ok) throw new Error(`Checksum download failed: ${response.status}`);
      return response.text();
    },
    downloadFile: async (url, path, onProgress) => downloadFile(url, path, { onProgress }),
    hashFile: async (path) => ReactNativeFs.hash(path.replace(/^file:\/\//, ""), "sha256"),
    getContentUri: FileSystem.getContentUriAsync,
    launchInstaller: async (contentUri) =>
      IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: "application/vnd.android.package-archive",
        flags: 1,
      }),
  };
}

export async function installShlaiPreviewUpdateWithExpo(
  input: ShlaiPreviewInstallInput,
  onState?: (state: UpdateInstallState) => void,
): Promise<void> {
  return installShlaiPreviewUpdate(input, await createExpoDependencies(), onState);
}
