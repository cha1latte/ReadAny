import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useThemeStore, BUILTIN_THEMES } from "@readany/core/theme";
import type { ThemeDefinition } from "@readany/core/theme";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { OnboardingLayout } from "../OnboardingLayout";

export function AppearancePage({ onNext, onPrev, step, totalSteps }: any) {
  const { t, i18n } = useTranslation();
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const themeMode = useThemeStore((s) => s.mode);
  const resolvedMode = useThemeStore((s) => s.resolvedMode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);

  const handleLanguageChange = async (lang: string) => {
    const { changeAndPersistLanguage } = await import("@readany/core/i18n");
    await changeAndPersistLanguage(lang);
  };

  return (
    <OnboardingLayout
      illustration="/illustrations/smiling_girl.svg"
      step={step}
      totalSteps={totalSteps}
      footer={
        <>
          <Button variant="ghost" onClick={onPrev}>
            {t("common.back", "Back")}
          </Button>
          <Button onClick={onNext} size="lg" className="rounded-full px-8 shadow-md">
            {t("common.next", "Next")} →
          </Button>
        </>
      }
    >
      <div className="animate-in fade-in slide-in-from-right-4 duration-500 flex-1 flex flex-col justify-center">
        <div className="space-y-2 text-center mb-6">
          <h2 className="text-2xl font-bold tracking-tight">
            {t("onboarding.appearance.title", "Appearance & Language")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("onboarding.appearance.desc", "Customize ReadAny to suit your preferences.")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border bg-muted/30 p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-medium text-foreground uppercase tracking-wide">
              {t("settings.theme", "Theme")}
            </h3>

            {/* Mode Toggle */}
            <div className="mb-3 flex gap-1.5">
              {([
                { mode: "system" as const, icon: Monitor },
                { mode: "light" as const, icon: Sun },
                { mode: "dark" as const, icon: Moon },
              ]).map(({ mode, icon: Icon }) => {
                const isActive = themeMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setMode(mode)}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-background/80"
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {t(`settings.${mode}`)}
                  </button>
                );
              })}
            </div>

            {/* Theme Grid */}
            <div className="grid grid-cols-4 gap-1.5">
              {BUILTIN_THEMES.map((theme: ThemeDefinition) => {
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
                    {isActive && (
                      <div className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-primary">
                        <Check className="h-2 w-2 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border bg-muted/30 p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-medium text-foreground uppercase tracking-wide">
              {t("settings.language", "Language")}
            </h3>
            <Select value={i18n.language} onValueChange={handleLanguageChange}>
              <SelectTrigger className="h-10 rounded-lg font-medium text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="zh">{t("settings.simplifiedChinese", "中文")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </OnboardingLayout>
  );
}
