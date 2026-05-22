import {
  clearDesktopLibraryRoot,
  getDefaultDesktopLibraryRoot,
  getDesktopLibraryRoot,
  migrateDesktopLibraryRoot,
} from "@/lib/storage/desktop-library-root";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeEditorDialog } from "./ThemeEditorDialog";
import { useThemeStore, BUILTIN_THEMES } from "@readany/core/theme";
import type { ThemeDefinition, ThemeMode } from "@readany/core/theme";
import { Check, Download, FolderOpen, HardDrive, Monitor, Moon, Pencil, Plus, RotateCcw, Sun, Trash2 } from "lucide-react";
/**
 * GeneralSettings — app-level settings
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const MODE_CONFIG: { mode: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { mode: "system", icon: Monitor, labelKey: "settings.system" },
  { mode: "light", icon: Sun, labelKey: "settings.light" },
  { mode: "dark", icon: Moon, labelKey: "settings.dark" },
];

export function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const themeMode = useThemeStore((s) => s.mode);
  const customThemes = useThemeStore((s) => s.customThemes);
  const allThemes = useMemo(() => [...BUILTIN_THEMES, ...customThemes], [customThemes]);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);
  const deleteCustomTheme = useThemeStore((s) => s.deleteCustomTheme);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingThemeId, setEditingThemeId] = useState<string | undefined>(undefined);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const [currentLibraryRoot, setCurrentLibraryRoot] = useState("");
  const [defaultLibraryRoot, setDefaultLibraryRoot] = useState("");
  const [targetLibraryRoot, setTargetLibraryRoot] = useState("");
  const [migratingLibrary, setMigratingLibrary] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadLibraryRoot = async () => {
      const [currentRoot, defaultRoot] = await Promise.all([
        getDesktopLibraryRoot(),
        getDefaultDesktopLibraryRoot(),
      ]);
      if (cancelled) return;
      setCurrentLibraryRoot(currentRoot);
      setDefaultLibraryRoot(defaultRoot);
      setTargetLibraryRoot(currentRoot);
    };

    void loadLibraryRoot();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLanguageChange = async (lang: string) => {
    const { changeAndPersistLanguage } = await import("@readany/core/i18n");
    await changeAndPersistLanguage(lang);
  };

  const handleChooseLibraryFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: targetLibraryRoot || currentLibraryRoot || defaultLibraryRoot || undefined,
    });

    if (typeof selected === "string" && selected.trim()) {
      setTargetLibraryRoot(selected);
    }
  };

  const restartAfterMigration = async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    window.setTimeout(() => {
      void relaunch();
    }, 500);
  };

  const handleMigrateLibrary = async () => {
    if (!targetLibraryRoot) {
      toast.error(t("settings.storageChooseFolderFirst"));
      return;
    }

    if (targetLibraryRoot === currentLibraryRoot) {
      toast.message(t("settings.storageNoChange"));
      return;
    }

    setMigratingLibrary(true);
    try {
      const result = await migrateDesktopLibraryRoot(targetLibraryRoot);
      setCurrentLibraryRoot(result.to);
      setTargetLibraryRoot(result.to);
      toast.success(
        t("settings.storageMigrationSuccess", {
          count: result.movedFiles,
        }),
      );
      await restartAfterMigration();
    } catch (error) {
      console.error("[GeneralSettings] Failed to migrate library root:", error);
      toast.error(
        t("settings.storageMigrationFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setMigratingLibrary(false);
    }
  };

  const handleResetLibrary = async () => {
    if (!currentLibraryRoot || currentLibraryRoot === defaultLibraryRoot) {
      toast.message(t("settings.storageAlreadyDefault"));
      return;
    }

    setMigratingLibrary(true);
    try {
      const result = await migrateDesktopLibraryRoot(defaultLibraryRoot);
      await clearDesktopLibraryRoot();
      setCurrentLibraryRoot(defaultLibraryRoot);
      setTargetLibraryRoot(defaultLibraryRoot);
      toast.success(
        t("settings.storageMigrationSuccess", {
          count: result.movedFiles,
        }),
      );
      await restartAfterMigration();
    } catch (error) {
      console.error("[GeneralSettings] Failed to reset library root:", error);
      toast.error(
        t("settings.storageMigrationFailed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setMigratingLibrary(false);
    }
  };

  return (
    <div className="space-y-6 p-4 pt-3">
      {/* Theme Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.theme")}</h2>

        {/* Mode Toggle: System / Light / Dark */}
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-foreground">{t("settings.themeMode", "Mode")}</span>
          <div className="flex gap-1.5">
            {MODE_CONFIG.map(({ mode, icon: Icon, labelKey }) => {
              const isActive = themeMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setMode(mode)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-background/80"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Theme Grid */}
        <div className="grid grid-cols-4 gap-2">
          {allThemes.map((theme: ThemeDefinition) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              isActive={activeThemeId === theme.id}
              isCustom={!theme.builtIn}
              onSelect={() => setTheme(theme.id)}
              onEdit={() => { setEditingThemeId(theme.id); setEditorOpen(true); }}
              onDelete={() => {
                deleteCustomTheme(theme.id);
                toast.success(t("settings.themeDeleted", "Theme deleted"));
              }}
            />
          ))}
          {/* Create New Theme Button */}
          <button
            onClick={() => { setEditingThemeId(undefined); setEditorOpen(true); }}
            className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 transition-all hover:border-primary/50 hover:bg-muted/50"
          >
            <Plus className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("settings.newTheme", "New")}</span>
          </button>
        </div>

        {/* Import Button */}
        <button
          onClick={() => setImportDialogOpen(true)}
          className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Download className="h-3 w-3" />
          {t("settings.importTheme")}
        </button>
      </section>

      {/* Theme Editor Dialog */}
      <ThemeEditorDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        editThemeId={editingThemeId}
      />
      {/* Import Dialog */}
      <ThemeEditorDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        initialImport
      />

      {/* Language Section */}
      <section className="rounded-lg bg-muted/60 p-4">
        <h2 className="mb-4 text-sm font-medium text-foreground">{t("settings.language")}</h2>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">{t("settings.language")}</span>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.languageDesc")}</p>
          </div>
          <Select value={i18n.language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">{t("settings.simplifiedChinese", "中文")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="rounded-lg bg-muted/60 p-4">
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-background p-2 text-primary shadow-sm">
            <HardDrive className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">
              {t("settings.storageLocation")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.storageLocationDesc")}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.storageCurrentPath")}
            </label>
            <Input value={currentLibraryRoot} readOnly />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("settings.storageTargetPath")}
            </label>
            <div className="flex gap-2">
              <Input
                value={targetLibraryRoot}
                onChange={(e) => setTargetLibraryRoot(e.target.value)}
                placeholder={t("settings.storageTargetPath")}
              />
              <Button variant="outline" onClick={handleChooseLibraryFolder} disabled={migratingLibrary}>
                <FolderOpen className="h-4 w-4" />
                {t("settings.storageChooseFolder")}
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border/60 bg-background/80 p-3">
            <p className="text-xs leading-5 text-muted-foreground">
              {t("settings.storageMigrationNote")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleMigrateLibrary} disabled={migratingLibrary}>
              {migratingLibrary ? t("settings.storageMigrating") : t("settings.storageMigrate")}
            </Button>
            <Button
              variant="outline"
              onClick={handleResetLibrary}
              disabled={migratingLibrary || currentLibraryRoot === defaultLibraryRoot}
            >
              <RotateCcw className="h-4 w-4" />
              {t("settings.storageResetDefault")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── ThemeCard ─────────────────────────────────────────────────────────────────

function ThemeCard({
  theme,
  isActive,
  isCustom,
  onSelect,
  onEdit,
  onDelete,
}: {
  theme: ThemeDefinition;
  isActive: boolean;
  isCustom?: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const resolvedMode = useThemeStore((s) => s.resolvedMode);
  const colors = resolvedMode === "dark" ? theme.dark : theme.light;

  return (
    <div
      onClick={onSelect}
      className={`group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-1.5 transition-all duration-200 ${
        isActive
          ? "border-primary shadow-sm ring-2 ring-primary/20"
          : "border-border hover:border-primary/40 hover:shadow-xs"
      }`}
    >
      {/* Mini App Mockup */}
      <div
        className="flex h-12 w-full flex-col overflow-hidden rounded-md"
        style={{ backgroundColor: colors.background }}
      >
        {/* Mini sidebar + content mockup */}
        <div className="flex flex-1">
          <div className="w-[30%] border-r" style={{ backgroundColor: colors.sidebar, borderColor: colors.border }}>
            <div className="mx-1 mt-1.5 h-1 w-3 rounded-sm" style={{ backgroundColor: colors.sidebarForeground, opacity: 0.4 }} />
            <div className="mx-1 mt-1 h-1 w-4 rounded-sm" style={{ backgroundColor: colors.primary, opacity: 0.8 }} />
          </div>
          <div className="flex-1 p-1">
            <div className="h-1 w-full rounded-sm" style={{ backgroundColor: colors.foreground, opacity: 0.15 }} />
            <div className="mt-1 flex gap-0.5">
              <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors.primary }} />
              <div className="h-2.5 flex-1 rounded-sm" style={{ backgroundColor: colors.muted }} />
            </div>
          </div>
        </div>
      </div>

      {/* Theme Name */}
      <span className="max-w-full truncate text-[11px] font-medium text-foreground">
        {theme.nameEn || theme.name}
      </span>

      {/* Active Check */}
      {isActive && (
        <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary shadow-sm">
          <Check className="h-2.5 w-2.5 text-primary-foreground" />
        </div>
      )}

      {/* Custom Theme Actions (visible on hover) */}
      {isCustom && (
        <div className="absolute -top-2 left-1/2 hidden -translate-x-1/2 gap-1 group-hover:flex">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background shadow-sm transition-colors hover:bg-muted"
            >
              <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-destructive/30 bg-background shadow-sm transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-2.5 w-2.5 text-destructive" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
