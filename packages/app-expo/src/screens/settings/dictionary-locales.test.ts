import { describe, expect, it } from "vitest";
import enReader from "../../../../core/src/i18n/locales/en/reader.json";
import zhTwReader from "../../../../core/src/i18n/locales/zh-TW/reader.json";
import zhReader from "../../../../core/src/i18n/locales/zh/reader.json";

const requiredDictionaryKeys = [
  "define",
  "title",
  "close",
  "loadingDefinition",
  "dictionaries",
  "english",
  "chinese",
  "download",
  "update",
  "remove",
  "retry",
  "retryLookup",
  "manageDictionaries",
  "notDownloaded",
  "noDefinitionFound",
  "unsupportedSelection",
  "lookupError",
  "downloadDefinition",
  "downloadingDefinition",
  "downloadAccessibility",
  "downloadingAccessibility",
  "offlinePrivacy",
  "downloading",
  "installed",
  "installedStatus",
  "updateAvailable",
  "updateStatus",
  "error",
  "packError",
  "unavailable",
  "version",
  "size",
  "attribution",
  "attributionLabel",
  "license",
  "licenseDetail",
  "actionLabel",
  "statusLabel",
  "removeTitle",
  "removeMessage",
  "cancel",
] as const;

const requiredDictionaryTemplates = {
  actionLabel: ["action", "language"],
  attributionLabel: ["language"],
  downloading: ["progress"],
  downloadingDefinition: ["language", "progress"],
  downloadDefinition: ["language", "size"],
  downloadAccessibility: ["language"],
  downloadingAccessibility: ["language"],
  installedStatus: ["installed", "version", "size"],
  licenseDetail: ["label", "license"],
  packError: ["language"],
  removeMessage: ["language"],
  removeTitle: ["language"],
  size: ["size"],
  statusLabel: ["language", "status"],
  updateStatus: ["updateAvailable", "installedVersion", "availableVersion"],
  version: ["version"],
} as const;

describe("dictionary locale copy", () => {
  it.each([
    ["English", enReader],
    ["Simplified Chinese", zhReader],
    ["Traditional Chinese", zhTwReader],
  ])("provides every dictionary string in %s", (_language, reader) => {
    const dictionary = reader.dictionary as Record<string, unknown> | undefined;

    for (const key of requiredDictionaryKeys) {
      expect(dictionary?.[key], `${_language} reader.dictionary.${key}`).toEqual(
        expect.any(String),
      );
      expect((dictionary?.[key] as string).trim()).not.toBe("");
    }

    for (const [key, variables] of Object.entries(requiredDictionaryTemplates)) {
      for (const variable of variables) {
        expect(dictionary?.[key], `${_language} reader.dictionary.${key}`).toContain(
          `{{${variable}}}`,
        );
      }
    }
  });
});
