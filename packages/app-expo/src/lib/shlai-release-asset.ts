export interface DownloadableReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export function selectReleaseAsset(
  assets: DownloadableReleaseAsset[] | undefined,
  assetName: string,
): DownloadableReleaseAsset | undefined {
  return assets?.find((asset) => asset.name === assetName);
}
