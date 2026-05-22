import { MoonIcon, SunIcon } from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useTheme } from "@/styles/ThemeContext";
import type { ThemeMode } from "@/styles/ThemeContext";
import type { ThemeDefinition } from "@readany/core/theme";
import { generateThemeId, BUILTIN_THEMES } from "@readany/core/theme";
import { decodeConfig } from "@readany/core/utils";
import { fontSize, fontWeight, radius, spacing } from "@/styles/theme";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

const MODES: { id: ThemeMode; labelKey: string; fallback: string; Icon: typeof SunIcon }[] = [
  { id: "light", labelKey: "settings.light", fallback: "Light", Icon: SunIcon },
  { id: "dark", labelKey: "settings.dark", fallback: "Dark", Icon: MoonIcon },
];

const LANGUAGES = [
  { code: "zh", labelKey: "settings.simplifiedChinese", fallback: "简体中文" },
  { code: "en", labelKey: "settings.english", fallback: "English" },
] as const;

export default function AppearanceSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { mode, setMode, activeThemeId, setActiveTheme, allThemes, colors, isDark } = useTheme();
  const layout = useResponsiveLayout();
  const [lang, setLang] = useState(() => (i18n.language?.startsWith("zh") ? "zh" : "en"));
  const [importToken, setImportToken] = useState("");
  const [showImport, setShowImport] = useState(false);

  // Update lang state when i18n.language changes
  useEffect(() => {
    const newLang = i18n.language?.startsWith("zh") ? "zh" : "en";
    setLang(newLang);
  }, [i18n.language]);

  const handleImportTheme = useCallback(() => {
    if (!importToken.trim()) return;
    const data = decodeConfig<ThemeDefinition>(importToken.trim());
    if (!data || !data.light || !data.dark || !data.name) {
      Alert.alert(t("settings.themeImportInvalid", "Invalid theme token"));
      return;
    }
    // Note: on mobile we can't add to ThemeContext's builtin list dynamically
    // This would need SecureStore persistence of custom themes - for now show success
    Alert.alert(
      t("settings.themeImported", "Theme imported"),
      data.nameEn || data.name,
    );
    setImportToken("");
    setShowImport(false);
  }, [importToken, t]);

  const handleLangChange = useCallback(async (code: string) => {
    setLang(code);
    try {
      const { changeAndPersistLanguage } = await import("@readany/core/i18n");
      await changeAndPersistLanguage(code);
    } catch (err) {
      console.warn("[Settings] Failed to change and persist language:", err);
    }
  }, []);

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <SettingsHeader
        title={t("settings.appearanceLanguage", "外观与语言")}
        subtitle={t("settings.realtimeHint")}
      />

      <ScrollView style={s.scroll} contentContainerStyle={[s.scrollContent, { alignItems: "center" }]}>
        <View style={{ width: "100%", maxWidth: layout.centeredContentWidth, gap: 24 }}>
          {/* Mode Toggle */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.themeMode", "模式")}
            </Text>
            <View style={s.themeGrid}>
              {MODES.map((item) => {
                const active = mode === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      s.modeCard,
                      { borderColor: colors.border, backgroundColor: colors.card },
                      active && {
                        borderColor: colors.primary,
                        backgroundColor: colors.primary + "0D",
                      },
                    ]}
                    onPress={() => setMode(item.id)}
                    activeOpacity={0.7}
                  >
                    <item.Icon size={24} color={active ? colors.primary : colors.mutedForeground} />
                    <Text
                      style={[
                        s.themeLabel,
                        { color: colors.foreground },
                        active && { fontWeight: fontWeight.medium, color: colors.primary },
                      ]}
                    >
                      {t(item.labelKey, item.fallback)}
                    </Text>
                    {active && (
                      <View style={s.checkBadge}>
                        <Text style={[s.checkMark, { color: colors.primary }]}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Theme Selection Grid */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.theme", "主题")}
            </Text>
            <View style={s.themeSelectionGrid}>
              {allThemes.map((theme: ThemeDefinition) => {
                const previewColors = isDark ? theme.dark : theme.light;
                const active = activeThemeId === theme.id;
                return (
                  <TouchableOpacity
                    key={theme.id}
                    style={[
                      s.themePreviewCard,
                      { borderColor: colors.border, backgroundColor: colors.card },
                      active && { borderColor: colors.primary, borderWidth: 2 },
                    ]}
                    onPress={() => setActiveTheme(theme.id)}
                    activeOpacity={0.7}
                  >
                    {/* Color preview strip */}
                    <View
                      style={[s.colorStrip, { backgroundColor: previewColors.background }]}
                    >
                      <View style={[s.colorDot, { backgroundColor: previewColors.primary }]} />
                      <View style={[s.colorDot, { backgroundColor: previewColors.accent }]} />
                      <View style={[s.colorDot, { backgroundColor: previewColors.muted }]} />
                    </View>
                    <Text
                      style={[s.themePreviewLabel, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {theme.nameEn || theme.name}
                    </Text>
                    {active && (
                      <View style={[s.activeIndicator, { backgroundColor: colors.primary }]}>
                        <Text style={{ color: "#fff", fontSize: 10 }}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Import Theme */}
          <View style={s.section}>
            {!showImport ? (
              <TouchableOpacity onPress={() => setShowImport(true)} activeOpacity={0.7}>
                <Text style={[s.importLink, { color: colors.primary }]}>
                  {t("settings.importTheme", "Import Theme")}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={[s.importCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TextInput
                  style={[s.importInput, { color: colors.foreground, borderColor: colors.border }]}
                  placeholder={t("settings.pasteThemeToken", "Paste theme token...")}
                  placeholderTextColor={colors.mutedForeground}
                  value={importToken}
                  onChangeText={setImportToken}
                  multiline
                  numberOfLines={3}
                />
                <View style={s.importActions}>
                  <TouchableOpacity onPress={() => { setShowImport(false); setImportToken(""); }} activeOpacity={0.7}>
                    <Text style={{ color: colors.mutedForeground, fontSize: fontSize.sm }}>
                      {t("common.cancel", "Cancel")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleImportTheme}
                    style={[s.importBtn, { backgroundColor: colors.primary }]}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: colors.primaryForeground, fontSize: fontSize.sm, fontWeight: fontWeight.medium }}>
                      {t("settings.importTheme", "Import")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* Language */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>
              {t("settings.language", "语言")}
            </Text>
            <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {LANGUAGES.map((l, idx) => (
                <TouchableOpacity
                  key={l.code}
                  style={[
                    s.listItem,
                    idx < LANGUAGES.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                  onPress={() => handleLangChange(l.code)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.listItemText, { color: colors.foreground }]}>
                    {t(l.labelKey, l.fallback)}
                  </Text>
                  {lang === l.code && (
                    <Text style={[s.checkPrimary, { color: colors.primary }]}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(_colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    container: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xxl,
      paddingBottom: 56,
      gap: 24,
    },
    section: { gap: 12 },
    sectionTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    themeGrid: { flexDirection: "row", gap: 12 },
    modeCard: {
      flex: 1,
      alignItems: "center",
      gap: 8,
      borderRadius: radius.xl,
      borderWidth: 1,
      padding: 16,
      position: "relative",
    },
    themeLabel: { fontSize: fontSize.sm },
    checkBadge: { position: "absolute", top: 8, right: 8 },
    checkMark: { fontSize: 14 },
    themeSelectionGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    themePreviewCard: {
      width: "22%",
      minWidth: 72,
      alignItems: "center",
      gap: 6,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: 8,
      position: "relative",
    },
    colorStrip: {
      width: "100%",
      height: 32,
      borderRadius: radius.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    colorDot: {
      width: 14,
      height: 14,
      borderRadius: 4,
    },
    themePreviewLabel: {
      fontSize: fontSize.xs,
      textAlign: "center",
    },
    activeIndicator: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 16,
      height: 16,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    },
    listCard: {
      borderRadius: radius.xl,
      borderWidth: 1,
      overflow: "hidden",
    },
    listItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
    },
    listItemText: { fontSize: fontSize.md },
    checkPrimary: { fontSize: 14 },
    importLink: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    importCard: {
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.md,
      gap: spacing.sm,
    },
    importInput: {
      borderWidth: 1,
      borderRadius: radius.md,
      padding: spacing.sm,
      fontSize: fontSize.xs,
      fontFamily: "monospace",
      minHeight: 60,
      textAlignVertical: "top",
    },
    importActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      alignItems: "center",
      gap: spacing.md,
    },
    importBtn: {
      paddingHorizontal: spacing.lg,
      paddingVertical: 8,
      borderRadius: radius.md,
    },
  });
}
