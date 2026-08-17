import {
  createUpdateInstallOwner,
  installShlaiPreviewUpdateWithExpo,
} from "@/lib/shlai-apk-installer";
import { getShlaiReleaseConfig } from "@/lib/shlai-release";
import { selectReleaseAsset } from "@/lib/shlai-release-asset";
import { useUpdateStore } from "@/stores/update-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  useColors,
  withOpacity,
} from "@/styles/theme";
import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

/**
 * Themed update dialog — shown when a new version is detected.
 * Finds the `.apk` asset from the GitHub release and opens it via Linking.
 */
export function UpdateDialog() {
  const colors = useColors();
  const { t } = useTranslation();
  const dialogVisible = useUpdateStore((s) => s.dialogVisible);
  const checkResult = useUpdateStore((s) => s.checkResult);
  const hideDialog = useUpdateStore((s) => s.hideDialog);
  const dismissVersion = useUpdateStore((s) => s.dismissVersion);
  const installState = useUpdateStore((s) => s.installState);
  const setInstallState = useUpdateStore((s) => s.setInstallState);
  const installOwner = useRef(createUpdateInstallOwner()).current;
  const releaseConfig = getShlaiReleaseConfig();

  const release = checkResult?.release;
  const version = release?.version ?? checkResult?.latestVersion;

  const apkAsset = useMemo(
    () => selectReleaseAsset(release?.assets, releaseConfig?.assetName ?? ""),
    [release, releaseConfig?.assetName],
  );
  const checksumAsset = useMemo(
    () => selectReleaseAsset(release?.assets, releaseConfig?.checksumAssetName ?? ""),
    [release, releaseConfig?.checksumAssetName],
  );

  const downloadUrl = apkAsset?.downloadUrl ?? release?.htmlUrl ?? null;
  const busy =
    installState.status === "downloading" ||
    installState.status === "verifying" ||
    installState.status === "opening-installer";

  const notes = useMemo(() => {
    if (!release?.notes) return "";
    // Strip markdown headings, links, images, bold/italic — keep plain text
    const plain = release.notes
      .replace(/#{1,6}\s*/g, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim();
    return plain.length > 200 ? `${plain.slice(0, 200)}...` : plain;
  }, [release]);

  const handleDownload = useCallback(async () => {
    if (!releaseConfig || !release) return;
    if (releaseConfig.releaseMode === "single") {
      if (downloadUrl) await Linking.openURL(downloadUrl);
      hideDialog();
      return;
    }
    if (!apkAsset || !checksumAsset) {
      setInstallState({ status: "error", message: "Required update files are missing." });
      return;
    }
    await installOwner.run(async () => {
      try {
        await installShlaiPreviewUpdateWithExpo(
          {
            tag: `${releaseConfig.tagPrefix}${release.version}`,
            apkAsset,
            checksumAsset,
          },
          setInstallState,
        );
        setInstallState({ status: "idle" });
        hideDialog();
      } catch (error) {
        setInstallState({
          status: "error",
          message: error instanceof Error ? error.message : "Update installation failed.",
        });
      }
    });
  }, [
    apkAsset,
    checksumAsset,
    downloadUrl,
    hideDialog,
    installOwner,
    release,
    releaseConfig,
    setInstallState,
  ]);

  const handleLater = useCallback(() => {
    if (busy) return;
    setInstallState({ status: "idle" });
    if (version) {
      dismissVersion(version);
    } else {
      hideDialog();
    }
  }, [version, dismissVersion, hideDialog, busy, setInstallState]);

  if (!dialogVisible || !checkResult?.hasUpdate) return null;

  const s = makeStyles(colors);

  return (
    <Modal transparent animationType="fade" onRequestClose={handleLater}>
      <Pressable style={s.overlay} onPress={handleLater}>
        <Pressable style={s.card} onPress={() => {}}>
          {/* Version badge */}
          <View style={s.badgeRow}>
            <View style={[s.badge, { backgroundColor: withOpacity(colors.primary, 0.12) }]}>
              <Text style={[s.badgeText, { color: colors.primary }]}>v{version}</Text>
            </View>
          </View>

          {/* Title */}
          <Text style={s.title}>{t("settings.updateAvailable")}</Text>

          {/* Description */}
          <Text style={s.description}>{t("settings.newVersionAvailable", { version })}</Text>

          {/* Release notes */}
          {notes.length > 0 && (
            <View style={s.notesBox}>
              <Text style={s.notesText} numberOfLines={5}>
                {notes}
              </Text>
            </View>
          )}

          {installState.status === "error" && (
            <Text style={s.errorText}>{installState.message}</Text>
          )}

          {installState.status === "downloading" && (
            <Text style={s.progressText}>
              {installState.progress === null
                ? t("settings.updateDownloading", "Downloading…")
                : `${t("settings.updateDownloading", "Downloading…")} ${Math.round(installState.progress * 100)}%`}
            </Text>
          )}

          {/* Actions */}
          <View style={s.actions}>
            <TouchableOpacity
              style={[s.primaryBtn, busy && s.disabledBtn]}
              onPress={handleDownload}
              disabled={busy}
              activeOpacity={0.8}
            >
              <Text style={s.primaryBtnText}>
                {installState.status === "verifying"
                  ? t("settings.updateVerifying", "Verifying…")
                  : installState.status === "opening-installer"
                    ? t("settings.updateOpeningInstaller", "Opening installer…")
                    : t("settings.downloadUpdate")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={handleLater}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={s.secondaryBtnText}>{t("settings.later")}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "center",
      alignItems: "center",
      padding: spacing.xxl,
    },
    card: {
      width: "100%",
      maxWidth: 340,
      backgroundColor: colors.card,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.xxl,
    },
    badgeRow: {
      flexDirection: "row",
      justifyContent: "center",
      marginBottom: spacing.md,
    },
    badge: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.full,
    },
    badgeText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    title: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      color: colors.foreground,
      textAlign: "center",
      marginBottom: spacing.sm,
    },
    description: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: spacing.lg,
    },
    notesBox: {
      backgroundColor: colors.muted,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },
    notesText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      lineHeight: 18,
    },
    actions: {
      gap: spacing.sm,
    },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.xl,
      paddingVertical: 12,
      alignItems: "center",
    },
    primaryBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.primaryForeground,
    },
    disabledBtn: { opacity: 0.6 },
    progressText: {
      color: colors.mutedForeground,
      fontSize: fontSize.xs,
      textAlign: "center",
      marginBottom: spacing.md,
    },
    errorText: {
      color: colors.destructive,
      fontSize: fontSize.xs,
      textAlign: "center",
      marginBottom: spacing.md,
    },
    secondaryBtn: {
      borderRadius: radius.xl,
      paddingVertical: 10,
      alignItems: "center",
    },
    secondaryBtnText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
  });
