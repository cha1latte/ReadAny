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

export { DEFAULT_HIGHLIGHTS, DEFAULT_STYLE, generateThemeId } from "./theme-schema";

export { BUILTIN_THEMES, getBuiltinTheme, getDefaultTheme } from "./builtin-themes";

export { BUILTIN_TEXTURES, getTextureById } from "./builtin-textures";
export type { TexturePreset } from "./builtin-textures";

export { useThemeStore } from "./theme-store";
export type { ThemeState } from "./theme-store";
