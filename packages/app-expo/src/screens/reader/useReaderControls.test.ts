import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReaderControls } from "./useReaderControls";

const { animations } = vi.hoisted(() => ({
  animations: [] as Array<{ stopped: boolean; toValue: number }>,
}));
vi.mock("./reader-constants", () => ({ CONTROLS_TIMEOUT: 4000 }));
vi.mock("react-native", () => ({
  Animated: {
    Value: class {
      constructor(readonly value: number) {}
      interpolate() {
        return {};
      }
    },
    timing: (_value: unknown, config: { toValue: number }) => {
      const animation = {
        stopped: false,
        toValue: config.toValue,
        start: () => {},
        stop: () => {
          animation.stopped = true;
        },
      };
      animations.push(animation);
      return animation;
    },
  },
  Easing: { cubic: 0, out: () => 0 },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: TestRenderer.ReactTestRenderer;
let controls: ReturnType<typeof useReaderControls>;
function Reader() {
  controls = useReaderControls();
  return createElement("Controls");
}
beforeEach(async () => {
  vi.useFakeTimers();
  animations.length = 0;
  await act(async () => {
    renderer = TestRenderer.create(createElement(Reader));
  });
});
afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
  vi.useRealTimers();
});

describe("reader toolbar lifecycle", () => {
  it("does no animation or timer work while initially hidden", () => {
    expect(controls.showControls).toBe(false);
    expect(animations).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts immediately on tap and retains the same native animation bindings", async () => {
    const initial = controls;
    await act(async () => {
      controls.toggleControls();
      // Native animation should start before the React state update commits.
      expect(animations).toHaveLength(1);
    });
    expect(animations).toHaveLength(1);
    expect(animations[0].toValue).toBe(0);
    expect(controls.topControlsOpacity).toBe(initial.topControlsOpacity);
    expect(controls.bottomControlsOpacity).toBe(initial.bottomControlsOpacity);
    expect(controls.auxToolsTranslate).toBe(initial.auxToolsTranslate);
    await act(async () => {
      controls.toggleControls();
    });
    expect(animations[0].stopped).toBe(true);
    expect(controls.showControls).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      controls.toggleControls();
    });
    expect(animations[1].stopped).toBe(true);
    expect(controls.showControls).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("auto-hides and cancels timers and animations on reader unmount", async () => {
    await act(async () => {
      controls.setShowControls(true);
    });
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(controls.showControls).toBe(false);
    expect(animations).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      controls.setShowControls(true);
    });
    await act(async () => {
      renderer.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(animations.at(-1)?.stopped).toBe(true);
  });
});
