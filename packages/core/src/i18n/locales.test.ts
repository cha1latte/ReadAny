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

function isKnowledgeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes("knowledge") || normalized.includes("card");
}

describe("i18n knowledge locales", () => {
  it("keeps knowledge and card translation keys available in every locale", () => {
    const locales = readdirSync(localesDir)
      .filter((entry) => statSync(path.join(localesDir, entry)).isDirectory())
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
});
