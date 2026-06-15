import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type LocaleObject = Record<string, unknown>;

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "locales");
const knowledgeNamespaces = ["notes", "chat"] as const;

function readLocaleNamespace(locale: string, namespace: (typeof knowledgeNamespaces)[number]) {
  return JSON.parse(
    readFileSync(path.join(localesDir, locale, `${namespace}.json`), "utf8"),
  ) as LocaleObject;
}

function isLocaleObject(value: unknown): value is LocaleObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function flattenKeys(value: LocaleObject, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    return isLocaleObject(child) ? flattenKeys(child, nextKey) : [nextKey];
  });
}

function flattenEntries(value: LocaleObject, prefix = ""): Array<[string, unknown]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    return isLocaleObject(child) ? flattenEntries(child, nextKey) : [[nextKey, child]];
  });
}

function isKnowledgeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("knowledge") || normalized.includes("card");
}

function localeDirectories() {
  return readdirSync(localesDir)
    .filter((entry) => statSync(path.join(localesDir, entry)).isDirectory())
    .sort();
}

function interpolationPlaceholders(value: unknown): string[] {
  return Array.from(String(value).matchAll(/{{\s*([\w.]+)\s*}}/g))
    .map((match) => match[1])
    .sort();
}

describe("i18n knowledge locales", () => {
  it("keeps notes knowledge and card keys inside the notes object", () => {
    for (const locale of localeDirectories()) {
      const topLevelKeys = Object.keys(readLocaleNamespace(locale, "notes")).filter(isKnowledgeKey);
      expect(
        topLevelKeys,
        `${locale}/notes has knowledge i18n keys outside the notes object`,
      ).toEqual([]);
    }
  });

  it("keeps knowledge and card translation keys available in every locale", () => {
    const locales = localeDirectories()
      .filter((locale) => locale !== "en")
      .sort();

    for (const namespace of knowledgeNamespaces) {
      const expectedKeys = flattenKeys(readLocaleNamespace("en", namespace)).filter(isKnowledgeKey);
      for (const locale of locales) {
        const localeKeys = new Set(flattenKeys(readLocaleNamespace(locale, namespace)));
        const missingKeys = expectedKeys.filter((key) => !localeKeys.has(key));
        expect(missingKeys, `${locale}/${namespace} is missing knowledge i18n keys`).toEqual([]);
      }
    }
  });

  it("keeps knowledge and card interpolation placeholders consistent", () => {
    const locales = localeDirectories()
      .filter((locale) => locale !== "en")
      .sort();

    for (const namespace of knowledgeNamespaces) {
      const expectedEntries = flattenEntries(readLocaleNamespace("en", namespace)).filter(([key]) =>
        isKnowledgeKey(key),
      );
      for (const locale of locales) {
        const localeEntries = new Map(flattenEntries(readLocaleNamespace(locale, namespace)));
        const placeholderMismatches = expectedEntries
          .map(([key, value]) => {
            const expected = interpolationPlaceholders(value);
            const actual = interpolationPlaceholders(localeEntries.get(key));
            return expected.join(",") === actual.join(",")
              ? null
              : { key, expected, actual };
          })
          .filter(Boolean);

        expect(
          placeholderMismatches,
          `${locale}/${namespace} has mismatched knowledge i18n placeholders`,
        ).toEqual([]);
      }
    }
  });
});
