/**
 * ReadSettings — reading view settings using shadcn components
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useSettingsStore } from "@/stores/settings-store";
import { BUILTIN_THEMES, useThemeStore } from "@readany/core/theme";
import type { ThemeDefinition } from "@readany/core/theme";
import { useFontStore } from "@readany/core/stores";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function ReadSettingsPanel() {
  const { t } = useTranslation();
  const { readSettings, updateReadSettings } = useSettingsStore();
  const customFonts = useFontStore((s) => s.fonts);
  const selectedFontId = useFontStore((s) => s.selectedFontId);
  const setSelectedFont = useFontStore((s) => s.setSelectedFont);

  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const customThemes = useThemeStore((s) => s.customThemes);
  const resolvedMode = useThemeStore((s) => s.resolvedMode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const allThemes = useMemo(() => [...BUILTIN_THEMES, ...customThemes], [customThemes]);

  const currentFontValue = selectedFontId ?? "system";

  const handleFontChange = (v: string) => {
    if (v === "system") {
      setSelectedFont(null);
    } else {
      setSelectedFont(v);
    }
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Reader Theme */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-3 text-sm font-medium text-foreground">{t("settings.theme")}</h2>
        <div className="grid grid-cols-4 gap-1.5">
          {allThemes.map((theme: ThemeDefinition) => {
            const colors = resolvedMode === "dark" ? theme.dark : theme.light;
            const isActive = activeThemeId === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                className={`relative flex flex-col items-center gap-1 rounded-md border p-1.5 transition-all ${
                  isActive
                    ? "border-primary ring-1 ring-primary/20"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div
                  className="flex h-6 w-full items-center justify-center gap-0.5 rounded"
                  style={{ backgroundColor: colors.background }}
                >
                  <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: colors.primary }} />
                  <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: colors.muted }} />
                </div>
                <span className="text-[10px] leading-tight text-foreground">
                  {theme.nameEn || theme.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.reading_title")}</h2>
        <p className="mb-2 text-xs text-muted-foreground">{t("settings.reading_desc")}</p>
        <p className="mb-4 text-xs text-muted-foreground/60">{t("settings.readingNotice")}</p>

        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t("settings.paginatedLayout")}</span>
            <Select
              value={readSettings.paginatedLayout ?? "double"}
              onValueChange={(v) =>
                updateReadSettings({ paginatedLayout: v as "single" | "double" })
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">{t("settings.singlePage")}</SelectItem>
                <SelectItem value="double">{t("settings.doublePage")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Font */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground">{t("settings.fontTheme")}</span>
            <Select value={currentFontValue} onValueChange={handleFontChange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t("fonts.systemDefault", "系统默认")}</SelectItem>
                {customFonts.map((font) => (
                  <SelectItem key={font.id} value={font.id}>
                    {font.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Font Size */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("settings.fontSize", { size: readSettings.fontSize })}
              </span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {readSettings.fontSize}px
              </span>
            </div>
            <Slider
              min={12}
              max={64}
              step={1}
              value={[readSettings.fontSize]}
              onValueChange={([v]) => updateReadSettings({ fontSize: v })}
            />
          </div>

          {/* Line Height */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t("settings.lineHeight", { height: readSettings.lineHeight })}
              </span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {readSettings.lineHeight}
              </span>
            </div>
            <Slider
              min={1.2}
              max={2.5}
              step={0.1}
              value={[readSettings.lineHeight]}
              onValueChange={([v]) => updateReadSettings({ lineHeight: v })}
            />
          </div>

          {/* Paragraph Spacing */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">{t("settings.paragraphSpacing")}</span>
              <span className="rounded bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {readSettings.paragraphSpacing}px
              </span>
            </div>
            <Slider
              min={0}
              max={32}
              step={2}
              value={[readSettings.paragraphSpacing]}
              onValueChange={([v]) => updateReadSettings({ paragraphSpacing: v })}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
