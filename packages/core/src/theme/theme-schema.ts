/**
 * Theme system type definitions.
 *
 * Architecture:
 *   mode (light/dark/system)  →  resolves to  →  picks light or dark color set
 *   theme (default/sepia/nord/...)  →  provides  →  both light + dark color sets
 */

// ─── Color Sets ──────────────────────────────────────────────────────────────

export interface ThemeColorSet {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  popover: string;
  popoverForeground: string;
}

export interface ReaderColorSet {
  background: string;
  foreground: string;
  linkColor: string;
}

export interface HighlightColors {
  yellow: string;
  green: string;
  blue: string;
  pink: string;
  purple: string;
}

// ─── Style & Background ──────────────────────────────────────────────────────

export type ShadowLevel = "none" | "sm" | "md" | "lg";
export type BorderStyle = "none" | "subtle" | "normal";
export type BackgroundFillMode = "cover" | "contain" | "tile" | "stretch";

export interface ThemeStyle {
  /** Base border-radius value in rem */
  radius: number;
  /** Card shadow intensity */
  shadowLevel: ShadowLevel;
  /** Border visibility */
  borderStyle: BorderStyle;
  /** Backdrop blur for glass effects (px) */
  backdropBlur: number;
}

export interface ThemeBackground {
  /** Image URL (builtin asset path or user-uploaded local path) */
  image?: string;
  /** Image opacity 0-1 */
  opacity?: number;
  /** Image blur in px */
  blur?: number;
  /** Image fill mode */
  fillMode?: BackgroundFillMode;
}

// ─── Theme Definition ────────────────────────────────────────────────────────

export interface ThemeDefinition {
  id: string;
  name: string;
  nameEn?: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;

  /** Light mode colors */
  light: ThemeColorSet;
  /** Dark mode colors */
  dark: ThemeColorSet;

  /** Reader-specific colors (optional; derived from light/dark if absent) */
  reader?: {
    light: ReaderColorSet;
    dark: ReaderColorSet;
  };

  /** Highlight annotation colors (optional; uses defaults if absent) */
  highlights?: HighlightColors;

  /** UI style parameters */
  style: ThemeStyle;

  /** App background image/texture */
  appBackground?: ThemeBackground;
  /** Reader background texture */
  readerBackground?: ThemeBackground;
}

// ─── Mode ────────────────────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_HIGHLIGHTS: HighlightColors = {
  yellow: "#fef08a",
  green: "#bbf7d0",
  blue: "#bfdbfe",
  pink: "#fbcfe8",
  purple: "#e9d5ff",
};

export const DEFAULT_STYLE: ThemeStyle = {
  radius: 0.625,
  shadowLevel: "sm",
  borderStyle: "normal",
  backdropBlur: 8,
};

/** Generate a unique ID for a custom theme */
export function generateThemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
