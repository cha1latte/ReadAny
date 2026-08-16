import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleUpdateCheck } from "./update-checker-task";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("useUpdateChecker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks once and consults hydrated state after an in-flight check resolves", async () => {
    const deferredResult = createDeferred<{
      hasUpdate: boolean;
      latestVersion: string;
    }>();
    const platform = { getAppVersion: vi.fn().mockResolvedValue("1.3.5-shlai.1") };
    const checkForUpdate = vi.fn().mockReturnValue(deferredResult.promise);
    const setCheckResult = vi.fn();
    const showDialog = vi.fn();
    let currentState = { dismissedVersion: null as string | null, setCheckResult, showDialog };

    scheduleUpdateCheck({
      getPlatformService: () => platform,
      checkForUpdate,
      getReleaseConfig: () => ({}) as never,
      getUpdateState: () => currentState,
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(platform.getAppVersion).toHaveBeenCalledTimes(1);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    currentState = { ...currentState, dismissedVersion: "1.3.5.2" };
    deferredResult.resolve({ hasUpdate: true, latestVersion: "1.3.5.2" });
    await vi.runAllTimersAsync();

    expect(setCheckResult).toHaveBeenCalledWith({ hasUpdate: true, latestVersion: "1.3.5.2" });
    expect(showDialog).not.toHaveBeenCalled();
  });

  it("shows the dialog when the latest state has not dismissed the update", async () => {
    const platform = { getAppVersion: vi.fn().mockResolvedValue("1.3.5-shlai.1") };
    const setCheckResult = vi.fn();
    const showDialog = vi.fn();

    scheduleUpdateCheck({
      getPlatformService: () => platform,
      checkForUpdate: vi.fn().mockResolvedValue({ hasUpdate: true, latestVersion: "1.3.5.2" }),
      getReleaseConfig: () => ({}) as never,
      getUpdateState: () => ({ dismissedVersion: null, setCheckResult, showDialog }),
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(setCheckResult).toHaveBeenCalledWith({ hasUpdate: true, latestVersion: "1.3.5.2" });
    expect(showDialog).toHaveBeenCalledTimes(1);
  });
});
