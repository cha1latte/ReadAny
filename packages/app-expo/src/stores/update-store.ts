import type { UpdateInstallState } from "@/lib/shlai-apk-installer";
import type { UpdateCheckResult } from "@readany/core/update";
import { create } from "zustand";
import { withPersist } from "./persist";

export interface UpdateState {
  /** Version the user chose to skip — persisted across sessions */
  dismissedVersion: string | null;

  /** Latest check result (ephemeral, resets on cold boot) */
  checkResult: UpdateCheckResult | null;
  /** Whether the update dialog is visible */
  dialogVisible: boolean;
  installState: UpdateInstallState;

  setCheckResult: (result: UpdateCheckResult | null) => void;
  showDialog: () => void;
  hideDialog: () => void;
  setInstallState: (state: UpdateInstallState) => void;
  /** Dismiss update for a specific version — won't prompt again until a newer version */
  dismissVersion: (version: string) => void;
}

export const useUpdateStore = create<UpdateState>()(
  withPersist<UpdateState>(
    "update",
    (set) => ({
      dismissedVersion: null,
      checkResult: null,
      dialogVisible: false,
      installState: { status: "idle" },

      setCheckResult: (result) => set({ checkResult: result }),
      showDialog: () => set({ dialogVisible: true }),
      hideDialog: () => set({ dialogVisible: false }),
      setInstallState: (installState) => set({ installState }),
      dismissVersion: (version) => set({ dismissedVersion: version, dialogVisible: false }),
    }),
    {
      checkResult: null,
      dialogVisible: false,
      installState: { status: "idle" },
    },
  ),
);
