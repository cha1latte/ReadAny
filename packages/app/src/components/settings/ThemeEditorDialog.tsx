/**
 * ThemeEditorDialog — create/edit custom themes with live preview.
 *
 * Features:
 * - Clone from builtin themes as starting point
 * - Color editing with grouped sections + native color picker
 * - Live preview via direct CSS variable manipulation
 * - Import/export via config tokens
 * - Proper i18n for all labels
 */
import { ColorInput } from "@/components/ui/color-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { applyThemeToDOM } from "@/lib/theme-injector";
import {
  BUILTIN_THEMES,
  generateThemeId,
  useThemeStore,
} from "@readany/core/theme";
import type {
  BorderStyle,
  ShadowLevel,
  ThemeColorSet,
  ThemeDefinition,
} from "@readany/core/theme";
import { encodeConfig, decodeConfig } from "@readany/core/utils";
import { Check, Download, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  editThemeId?: string;
}

type ColorTab = "light" | "dark" | "reader" | "style";

interface ColorField {
  key: keyof ThemeColorSet;
  labelKey: string;
}

interface ColorGroup {
  labelKey: string;
  fields: ColorField[];
}

// ─── Color Groups ───────────────────────────────────────────────────────────

const COLOR_GROUPS: ColorGroup[] = [
  {
    labelKey: "settings.themeCore",
    fields: [
      { key: "background", labelKey: "settings.themeBackground" },
      { key: "foreground", labelKey: "settings.themeForeground" },
      { key: "primary", labelKey: "settings.themePrimary" },
      { key: "primaryForeground", labelKey: "settings.themePrimaryFg" },
    ],
  },
  {
    labelKey: "settings.themeSurface",
    fields: [
      { key: "card", labelKey: "settings.themeCard" },
      { key: "cardForeground", labelKey: "settings.themeCardFg" },
      { key: "sidebar", labelKey: "settings.themeSidebar" },
      { key: "sidebarForeground", labelKey: "settings.themeSidebarFg" },
      { key: "popover", labelKey: "settings.themePopover" },
      { key: "popoverForeground", labelKey: "settings.themePopoverFg" },
    ],
  },
  {
    labelKey: "settings.themeSecondary",
    fields: [
      { key: "secondary", labelKey: "settings.themeSecondaryColor" },
      { key: "secondaryForeground", labelKey: "settings.themeSecondaryFg" },
      { key: "muted", labelKey: "settings.themeMuted" },
      { key: "mutedForeground", labelKey: "settings.themeMutedFg" },
      { key: "accent", labelKey: "settings.themeAccent" },
      { key: "accentForeground", labelKey: "settings.themeAccentFg" },
    ],
  },
  {
    labelKey: "settings.themeUtility",
    fields: [
      { key: "border", labelKey: "settings.themeBorder" },
      { key: "input", labelKey: "settings.themeInput" },
      { key: "ring", labelKey: "settings.themeRing" },
      { key: "destructive", labelKey: "settings.themeDestructive" },
      { key: "destructiveForeground", labelKey: "settings.themeDestructiveFg" },
    ],
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function ThemeEditorDialog({ open, onClose, editThemeId }: Props) {
  const { t } = useTranslation();
  const customThemes = useThemeStore((s) => s.customThemes);

  const [draft, setDraft] = useState<ThemeDefinition | null>(null);
  const [activeTab, setActiveTab] = useState<ColorTab>("light");
  const [baseThemeId, setBaseThemeId] = useState("default");
  const [step, setStep] = useState<"pick-base" | "editing">("pick-base");
  const [importMode, setImportMode] = useState(false);
  const [importToken, setImportToken] = useState("");

  const originalThemeIdRef = useRef<string | null>(null);

  // Initialize draft when dialog opens
  useEffect(() => {
    if (!open) return;
    if (editThemeId) {
      const existing = customThemes.find((th) => th.id === editThemeId);
      if (existing) {
        setDraft(structuredClone(existing));
        setStep("editing");
      }
    } else {
      setStep("pick-base");
      setDraft(null);
    }
    originalThemeIdRef.current = useThemeStore.getState().activeThemeId;
  }, [open, editThemeId, customThemes]);

  // Live preview: directly set CSS variables without modifying the store
  useEffect(() => {
    if (!draft || !open) return;
    const resolvedMode = useThemeStore.getState().resolvedMode;
    const colors = resolvedMode === "dark" ? draft.dark : draft.light;
    const root = document.documentElement;

    const varMap: Record<string, string> = {
      "--background": colors.background,
      "--foreground": colors.foreground,
      "--card": colors.card,
      "--card-foreground": colors.cardForeground,
      "--primary": colors.primary,
      "--primary-foreground": colors.primaryForeground,
      "--secondary": colors.secondary,
      "--secondary-foreground": colors.secondaryForeground,
      "--muted": colors.muted,
      "--muted-foreground": colors.mutedForeground,
      "--accent": colors.accent,
      "--accent-foreground": colors.accentForeground,
      "--destructive": colors.destructive,
      "--destructive-foreground": colors.destructiveForeground,
      "--border": colors.border,
      "--input": colors.input,
      "--ring": colors.ring,
      "--sidebar": colors.sidebar,
      "--sidebar-foreground": colors.sidebarForeground,
      "--popover": colors.popover,
      "--popover-foreground": colors.popoverForeground,
    };
    for (const [varName, value] of Object.entries(varMap)) {
      root.style.setProperty(varName, value);
    }
    if (draft.style) {
      root.style.setProperty("--radius", `${draft.style.radius}rem`);
    }
  }, [draft, open]);

  const handlePickBase = useCallback(() => {
    const base = BUILTIN_THEMES.find((th) => th.id === baseThemeId) ?? BUILTIN_THEMES[0];
    const newTheme: ThemeDefinition = {
      ...structuredClone(base),
      id: generateThemeId(),
      name: `${base.nameEn || base.name} Copy`,
      nameEn: `${base.nameEn || base.name} Copy`,
      builtIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setDraft(newTheme);
    setStep("editing");
  }, [baseThemeId]);

  const handleColorChange = useCallback(
    (mode: "light" | "dark", key: keyof ThemeColorSet, value: string) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return { ...prev, [mode]: { ...prev[mode], [key]: value }, updatedAt: Date.now() };
      });
    },
    [],
  );

  const handleReaderColorChange = useCallback(
    (mode: "light" | "dark", key: "background" | "foreground" | "linkColor", value: string) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const reader = prev.reader ?? {
          light: { background: prev.light.background, foreground: prev.light.foreground, linkColor: prev.light.primary },
          dark: { background: prev.dark.background, foreground: prev.dark.foreground, linkColor: prev.dark.primary },
        };
        return { ...prev, reader: { ...reader, [mode]: { ...reader[mode], [key]: value } }, updatedAt: Date.now() };
      });
    },
    [],
  );

  const handleStyleChange = useCallback(
    (updates: Partial<ThemeDefinition["style"]>) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return { ...prev, style: { ...prev.style, ...updates }, updatedAt: Date.now() };
      });
    },
    [],
  );

  const handleNameChange = useCallback((name: string) => {
    setDraft((prev) => (prev ? { ...prev, name, nameEn: name, updatedAt: Date.now() } : prev));
  }, []);

  const handleSave = useCallback(() => {
    if (!draft) return;
    const store = useThemeStore.getState();
    const existing = store.customThemes.find((th) => th.id === draft.id);
    if (existing) {
      store.updateCustomTheme(draft.id, draft);
    } else {
      store.addCustomTheme(draft);
    }
    store.setTheme(draft.id);
    applyThemeToDOM();
    toast.success(t("settings.themeSaved"));
    onClose();
  }, [draft, onClose, t]);

  const handleCancel = useCallback(() => {
    const store = useThemeStore.getState();
    if (originalThemeIdRef.current) {
      store.setTheme(originalThemeIdRef.current);
    }
    applyThemeToDOM();
    onClose();
  }, [onClose]);

  const handleExport = useCallback(() => {
    if (!draft) return;
    const token = encodeConfig(draft);
    navigator.clipboard.writeText(token);
    toast.success(t("settings.themeExported"));
  }, [draft, t]);

  const handleImport = useCallback(() => {
    if (!importToken.trim()) return;
    const data = decodeConfig<ThemeDefinition>(importToken.trim());
    if (!data || !data.light || !data.dark || !data.name) {
      toast.error(t("settings.themeImportInvalid"));
      return;
    }
    const imported: ThemeDefinition = {
      ...data,
      id: generateThemeId(),
      builtIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    useThemeStore.getState().addCustomTheme(imported);
    useThemeStore.getState().setTheme(imported.id);
    applyThemeToDOM();
    toast.success(t("settings.themeImported"));
    setImportMode(false);
    setImportToken("");
    onClose();
  }, [importToken, onClose, t]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (!open) return null;

  // Import mode dialog
  if (importMode) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && setImportMode(false)}>
        <DialogContent className="w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("settings.importTheme")}</DialogTitle>
          </DialogHeader>
          <textarea
            className="h-32 w-full resize-none rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={t("settings.pasteThemeToken")}
            value={importToken}
            onChange={(e) => setImportToken(e.target.value)}
          />
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setImportMode(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={handleImport} disabled={!importToken.trim()}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("settings.importTheme")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Pick base theme step
  if (step === "pick-base" && !editThemeId) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("settings.createTheme")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {t("settings.baseTheme")}
              </label>
              <Select value={baseThemeId} onValueChange={setBaseThemeId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUILTIN_THEMES.map((theme) => (
                    <SelectItem key={theme.id} value={theme.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full border border-border"
                          style={{ backgroundColor: theme.light.primary }}
                        />
                        {theme.nameEn || theme.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button onClick={handlePickBase}>
              {t("settings.createAndEdit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Main editor
  if (!draft) return null;

  const currentColorSet = activeTab === "dark" ? draft.dark : draft.light;
  const readerColors = draft.reader ?? {
    light: { background: draft.light.background, foreground: draft.light.foreground, linkColor: draft.light.primary },
    dark: { background: draft.dark.background, foreground: draft.dark.foreground, linkColor: draft.dark.primary },
  };

  const TABS: { id: ColorTab; labelKey: string }[] = [
    { id: "light", labelKey: "settings.light" },
    { id: "dark", labelKey: "settings.dark" },
    { id: "reader", labelKey: "settings.themeReader" },
    { id: "style", labelKey: "settings.themeStyle" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <DialogContent className="flex h-[75vh] max-h-[680px] w-[580px] max-w-[92vw] flex-col gap-0 p-0">
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-5 py-3.5">
          <Input
            value={draft.nameEn || draft.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="h-8 w-48 border-none bg-muted/40 px-2.5 text-sm font-medium shadow-none focus-visible:ring-1"
            placeholder={t("settings.themeNamePlaceholder")}
          />
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={handleExport}>
            <Upload className="h-3 w-3" />
            {t("settings.exportTheme")}
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-5">
          {TABS.map(({ id, labelKey }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`relative px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(labelKey)}
              {activeTab === id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {(activeTab === "light" || activeTab === "dark") && (
            <div className="space-y-6">
              {COLOR_GROUPS.map((group) => (
                <div key={group.labelKey}>
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(group.labelKey)}
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    {group.fields.map((field) => (
                      <ColorInput
                        key={field.key}
                        label={t(field.labelKey)}
                        value={currentColorSet[field.key]}
                        onChange={(v) => handleColorChange(activeTab as "light" | "dark", field.key, v)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "reader" && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("settings.themeLightReader")}
                </h3>
                <div className="space-y-2.5">
                  <ColorInput label={t("settings.themeBackground")} value={readerColors.light.background} onChange={(v) => handleReaderColorChange("light", "background", v)} />
                  <ColorInput label={t("settings.themeForeground")} value={readerColors.light.foreground} onChange={(v) => handleReaderColorChange("light", "foreground", v)} />
                  <ColorInput label={t("settings.themeLinkColor")} value={readerColors.light.linkColor} onChange={(v) => handleReaderColorChange("light", "linkColor", v)} />
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("settings.themeDarkReader")}
                </h3>
                <div className="space-y-2.5">
                  <ColorInput label={t("settings.themeBackground")} value={readerColors.dark.background} onChange={(v) => handleReaderColorChange("dark", "background", v)} />
                  <ColorInput label={t("settings.themeForeground")} value={readerColors.dark.foreground} onChange={(v) => handleReaderColorChange("dark", "foreground", v)} />
                  <ColorInput label={t("settings.themeLinkColor")} value={readerColors.dark.linkColor} onChange={(v) => handleReaderColorChange("dark", "linkColor", v)} />
                </div>
              </div>
            </div>
          )}

          {activeTab === "style" && (
            <div className="space-y-5">
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-sm text-foreground">{t("settings.themeRadius")}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">{draft.style.radius}rem</span>
                </div>
                <Slider
                  min={0}
                  max={1.5}
                  step={0.125}
                  value={[draft.style.radius]}
                  onValueChange={([v]) => handleStyleChange({ radius: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{t("settings.themeShadow")}</span>
                <Select
                  value={draft.style.shadowLevel}
                  onValueChange={(v) => handleStyleChange({ shadowLevel: v as ShadowLevel })}
                >
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("settings.themeShadowNone")}</SelectItem>
                    <SelectItem value="sm">{t("settings.themeShadowSm")}</SelectItem>
                    <SelectItem value="md">{t("settings.themeShadowMd")}</SelectItem>
                    <SelectItem value="lg">{t("settings.themeShadowLg")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{t("settings.themeBorderStyle")}</span>
                <Select
                  value={draft.style.borderStyle}
                  onValueChange={(v) => handleStyleChange({ borderStyle: v as BorderStyle })}
                >
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("settings.themeBorderNone")}</SelectItem>
                    <SelectItem value="subtle">{t("settings.themeBorderSubtle")}</SelectItem>
                    <SelectItem value="normal">{t("settings.themeBorderNormal")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-sm text-foreground">{t("settings.themeBackdropBlur")}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">{draft.style.backdropBlur}px</span>
                </div>
                <Slider
                  min={0}
                  max={24}
                  step={2}
                  value={[draft.style.backdropBlur]}
                  onValueChange={([v]) => handleStyleChange({ backdropBlur: v })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {t("common.save", "Save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
