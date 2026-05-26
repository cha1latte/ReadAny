/**
 * ReadAny Expo App — Root component
 *
 * Initialises platform service, i18n, and mounts navigation.
 */

// Polyfill AbortSignal.throwIfAborted — missing in Hermes, required by LangChain
if (typeof AbortSignal !== "undefined" && !AbortSignal.prototype.throwIfAborted) {
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) {
      const err = this.reason ?? new Error("The operation was aborted.");
      throw err;
    }
  };
}

// Polyfill navigator.userAgent for LangChain — React Native doesn't have userAgent
if (typeof navigator !== "undefined" && !navigator.userAgent) {
  Object.defineProperty(navigator, "userAgent", {
    get: () => "ReactNative",
    configurable: true,
  });
}

import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LogBox, Platform, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplash } from "@/components/splash/AnimatedSplash";
import { rnSessionEventSource } from "@/hooks";
import { setStreamingFetch } from "@readany/core/ai/llm-provider";
import { initDatabase } from "@readany/core/db/database";
import { installFeedbackLogCapture, setFeedbackWorkerUrl } from "@readany/core/feedback";
import { setSessionEventSource } from "@readany/core/hooks/use-reading-session";
import { i18nReady, initI18nLanguage } from "@readany/core/i18n";
import i18n from "@readany/core/i18n";
import { setPlatformService } from "@readany/core/services";
import { setSyncAdapter } from "@readany/core/sync";
import { Audio } from "expo-av";
import { I18nextProvider } from "react-i18next";
import TrackPlayer, { Event as TrackEvent, Capability } from "react-native-track-player";

import { FloatingTTSBubble } from "@/components/tts/FloatingTTSBubble";
import { UpdateDialog } from "@/components/update/UpdateDialog";
import { useUpdateChecker } from "@/hooks/use-update-checker";
import { navigationRef } from "@/lib/navigationRef";
import { ExpoPlatformService } from "@/lib/platform/expo-platform-service";
import { MobileSyncAdapter } from "@/lib/sync/sync-adapter-mobile";
import { RootNavigator } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import { ThemeProvider, useTheme } from "@/styles/ThemeContext";
import { useAutoSync } from "@readany/core/hooks/use-auto-sync";

installFeedbackLogCapture();

// iOS New-Arch + expo-dev-client cold-start: when dev-client swaps its boot
// RCTInstance for the app's instance, RCTTurboModuleManager waits up to 10s for
// every TurboModule's invalidate to return. If any module's method queue is slow
// (e.g. react-native-track-player v4, whose v4 branch is frozen and does not
// fully support RN 0.81 New Arch), the wait times out and prints RCTLogError —
// triggering a red-box. State clears correctly afterwards (see
// RCTTurboModuleManager.mm:1105), so the warning is purely cosmetic dev noise.
if (Platform.OS === "ios") {
  LogBox.ignoreLogs([/TurboModuleManager: Timed out waiting for modules to be invalidated/]);
}

const FEEDBACK_WORKER_FALLBACK = "https://feedback.readany.top";
const feedbackWorkerUrl = process.env.EXPO_PUBLIC_FEEDBACK_WORKER_URL?.trim() || FEEDBACK_WORKER_FALLBACK;
setFeedbackWorkerUrl(feedbackWorkerUrl);

