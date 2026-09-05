import type { UpdateInstallState } from "@/lib/shlai-apk-installer";
import type { UpdateCheckResult } from "@readany/core/update";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
(globalThis as typeof globalThis & { React: typeof React }).React = React;

interface MockUpdateState {
  dialogVisible: boolean;
  checkResult: UpdateCheckResult;
  installState: UpdateInstallState;
  hideDialog: ReturnType<typeof vi.fn>;
  dismissVersion: ReturnType<typeof vi.fn>;
  setInstallState: ReturnType<typeof vi.fn>;
}

const updateStore = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const state = {} as MockUpdateState;
  const reset = () => {
    state.dialogVisible = true;
    state.checkResult = {
      hasUpdate: true,
      currentVersion: "1.3.6-shlai.0",
      latestVersion: "1.3.6.1",
      release: {
        version: "1.3.6.1",
        notes: "Test release",
        htmlUrl: "https://github.com/cha1latte/ReadAny/releases/tag/shlai-preview-v1.3.6.1",
        publishedAt: "2026-08-17T00:00:00Z",
        assets: [
          {
            name: "ReadAny-Shlai-Preview.apk",
            downloadUrl:
              "https://github.com/cha1latte/ReadAny/releases/download/shlai-preview-v1.3.6.1/ReadAny-Shlai-Preview.apk",
            size: 100,
          },
          {
            name: "ReadAny-Shlai-Preview.apk.sha256",
            downloadUrl:
              "https://github.com/cha1latte/ReadAny/releases/download/shlai-preview-v1.3.6.1/ReadAny-Shlai-Preview.apk.sha256",
            size: 100,
          },
        ],
      },
    };
    state.installState = { status: "idle" };
  };
  state.hideDialog = vi.fn(() => {
    state.dialogVisible = false;
    notify();
  });
  state.dismissVersion = vi.fn(() => {
    state.dialogVisible = false;
    notify();
  });
  state.setInstallState = vi.fn((installState: UpdateInstallState) => {
    state.installState = installState;
    notify();
  });
  reset();
  return { listeners, reset, state };
});

const installer = vi.hoisted(() => ({ install: vi.fn() }));

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const host = (name: string) =>
    function HostComponent(props: Record<string, unknown>) {
      return ReactModule.createElement(name, props, props.children as React.ReactNode);
    };
  return {
    Linking: { openURL: vi.fn() },
    Modal: host("Modal"),
    Pressable: host("Pressable"),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: host("Text"),
    TouchableOpacity: host("TouchableOpacity"),
    View: host("View"),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrValues?: string | { version?: string }) =>
      typeof fallbackOrValues === "string"
        ? fallbackOrValues
        : key === "settings.newVersionAvailable"
          ? `Version ${fallbackOrValues?.version}`
          : key,
  }),
}));

vi.mock("@/styles/theme", () => ({
  fontSize: { lg: 18, sm: 14, xs: 12 },
  fontWeight: { bold: "700", medium: "500", semibold: "600" },
  radius: { full: 99, lg: 8, xl: 12, xxl: 16 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xxl: 24 },
  useColors: () => ({
    border: "border",
    card: "card",
    destructive: "red",
    foreground: "foreground",
    muted: "muted",
    mutedForeground: "mutedForeground",
    primary: "primary",
    primaryForeground: "primaryForeground",
  }),
  withOpacity: (color: string) => color,
}));

vi.mock("@/stores/update-store", async () => {
  const ReactModule = await import("react");
  return {
    useUpdateStore: (selector: (state: MockUpdateState) => unknown) =>
      ReactModule.useSyncExternalStore(
        (listener) => {
          updateStore.listeners.add(listener);
          return () => updateStore.listeners.delete(listener);
        },
        () => selector(updateStore.state),
        () => selector(updateStore.state),
      ),
  };
});

vi.mock("@/lib/shlai-release", () => ({
  getShlaiReleaseConfig: () => ({
    apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100",
    assetName: "ReadAny-Shlai-Preview.apk",
    checksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
    releaseMode: "canonical-prerelease-list",
    tagPrefix: "shlai-preview-v",
    throttleKey: "test",
  }),
}));

