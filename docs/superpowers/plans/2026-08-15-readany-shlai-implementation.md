# ReadAny Shlai Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `cha1latte/ReadAny` into a safe Android fork named ReadAny Shlai with distinct app identities, collaborative pull-request preview builds, signed GitHub Releases, Obtainium updates, and reviewable upstream synchronization.

**Architecture:** Keep application identity and release metadata in small CommonJS configuration modules consumed by Expo. Route mobile update checks to Shlai releases without changing desktop ReadAny defaults. Use separate GitHub Actions workflows for untrusted preview builds, protected stable signing, and upstream-sync pull requests; repository protection and secrets are configured only after the code workflows are validated.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, Vitest 4, Biome 1.9, pnpm 9.15, Node 20.18, Android/Gradle, GitHub Actions, GitHub CLI, Obtainium.

## Global Constraints

- Official ReadAny remains installed as package `com.readany.app` and its data is never modified.
- Stable Shlai uses `io.github.cha1latte.readanyshlai`; preview uses `io.github.cha1latte.readanyshlai.preview`; development uses `io.github.cha1latte.readanyshlai.dev`.
- Display names are `ReadAny Shlai`, `ReadAny Shlai Preview`, and `ReadAny Shlai Dev`.
- Deep-link schemes are `readany-shlai`, `readany-shlai-preview`, and `readany-shlai-dev`.
- The fork remains public and GPL-3.0-or-later with explicit unofficial-fork and upstream attribution.
- Pull-request workflows never receive the stable Android signing key.
- Stable releases require Celia's approval through the `shlai-production` GitHub environment.
- Merging a pull request never automatically publishes a stable phone update.
- Upstream changes arrive only through visible pull requests and are never auto-merged.
- The first stable release is blocked until two encrypted signing-key backups are verified.
- Android is the only distribution target in this implementation.

---

### Preflight: Establish fork and upstream ownership locally

Run this before Task 1 so all Shlai commits and pull requests target Celia's fork while upstream PR #680 remains attached to the official repository:

```powershell
git remote rename origin upstream
git remote rename fork origin
git branch --set-upstream-to=origin/main main
git remote -v
git branch -vv
```

After creating the isolated `agent/readany-shlai-implementation` branch, carry the already-proven keyboard fix into Shlai without mixing Shlai customization into upstream PR #680:

```powershell
git cherry-pick 45cc94e1
pnpm --filter @readany/app-expo exec vitest run src/screens/chat-keyboard-layout.test.ts
```

Expected: `origin` is `cha1latte/ReadAny`; `upstream` is `codedogQBY/ReadAny`; the existing keyboard branch tracks `origin/fix/android-chat-keyboard`; upstream PR #680 remains open against `codedogQBY/ReadAny:main`; and the Shlai implementation branch contains the same keyboard regression commit with all five layout tests passing.

---

### Task 1: Shlai app identities and deterministic version metadata

**Files:**
- Create: `packages/app-expo/scripts/shlai-version.js`
- Create: `packages/app-expo/src/config/shlai-app-config.test.ts`
- Modify: `packages/app-expo/scripts/app-variant.js:1-23`
- Modify: `packages/app-expo/app.config.js:1-98`
- Modify: `packages/app-expo/scripts/configure-native-variant.js:49-63`
- Modify: `packages/app-expo/package.json:18-45`
- Modify: `packages/app-expo/eas.json:1-75`

**Interfaces:**
- Consumes: `APP_VARIANT`, `SHLAI_UPSTREAM_VERSION`, `SHLAI_REVISION`, and `SHLAI_VERSION_CODE` environment variables.
- Produces: `getShlaiVersionConfig(env)` returning `{ upstreamVersion, revision, version, tag, versionCode }` and exact variant objects consumed by `app.config.js` and release workflows.

- [ ] **Step 1: Write failing identity and version tests**

Create `packages/app-expo/src/config/shlai-app-config.test.ts`:

```ts
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { APP_VARIANTS } = require("../../scripts/app-variant.js");
const { getShlaiVersionConfig } = require("../../scripts/shlai-version.js");

describe("ReadAny Shlai app configuration", () => {
  it("uses isolated identities for every Android variant", () => {
    expect(APP_VARIANTS).toEqual({
      development: {
        key: "development",
        name: "ReadAny Shlai Dev",
        bundleIdentifier: "io.github.cha1latte.readanyshlai.dev",
        androidPackage: "io.github.cha1latte.readanyshlai.dev",
        scheme: "readany-shlai-dev",
      },
      preview: {
        key: "preview",
        name: "ReadAny Shlai Preview",
        bundleIdentifier: "io.github.cha1latte.readanyshlai.preview",
        androidPackage: "io.github.cha1latte.readanyshlai.preview",
        scheme: "readany-shlai-preview",
      },
      production: {
        key: "production",
        name: "ReadAny Shlai",
        bundleIdentifier: "io.github.cha1latte.readanyshlai",
        androidPackage: "io.github.cha1latte.readanyshlai",
        scheme: "readany-shlai",
      },
    });
  });

  it("derives the release tag, display version, and Android build number", () => {
    expect(
      getShlaiVersionConfig({
        SHLAI_UPSTREAM_VERSION: "1.3.5",
        SHLAI_REVISION: "2",
        SHLAI_VERSION_CODE: "9",
      }),
    ).toEqual({
      upstreamVersion: "1.3.5",
      revision: 2,
      version: "1.3.5-shlai.2",
      tag: "shlai-v1.3.5.2",
      versionCode: 9,
    });
  });

  it.each([
    [{ SHLAI_UPSTREAM_VERSION: "one" }, "Invalid SHLAI_UPSTREAM_VERSION"],
    [{ SHLAI_REVISION: "-1" }, "Invalid SHLAI_REVISION"],
    [{ SHLAI_VERSION_CODE: "0" }, "Invalid SHLAI_VERSION_CODE"],
  ])("rejects invalid release metadata", (env, message) => {
    expect(() => getShlaiVersionConfig(env)).toThrow(message);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/config/shlai-app-config.test.ts
```

Expected: FAIL because `scripts/shlai-version.js` does not exist and the variants still use official ReadAny identities.

- [ ] **Step 3: Implement deterministic Shlai version parsing**

Create `packages/app-expo/scripts/shlai-version.js`:

