import { getShlaiReleaseConfig } from "@/lib/shlai-release";
import { useUpdateStore } from "@/stores/update-store";
import { getPlatformService } from "@readany/core/services";
import { checkForUpdate } from "@readany/core/update";
import { useEffect } from "react";
import { Platform } from "react-native";
import { scheduleUpdateCheck } from "./update-checker-task";

/**
 * Background update checker — runs once on mount.
 * Only active on Android for now.
 */
export function useUpdateChecker() {
  useEffect(() => {
    if (Platform.OS !== "android") return;

    return scheduleUpdateCheck({
      getPlatformService,
      checkForUpdate,
      getReleaseConfig: getShlaiReleaseConfig,
      getUpdateState: useUpdateStore.getState,
      onError: (error) => console.warn("[UpdateChecker] Background check failed:", error),
    });
  }, []);
}
