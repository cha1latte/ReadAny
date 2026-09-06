import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { SyncButton } from "./SyncButton";

const { loops, state } = vi.hoisted(() => ({
  loops: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
  state: { status: "syncing", backendType: "webdav", syncNow: vi.fn(), loadConfig: vi.fn() },
}));
vi.mock("@readany/core/stores", () => ({
  useSyncStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("@/components/ui/Icon", () => ({ RefreshCwIcon: "Icon" }));
vi.mock("react-native", () => ({
  TouchableOpacity: "Button",
  Animated: {
    View: "View",
    Value: class {
      setValue() {}
      interpolate() {
        return "0deg";
      }
    },
    timing: vi.fn(),
    loop: () => {
      const loop = { start: vi.fn(), stop: vi.fn() };
      loops.push(loop);
      return loop;
    },
  },
  Easing: { linear: 0 },
}));
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

describe("sync icon visibility", () => {
  it("pauses hidden animation without cancelling sync, resumes when shown, and stops on unmount", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<SyncButton animationEnabled={false} />);
    });
    expect(loops).toHaveLength(0);
    await act(async () => {
      renderer.update(<SyncButton animationEnabled />);
    });
    expect(loops[0].start).toHaveBeenCalledOnce();
    await act(async () => {
      renderer.update(<SyncButton animationEnabled={false} />);
    });
    expect(loops[0].stop).toHaveBeenCalledOnce();
    expect(state.status).toBe("syncing");
    expect(state.syncNow).not.toHaveBeenCalled();
    await act(async () => {
      renderer.update(<SyncButton animationEnabled />);
    });
    expect(loops[1].start).toHaveBeenCalledOnce();
    await act(async () => {
      renderer.unmount();
    });
    expect(loops[1].stop).toHaveBeenCalledOnce();
  });
});
