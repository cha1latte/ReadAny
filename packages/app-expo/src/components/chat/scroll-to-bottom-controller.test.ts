import { describe, expect, it, vi } from "vitest";
import { createScrollToBottomController } from "./scroll-to-bottom-controller";

describe("scroll-to-bottom controller", () => {
  it("keeps converging until the true bottom is observed", () => {
    const ticks: Array<() => void> = [];
    const scrollToEnd = vi.fn();
    const cancelSchedule = vi.fn();
    const controller = createScrollToBottomController({
      scrollToEnd,
      schedule: (callback) => {
        ticks.push(callback);
        return 7;
      },
      cancelSchedule,
      bottomThreshold: 80,
      maxAttempts: 10,
    });

    controller.request();
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(controller.isPending()).toBe(true);

    ticks[0]();
    controller.contentSizeChanged();
    expect(scrollToEnd.mock.calls.length).toBeGreaterThanOrEqual(3);

    controller.observeDistance(81);
    expect(controller.isPending()).toBe(true);
    controller.observeDistance(79);
    expect(controller.isPending()).toBe(false);
    expect(cancelSchedule).toHaveBeenCalledWith(7);
  });

  it("stops at the attempt bound and reports exhaustion once", () => {
    let tick: (() => void) | undefined;
    const scrollToEnd = vi.fn();
    const onExhausted = vi.fn();
    const controller = createScrollToBottomController({
      scrollToEnd,
      schedule: (callback) => {
        tick = callback;
        return "timer";
      },
      cancelSchedule: vi.fn(),
      bottomThreshold: 80,
      maxAttempts: 2,
      onExhausted,
    });

    controller.request();
    tick?.();
    tick?.();
    tick?.();

    expect(scrollToEnd).toHaveBeenCalledTimes(2);
    expect(controller.isPending()).toBe(false);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });
});
