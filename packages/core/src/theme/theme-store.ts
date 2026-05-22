/**
 * Theme Store — manages active theme, mode, and custom themes.
 *
 * Persistence: theme settings are saved via platform kvStore (SecureStore on mobile,
 * localStorage on desktop) so they survive restarts.
 */
import { create } from "zustand";
import { BUILTIN_THEMES, getDefaultTheme } from "./builtin-themes";
import {
  DEFAULT_HIGHLIGHTS,
  DEFAULT_STYLE,
  type HighlightColors,
  type ReaderColorSet,
  type ResolvedMode,
  type ThemeBackground,
  type ThemeColorSet,
  type ThemeDefinition,
  type ThemeMode,
  type ThemeStyle,
} from "./theme-schema";

// ─── State ───────────────────────────────────────────────────────────────────

export interface ThemeState {
  /** Active theme ID */
  activeThemeId: string;
  /** User preference: light / dark / system */
  mode: ThemeMode;
  /** Resolved actual mode (after evaluating system preference) */
  resolvedMode: ResolvedMode;
  /** Custom themes created by user */
  customThemes: ThemeDefinition[];
  /** Per-book reader theme overrides: bookId → themeId */
  bookThemeOverrides: Record<string, string>;

  // ── Computed getters ──
  /** Get the current active theme definition */
  getCurrentTheme: () => ThemeDefinition;
  /** Get resolved color set (light or dark) for the active theme */
  getActiveColors: () => ThemeColorSet;
  /** Get reader colors for the active theme */
  getReaderColors: () => ReaderColorSet;
  /** Get highlight colors */
  getHighlightColors: () => HighlightColors;
  /** Get style parameters */
  getStyle: () => ThemeStyle;
  /** Get app background settings */
  getAppBackground: () => ThemeBackground | undefined;
  /** Get reader background settings */
  getReaderBackground: () => ThemeBackground | undefined;
  /** Get all available themes (builtin + custom) */
  getAllThemes: () => ThemeDefinition[];
  /** Get reader theme for a specific book (with fallback to active) */
  getBookReaderColors: (bookId: string) => ReaderColorSet;

  // ── Actions ──
  setTheme: (themeId: string) => void;
  setMode: (mode: ThemeMode) => void;
  setResolvedMode: (mode: ResolvedMode) => void;
  addCustomTheme: (theme: ThemeDefinition) => void;
  updateCustomTheme: (id: string, updates: Partial<ThemeDefinition>) => void;
  deleteCustomTheme: (id: string) => void;
  setBookTheme: (bookId: string, themeId: string | null) => void;
  /** Hydrate from persisted storage */
  hydrate: (data: {
    activeThemeId?: string;
    mode?: ThemeMode;
    customThemes?: ThemeDefinition[];
    bookThemeOverrides?: Record<string, string>;
  }) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findTheme(id: string, customThemes: ThemeDefinition[]): ThemeDefinition {
  return (
    BUILTIN_THEMES.find((t) => t.id === id) ||
    customThemes.find((t) => t.id === id) ||
    getDefaultTheme()
  );
}

function deriveReaderColors(theme: ThemeDefinition, mode: ResolvedMode): ReaderColorSet {
  if (theme.reader) {
    return theme.reader[mode];
  }
  const colors = mode === "dark" ? theme.dark : theme.light;
  return {
    background: colors.background,
    foreground: colors.foreground,
    linkColor: colors.primary,
  };
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useThemeStore = create<ThemeState>((set, get) => ({
  activeThemeId: "sepia",
  mode: "system",
  resolvedMode: "light",
  customThemes: [],
  bookThemeOverrides: {},

  // ── Computed ──

  getCurrentTheme: () => findTheme(get().activeThemeId, get().customThemes),

  getActiveColors: () => {
    const theme = get().getCurrentTheme();
    return get().resolvedMode === "dark" ? theme.dark : theme.light;
  },

  getReaderColors: () => {
    const theme = get().getCurrentTheme();
    return deriveReaderColors(theme, get().resolvedMode);
  },

  getHighlightColors: () => {
    const theme = get().getCurrentTheme();
    return theme.highlights ?? DEFAULT_HIGHLIGHTS;
  },

  getStyle: () => {
    const theme = get().getCurrentTheme();
    return theme.style ?? DEFAULT_STYLE;
  },

  getAppBackground: () => get().getCurrentTheme().appBackground,

  getReaderBackground: () => get().getCurrentTheme().readerBackground,

  getAllThemes: () => [...BUILTIN_THEMES, ...get().customThemes],

  getBookReaderColors: (bookId: string) => {
    const overrideId = get().bookThemeOverrides[bookId];
    if (overrideId) {
      const overrideTheme = findTheme(overrideId, get().customThemes);
      return deriveReaderColors(overrideTheme, get().resolvedMode);
    }
    return get().getReaderColors();
  },

  // ── Actions ──

  setTheme: (themeId) => set({ activeThemeId: themeId }),

  setMode: (mode) => set({ mode }),

  setResolvedMode: (resolvedMode) => set({ resolvedMode }),

  addCustomTheme: (theme) =>
    set((state) => ({ customThemes: [...state.customThemes, theme] })),

  updateCustomTheme: (id, updates) =>
    set((state) => ({
      customThemes: state.customThemes.map((t) =>
        t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t,
      ),
    })),

  deleteCustomTheme: (id) =>
    set((state) => ({
      customThemes: state.customThemes.filter((t) => t.id !== id),
      // Reset active to default if deleted theme was active
      activeThemeId: state.activeThemeId === id ? "default" : state.activeThemeId,
    })),

  setBookTheme: (bookId, themeId) =>
    set((state) => {
      const overrides = { ...state.bookThemeOverrides };
      if (themeId === null) {
        delete overrides[bookId];
      } else {
        overrides[bookId] = themeId;
      }
      return { bookThemeOverrides: overrides };
    }),

  hydrate: (data) =>
    set({
      activeThemeId: data.activeThemeId ?? "sepia",
      mode: data.mode ?? "system",
      customThemes: data.customThemes ?? [],
      bookThemeOverrides: data.bookThemeOverrides ?? {},
    }),
}));
