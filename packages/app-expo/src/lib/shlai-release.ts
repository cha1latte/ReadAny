import type { UpdateCheckOptions } from "@readany/core/update";
import Constants from "expo-constants";

export interface ShlaiReleaseConfig extends UpdateCheckOptions {
  apiUrl: string;
  tagPrefix: string;
  throttleKey: string;
  assetName: string;
  releaseMode: "single" | "canonical-prerelease-list";
}

interface ShlaiReleaseExtra {
  appVariant?: unknown;
}

export function getShlaiReleaseConfigForExtra(
  extra: ShlaiReleaseExtra | null | undefined,
): ShlaiReleaseConfig | null {
  if (extra?.appVariant === "development") return null;
  if (extra?.appVariant === "preview") {
    return {
      apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100",
      tagPrefix: "shlai-preview-v",
      throttleKey: "shlai_preview_update_last_check_at",
      releaseMode: "canonical-prerelease-list",
      assetName: "ReadAny-Shlai-Preview.apk",
      checksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
      maxPages: 10,
    };
  }
  return {
    apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
    tagPrefix: "shlai-v",
    throttleKey: "shlai_update_last_check_at",
    releaseMode: "single",
    assetName: "ReadAny-Shlai.apk",
  };
}

export function shouldShowPublicUpdateControls(config: ShlaiReleaseConfig | null): boolean {
  return config !== null;
}

export function getShlaiReleaseConfig(): ShlaiReleaseConfig | null {
  return getShlaiReleaseConfigForExtra(Constants.expoConfig?.extra);
}