```js
const { version: packageVersion } = require("../package.json");

function getShlaiVersionConfig(env = process.env) {
  const upstreamVersion = String(env.SHLAI_UPSTREAM_VERSION || packageVersion).trim();
  const revisionText = String(env.SHLAI_REVISION || "0").trim();
  const versionCodeText = String(env.SHLAI_VERSION_CODE || "1").trim();

  if (!/^\d+\.\d+\.\d+$/.test(upstreamVersion)) {
    throw new Error(`Invalid SHLAI_UPSTREAM_VERSION: ${upstreamVersion}`);
  }
  if (!/^\d+$/.test(revisionText)) {
    throw new Error(`Invalid SHLAI_REVISION: ${revisionText}`);
  }
  if (!/^[1-9]\d*$/.test(versionCodeText)) {
    throw new Error(`Invalid SHLAI_VERSION_CODE: ${versionCodeText}`);
  }

  const revision = Number(revisionText);
  const versionCode = Number(versionCodeText);
  return {
    upstreamVersion,
    revision,
    version: `${upstreamVersion}-shlai.${revision}`,
    tag: `shlai-v${upstreamVersion}.${revision}`,
    versionCode,
  };
}

module.exports = { getShlaiVersionConfig };
```

- [ ] **Step 4: Replace official identities and connect them to Expo config**

Replace `APP_VARIANTS` in `packages/app-expo/scripts/app-variant.js` with the exact object asserted in Step 1.

Update `packages/app-expo/app.config.js` to import `getShlaiVersionConfig`, use the returned `version` and `versionCode`, use `slug: "readany-shlai"`, point all icon fields at `./assets/shlai/`, interpolate `variant.name` in permission copy, and replace the official EAS project block with fork metadata:

```js
const { getAppVariantConfig } = require("./scripts/app-variant");
const { getShlaiVersionConfig } = require("./scripts/shlai-version");

const variant = getAppVariantConfig();
const release = getShlaiVersionConfig();

// Inside expo:
slug: "readany-shlai",
version: release.version,
icon: "./assets/shlai/icon.png",
splash: {
  image: "./assets/shlai/splash-icon.png",
  resizeMode: "contain",
  backgroundColor: "#05042B",
},
android: {
  adaptiveIcon: {
    foregroundImage: "./assets/shlai/adaptive-icon.png",
    backgroundColor: "#05042B",
  },
  versionCode: release.versionCode,
  softwareKeyboardLayoutMode: "resize",
  package: variant.androidPackage,
  permissions: [
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    "android.permission.MODIFY_AUDIO_SETTINGS",
  ],
},
scheme: variant.scheme,
extra: {
  appVariant: variant.key,
  shlaiRevision: release.revision,
  upstreamRepository: "codedogQBY/ReadAny",
  forkRepository: "cha1latte/ReadAny",
  releaseApiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
  releaseTagPrefix: "shlai-v",
  releaseAssetName: "ReadAny-Shlai.apk",
},
```

Do not retain the official Expo `projectId` or App Store `ascAppId`. Set `appVersionSource` to `local` in `packages/app-expo/eas.json`. Update hard-coded development schemes in `packages/app-expo/package.json` to `readany-shlai-dev`.

Broaden the three iOS replacement patterns in `configure-native-variant.js` so they recognize both inherited official identifiers and all Shlai identifiers before substituting `variant` values. This preserves local tooling without adding iOS distribution.

- [ ] **Step 5: Run identity verification**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/config/shlai-app-config.test.ts
$env:APP_VARIANT='production'; $env:SHLAI_UPSTREAM_VERSION='1.3.5'; $env:SHLAI_REVISION='1'; $env:SHLAI_VERSION_CODE='1'; pnpm --filter @readany/app-expo exec expo config --type public
```

Expected: tests PASS; Expo config reports `ReadAny Shlai`, package `io.github.cha1latte.readanyshlai`, scheme `readany-shlai`, version `1.3.5-shlai.1`, and version code `1`, with no official EAS project ID.

- [ ] **Step 6: Commit the identity slice**

```powershell
git add packages/app-expo/app.config.js packages/app-expo/eas.json packages/app-expo/package.json packages/app-expo/scripts/app-variant.js packages/app-expo/scripts/configure-native-variant.js packages/app-expo/scripts/shlai-version.js packages/app-expo/src/config/shlai-app-config.test.ts
git commit -m "feat(mobile): add ReadAny Shlai app identities"
```

---

### Task 2: Route update checks to Shlai releases without changing desktop defaults

**Files:**
- Create: `packages/core/src/update/update-checker.test.ts`
- Create: `packages/app-expo/src/lib/shlai-release.ts`
- Modify: `packages/core/src/update/update-checker.ts:8-103`
- Modify: `packages/app-expo/src/hooks/use-update-checker.ts:1-50`
- Modify: `packages/app-expo/src/screens/settings/AboutScreen.tsx:1-77`
- Modify: `packages/app-expo/src/lib/platform/expo-platform-service.ts:597-640`

**Interfaces:**
- Consumes: Expo `extra.releaseApiUrl`, `extra.releaseTagPrefix`, and `extra.releaseAssetName` from Task 1.
- Produces: `getShlaiReleaseConfig()` and optional `UpdateCheckOptions` accepted by core `checkForUpdate`.

- [ ] **Step 1: Write failing release parsing and routing tests**

Create `packages/core/src/update/update-checker.test.ts` with a minimal `IPlatformService` mock and these assertions:

```ts
import { describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "../services/platform";
import { checkForUpdate, compareVersions, releaseTagToVersion } from "./update-checker";

function makePlatform() {
  return {
    kvGetItem: vi.fn().mockResolvedValue(null),
    kvSetItem: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "shlai-v1.3.5.2",
        body: "Visible input fix",
        html_url: "https://github.com/cha1latte/ReadAny/releases/tag/shlai-v1.3.5.2",
        published_at: "2026-08-16T00:00:00Z",
        assets: [{ name: "ReadAny-Shlai.apk", browser_download_url: "https://example.test/shlai.apk", size: 42 }],
      }),
    }),
  } as unknown as IPlatformService;
}

