import { useCallback, useEffect, useRef } from "react";
/**
 * useReadingSession — reading session state machine hook
 *
 * Cross-platform: event listeners are provided by a SessionEventSource adapter.
 * - Web: uses window/document event listeners (default)
 * - React Native: inject an AppState-based adapter
 */
import { type SessionEvent, createSessionDetector } from "../reader/session-detector";
import { useAppStore } from "../stores/app-store";
import { useReadingSessionStore } from "../stores/reading-session-store";
import { useSyncStore } from "../stores/sync-store";

// Save session every 5 minutes
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000;

/**
 * Platform adapter for user activity / visibility / unload events.
 * Each platform provides its own implementation.
 */
export interface SessionEventSource {
  /** Subscribe to user activity events. Returns unsubscribe function. */
  subscribeActivity(callback: () => void): () => void;
  /** Subscribe to visibility changes. Returns unsubscribe function. */
  subscribeVisibility(callback: (visible: boolean) => void): () => void;
  /** Subscribe to app close / beforeunload. Returns unsubscribe function. */
  subscribeBeforeUnload(callback: () => void): () => void;
}

/** Default Web implementation using window/document events */
export const webSessionEventSource: SessionEventSource = {
  subscribeActivity(callback) {
    if (typeof window === "undefined") return () => {};
    const events = ["mousemove", "keydown", "scroll", "click", "touchstart"] as const;
    for (const evt of events) {
      window.addEventListener(evt, callback);
    }
    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, callback);
      }
    };
  },
  subscribeVisibility(callback) {
    if (typeof document === "undefined") return () => {};
    const handler = () => callback(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
  subscribeBeforeUnload(callback) {
    if (typeof window === "undefined") return () => {};
    window.addEventListener("beforeunload", callback);
    return () => window.removeEventListener("beforeunload", callback);
  },
};

/** Global override — set by platforms that cannot use web events (e.g. React Native) */
let _sessionEventSource: SessionEventSource = webSessionEventSource;

export function setSessionEventSource(source: SessionEventSource): void {
  _sessionEventSource = source;
}

export function useReadingSession(bookId: string | null, tabId?: string) {
  // Session ticks update currentSession every second; the reader only needs actions.
  const startSession = useReadingSessionStore((s) => s.startSession);
  const pauseSession = useReadingSessionStore((s) => s.pauseSession);
  const resumeSession = useReadingSessionStore((s) => s.resumeSession);
  const stopSession = useReadingSessionStore((s) => s.stopSession);
  const updateActiveTime = useReadingSessionStore((s) => s.updateActiveTime);
  const saveCurrentSession = useReadingSessionStore((s) => s.saveCurrentSession);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const isTabActive = tabId ? activeTabId === tabId : true;

  const dispatchRef = useRef<(event: SessionEvent) => void>(() => {});
  const sendEvent = useCallback((event: SessionEvent) => dispatchRef.current(event), []);

  useEffect(() => {
    if (!bookId || !isTabActive) return;

    const isCurrentTabActive = () => !tabId || useAppStore.getState().activeTabId === tabId;
    const detector = createSessionDetector(undefined, (from, to) => {
      switch (to) {
        case "ACTIVE":
          if (from === "STOPPED") startSession(bookId);
          else resumeSession();
          break;
        case "PAUSED":
          pauseSession();
          break;
        case "STOPPED":
          stopSession();
          break;
      }
    });
    let lastActivity = Date.now();
    let lastSave = Date.now();
    const dispatch = (event: SessionEvent) => {
      if (!isCurrentTabActive()) return;
      if (event.type === "activity") lastActivity = Date.now();
      detector.processEvent(event);
    };
    dispatchRef.current = dispatch;
    const source = _sessionEventSource;
    const unsubActivity = source.subscribeActivity(() => dispatch({ type: "activity" }));
    const unsubVisibility = source.subscribeVisibility((visible) =>
      dispatch({ type: "visibility", visible }),
    );
    const unsubUnload = source.subscribeBeforeUnload(() => dispatch({ type: "close" }));
    dispatch({ type: "activity" });

    const timer = setInterval(() => {
      if (!isCurrentTabActive()) return;
      const currentState = detector.currentState;
      const idleDuration = Date.now() - lastActivity;
      if (idleDuration >= 30000) detector.processEvent({ type: "idle", duration: idleDuration });
      if (currentState === "ACTIVE") {
        updateActiveTime();
        const syncStatus = useSyncStore.getState().status;
        const syncInProgress = syncStatus !== "idle" && syncStatus !== "error";
        if (!syncInProgress && Date.now() - lastSave >= AUTO_SAVE_INTERVAL) {
          lastSave = Date.now();
          void saveCurrentSession();
        }
      }
    }, 1000);

    return () => {
      dispatchRef.current = () => {};
      unsubActivity();
      unsubVisibility();
      unsubUnload();
      clearInterval(timer);
      detector.processEvent({ type: "close" });
    };
  }, [
    bookId,
    tabId,
    isTabActive,
    startSession,
    pauseSession,
    resumeSession,
    stopSession,
    updateActiveTime,
    saveCurrentSession,
  ]);

  return { sendEvent };
}
