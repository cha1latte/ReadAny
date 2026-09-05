/**
 * Styles for ReaderScreen — aggregated from sub-modules.
 * Keep this file as a single import point for backward compatibility.
 */
import type { ThemeColors } from "@/styles/theme";
import { createNoteTooltipTheme } from "./note-tooltip-theme";
import { makeToolbarStyles } from "./styles/reader-base-styles";
import { makeNoteStyles } from "./styles/reader-note-styles";
import { makeSheetStyles } from "./styles/reader-sheet-styles";

export const noteTooltipMdStyles = {} as ReturnType<typeof createNoteTooltipTheme>["markdown"];

export const makeStyles = (colors: ThemeColors) => {
  Object.assign(noteTooltipMdStyles, createNoteTooltipTheme(colors).markdown);

  return {
    ...makeToolbarStyles(colors),
    ...makeSheetStyles(colors),
    ...makeNoteStyles(colors),
  };
};
