import { BUILTIN_THEMES } from "@readany/core/theme";
import type { ThemeColorSet, ThemeDefinition } from "@readany/core/theme";
import * as SecureStore from "expo-secure-store";
/**
 * ThemeContext — provides theme support for React Native / Expo.
 *
 * Reads color definitions from @readany/core/theme builtin themes.
 * Persistence is local (SecureStore), NOT synced cross-platform.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  destructiveForeground: string;
  accent: string;
  accentForeground: string;
  // Functional
  indigo: string;
  emerald: string;
  amber: string;
  blue: string;
  violet: string;
  // Highlight colors
  highlightYellow: string;
  highlightGreen: string;
  highlightBlue: string;
  highlightPink: string;
  highlightPurple: string;
  // Fallback cover gradients
  stone100: string;
  stone200: string;
  stone300: string;
  stone400: string;
  stone500: string;
}

// Functional & stone colors that don't come from the theme definition
const FUNCTIONAL_COLORS = {
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// Default highlight colors for light / dark
const LIGHT_HIGHLIGHTS = {
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
};

const DARK_HIGHLIGHTS = {
  highlightYellow: "#854d0e",
  highlightGreen: "#166534",
  highlightBlue: "#1e40af",
  highlightPink: "#9d174d",
  highlightPurple: "#6b21a8",
};

/** Convert a ThemeColorSet to mobile ThemeColors */
function colorSetToThemeColors(colorSet: ThemeColorSet, mode: ThemeMode): ThemeColors {
  const highlights = mode === "dark" ? DARK_HIGHLIGHTS : LIGHT_HIGHLIGHTS;
  return {
    background: colorSet.background,
    foreground: colorSet.foreground,
    card: colorSet.card,
    cardForeground: colorSet.cardForeground,
    muted: colorSet.muted,
    mutedForeground: colorSet.mutedForeground,
    border: colorSet.border,
    primary: colorSet.primary,
    primaryForeground: colorSet.primaryForeground,
    destructive: colorSet.destructive,
    destructiveForeground: colorSet.destructiveForeground,
    accent: colorSet.accent,
    accentForeground: colorSet.accentForeground,
    ...FUNCTIONAL_COLORS,
    ...highlights,
  };
}

const STORAGE_KEY = "readany-theme";
const STORAGE_THEME_ID_KEY = "readany-theme-id";

export interface ReaderColors {
  background: string;
  foreground: string;
  linkColor: string;
}

interface ThemeContextValue {
  mode: ThemeMode;
  activeThemeId: string;
  colors: ThemeColors;
  readerColors: ReaderColors;
  allThemes: ThemeDefinition[];
  setMode: (mode: ThemeMode) => void;
  setActiveTheme: (themeId: string) => void;
  isDark: boolean;
}

const defaultTheme = BUILTIN_THEMES.find((t) => t.id === "sepia") ?? BUILTIN_THEMES[0];

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  activeThemeId: "sepia",
  colors: colorSetToThemeColors(defaultTheme.light, "light"),
  readerColors: defaultTheme.reader?.light ?? { background: "#ffffff", foreground: "#1a1a1a", linkColor: "#2563eb" },
  allThemes: BUILTIN_THEMES,
  setMode: () => {},
  setActiveTheme: () => {},
  isDark: false,
});

export function ThemeProvider({
  children,
  initialMode = "light",
}: {
  children: ReactNode;
  initialMode?: ThemeMode;
}) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [activeThemeId, setActiveThemeId] = useState("sepia");

  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync(STORAGE_KEY),
      SecureStore.getItemAsync(STORAGE_THEME_ID_KEY),
    ]).then(([savedMode, savedThemeId]) => {
      if (savedMode === "light" || savedMode === "dark") {
        setModeState(savedMode);
      } else if (savedMode === "sepia") {
        // Migration: old "sepia" mode → light mode + sepia theme
        setModeState("light");
        setActiveThemeId("sepia");
        SecureStore.setItemAsync(STORAGE_KEY, "light");
        SecureStore.setItemAsync(STORAGE_THEME_ID_KEY, "sepia");
      }
      if (savedThemeId && BUILTIN_THEMES.some((t) => t.id === savedThemeId)) {
        setActiveThemeId(savedThemeId);
      }
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    SecureStore.setItemAsync(STORAGE_KEY, m);
  }, []);

  const setActiveTheme = useCallback((themeId: string) => {
    setActiveThemeId(themeId);
    SecureStore.setItemAsync(STORAGE_THEME_ID_KEY, themeId);
  }, []);

  const value: ThemeContextValue = useMemo(() => {
    const themeDef = BUILTIN_THEMES.find((t) => t.id === activeThemeId) ?? defaultTheme;
    const colorSet = mode === "dark" ? themeDef.dark : themeDef.light;
    // Derive reader colors: from theme.reader if present, otherwise fallback to main colors
    const readerColorSet = themeDef.reader
      ? (mode === "dark" ? themeDef.reader.dark : themeDef.reader.light)
      : { background: colorSet.background, foreground: colorSet.foreground, linkColor: colorSet.primary };
    return {
      mode,
      activeThemeId,
      colors: colorSetToThemeColors(colorSet, mode),
      readerColors: readerColorSet,
      allThemes: BUILTIN_THEMES,
      setMode,
      setActiveTheme,
      isDark: mode === "dark",
    };
  }, [mode, activeThemeId, setMode, setActiveTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Backward-compatible exports.
 * Components that used lightColors/darkColors/sepiaColors can still import them.
 */
const lightColors: ThemeColors = colorSetToThemeColors(
  (BUILTIN_THEMES.find((t) => t.id === "default") ?? BUILTIN_THEMES[0]).light,
  "light",
);
const darkColors: ThemeColors = colorSetToThemeColors(
  (BUILTIN_THEMES.find((t) => t.id === "default") ?? BUILTIN_THEMES[0]).dark,
  "dark",
);
const sepiaColors: ThemeColors = colorSetToThemeColors(
  (BUILTIN_THEMES.find((t) => t.id === "sepia") ?? BUILTIN_THEMES[0]).light,
  "light",
);
const THEME_MAP: Record<string, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
  sepia: sepiaColors,
};

export { lightColors, darkColors, sepiaColors, THEME_MAP };
