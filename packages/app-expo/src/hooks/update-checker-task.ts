export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion?: string | null;
}

export interface UpdateCheckState<TResult extends UpdateCheckResult> {
  dismissedVersion: string | null;
  setCheckResult: (result: TResult) => void;
  showDialog: () => void;
}

interface ScheduleUpdateCheckOptions<TPlatform, TReleaseConfig, TResult extends UpdateCheckResult> {
  getPlatformService: () => TPlatform;
  checkForUpdate: (
    currentVersion: string,
    platform: TPlatform,
    force: boolean,
    releaseConfig: TReleaseConfig,
  ) => Promise<TResult>;
  getReleaseConfig: () => TReleaseConfig | null;
  getUpdateState: () => UpdateCheckState<TResult>;
  onError?: (error: unknown) => void;
}

const UPDATE_CHECK_DELAY_MS = 3000;

export function scheduleUpdateCheck<
  TPlatform extends { getAppVersion: () => Promise<string> },
  TReleaseConfig,
  TResult extends UpdateCheckResult,
>(options: ScheduleUpdateCheckOptions<TPlatform, TReleaseConfig, TResult>) {
  let cancelled = false;

  const timer = setTimeout(async () => {
    try {
      const releaseConfig = options.getReleaseConfig();
      if (releaseConfig === null) return;
      const platform = options.getPlatformService();
      const version = await platform.getAppVersion();
      const result = await options.checkForUpdate(version, platform, false, releaseConfig);

      if (cancelled) return;

      const { dismissedVersion, setCheckResult, showDialog } = options.getUpdateState();
      setCheckResult(result);

      if (result.hasUpdate && result.latestVersion && result.latestVersion !== dismissedVersion) {
        showDialog();
      }
    } catch (error) {
      options.onError?.(error);
    }
  }, UPDATE_CHECK_DELAY_MS);

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
