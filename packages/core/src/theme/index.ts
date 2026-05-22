/**
 * Theme system — public API
 */

export type {
  ThemeColorSet,
  ReaderColorSet,
  HighlightColors,
  ThemeStyle,
  ThemeBackground,
  ThemeDefinition,
  ThemeMode,
  ResolvedMode,
  ShadowLevel,
  BorderStyle,
  BackgroundFillMode,
} from "./theme-schema";

export { DEFAULT_HIGHLIGHTS, DEFAULT_STYLE } from "./theme-schema";

export { BUILTIN_THEMES, getBuiltinTheme, getDefaultTheme } from "./builtin-themes";

export { useThemeStore } from "./theme-store";
export type { ThemeState } from "./theme-store";
