/**
 * Theme Injector — applies theme colors to CSS variables on the desktop.
 *
 * Call `applyThemeToDOM()` whenever the theme or mode changes.
 * Call `setupSystemModeListener()` once at startup to track OS dark mode.
 */
import { useThemeStore } from "@readany/core/theme";
import type { ThemeColorSet } from "@readany/core/theme";

/** Map ThemeColorSet fields to CSS variable names */
const COLOR_VAR_MAP: Record<keyof ThemeColorSet, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
};

/** Apply the current theme's color set + style to the DOM */
export function applyThemeToDOM(): void {
  const store = useThemeStore.getState();
  const colors = store.getActiveColors();
  const style = store.getStyle();
  const highlights = store.getHighlightColors();
  const root = document.documentElement;

  // Inject colors
  for (const [key, varName] of Object.entries(COLOR_VAR_MAP)) {
    const value = colors[key as keyof ThemeColorSet];
    if (value) root.style.setProperty(varName, value);
  }

  // Inject highlights
  root.style.setProperty("--color-highlight-yellow", highlights.yellow);
  root.style.setProperty("--color-highlight-green", highlights.green);
  root.style.setProperty("--color-highlight-blue", highlights.blue);
  root.style.setProperty("--color-highlight-pink", highlights.pink);
  root.style.setProperty("--color-highlight-purple", highlights.purple);

  // Inject style
  root.style.setProperty("--radius", `${style.radius}rem`);

  // Set data-mode for components that need to know light/dark
  root.setAttribute("data-mode", store.resolvedMode);
}

/** Listen for OS dark mode changes and update resolvedMode */
export function setupSystemModeListener(): () => void {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const updateResolved = () => {
    const store = useThemeStore.getState();
    if (store.mode === "system") {
      const resolved = mediaQuery.matches ? "dark" : "light";
      store.setResolvedMode(resolved);
    }
  };

  // Initial resolve
  const store = useThemeStore.getState();
  if (store.mode === "system") {
    store.setResolvedMode(mediaQuery.matches ? "dark" : "light");
  } else {
    store.setResolvedMode(store.mode);
  }

  mediaQuery.addEventListener("change", updateResolved);
  return () => mediaQuery.removeEventListener("change", updateResolved);
}

/** Subscribe to theme store changes and re-apply to DOM */
export function setupThemeStoreSubscription(): () => void {
  return useThemeStore.subscribe(() => {
    applyThemeToDOM();
  });
}

/**
 * Initialize the theme system on desktop.
 * Call once at app startup (e.g. in main.tsx).
 */
export function initDesktopTheme(): () => void {
  // Load persisted settings
  const saved = localStorage.getItem("readany-theme-store");
  if (saved) {
    try {
      const data = JSON.parse(saved);
      useThemeStore.getState().hydrate(data);
    } catch {
      // Ignore parse errors
    }
  } else {
    // Migration: map old theme setting to new system
    const oldTheme = localStorage.getItem("readany-theme");
    if (oldTheme === "dark") {
      useThemeStore.getState().hydrate({ activeThemeId: "default", mode: "dark" });
    } else if (oldTheme === "sepia") {
      useThemeStore.getState().hydrate({ activeThemeId: "sepia", mode: "light" });
    } else if (oldTheme === "light") {
      useThemeStore.getState().hydrate({ activeThemeId: "default", mode: "light" });
    } else if (oldTheme === "system") {
      useThemeStore.getState().hydrate({ activeThemeId: "default", mode: "system" });
    }
  }

  // Setup listeners
  const cleanupModeListener = setupSystemModeListener();
  const cleanupStoreSubscription = setupThemeStoreSubscription();

  // Initial apply
  applyThemeToDOM();

  // Persist on change
  const cleanupPersist = useThemeStore.subscribe((state: { activeThemeId: string; mode: string; customThemes: unknown[]; bookThemeOverrides: Record<string, string> }) => {
    localStorage.setItem(
      "readany-theme-store",
      JSON.stringify({
        activeThemeId: state.activeThemeId,
        mode: state.mode,
        customThemes: state.customThemes,
        bookThemeOverrides: state.bookThemeOverrides,
      }),
    );
  });

  return () => {
    cleanupModeListener();
    cleanupStoreSubscription();
    cleanupPersist();
  };
}
