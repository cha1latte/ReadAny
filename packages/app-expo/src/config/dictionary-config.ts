import { parseDictionaryManifest } from "@readany/core/dictionary";
import bundledManifest from "./dictionary-manifest.json";

export const DICTIONARY_REMOTE_MANIFEST_URL =
  process.env.EXPO_PUBLIC_DICTIONARY_MANIFEST_URL?.trim() ||
  "https://raw.githubusercontent.com/codedogQBY/ReadAny/main/dictionary-packs/manifest.json";

export const DICTIONARY_BUNDLED_MANIFEST = parseDictionaryManifest(bundledManifest);