describe("Shlai update routing", () => {
  it("normalizes Shlai release tags and prerelease-style app versions", () => {
    expect(releaseTagToVersion("shlai-v1.3.5.2", "shlai-v")).toBe("1.3.5.2");
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.1")).toBeGreaterThan(0);
    expect(compareVersions("1.3.5.2", "1.3.5-shlai.2")).toBe(0);
  });

  it("uses the fork API and a fork-specific throttle key", async () => {
    const platform = makePlatform();
    const result = await checkForUpdate("1.3.5-shlai.1", platform, false, {
      apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      tagPrefix: "shlai-v",
      throttleKey: "shlai_update_last_check_at",
    });
    expect(platform.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
      expect.any(Object),
    );
    expect(platform.kvSetItem).toHaveBeenCalledWith("shlai_update_last_check_at", expect.any(String));
    expect(result.latestVersion).toBe("1.3.5.2");
    expect(result.hasUpdate).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused core test and confirm failure**

```powershell
pnpm --filter @readany/core exec vitest run src/update/update-checker.test.ts
```

Expected: FAIL because the new exports/options do not exist and the old numeric parser treats `shlai` as `NaN`.

- [ ] **Step 3: Implement configurable release routing**

In `packages/core/src/update/update-checker.ts`, keep the official API as the default and add:

```ts
export interface UpdateCheckOptions {
  apiUrl?: string;
  tagPrefix?: string;
  throttleKey?: string;
  assetName?: string;
}

export function releaseTagToVersion(tag: string, prefix = "v"): string | null {
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : null;
}

function versionParts(value: string): number[] {
  return (value.match(/\d+/g) || []).map(Number);
}

export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}
```

Add `options: UpdateCheckOptions = {}` as the fourth `checkForUpdate` parameter. Resolve `apiUrl`, `tagPrefix`, `throttleKey`, and optional `assetName` once at the start. Reject a tag without the exact prefix before throttling. When `assetName` is configured, require that exact asset, expose only that asset in `ReleaseInfo`, and do not burn the 24-hour throttle for a missing required asset. Existing desktop callers that pass only three arguments retain the official `v` prefix and unfiltered release assets.

- [ ] **Step 4: Add the mobile Shlai release configuration boundary**

Create `packages/app-expo/src/lib/shlai-release.ts`:

```ts
import Constants from "expo-constants";

export interface ShlaiReleaseConfig {
  apiUrl: string;
  tagPrefix: string;
  throttleKey: string;
  assetName: string;
}

export function getShlaiReleaseConfig(): ShlaiReleaseConfig {
  const extra = Constants.expoConfig?.extra;
  return {
    apiUrl:
      extra?.releaseApiUrl ||
      "https://api.github.com/repos/cha1latte/ReadAny/releases/latest",
    tagPrefix: extra?.releaseTagPrefix || "shlai-v",
    throttleKey: "shlai_update_last_check_at",
    assetName: extra?.releaseAssetName || "ReadAny-Shlai.apk",
  };
}
```

Pass this configuration as the fourth argument from `use-update-checker.ts` and `AboutScreen.tsx`. In `ExpoPlatformService.checkUpdate`, replace the official API literal with `getShlaiReleaseConfig().apiUrl`, normalize with `releaseTagToVersion`, compare with the shared `compareVersions`, and select the exact configured `assetName` instead of `ReadAny.apk`. `UpdateDialog` must use that same exact asset name rather than the first `.apk` suffix match.

- [ ] **Step 5: Verify both fork and default update behavior**

```powershell
pnpm --filter @readany/core exec vitest run src/update/update-checker.test.ts
pnpm --filter @readany/core test
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
```

Expected: the new tests PASS, all existing core tests remain green, and Expo type-checking succeeds.

- [ ] **Step 6: Commit the update-routing slice**

```powershell
git add packages/core/src/update/update-checker.ts packages/core/src/update/update-checker.test.ts packages/app-expo/src/lib/shlai-release.ts packages/app-expo/src/hooks/use-update-checker.ts packages/app-expo/src/screens/settings/AboutScreen.tsx packages/app-expo/src/lib/platform/expo-platform-service.ts
git commit -m "fix(mobile): route updates to Shlai releases"
```

---

### Task 3: Add unmistakable Shlai branding and attribution

**Files:**
- Create: `packages/app-expo/assets/shlai/icon.png`
- Create: `packages/app-expo/assets/shlai/adaptive-icon.png`
- Create: `packages/app-expo/assets/shlai/splash-icon.png`
- Create: `packages/app-expo/src/screens/settings/shlai-branding.test.ts`
- Modify: `packages/app-expo/src/screens/settings/AboutScreen.tsx:28-166`
- Modify: `packages/app-expo/src/screens/ProfileScreen.tsx:105-106,640-652`
- Modify: `README.md:1-37`

**Interfaces:**
- Consumes: exact app names and asset paths from Task 1.
- Produces: visually distinct Shlai assets and user-visible GPL/upstream attribution.

- [ ] **Step 1: Write the failing branding contract**

Create `packages/app-expo/src/screens/settings/shlai-branding.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const about = readFileSync(resolve(here, "AboutScreen.tsx"), "utf8");
const profile = readFileSync(resolve(here, "../../ProfileScreen.tsx"), "utf8");

describe("ReadAny Shlai attribution", () => {
  it("names the fork and links both source repositories", () => {
    expect(about).toContain("ReadAny Shlai");
    expect(about).toContain("https://github.com/cha1latte/ReadAny");
    expect(about).toContain("https://github.com/codedogQBY/ReadAny");
    expect(about).toContain("Unofficial GPL-3.0 fork");
  });

  it("does not claim the official app's ICP registration", () => {
    expect(profile).not.toContain("ICP_NUMBER");
    expect(profile).not.toContain("beian.miit.gov.cn");
  });
});
```

- [ ] **Step 2: Run the branding test and confirm failure**

```powershell
pnpm --filter @readany/app-expo exec vitest run src/screens/settings/shlai-branding.test.ts
```

Expected: FAIL because the current About screen names official ReadAny/nicepkg and the Profile screen displays the official ICP registration.

- [ ] **Step 3: Generate and visually verify the three Shlai icon assets**

Use the `imagegen` skill with the existing `packages/app-expo/assets/icon.png` as the reference and this exact edit brief:

> Preserve the navy, cream, hand-drawn reading mascot character and overall silhouette. Create an unmistakable unofficial fork variant by adding a clean mint-green circular corner badge containing a bold handwritten capital S, plus a thin mint accent around the book. Keep the artwork friendly, legible at small Android launcher sizes, centered, with no additional words and no photographic texture.

Generate a 1024x1024 master, inspect it with `view_image`, then export:

- `icon.png` at 512x512 with the existing navy background;
- `adaptive-icon.png` at 1024x1024 with safe-zone foreground placement; and
- `splash-icon.png` at 512x512.

Verify all three with `view_image` and confirm the S badge remains recognizable at a 48x48 preview.

- [ ] **Step 4: Replace About copy and links with fork-safe attribution**

In `AboutScreen.tsx`, import `assets/shlai/icon.png`, set the app heading to `ReadAny Shlai`, and use these exact links/copy:

```ts
const LINKS = [
  { label: "ReadAny Shlai source", url: "https://github.com/cha1latte/ReadAny" },
  { label: "Official ReadAny", url: "https://github.com/codedogQBY/ReadAny" },
  { label: "Report a Shlai issue", url: "https://github.com/cha1latte/ReadAny/issues" },
];

const FORK_NOTICE = "Unofficial GPL-3.0 fork of ReadAny maintained by Chai.";
```

Render `FORK_NOTICE` below the description and replace the old `nicepkg` footer with `ReadAny Shlai by Chai · Based on ReadAny`. Remove the separate hard-coded feedback link because `LINKS` now owns it.

Remove `ICP_NUMBER`, `ICP_URL`, the ICP touch target, and their styles from `ProfileScreen.tsx`; the official registration must not be presented as belonging to the fork.

Add a top-of-file banner to `README.md` before the inherited upstream content:

```md
> [!IMPORTANT]
> **ReadAny Shlai** is an unofficial GPL-3.0 fork maintained at
> [cha1latte/ReadAny](https://github.com/cha1latte/ReadAny). The official project is
> [codedogQBY/ReadAny](https://github.com/codedogQBY/ReadAny). Shlai Android releases use a
> separate package and do not replace the official app.
```

- [ ] **Step 5: Verify branding, dimensions, and source hygiene**

```powershell
pnpm --filter @readany/app-expo exec vitest run src/screens/settings/shlai-branding.test.ts
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
pnpm exec biome check packages/app-expo/src/screens/settings/AboutScreen.tsx packages/app-expo/src/screens/ProfileScreen.tsx packages/app-expo/src/screens/settings/shlai-branding.test.ts
git diff --check
```

Expected: branding test PASS, type-check PASS, Biome PASS, and the images exist at the exact sizes specified.

- [ ] **Step 6: Commit the branding slice**

```powershell
git add README.md packages/app-expo/assets/shlai packages/app-expo/src/screens/ProfileScreen.tsx packages/app-expo/src/screens/settings/AboutScreen.tsx packages/app-expo/src/screens/settings/shlai-branding.test.ts
git commit -m "feat(mobile): brand the ReadAny Shlai fork"
```

---

### Task 4: Add required pull-request validation and preview APK artifacts

**Files:**
- Create: `.github/workflows/shlai-pr.yml`
- Create: `packages/app-expo/src/config/shlai-workflows.test.ts`

**Interfaces:**
- Consumes: preview identity/configuration from Task 1 and existing Expo build scripts.
- Produces: required checks named `Validate` and `Preview APK`, plus an installable debug-signed preview artifact that has no stable secrets.

- [ ] **Step 1: Write the failing workflow security contract**

Create `packages/app-expo/src/config/shlai-workflows.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const readWorkflow = (name: string) =>
  readFileSync(resolve(root, ".github/workflows", name), "utf8");

describe("ReadAny Shlai workflows", () => {
  it("builds secret-free preview APKs after validation", () => {
    const source = readWorkflow("shlai-pr.yml");
    expect(source).toContain("name: Validate");
    expect(source).toContain("name: Preview APK");
    expect(source).toContain("APP_VARIANT: preview");
    expect(source).toContain("assembleDebug");
    expect(source).toContain("ReadAny-Shlai-Preview-");
    expect(source).not.toContain("SHLAI_ANDROID_KEYSTORE");
    expect(source).not.toContain("environment: shlai-production");
  });
});
```

- [ ] **Step 2: Run the workflow test and confirm failure**

```powershell
pnpm --filter @readany/app-expo exec vitest run src/config/shlai-workflows.test.ts
```

Expected: FAIL because `.github/workflows/shlai-pr.yml` does not exist.

- [ ] **Step 3: Create the pull-request workflow**

Create `.github/workflows/shlai-pr.yml`:

```yaml
name: Shlai Pull Request

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: shlai-pr-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    name: Validate
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v3
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20.18.0
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @readany/core test
      - run: pnpm --filter @readany/app-expo test
      - run: pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
      - name: Check changed files with Biome
        shell: bash
        run: |
          if [[ "${{ github.event_name }}" == "pull_request" ]]; then
            BASE_SHA="${{ github.event.pull_request.base.sha }}"
          else
            BASE_SHA="$(git rev-parse HEAD^)"
          fi
          mapfile -t FILES < <(git diff --name-only --diff-filter=ACMR "$BASE_SHA" HEAD -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.json' '*.css')
          if (( ${#FILES[@]} > 0 )); then
            pnpm exec biome check --no-errors-on-unmatched "${FILES[@]}"
          fi
          git diff --check "$BASE_SHA" HEAD

  preview:
    name: Preview APK
    needs: validate
    runs-on: ubuntu-22.04
    env:
      APP_VARIANT: preview
      SHLAI_UPSTREAM_VERSION: 1.3.5
      SHLAI_REVISION: 0
      SHLAI_VERSION_CODE: 1
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20.18.0
          cache: pnpm
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17
      - uses: android-actions/setup-android@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @readany/app-expo run build:reader
      - run: pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install
      - name: Build preview APK
        working-directory: packages/app-expo/android
        run: ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
      - name: Stage preview APK
        shell: bash
        run: |
          NUMBER="${{ github.event.pull_request.number || github.run_number }}"
          cp packages/app-expo/android/app/build/outputs/apk/debug/app-debug.apk "ReadAny-Shlai-Preview-${NUMBER}.apk"
      - uses: actions/upload-artifact@v4
        with:
          name: ReadAny-Shlai-Preview-${{ github.event.pull_request.number || github.run_number }}
          path: ReadAny-Shlai-Preview-*.apk
          retention-days: 14
```

- [ ] **Step 4: Run the workflow contract and local preview build**

```powershell
pnpm --filter @readany/app-expo exec vitest run src/config/shlai-workflows.test.ts
$env:APP_VARIANT='preview'; $env:SHLAI_UPSTREAM_VERSION='1.3.5'; $env:SHLAI_REVISION='0'; $env:SHLAI_VERSION_CODE='1'; pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install
Set-Location packages/app-expo/android
.\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a
Set-Location ../../../
```

Expected: workflow contract PASS and `packages/app-expo/android/app/build/outputs/apk/debug/app-debug.apk` exists with preview package identity.

- [ ] **Step 5: Commit the preview workflow slice**

```powershell
git add .github/workflows/shlai-pr.yml packages/app-expo/src/config/shlai-workflows.test.ts
git commit -m "ci: build Shlai pull request previews"
```

---

### Task 5: Add protected, signed stable releases

**Files:**
- Create: `.github/workflows/shlai-release.yml`
- Create: `docs/readany-shlai/releasing.md`
- Modify: `packages/app-expo/src/config/shlai-workflows.test.ts`

**Interfaces:**
- Consumes: Task 1 version environment variables and protected GitHub secrets `SHLAI_ANDROID_KEYSTORE_BASE64`, `SHLAI_ANDROID_KEYSTORE_PASSWORD`, `SHLAI_ANDROID_KEY_ALIAS`, and `SHLAI_ANDROID_KEY_PASSWORD`.
- Produces: tag `shlai-v1.3.5.1`, release asset `ReadAny-Shlai.apk`, and a signed production package verified by Android build tools.

- [ ] **Step 1: Extend the failing workflow security contract**

Add this test to `shlai-workflows.test.ts`:

```ts
it("guards stable signing behind the production environment", () => {
  const source = readWorkflow("shlai-release.yml");
  expect(source).toContain("environment: shlai-production");
  expect(source).toContain("workflow_dispatch:");
  expect(source).toContain("SHLAI_ANDROID_KEYSTORE_BASE64");
  expect(source).toContain("android.injected.signing.store.file");
  expect(source).toContain("apksigner verify --verbose --print-certs");
  expect(source).toContain('gh release create "$TAG"');
  expect(source).not.toContain("pull_request:");
});
```

Run the test and expect failure because the release workflow does not exist.

- [ ] **Step 2: Create the stable-release workflow**

Create `.github/workflows/shlai-release.yml` with two jobs: `validate` without secrets, followed by `release` using `environment: shlai-production`. Set top-level permissions to `contents: read`, then grant only the `release` job `contents: write` so `gh release create` can publish. The dispatch inputs are `upstream_version`, `revision`, and `version_code`, all required strings with defaults `1.3.5`, `1`, and `1`.

The release job must use these exact build/sign/release commands:

```bash
TAG="shlai-v${SHLAI_UPSTREAM_VERSION}.${SHLAI_REVISION}"
APK="ReadAny-Shlai.apk"
KEYSTORE="$RUNNER_TEMP/readany-shlai-release.jks"

if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "Release already exists: $TAG" >&2
  exit 1
fi

printf '%s' "$SHLAI_ANDROID_KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE"
pnpm --filter @readany/app-expo run build:reader
pnpm --filter @readany/app-expo exec expo prebuild --platform android --clean --no-install

cd packages/app-expo/android
./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a \
  -Pandroid.injected.signing.store.file="$KEYSTORE" \
  -Pandroid.injected.signing.store.password="$SHLAI_ANDROID_KEYSTORE_PASSWORD" \
  -Pandroid.injected.signing.key.alias="$SHLAI_ANDROID_KEY_ALIAS" \
  -Pandroid.injected.signing.key.password="$SHLAI_ANDROID_KEY_PASSWORD"
cd ../../..

cp packages/app-expo/android/app/build/outputs/apk/release/app-release.apk "$APK"
BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
"$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK"
gh release create "$TAG" "$APK" \
  --repo "$GITHUB_REPOSITORY" \
  --target "$GITHUB_SHA" \
  --title "ReadAny Shlai ${SHLAI_UPSTREAM_VERSION}.${SHLAI_REVISION}" \
  --notes "Unofficial ReadAny Shlai Android release. Source: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/tree/${GITHUB_SHA}"
```

Set job environment variables from workflow inputs and secrets. The `validate` job runs the same core tests, Expo tests, type-check, and diff check as Task 4. The `release` job installs Node 20.18, pnpm 9.15, Java 17, Android SDK, and frozen dependencies before the commands above.

- [ ] **Step 3: Write operator documentation**

Create `docs/readany-shlai/releasing.md` with exact sections:

1. `Required GitHub environment and secrets` listing the four secret names and stating that they are never used by pull-request workflows.
2. `Versioning` explaining `1.3.5-shlai.1`, `versionCode=1`, and `shlai-v1.3.5.1`.
3. `Release` showing `gh workflow run "Release ReadAny Shlai" --repo cha1latte/ReadAny -f upstream_version=1.3.5 -f revision=1 -f version_code=1`.
4. `Verify` showing `gh release view shlai-v1.3.5.1 --repo cha1latte/ReadAny` and APK signature/package checks.
5. `Rollback` requiring a newer version code while rebuilding the previous known-good source commit.
6. `Key recovery` explicitly blocking release until both encrypted backups are confirmed.

- [ ] **Step 4: Verify workflow contracts and generated production identity**

```powershell
pnpm --filter @readany/app-expo exec vitest run src/config/shlai-workflows.test.ts
$env:APP_VARIANT='production'; $env:SHLAI_UPSTREAM_VERSION='1.3.5'; $env:SHLAI_REVISION='1'; $env:SHLAI_VERSION_CODE='1'; pnpm --filter @readany/app-expo exec expo config --type public
git diff --check
```

Expected: tests PASS; Expo reports the production package/version; no secret value exists in tracked files.

- [ ] **Step 5: Commit the stable-release slice**

```powershell
git add .github/workflows/shlai-release.yml docs/readany-shlai/releasing.md packages/app-expo/src/config/shlai-workflows.test.ts
git commit -m "ci: add protected Shlai Android releases"
```

---

### Task 6: Add visible upstream synchronization pull requests

**Files:**
- Create: `.github/workflows/shlai-upstream-sync.yml`
- Create: `docs/readany-shlai/upstream-sync.md`
- Modify: `packages/app-expo/src/config/shlai-workflows.test.ts`

**Interfaces:**
- Consumes: public official branch `codedogQBY/ReadAny:main` and fork branch `cha1latte/ReadAny:main`.
- Produces: at most one open `Sync official ReadAny upstream` pull request; no automatic merge.

- [ ] **Step 1: Add the failing upstream-sync contract**

```ts
it("opens reviewable upstream sync pull requests without merging", () => {
  const source = readWorkflow("shlai-upstream-sync.yml");
  expect(source).toContain("cron: '17 13 * * 1'");
  expect(source).toContain("https://github.com/codedogQBY/ReadAny.git");
  expect(source).toContain("gh pr create");
  expect(source).toContain("Sync official ReadAny upstream");
  expect(source).not.toMatch(/gh pr merge|--auto|git merge upstream/);
});
```

Run the workflow test and expect failure because the sync workflow does not exist.

- [ ] **Step 2: Create the scheduled sync workflow**

Create `.github/workflows/shlai-upstream-sync.yml`:

```yaml
name: Shlai Upstream Sync

on:
  schedule:
    - cron: '17 13 * * 1'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    name: Open upstream sync PR
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Create sync branch and PR
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          git fetch origin main
          git fetch https://github.com/codedogQBY/ReadAny.git main:refs/remotes/upstream/main

          if git merge-base --is-ancestor upstream/main origin/main; then
            echo "Fork already contains upstream main."
            exit 0
          fi

          OPEN_COUNT="$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --search 'in:title "Sync official ReadAny upstream"' --json number --jq 'length')"
          if [[ "$OPEN_COUNT" != "0" ]]; then
            echo "An upstream sync PR is already open."
            exit 0
          fi

          BRANCH="sync/upstream-$(date -u +%Y-%m-%d)"
          if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
            echo "Sync branch already exists: $BRANCH"
            exit 0
          fi

          git switch --create "$BRANCH" upstream/main
          git push origin "$BRANCH"
          gh pr create \
            --repo "$GITHUB_REPOSITORY" \
            --base main \
            --head "$BRANCH" \
            --title "Sync official ReadAny upstream $(date -u +%Y-%m-%d)" \
            --body "Brings the latest codedogQBY/ReadAny main into ReadAny Shlai. This PR is never auto-merged; resolve conflicts and verify the preview APK before approval."
```

This deliberately branches from the latest official commit. GitHub's pull request shows whether those commits merge cleanly with Shlai; conflicts remain visible and require human resolution.

- [ ] **Step 3: Document conflict handling**

Create `docs/readany-shlai/upstream-sync.md` documenting:

- the weekly Monday schedule and manual workflow dispatch;
- the one-open-sync-PR rule;
- how to fetch the sync branch, merge fork `main` into it locally, resolve conflicts, run required checks, and push the resolved branch;
- how to preserve Shlai identities, release workflows, branding, and attribution during conflicts; and
- how an upstreamed Shlai fix is removed only after the upstream commit arrives through this sync path.

Use these exact conflict commands:

```powershell
git fetch origin
git switch sync/upstream-2026-08-15
git merge origin/main
pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
git push origin sync/upstream-2026-08-15
```

- [ ] **Step 4: Verify and commit the sync slice**

```powershell
pnpm --filter @readany/app-expo exec vitest run src/config/shlai-workflows.test.ts
git diff --check
git add .github/workflows/shlai-upstream-sync.yml docs/readany-shlai/upstream-sync.md packages/app-expo/src/config/shlai-workflows.test.ts
git commit -m "ci: open reviewable upstream sync pull requests"
```

---

### Task 7: Configure owner-only repository governance and signing secrets

**Files:**
- Create: `docs/readany-shlai/development.md`
- Modify: GitHub repository settings; no product source files.

**Interfaces:**
- Consumes: the fork/upstream remotes established in Preflight, GitHub account `cha1latte`, Celia's authenticated `gh` session, and Celia's GitHub numeric user ID queried at runtime.
- Produces: owner-only canonical write access, protected `main`, a protected release environment, four encrypted GitHub secrets, and the non-secret signing-certificate digest variable `SHLAI_ANDROID_CERT_SHA256`.

- [ ] **Step 1: Write owner/friend development instructions**

Create `docs/readany-shlai/development.md` with exact owner and friend-fork clone/setup commands, the branch/PR rule, preview artifact download instructions, the no-secrets rule, official-vs-Shlai package table, and links to `releasing.md` and `upstream-sync.md`. The friend commands must use `<friend-login>`, keep `origin` as the friend's fork, add `canonical` for `cha1latte/ReadAny`, and preserve `upstream` for `codedogQBY/ReadAny`. Explain that the friend must not be invited as a direct collaborator because GitHub Releases use canonical `contents: write`; public releases remain usable. Friend reviews/comments are advisory and Celia manually approves merges. Add an `Upstreamable fixes` section requiring broadly useful changes to start from `upstream/main`, remain free of Shlai names/assets/signing/release automation, and go to `codedogQBY/ReadAny:main` as a focused PR before being carried into Shlai.

The quick start must be:

```powershell
git clone https://github.com/cha1latte/ReadAny.git
Set-Location ReadAny
git remote add upstream https://github.com/codedogQBY/ReadAny.git
pnpm install --frozen-lockfile
pnpm --filter @readany/app-expo test
git switch -c feature/reader-font-size
```

- [ ] **Step 2: Enable Actions and create the protected production environment**

Run after the workflow branch has been pushed and GitHub recognizes the workflow files:

```powershell
gh api --method PUT repos/cha1latte/ReadAny/actions/permissions -F enabled=true -f allowed_actions=all
$celiaId = gh api user --jq '.id'
$environment = @{
  wait_timer = 0
  prevent_self_review = $false
  reviewers = @(@{ type = 'User'; id = [int64]$celiaId })
  deployment_branch_policy = @{ protected_branches = $true; custom_branch_policies = $false }
} | ConvertTo-Json -Depth 5
$environment | gh api --method PUT repos/cha1latte/ReadAny/environments/shlai-production --input -
```

Verify with:

```powershell
gh api repos/cha1latte/ReadAny/environments/shlai-production
```

- [ ] **Step 3: Generate the stable keystore outside the repository and establish two backups**

Create the keystore outside the repository and let `keytool` prompt for the passwords and certificate identity:

```powershell
New-Item -ItemType Directory -Force -Path D:\dev\_secrets\readany-shlai
keytool -genkeypair -keystore D:\dev\_secrets\readany-shlai\readany-shlai-release.jks -alias readany-shlai -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10000
keytool -list -v -keystore D:\dev\_secrets\readany-shlai\readany-shlai-release.jks -alias readany-shlai
```

Never put either password in terminal arguments, chat, files under the repository, or logs. Confirm the alias and SHA-256 certificate fingerprint from the final command without recording the passwords.

Before continuing, Celia verifies two encrypted copies in two independent locations and records their location labels plus the alias in her password manager. The implementation stops here if either backup is missing or cannot be opened.

- [ ] **Step 4: Upload the four GitHub secrets and configure the certificate digest**

```powershell
$keystorePath='D:\dev\_secrets\readany-shlai\readany-shlai-release.jks'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath)) | gh secret set SHLAI_ANDROID_KEYSTORE_BASE64 --env shlai-production --repo cha1latte/ReadAny
gh secret set SHLAI_ANDROID_KEYSTORE_PASSWORD --env shlai-production --repo cha1latte/ReadAny
gh secret set SHLAI_ANDROID_KEY_ALIAS --env shlai-production --repo cha1latte/ReadAny --body 'readany-shlai'
gh secret set SHLAI_ANDROID_KEY_PASSWORD --env shlai-production --repo cha1latte/ReadAny
gh secret list --env shlai-production --repo cha1latte/ReadAny
$certSha256 = Read-Host 'Paste the 64-character signing certificate SHA-256 digest without separators'
if ($certSha256 -notmatch '^[0-9A-Fa-f]{64}$') { throw 'Invalid certificate SHA-256 digest' }
gh variable set SHLAI_ANDROID_CERT_SHA256 --repo cha1latte/ReadAny --env shlai-production --body ($certSha256.ToUpperInvariant())
gh variable list --repo cha1latte/ReadAny --env shlai-production
```

The two password commands intentionally prompt Celia interactively. Secret verification checks only names and update timestamps, never values. `SHLAI_ANDROID_CERT_SHA256` is a non-secret environment variable and must match the fingerprint confirmed in Step 3; the release workflow fails before publication if it is missing, malformed, or different from the signed APK.

- [ ] **Step 5: Use a friend-owned fork, not a canonical collaborator invitation**

Do not use `SHLAI_FRIEND_LOGIN`, invite the friend, or grant canonical repository write access. The friend creates `<friend-login>/ReadAny` as a GitHub fork and follows the documented clone/remotes commands. Their pull requests target `cha1latte/ReadAny:main`; their comments and reviews remain advisory.

Expected: only Celia can write canonical branches or release assets, while the friend can contribute through fork pull requests and consume every public release.

- [ ] **Step 6: Protect `main` after the two PR checks have appeared once**

```powershell
$protection = @{
  required_status_checks = @{ strict = $true; contexts = @('Validate', 'Preview APK') }
  enforce_admins = $true
  required_pull_request_reviews = @{
    dismiss_stale_reviews = $true
    require_code_owner_reviews = $false
    required_approving_review_count = 0
  }
  restrictions = $null
  required_conversation_resolution = $true
  allow_force_pushes = $false
  allow_deletions = $false
} | ConvertTo-Json -Depth 6
$protection | gh api --method PUT repos/cha1latte/ReadAny/branches/main/protection --input -
gh api repos/cha1latte/ReadAny/branches/main/protection
```

Expected: direct pushes, force pushes, deletion, and administrator bypasses are blocked; `Validate`, `Preview APK`, and conversation resolution are required. Zero required approving reviews avoids deadlocking an owner-only repository; friend reviews/comments remain advisory and Celia explicitly approves every merge manually.

- [ ] **Step 7: Commit only the governance documentation**

```powershell
git add docs/readany-shlai/development.md
git commit -m "docs: document Shlai collaboration workflow"
```

Repository settings and secrets are external state and do not appear in the commit.

---

### Task 8: Publish and prove the first complete Shlai delivery cycle

**Files:**
- Modify only files required by validated review findings; do not add unrelated features.
- External artifacts: preview APK, stable `ReadAny-Shlai.apk`, GitHub Release `shlai-v1.3.5.1`.

**Interfaces:**
- Consumes: all code/workflows from Tasks 1-7, Pixel device `55311JEBF05878`, Obtainium, protected signing secrets, and Celia's explicit approval before merge and stable release.
- Produces: a Celia-approved merged fork PR, stable release, side-by-side installation proof, and an update path Celia and fork contributors can repeat without canonical write access.

- [ ] **Step 1: Run the complete local gate**

```powershell
pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
pnpm exec biome check packages/app-expo/scripts packages/app-expo/src/config packages/app-expo/src/lib/shlai-release.ts packages/app-expo/src/hooks/use-update-checker.ts packages/app-expo/src/screens/settings/AboutScreen.tsx packages/app-expo/src/screens/ProfileScreen.tsx packages/core/src/update
git diff --check upstream/main...HEAD
git status -sb
```

Expected: all tests/checks PASS and only intentional Shlai commits differ from upstream.

- [ ] **Step 2: Request an independent code and workflow review**

Dispatch a read-only reviewer with the design spec, base SHA from `upstream/main`, head SHA, exact package identities, secret boundaries, update routing, and workflow names. Fix every Critical or Important finding and rerun Step 1. Record Minor findings in the PR body if intentionally deferred.

- [ ] **Step 3: Push the implementation branch and open a draft PR into the fork**

```powershell
git push -u origin agent/readany-shlai-implementation
$prBody = @'
## Summary

- gives ReadAny Shlai stable, preview, and development Android identities isolated from official ReadAny
- routes in-app updates to signed ReadAny Shlai GitHub Releases
- adds Shlai branding, upstream attribution, and contributor documentation
- adds secret-free PR preview APKs, protected signed releases, and review-only upstream synchronization

## Verification

- core and Expo tests
- Expo TypeScript check
- scoped Biome check and `git diff --check`
- preview APK installed beside official ReadAny on Pixel 55311JEBF05878

## Manual gates

- stable signing remains blocked until both encrypted key backups are verified
- merge and first stable release each require Celia's explicit approval
'@
gh pr create --repo cha1latte/ReadAny --base main --head agent/readany-shlai-implementation --draft --title "feat: establish ReadAny Shlai Android fork" --body $prBody
```

Expected: the draft PR body records identity isolation, update routing, branding, preview builds, stable signing, upstream sync, tests, and manual gates without creating a temporary file.

- [ ] **Step 4: Let GitHub parse the workflows and download the preview artifact**

```powershell
$prNumber = gh pr view --repo cha1latte/ReadAny agent/readany-shlai-implementation --json number --jq '.number'
gh pr checks $prNumber --watch --repo cha1latte/ReadAny
$previewRunId = gh run list --repo cha1latte/ReadAny --workflow shlai-pr.yml --branch agent/readany-shlai-implementation --event pull_request --limit 1 --json databaseId --jq '.[0].databaseId'
gh run view $previewRunId --repo cha1latte/ReadAny
$previewArtifact = "ReadAny-Shlai-Preview-$prNumber"
gh run download $previewRunId --repo cha1latte/ReadAny --name $previewArtifact --dir D:\dev\_artifacts\readany-shlai-preview
```

Expected: `Validate` and `Preview APK` pass and the artifact named for this exact PR contains one APK.

When an automated sync PR created with `GITHUB_TOKEN`, or a first-time friend-fork PR, shows **Approve workflows**, Celia clicks that control in GitHub before waiting for checks. Do not add a PAT, dispatch workaround, or bootstrap push: the jobs already run on the `pull_request` event, which is not default-branch-only.

- [ ] **Step 5: Install and verify the preview without touching official ReadAny**

```powershell
$adb='D:\dev\_toolchains\readany-android\sdk\platform-tools\adb.exe'
$previewApk = "D:\dev\_artifacts\readany-shlai-preview\ReadAny-Shlai-Preview-$prNumber.apk"
& $adb install -r $previewApk
& $adb shell pm list packages | Select-String 'com.readany.app|io.github.cha1latte.readanyshlai'
```

Expected: official `com.readany.app` and preview `io.github.cha1latte.readanyshlai.preview` both exist. Open the preview and verify name/icon, empty isolated library, book import, normal chat, selected-text sparkle input above the keyboard, and keyboard dismissal/reopening.

- [ ] **Step 6: Mark the fork PR ready and merge only after Celia approves**

Do not infer merge permission from successful checks. Present the PR, preview proof, review findings, and remaining risks to Celia. After explicit approval:

```powershell
gh pr ready $prNumber --repo cha1latte/ReadAny
gh pr merge $prNumber --repo cha1latte/ReadAny --squash --delete-branch
```

Expected: fork `main` contains the complete Shlai implementation and branch protection remains active.

- [ ] **Step 7: Run the protected first stable release**

```powershell
gh workflow run "Release ReadAny Shlai" --repo cha1latte/ReadAny -f upstream_version=1.3.5 -f revision=1 -f version_code=1
Start-Sleep -Seconds 5
$releaseRunId = gh run list --repo cha1latte/ReadAny --workflow shlai-release.yml --branch main --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $releaseRunId --repo cha1latte/ReadAny --exit-status
gh release view shlai-v1.3.5.1 --repo cha1latte/ReadAny
```

Approve the `shlai-production` environment only after verifying the run targets fork `main`. Expected: one release asset named `ReadAny-Shlai.apk`, linked to the exact release commit.

- [ ] **Step 8: Install stable Shlai and verify side-by-side data isolation**

Download the release APK, verify its signature, install it, and confirm all three package identities:

```powershell
gh release download shlai-v1.3.5.1 --repo cha1latte/ReadAny --pattern ReadAny-Shlai.apk --dir D:\dev\_artifacts\readany-shlai-stable
$adb='D:\dev\_toolchains\readany-android\sdk\platform-tools\adb.exe'
& $adb install -r D:\dev\_artifacts\readany-shlai-stable\ReadAny-Shlai.apk
& $adb shell pm list packages | Select-String 'com.readany.app|io.github.cha1latte.readanyshlai'
```

Expected: official and stable Shlai coexist; official library/data remain unchanged; stable Shlai starts isolated; and book import, reading, AI setup, ordinary chat, sparkle input visibility, keyboard dismissal/reopening, and the chosen WebDAV/data-transfer path all pass. The first release records update-over-previous-version as not applicable; every later stable release must prove both preserved data and successful in-place update before approval.

- [ ] **Step 9: Configure and prove Obtainium updates**

On each phone, add `https://github.com/cha1latte/ReadAny` in Obtainium, select GitHub Releases as the source, and choose the `ReadAny-Shlai.apk` asset. Verify Obtainium reports installed version `1.3.5-shlai.1` and does not associate Shlai with official package `com.readany.app`.

Do not publish a fake second release merely to test polling. The next real Shlai release performs the update-over-previous-version check before approval.

- [ ] **Step 10: Trigger and inspect one upstream-sync dry run**

```powershell
gh workflow run "Shlai Upstream Sync" --repo cha1latte/ReadAny
Start-Sleep -Seconds 5
$syncRunId = gh run list --repo cha1latte/ReadAny --workflow shlai-upstream-sync.yml --branch main --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $syncRunId --repo cha1latte/ReadAny --exit-status
gh pr list --repo cha1latte/ReadAny --state open --search 'in:title "Sync official ReadAny upstream"'
```

Expected: the workflow either reports that upstream is already contained or opens exactly one non-auto-merged sync PR.

- [ ] **Step 11: Final handoff**

Report:

- fork and upstream PR URLs;
- final package IDs and schemes;
- branch protection and owner-only canonical write boundary;
- preview and stable workflow run URLs;
- release tag, APK asset, signature verification, and installed package proof;
- Obtainium result;
- upstream sync result;
- exact signing-key backup verification status without locations or secrets; and
- any remaining manual gap or risk.
