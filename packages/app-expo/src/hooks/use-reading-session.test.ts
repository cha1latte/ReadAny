import {
  setSessionEventSource,
  useReadingSession,
  webSessionEventSource,
} from "@readany/core/hooks/use-reading-session";
import { useReadingSessionStore } from "@readany/core/stores/reading-session-store";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { persist } = vi.hoisted(() => ({ persist: vi.fn(async () => {}) }));
vi.mock("@readany/core/db/database", () => ({ insertReadingSession: persist }));
vi.mock("@readany/core/stores/sync-store", () => ({
  useSyncStore: { getState: () => ({ status: "idle" }) },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let renderer: TestRenderer.ReactTestRenderer;
let renders: number;
let session: ReturnType<typeof useReadingSession>;
function Reader() {
  renders += 1;
  session = useReadingSession("test-book");
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  persist.mockClear();
  renders = 0;
  useReadingSessionStore.setState({ currentSession: null, sessionState: "STOPPED" });
  setSessionEventSource({
    subscribeActivity: () => () => {},
    subscribeVisibility: () => () => {},
    subscribeBeforeUnload: () => () => {},
  });
  await act(async () => {
    renderer = TestRenderer.create(createElement(Reader));
  });
});
afterEach(async () => {
  await act(async () => {
    renderer.unmount();
  });
  setSessionEventSource(webSessionEventSource);
  vi.useRealTimers();
});

describe("reading-session work while reading", () => {
  it("counts time without rerendering the reader on every tick", async () => {
    const initialRenders = renders;
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(useReadingSessionStore.getState().currentSession?.totalActiveTime).toBe(10_000);
    expect(renders).toBe(initialRenders);
  });

  it("still saves active reading periodically and flushes on unmount", async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        session.sendEvent({ type: "activity" });
        await vi.advanceTimersByTimeAsync(60_000);
      });
    }
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "test-book", totalActiveTime: 300_000 }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      renderer.unmount();
    });
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({ bookId: "test-book", totalActiveTime: 2000, state: "STOPPED" }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resumes accounting on activity after the idle timeout", async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(301_000);
    });
    expect(useReadingSessionStore.getState().sessionState).toBe("PAUSED");
    const pausedTime = useReadingSessionStore.getState().currentSession?.totalActiveTime ?? 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(useReadingSessionStore.getState().currentSession?.totalActiveTime).toBe(pausedTime);
    await act(async () => {
      session.sendEvent({ type: "activity" });
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(useReadingSessionStore.getState().sessionState).toBe("ACTIVE");
    expect(useReadingSessionStore.getState().currentSession?.totalActiveTime).toBe(
      pausedTime + 1000,
    );
  });
});
