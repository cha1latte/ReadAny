import Constants from "expo-constants";

export interface ShlaiReleaseConfig {
  apiUrl: string;
  tagPrefix: string;
  throttleKey: string;
  assetName: string;
}

export function getShlaiReleaseConfig(): ShlaiReleaseConfig {
  const extra = Constants.expoConfig?.extra;
  return {
    apiUrl:
      extra?.releaseApiUrl || "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
    tagPrefix: extra?.releaseTagPrefix || "shlai-v",
    throttleKey: "shlai_update_last_check_at",
    assetName: extra?.releaseAssetName || "ReadAny-Shlai.apk",
  };
}
