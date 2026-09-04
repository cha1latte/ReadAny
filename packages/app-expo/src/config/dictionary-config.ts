import { parseDictionaryManifest } from "@readany/core/dictionary";
import bundledManifest from "./dictionary-manifest.json";

export const DICTIONARY_REMOTE_MANIFEST_URL =
  "https://raw.githubusercontent.com/cha1latte/ReadAny/main/dictionary-packs/manifest.json";

export const DICTIONARY_BUNDLED_MANIFEST = parseDictionaryManifest(bundledManifest);