vi.mock("@/lib/shlai-release-asset", () => ({
  selectReleaseAsset: (assets: Array<{ name: string }> | undefined, name: string) =>
    assets?.find((asset) => asset.name === name),
}));

vi.mock("@/lib/shlai-apk-installer", () => ({
  createUpdateInstallOwner: () => {
    let active = false;
    return {
      async run(operation: () => Promise<unknown>) {
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
  },
  installShlaiPreviewUpdateWithExpo: installer.install,
}));

import { UpdateDialog } from "./UpdateDialog";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function isHostType(node: TestRenderer.ReactTestInstance, type: string): boolean {
  return (node.type as unknown) === type;
}

function textContent(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => isHostType(node, "Text"))
    .flatMap((node) => node.children)
    .join(" ");
}

describe("UpdateDialog", () => {
  beforeEach(() => {
    updateStore.reset();
    updateStore.state.hideDialog.mockClear();
    updateStore.state.dismissVersion.mockClear();
    updateStore.state.setInstallState.mockClear();
    installer.install.mockReset();
  });

  it("locks both actions, renders progress and verification, and hides only after install resolves", async () => {
    const download = deferred();
    const verification = deferred();
    installer.install.mockImplementation(async (_input, onState) => {
      onState({ status: "downloading", progress: 0.4 });
      await download.promise;
      onState({ status: "verifying" });
      await verification.promise;
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<UpdateDialog />);
    });
    const primary = renderer.root.findAll((node) => isHostType(node, "TouchableOpacity"))[0];

    await act(async () => {
      void primary.props.onPress();
      await Promise.resolve();
    });
    expect(
      renderer.root
        .findAll((node) => isHostType(node, "TouchableOpacity"))
        .map((node) => node.props.disabled),
    ).toEqual([true, true]);
    expect(textContent(renderer)).toContain("Downloading… 40%");
    expect(updateStore.state.hideDialog).not.toHaveBeenCalled();

    await act(async () => {
      download.resolve();
      await Promise.resolve();
    });
    expect(textContent(renderer)).toContain("Verifying…");
    expect(updateStore.state.hideDialog).not.toHaveBeenCalled();

    await act(async () => {
      verification.resolve();
      await verification.promise;
    });
    expect(updateStore.state.hideDialog).toHaveBeenCalledTimes(1);
    expect(renderer.toJSON()).toBeNull();
  });

  it("renders an installer error and permits a successful retry", async () => {
    installer.install
      .mockRejectedValueOnce(new Error("checksum failed"))
      .mockResolvedValueOnce(undefined);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<UpdateDialog />);
    });

    await act(async () => {
      await renderer.root
        .findAll((node) => isHostType(node, "TouchableOpacity"))[0]
        .props.onPress();
    });
    expect(textContent(renderer)).toContain("checksum failed");
    expect(
      renderer.root
        .findAll((node) => isHostType(node, "TouchableOpacity"))
        .map((node) => node.props.disabled),
    ).toEqual([false, false]);
    expect(updateStore.state.hideDialog).not.toHaveBeenCalled();

    await act(async () => {
      await renderer.root
        .findAll((node) => isHostType(node, "TouchableOpacity"))[0]
        .props.onPress();
    });
    expect(installer.install).toHaveBeenCalledTimes(2);
    expect(updateStore.state.hideDialog).toHaveBeenCalledTimes(1);
  });

  it("owns the install before progress renders and ignores an immediate double tap", async () => {
    const pending = deferred();
    installer.install.mockReturnValue(pending.promise);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<UpdateDialog />);
    });
    const primary = renderer.root.findAll((node) => isHostType(node, "TouchableOpacity"))[0];

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = primary.props.onPress();
      second = primary.props.onPress();
      await Promise.resolve();
    });
    expect(installer.install).toHaveBeenCalledTimes(1);
    expect(updateStore.state.hideDialog).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
      await Promise.all([first, second]);
    });
    expect(updateStore.state.hideDialog).toHaveBeenCalledTimes(1);
  });
});