// Keep the native splash screen visible while we bootstrap
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Race a promise against a timeout. Resolves to the promise result, or rejects
 * with a labeled timeout error after `ms`. Used to keep individual bootstrap
 * steps from hanging the entire app start (e.g. native modules that block
 * waiting on system services when offline — see #205).
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    // Belt-and-braces: even if a step inside bootstrap hangs without resolving
    // and without timing out (unforeseen native lockup), force the app into the
    // ready state after 15s so users can at least see the UI instead of a
    // permanent splash screen. Reported by #205 (no-network startup deadlock).
    const bootstrapFallback = setTimeout(() => {
      console.warn("[App] Bootstrap exceeded 15s — forcing ready=true to escape splash");
      setReady(true);
    }, 15000);

    async function bootstrap() {
      try {
        console.log("[App] bootstrap: register platform service");
        const platform = new ExpoPlatformService();
        setPlatformService(platform);

        console.log("[App] bootstrap: register sync adapter");
        setSyncAdapter(new MobileSyncAdapter());

        console.log("[App] bootstrap: init database");
        await initDatabase();

        console.log("[App] bootstrap: wait i18nReady");
        await i18nReady;
        console.log("[App] i18n initialized successfully");

        console.log("[App] bootstrap: register RN session source");
        setSessionEventSource(rnSessionEventSource);

        console.log("[App] bootstrap: init language");
        await initI18nLanguage();

        console.log("[App] bootstrap: import expo/fetch");
        const { fetch: expoFetch } = await import("expo/fetch");
        setStreamingFetch(expoFetch as typeof globalThis.fetch);

        console.log("[App] bootstrap: configure audio mode");
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });

        console.log("[App] bootstrap: init react-native-track-player");
        // setupPlayer can only be called once per native process. On Android,
        // a Configuration Change (e.g. Huawei tablet small-screen → fullscreen)
        // restarts the Activity and re-runs this bootstrap, but the native
        // singleton is still alive — so setupPlayer() throws
        // "The player has already been initialized via setupPlayer".
        // Treat that specific error as success so bootstrap can continue.
        //
        // Separately (#205): in some no-network Android scenarios setupPlayer
        // never returns at all. Race it against an 8s timeout so a hung native
        // module can't pin the whole app on the splash screen. TTS may be
        // unavailable in that session, but the rest of the app still boots.
        try {
          await withTimeout(TrackPlayer.setupPlayer(), 8000, "TrackPlayer.setupPlayer");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/already been initialized/i.test(msg)) {
            console.log("[App] TrackPlayer already initialized — reusing existing native instance");
          } else if (/timed out/i.test(msg)) {
            console.warn(`[App] ${msg} — continuing without TrackPlayer; TTS playback may be unavailable`);
          } else {
            throw e;
          }
        }
        try {
          await withTimeout(
            TrackPlayer.updateOptions({
              capabilities: [
                Capability.Play,
                Capability.Pause,
                Capability.Stop,
                Capability.SkipToNext,
                Capability.SkipToPrevious,
              ],
              compactCapabilities: [Capability.Play, Capability.Pause],
              notificationCapabilities: [
                Capability.Play,
                Capability.Pause,
                Capability.Stop,
                Capability.SkipToNext,
                Capability.SkipToPrevious,
              ],
            }),
            5000,
            "TrackPlayer.updateOptions",
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[App] TrackPlayer.updateOptions failed (${msg}) — continuing`);
        }

        // Remote event → TTS store bridge
        const { useTTSStore: ttsStore } = await import("@/stores/tts-store");
        TrackPlayer.addEventListener(TrackEvent.RemotePlay, () => {
          ttsStore.getState().resume();
        });
        TrackPlayer.addEventListener(TrackEvent.RemotePause, () => {
          ttsStore.getState().pause();
        });
        TrackPlayer.addEventListener(TrackEvent.RemoteStop, () => {
          ttsStore.getState().stop();
        });
        TrackPlayer.addEventListener(TrackEvent.RemoteNext, () => {
          const { jumpToChunk, currentChunkIndex, totalChunks } = ttsStore.getState();
          const nextIndex = currentChunkIndex + 1;
          if (nextIndex < totalChunks) {
            jumpToChunk(nextIndex);
          }
        });
        TrackPlayer.addEventListener(TrackEvent.RemotePrevious, () => {
          const { jumpToChunk, currentChunkIndex } = ttsStore.getState();
          const prevIndex = currentChunkIndex - 1;
          if (prevIndex >= 0) {
            jumpToChunk(prevIndex);
          }
        });

        console.log("[App] bootstrap: done");
        clearTimeout(bootstrapFallback);
        setReady(true);
        // Hide native splash now — our animated splash takes over
        await SplashScreen.hideAsync();
      } catch (error) {
        console.error("[App] bootstrap failed:", error);
        clearTimeout(bootstrapFallback);
        setBootError(error instanceof Error ? error.message : String(error));
        await SplashScreen.hideAsync();
      }
    }
    bootstrap();
    return () => clearTimeout(bootstrapFallback);
  }, []);

  const handleSplashFinish = useCallback(() => {
    setSplashDone(true);
  }, []);

  if (bootError) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#1c1c1e",
          padding: 24,
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontSize: 18,
            fontWeight: "600",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          App failed to start
        </Text>
        <Text style={{ color: "#fca5a5", fontSize: 14, textAlign: "center" }}>{bootError}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#05042B",
        }}
      >
        {/* Background matches animated splash so transition is seamless */}
      </View>
    );
  }

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AppInner />
        {!splashDone && <AnimatedSplash onFinish={handleSplashFinish} />}
      </ThemeProvider>
    </I18nextProvider>
  );
}

function AppInner() {
  const { colors, isDark, mode } = useTheme();
  const loadBooks = useLibraryStore((s) => s.loadBooks);
  useUpdateChecker();
  useAutoSync(loadBooks);

  const navTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        background: colors.background,
        card: colors.card,
        text: colors.foreground,
        border: colors.border,
        primary: colors.primary,
      },
    }),
    [colors, isDark],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <NavigationContainer theme={navTheme} ref={navigationRef}>
          <StatusBar style={mode === "dark" ? "light" : "dark"} />
          <RootNavigator />
        </NavigationContainer>
        <UpdateDialog />
        <FloatingTTSBubble />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
