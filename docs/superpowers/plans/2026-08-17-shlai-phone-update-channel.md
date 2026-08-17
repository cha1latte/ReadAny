# Shlai Shared Phone Update Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one `ReadAny Shlai Preview` APK containing the metadata, MOBI, and OPDS work, then automatically publish an in-place update for Celia and Decidetto after every successful merge to `cha1latte/ReadAny:main`.

**Architecture:** Preserve the installed preview package and certificate lineage, integrate the three reviewed feature branches into the Shlai fork, and add a serialized main-only GitHub prerelease workflow. Make update discovery variant-aware: production continues using the stable release family, preview scans only canonical preview prereleases, and development disables public update checks. The Android client downloads the exact APK and checksum, verifies SHA-256 locally, and opens the system package installer for the required confirmation.

**Tech Stack:** TypeScript, React Native 0.81, Expo SDK 54, Vitest, Zustand, GitHub Actions, Gradle, Android `aapt2`/`apksigner`, `expo-file-system`, `expo-intent-launcher`, `@dr.pogodin/react-native-fs`, GitHub CLI, ADB.

## Global Constraints

- The canonical phone app remains `ReadAny Shlai Preview`, package `io.github.cha1latte.readanyshlai.preview`.
- Never uninstall the current preview package during migration or acceptance; updates use `adb install -r` or Android's installer.
- The first combined release has Android `versionCode=2`; every later canonical preview release strictly increments it.
- Canonical tags are `shlai-preview-vX.Y.Z.N`, with exact APK `ReadAny-Shlai-Preview.apk` and checksum `ReadAny-Shlai-Preview.apk.sha256`.
- Only successful `main` pushes or an owner-triggered retry on `refs/heads/main` may publish this phone channel.
- Pull-request APKs remain temporary review artifacts and never enter update discovery.
- Preview publication is secret-free and must retain the existing certificate SHA-256 digest `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Production identity, stable update discovery, stable signing, and `.github/workflows/shlai-release.yml` remain unchanged.
- Android always shows an explicit installer confirmation; silent installation is out of scope.
- Work is strict RED/GREEN TDD. Each product-code task records a failing focused test before its implementation.

---

### Task 1: Integrate the reviewed metadata, MOBI, and OPDS histories

**Files:**
- Merge: `fix/complete-book-metadata`
- Merge: `fix/mobi-vectorization`
- Merge: `feat/opds-catalogs`
- Resolve: `packages/app-expo/app.config.js`
- Resolve: `packages/app-expo/scripts/build-reader.js`
- Resolve: `packages/app-expo/src/lib/platform/expo-platform-service.ts`
- Resolve: `pnpm-lock.yaml`
- Verify generated: `packages/app-expo/assets/reader/reader.html`

**Interfaces:**
- Consumes: current `origin/main` Shlai identity, keyboard clearance, justified EPUB text, and OLED theme.
- Produces: one branch containing the exact reviewed commits behind upstream PRs #689, #690, and #693 without changing the preview package identity.

- [ ] **Step 1: Record the clean integration baseline and branch tips**

Run:

```powershell
git status --short
git rev-parse HEAD
git rev-parse fix/complete-book-metadata
git rev-parse fix/mobi-vectorization
git rev-parse feat/opds-catalogs
```

Expected: clean source tree; HEAD contains design commit `0bde7cb7`; feature tips are `665ef96f`, `afde9986`, and `ba7aefbb` respectively.

- [ ] **Step 2: Merge metadata and resolve the single known configuration conflict**

Run:

```powershell
git merge --no-ff fix/complete-book-metadata -m "merge: integrate complete book metadata"
```

Expected: only `packages/app-expo/app.config.js` has a content conflict. Resolve it so the existing Shlai variant identity/assets/version configuration remains intact while the plugin sequence contains:

```js
      "./plugins/withGradleMemory",
      "expo-font",
      [
        "expo-image-picker",
        {
          photosPermission: `${variant.name} uses your photo library to choose custom book covers.`,
        },
      ],
      "expo-secure-store",
      "expo-sqlite",
      "expo-asset",
      "./plugins/withOnnxruntimePackage",
      "onnxruntime-react-native",
      "./plugins/withVolumeKeyPaging",
```

Then stage and finish the merge:

```powershell
git add packages/app-expo/app.config.js packages/app-expo/package.json pnpm-lock.yaml packages
git commit --no-edit
```

Expected: a metadata merge commit with no unresolved entries from `git diff --name-only --diff-filter=U`.

- [ ] **Step 3: Merge MOBI and OPDS in dependency order**

Run:

```powershell
git merge --no-ff fix/mobi-vectorization -m "merge: integrate MOBI vectorization"
git merge --no-ff feat/opds-catalogs -m "merge: integrate OPDS catalogs"
```

Expected: both histories merge without dropping the Shlai app config or Task 1 metadata fixes. If a conflict appears, list it with `git diff --name-only --diff-filter=U`, then inspect the exact conflicted file with `git show :1:packages/app-expo/app.config.js`, `git show :2:packages/app-expo/app.config.js`, and `git show :3:packages/app-expo/app.config.js`. Stop and amend this plan if a different file conflicts; do not improvise a resolution without a written contract.

For the known MOBI conflict in `packages/app-expo/scripts/build-reader.js`, retain both owners:

```js
const JUSTIFIED_TEXT = path.resolve(ASSETS_DIR, "justified-text.js");
const EXTRACTION_SESSIONS = path.resolve(__dirname, "../src/lib/rag/reader-extraction-sessions.ts");
```

Keep the MOBI `ReaderExtractionSessions` entry import/window export and the Shlai `JUSTIFIED_TEXT_MARKER` injection/one-marker assertion. The rebuilt `reader.html` must contain both behaviors and remain deterministic.

For the known OPDS platform conflict, retain the shared imported `compareVersions`/`releaseTagToVersion` implementation from the Shlai side and retain OPDS's direct `secretGetItem`, `secretSetItem`, and `secretRemoveItem` SecureStore boundary. Drop OPDS's duplicate private `_compareVersions` method. For the lockfile conflict, retain OPDS's `jsdom@30.0.1` Vitest peer resolution (required by `packages/app`) and Shlai's direct `yaml@2.8.2` entry (required by workflow contract tests); confirm the combined result with `pnpm install --frozen-lockfile`.

- [ ] **Step 4: Run the integration-focused suites**

Run:

```powershell
$env:TZ='UTC'
pnpm --filter @readany/core test -- metadata mobi opds
pnpm --filter @readany/app-expo test -- imported-book-meta mobi opds shlai-app-config
pnpm --dir packages/app exec vitest run src
pnpm --filter @readany/app-expo run build:reader
git diff --exit-code -- packages/app-expo/assets/reader/reader.html
```

Expected: all focused suites pass and rebuilding the reader produces no uncommitted generated diff.

- [ ] **Step 5: Commit any deterministic merge-resolution adjustment**

If Step 4 required an integration adjustment, it must be confined to the known configuration owner/test or the OPDS library-store harness that now imports MOBI capability:

```powershell
git add packages/app-expo/app.config.js packages/app-expo/src/config/shlai-app-config.test.ts packages/app-expo/src/stores/library-store.opds.test.ts docs/superpowers/plans/2026-08-17-shlai-phone-update-channel.md
git commit -m "fix: preserve Shlai integration contracts"
```

Expected: no unrelated files are staged. If no adjustment was needed, do not create an empty commit.

---

### Task 2: Derive canonical preview release metadata

**Files:**
- Create: `packages/app-expo/scripts/shlai-preview-release.js`
- Create: `packages/app-expo/src/config/shlai-preview-release.test.ts`
- Create: `packages/app-expo/src/config/fixtures/no-preview-releases.json`

**Interfaces:**
- Produces: `derivePreviewRelease({ upstreamVersion, releases, baselineVersionCode }) -> { revision, tag, version, versionCode }`.
- Produces CLI: `node packages/app-expo/scripts/shlai-preview-release.js derive --version X.Y.Z --releases path.json --baseline-version-code 1`, writing `revision=`, `tag=`, `version=`, and `version_code=` lines.

- [ ] **Step 1: Write failing progression and rejection tests**

Create tests which require:

```ts
expect(derivePreviewRelease({ upstreamVersion: "1.3.6", releases: [], baselineVersionCode: 1 }))
  .toEqual({
    revision: 1,
    tag: "shlai-preview-v1.3.6.1",
    version: "1.3.6-shlai.1",
    versionCode: 2,
  });

expect(derivePreviewRelease({
  upstreamVersion: "1.3.6",
  baselineVersionCode: 1,
  releases: [canonicalRelease("shlai-preview-v1.3.6.4", 8)],
})).toEqual({
  revision: 5,
  tag: "shlai-preview-v1.3.6.5",
  version: "1.3.6-shlai.5",
  versionCode: 9,
});
```

Also assert rejection of whitespace, leading zeros, revision zero, duplicate canonical tags, drafts with the preview family, non-prerelease preview tags, missing or duplicate `Android versionCode: N` lines, `versionCode > 2100000000`, a repository version lower than the greatest canonical tuple, and an existing derived tag.

Create `packages/app-expo/src/config/fixtures/no-preview-releases.json` with the exact contents:

```json
[]
```

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
pnpm --filter @readany/app-expo test -- shlai-preview-release
```

Expected: FAIL because `shlai-preview-release.js` does not exist.

- [ ] **Step 3: Implement strict parsing, tuple comparison, and the CLI**

Implement these exports in CommonJS so both `app.config.js`-adjacent scripts and Vitest can load them:

```js
const PREVIEW_TAG = /^shlai-preview-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.([1-9]\d*)$/;
const UPSTREAM_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_CODE_LINE = /^Android versionCode: ([1-9]\d*)$/gm;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

function compareIntegerStrings(left, right) {
  if (left.length !== right.length) return left.length > right.length ? 1 : -1;
  return left === right ? 0 : left > right ? 1 : -1;
}

function compareTuples(left, right) {
  for (let index = 0; index < 4; index += 1) {
    const compared = compareIntegerStrings(left[index], right[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}
```

Treat any release whose tag starts with `shlai-preview-v` but is not a canonical, nondraft prerelease with exactly one canonical version-code line as malformed history and throw. Ignore unrelated release families. Flatten GitHub `--slurp` pagination arrays before parsing. Start at version code `2` when there is no canonical preview history.

- [ ] **Step 4: Run focused tests GREEN and exercise the CLI**

Run:

```powershell
pnpm --filter @readany/app-expo test -- shlai-preview-release
node packages/app-expo/scripts/shlai-preview-release.js derive --version 1.3.6 --releases packages/app-expo/src/config/fixtures/no-preview-releases.json --baseline-version-code 1
```

Expected: tests pass; CLI prints the four canonical output lines for revision 1/version code 2.

- [ ] **Step 5: Commit release derivation**

```powershell
git add packages/app-expo/scripts/shlai-preview-release.js packages/app-expo/src/config/shlai-preview-release.test.ts packages/app-expo/src/config/fixtures/no-preview-releases.json
git commit -m "feat(ci): derive Shlai preview releases"
```

---

### Task 3: Make update discovery variant-aware and release-family strict

**Files:**
- Modify: `packages/core/src/update/update-checker.ts`
- Modify: `packages/core/src/update/update-checker.test.ts`
- Modify: `packages/core/src/update/index.ts`
- Modify: `packages/app-expo/app.config.js`
- Modify: `packages/app-expo/src/lib/shlai-release.ts`
- Modify: `packages/app-expo/src/lib/shlai-release.test.ts`
- Modify: `packages/app-expo/src/hooks/update-checker-task.ts`
- Modify: `packages/app-expo/src/hooks/use-update-checker.ts`
- Modify: `packages/app-expo/src/hooks/use-update-checker.test.ts`
- Modify: `packages/app-expo/src/screens/settings/AboutScreen.tsx`
- Modify: `packages/app-expo/src/components/update/UpdateDialog.tsx`
- Modify: `packages/app-expo/src/lib/platform/expo-platform-service.ts`
- Modify: `packages/app-expo/src/lib/platform/expo-platform-service.test.ts`
- Modify: `packages/app-expo/src/config/shlai-app-config.test.ts`

**Interfaces:**
- Extends `UpdateCheckOptions` with `releaseMode?: "single" | "canonical-prerelease-list"`, `checksumAssetName?: string`, and `maxPages?: number`.
- Changes `getShlaiReleaseConfig()` to return `ShlaiReleaseConfig | null`; `null` means public update discovery is disabled.
- Preview config uses `https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100`, prefix `shlai-preview-v`, APK `ReadAny-Shlai-Preview.apk`, checksum `ReadAny-Shlai-Preview.apk.sha256`, and a preview-specific throttle key.

- [ ] **Step 1: Write failing core release-family tests**

Add tests proving:

```ts
const result = await checkForUpdate("1.3.6-shlai.1", platform, true, {
  apiUrl: "https://api.github.com/repos/cha1latte/ReadAny/releases?per_page=100",
  tagPrefix: "shlai-preview-v",
  releaseMode: "canonical-prerelease-list",
  assetName: "ReadAny-Shlai-Preview.apk",
  checksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
});
expect(result.latestVersion).toBe("1.3.6.3");
```

The fixture must include a lower valid preview, a higher draft, a stable release, a malformed preview tag, wrong APK/checksum names, and a valid highest preview. Assert stable `shlai-v` discovery still consumes one object from `/releases/latest`, preview follows an RFC 8288 `Link: <https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next"` header up to `maxPages`, and malformed JSON/network failure/checksum absence do not write the throttle.

- [ ] **Step 2: Write failing Expo variant tests**

Require these exact outcomes from mocked `Constants.expoConfig.extra`:

```ts
expect(getShlaiReleaseConfigForExtra({ appVariant: "development" })).toBeNull();
expect(getShlaiReleaseConfigForExtra({ appVariant: "preview" })).toMatchObject({
  tagPrefix: "shlai-preview-v",
  releaseMode: "canonical-prerelease-list",
  assetName: "ReadAny-Shlai-Preview.apk",
  checksumAssetName: "ReadAny-Shlai-Preview.apk.sha256",
});
expect(getShlaiReleaseConfigForExtra({ appVariant: "production" })).toMatchObject({
  tagPrefix: "shlai-v",
  releaseMode: "single",
  assetName: "ReadAny-Shlai.apk",
});
```

Assert the scheduler performs no platform/version/network work when config is `null` and About hides its public-update action in development.

- [ ] **Step 3: Run focused tests and capture RED**

```powershell
$env:TZ='UTC'
pnpm --filter @readany/core test -- update-checker
pnpm --filter @readany/app-expo test -- shlai-release use-update-checker shlai-app-config
```

Expected: FAIL on the missing list-selection options and variant-aware config.

- [ ] **Step 4: Implement canonical list selection without weakening stable behavior**

Use a small internal selector:

```ts
function selectCanonicalPrerelease(
  releases: GitHubRelease[],
  tagPrefix: string,
  requiredAssets: readonly string[],
): GitHubRelease | null {
  const valid = releases.filter((release) =>
    release.draft === false &&
    release.prerelease === true &&
    releaseTagToVersion(release.tag_name, tagPrefix) !== null &&
    requiredAssets.every((name) => release.assets?.some((asset) => asset.name === name)),
  );
  return valid.sort((left, right) =>
    compareVersions(
      releaseTagToVersion(right.tag_name, tagPrefix)!,
      releaseTagToVersion(left.tag_name, tagPrefix)!,
    ),
  )[0] ?? null;
}
```

Support `shlai-preview-v` as a four-component canonical prefix in `releaseTagToVersion`. Fetch subsequent list pages only from the parsed `rel="next"` URL, reject non-HTTPS or non-`api.github.com` next links, cap at `maxPages ?? 10`, and write the throttle only after a valid required-asset release is parsed.

- [ ] **Step 5: Implement variant config and null scheduling**

Put a pure `getShlaiReleaseConfigForExtra(extra)` beside `getShlaiReleaseConfig()`. Configure preview extras in `app.config.js`; keep production extras byte-for-byte equivalent to the current endpoint/family. Have the hook and About screen skip update operations when config is null.

- [ ] **Step 6: Run focused suites GREEN**

```powershell
$env:TZ='UTC'
pnpm --filter @readany/core test -- update-checker
pnpm --filter @readany/app-expo test -- shlai-release use-update-checker shlai-app-config
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
```

Expected: focused tests and Expo TypeScript pass; stable tests remain unchanged and green.

- [ ] **Step 7: Commit variant-aware discovery**

```powershell
git add packages/core/src/update packages/app-expo/app.config.js packages/app-expo/src/lib/shlai-release.ts packages/app-expo/src/lib/shlai-release.test.ts packages/app-expo/src/hooks packages/app-expo/src/screens/settings/AboutScreen.tsx packages/app-expo/src/config/shlai-app-config.test.ts
git commit -m "feat(update): add Shlai preview discovery"
```

---

### Task 4: Download, verify, and hand the APK to Android's installer

**Files:**
- Modify: `packages/app-expo/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/app-expo/app.config.js`
- Create: `packages/app-expo/src/lib/shlai-apk-installer.ts`
- Create: `packages/app-expo/src/lib/shlai-apk-installer.test.ts`
- Modify: `packages/app-expo/src/components/update/UpdateDialog.tsx`
- Create: `packages/app-expo/src/components/update/UpdateDialog.test.tsx`
- Modify: `packages/app-expo/src/stores/update-store.ts`

**Interfaces:**
- Produces `installShlaiPreviewUpdate(input, dependencies): Promise<void>` where input contains the canonical tag, APK asset, and checksum asset.
- Uses `@dr.pogodin/react-native-fs.hash(path, "sha256")` for native file hashing, `expo-file-system/legacy.getContentUriAsync`, and `expo-intent-launcher.startActivityAsync`.

- [ ] **Step 1: Write failing installer boundary tests**

Test exact ordering and hard failures with injected dependencies:

```ts
await installShlaiPreviewUpdate(validInput, deps);
expect(calls).toEqual([
  "validate-urls",
  "delete-stale-apk",
  "download-checksum",
  "parse-checksum",
  "download-apk",
  "hash-apk",
  "content-uri",
  "launch-installer",
]);
```

Assert no installer launch on wrong GitHub owner/repository/tag/asset URL, HTTP downgrade, checksum filename mismatch, malformed checksum text, uppercase or multiple digest lines, download failure, or hash mismatch. Assert the required checksum line is exactly `64-lowercase-hex + two spaces + ReadAny-Shlai-Preview.apk` and that errors leave the dialog open with a retryable message.

- [ ] **Step 2: Write failing rendered dialog tests**

Require Download to become disabled and show progress while work is active, prevent double taps, show `Verifying…` before installer launch, retain Later while idle, and call `hideDialog()` only after the installer intent resolves.

- [ ] **Step 3: Run focused tests and capture RED**

```powershell
pnpm --filter @readany/app-expo test -- shlai-apk-installer UpdateDialog
```

Expected: FAIL because the installer service and rendered contract do not exist.

- [ ] **Step 4: Add the SDK-matched installer dependency and permission**

Run:

```powershell
pnpm --filter @readany/app-expo add expo-intent-launcher@~13.0.8
```

Add `android.permission.REQUEST_INSTALL_PACKAGES` to `expo.android.permissions`. Do not add broad storage permissions.

- [ ] **Step 5: Implement exact-source download and native SHA-256 verification**

Validate asset URLs against:

```ts
const expectedPath = `/cha1latte/ReadAny/releases/download/${tag}/${assetName}`;
const parsed = new URL(downloadUrl);
if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.pathname !== expectedPath) {
  throw new Error("Unexpected Shlai update source");
}
```

Download into `FileSystem.cacheDirectory + "ReadAny-Shlai-Preview.apk"`; normalize `file://` before calling native `hash`; compare lowercase digests with constant-time character accumulation; convert to a content URI; then invoke:

```ts
await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
  data: contentUri,
  type: "application/vnd.android.package-archive",
  flags: 1,
});
```

Never fall back to opening an unverified browser URL. A retry may delete only this exact cache file.

- [ ] **Step 6: Wire dialog state and translations**

Represent state as:

```ts
type UpdateInstallState =
  | { status: "idle" }
  | { status: "downloading"; progress: number | null }
  | { status: "verifying" }
  | { status: "opening-installer" }
  | { status: "error"; message: string };
```

Keep progress ephemeral. Do not persist APK paths, checksum text, or failure objects. Preserve version dismissal semantics only for the Later action.

- [ ] **Step 7: Run focused tests and native config proof GREEN**

```powershell
pnpm --filter @readany/app-expo test -- shlai-apk-installer UpdateDialog shlai-app-config
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
$env:APP_VARIANT='preview'
$env:SHLAI_UPSTREAM_VERSION='1.3.6'
$env:SHLAI_REVISION='1'
$env:SHLAI_VERSION_CODE='2'
pnpm --filter @readany/app-expo exec expo config --type public
```

Expected: tests and TypeScript pass; public config shows the preview package, version code 2, and install-packages permission.

- [ ] **Step 8: Commit installer flow**

```powershell
git add packages/app-expo/package.json pnpm-lock.yaml packages/app-expo/app.config.js packages/app-expo/src/lib/shlai-apk-installer.ts packages/app-expo/src/lib/shlai-apk-installer.test.ts packages/app-expo/src/components/update packages/app-expo/src/stores/update-store.ts
git commit -m "feat(update): verify and install preview APKs"
```

---

### Task 5: Publish a verified preview prerelease from main

**Files:**
- Create: `.github/workflows/shlai-phone-release.yml`
- Modify: `packages/app-expo/src/config/shlai-workflows.test.ts`

**Interfaces:**
- Consumes Task 2 CLI outputs `revision`, `tag`, `version`, and `version_code`.
- Publishes exactly one APK and one checksum to a GitHub prerelease targeted at the validated main SHA.

- [ ] **Step 1: Add a failing parsed-YAML contract**

Require the workflow to have exactly `push.branches: [main]` and `workflow_dispatch`, read-only top-level permissions, concurrency `{ group: "shlai-phone-release", cancel-in-progress: false }`, a main-ref guard, and jobs `validate`, `metadata`, `build`, `publish`. Assert:

```ts
expect(build.env.APP_VARIANT).toBe("preview");
expect(build.steps.map((step) => step.run).join("\n")).toContain("assembleRelease");
expect(publish.permissions).toEqual({ contents: "write" });
expect(serializedRuns).toContain('sha256sum "ReadAny-Shlai-Preview.apk"');
expect(serializedRuns).toContain('gh release create "$TAG"');
expect(JSON.stringify(workflow)).not.toMatch(/\bsecrets\b/i);
```

Also mutate away each guard—main-only condition, pagination, prerelease flag, package assertion, version-code assertion, certificate digest, checksum asset, exact APK name, action SHA pin, or job dependency—and assert the contract rejects it.

- [ ] **Step 2: Run workflow tests and capture RED**

```powershell
pnpm --filter @readany/app-expo test -- shlai-workflows
```

Expected: FAIL because `shlai-phone-release.yml` is missing.

- [ ] **Step 3: Implement the main-only workflow**

Use pinned versions already accepted in `shlai-pr.yml`. The metadata job must run:

```bash
test "$GITHUB_REF" = "refs/heads/main"
UPSTREAM_VERSION="$(node -p "require('./packages/app-expo/package.json').version")"
gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" --slurp > "$RUNNER_TEMP/releases.json"
node packages/app-expo/scripts/shlai-preview-release.js derive \
  --version "$UPSTREAM_VERSION" \
  --releases "$RUNNER_TEMP/releases.json" \
  --baseline-version-code 1 >> "$GITHUB_OUTPUT"
```

Set `GH_TOKEN: ${{ github.token }}` only on the metadata step that reads releases and the publish step that creates the release. Do not expose it to build commands or third-party actions.

The build job exports the derived values as `SHLAI_UPSTREAM_VERSION`, `SHLAI_REVISION`, and `SHLAI_VERSION_CODE`, builds the standalone arm64 release APK, and stages the exact asset. Verify with Android build tools:

```bash
PACKAGE="$($AAPT2 dump badging ReadAny-Shlai-Preview.apk | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
VERSION_CODE="$($AAPT2 dump badging ReadAny-Shlai-Preview.apk | sed -n "s/^package:.*versionCode='\([^']*\)'.*/\1/p")"
test "$PACKAGE" = "io.github.cha1latte.readanyshlai.preview"
test "$VERSION_CODE" = "$SHLAI_VERSION_CODE"
DIGEST="$($APKSIGNER verify --verbose --print-certs ReadAny-Shlai-Preview.apk | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"
test "$DIGEST" = "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c"
test "$(printf '%s\n' "$DIGEST" | wc -l | tr -d ' ')" = "1"
sha256sum "ReadAny-Shlai-Preview.apk" > "ReadAny-Shlai-Preview.apk.sha256"
```

The publish job downloads only the build artifact, repeats package/version/certificate/checksum verification, rejects an existing exact tag, and creates:

```bash
NOTES="$(printf 'Unofficial ReadAny Shlai Preview Android release. Source: %s/%s/tree/%s\n\nAndroid versionCode: %s' "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_SHA" "$SHLAI_VERSION_CODE")"
gh release create "$TAG" \
  ReadAny-Shlai-Preview.apk \
  ReadAny-Shlai-Preview.apk.sha256 \
  --repo "$GITHUB_REPOSITORY" \
  --target "$GITHUB_SHA" \
  --title "ReadAny Shlai Preview $VERSION" \
  --notes "$NOTES" \
  --prerelease
```

- [ ] **Step 4: Run parsed-YAML and release-script suites GREEN**

```powershell
pnpm --filter @readany/app-expo test -- shlai-workflows shlai-preview-release
pnpm exec biome check packages/app-expo/src/config/shlai-workflows.test.ts packages/app-expo/src/config/shlai-preview-release.test.ts packages/app-expo/scripts/shlai-preview-release.js
```

Expected: all workflow adversarial mutations and release derivation tests pass.

- [ ] **Step 5: Commit the publication workflow**

```powershell
git add .github/workflows/shlai-phone-release.yml packages/app-expo/src/config/shlai-workflows.test.ts
git commit -m "feat(ci): publish Shlai phone updates"
```

---

### Task 6: Document the shared install and future-update workflow

**Files:**
- Modify: `docs/readany-shlai/development.md`
- Create: `docs/readany-shlai/phone-updates.md`
- Modify: `README.md`
- Test: `packages/app-expo/src/config/shlai-workflows.test.ts`

**Interfaces:**
- Produces the permanent Decidetto first-install URL and the owner workflow for future fixes.

- [ ] **Step 1: Add a failing documentation contract**

Require `phone-updates.md` to contain the exact package, asset, release-family URL, checksum command, Android confirmation limitation, `main` publication boundary, PR-artifact warning, data-preserving update rule, debug-certificate limitation, rollback behavior, and Decidetto instructions.

- [ ] **Step 2: Run the contract and capture RED**

```powershell
pnpm --filter @readany/app-expo test -- shlai-workflows
```

Expected: FAIL because `docs/readany-shlai/phone-updates.md` is absent.

- [ ] **Step 3: Write exact operator and friend instructions**

Document these two user paths verbatim in substance:

```text
Decidetto: open https://github.com/cha1latte/ReadAny/releases, choose the newest
shlai-preview-v… prerelease, download ReadAny-Shlai-Preview.apk, allow installs
from the browser when Android asks, and confirm Install. Later releases appear
inside ReadAny Shlai Preview; tap Download update and confirm the Android installer.

Future fixes: branch from cha1latte/main, commit and push the fix, open a PR into
cha1latte/main, wait for Shlai Pull Request validation, review its temporary APK,
then merge. Only that merge publishes the shared phone update. Never send a PR
artifact to Decidetto as a permanent update.
```

Include recovery: a failed workflow publishes nothing; repair on a new reviewed commit or rerun the workflow on main; never delete or overwrite an existing release/tag.

- [ ] **Step 4: Run docs/workflow checks GREEN**

```powershell
pnpm --filter @readany/app-expo test -- shlai-workflows
git diff --check
```

Expected: documentation contract and whitespace checks pass.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md docs/readany-shlai/development.md docs/readany-shlai/phone-updates.md packages/app-expo/src/config/shlai-workflows.test.ts
git commit -m "docs: explain Shlai phone updates"
```

---

### Task 7: Run the combined verification and ship the integration PR

**Files:**
- Verify all files changed from `origin/main...HEAD`
- PR target: `cha1latte/ReadAny:main`

**Interfaces:**
- Produces a reviewed, green integration PR whose merge triggers Task 5's phone release workflow.

- [ ] **Step 1: Run full repository gates from a clean dependency install**

```powershell
pnpm install --frozen-lockfile
$env:TZ='UTC'
pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
pnpm --dir packages/app exec vitest run src
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
pnpm --filter app build
pnpm --filter @readany/app-expo run build:reader
git diff --exit-code -- packages/app-expo/assets/reader/reader.html
```

Expected: every suite/build passes and the generated reader is deterministic.

- [ ] **Step 2: Run exact changed-file formatting and diff checks**

```powershell
$files = git diff --name-only --diff-filter=ACMR origin/main...HEAD -- '*.js' '*.jsx' '*.ts' '*.tsx' '*.json' '*.css'
pnpm exec biome check --no-errors-on-unmatched $files
git diff --check origin/main...HEAD
git status --short
```

Expected: Biome and diff checks pass; only intentional files are present and the tree is clean.

- [ ] **Step 3: Review the entire combined range**

Inspect:

```powershell
git diff --stat origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
git diff origin/main...HEAD -- packages/app-expo/app.config.js .github/workflows packages/core/src/update packages/app-expo/src/lib packages/app-expo/src/components/update
```

Confirm there is no package/signature/production-channel drift, no secret exposure, no cross-family update, no loss of any prior Shlai fix, and no untested publication path. Fix any confirmed finding with RED/GREEN and a focused commit before continuing.

- [ ] **Step 4: Push and open the integration PR**

```powershell
git push -u origin agent/shlai-phone-updates
$prBody = @'
## Summary
- combines complete Book Details metadata, MOBI/AZW/AZW3 vectorization, and OPDS catalogs with the existing Shlai keyboard, justified-text, and OLED fixes
- makes ReadAny Shlai Preview the one shared Android app for Celia and Decidetto
- publishes a checksum-verified preview prerelease only after a successful main merge

## Verification
- full UTC core, Expo, and desktop suites
- Expo TypeScript and desktop production build
- changed-file Biome and generated-reader determinism
- adversarial parsed-YAML, release progression, release-family, checksum, and installer tests

## Distribution boundary
This preserves the existing preview package and Android debug-certificate lineage so current app data can update in place. It is a preview-grade public channel, not the separate production signing boundary. Android still requires an explicit installer confirmation.

## Live proof
Pixel 9a in-place installation and the second-release in-app update loop are the post-merge acceptance gate because the main-only release does not exist before merge.

## Official upstream work
- codedogQBY/ReadAny#689
- codedogQBY/ReadAny#690
- codedogQBY/ReadAny#693
'@
gh pr create --repo cha1latte/ReadAny --base main --head agent/shlai-phone-updates --title "feat: ship shared Shlai phone updates" --body $prBody
```

The approved PR body above is the external text contract. Do not create a tracked PR-body file.

- [ ] **Step 5: Wait for hosted checks and make the PR ready**

```powershell
$prNumber = gh pr view --repo cha1latte/ReadAny agent/shlai-phone-updates --json number --jq .number
gh pr checks --repo cha1latte/ReadAny --watch $prNumber
gh pr view --repo cha1latte/ReadAny $prNumber --json mergeable,reviewDecision,statusCheckRollup
```

Expected: required checks are successful and GitHub reports the PR mergeable. Address any real final-head finding with a regression test and rerun all affected gates.

- [ ] **Step 6: Merge only the green final head**

```powershell
gh pr merge --repo cha1latte/ReadAny $prNumber --merge
$mergeSha = gh pr view --repo cha1latte/ReadAny $prNumber --json mergeCommit --jq .mergeCommit.oid
```

Expected: PR is merged to `main`; record the exact merge SHA. Do not merge any of the official upstream PRs.

---

### Task 8: Publish, install in place, and prove the real phone update loop

**Files/Systems:**
- GitHub workflow: `.github/workflows/shlai-phone-release.yml`
- Release assets in `cha1latte/ReadAny`
- Pixel 9a: ADB serial `55311JEBF05878`
- Installed package: `io.github.cha1latte.readanyshlai.preview`

**Interfaces:**
- Consumes the merged main SHA and canonical prerelease.
- Produces live evidence that current data survives, MOBI/OPDS work, and the next release updates through the in-app flow.

- [ ] **Step 1: Capture the pre-install phone baseline without modifying data**

```powershell
D:\dev\_toolchains\readany-android\sdk\platform-tools\adb.exe -s 55311JEBF05878 shell dumpsys package io.github.cha1latte.readanyshlai.preview
D:\dev\_toolchains\readany-android\sdk\platform-tools\adb.exe -s 55311JEBF05878 shell am force-stop io.github.cha1latte.readanyshlai.preview
```

Record version name/code, package presence, and UI screenshots showing Hitchhiker, Dracula, selected theme, and reading progress. Do not use `pm uninstall`, `pm clear`, or delete app files.

- [ ] **Step 2: Wait for the exact merge SHA's canonical prerelease**

```powershell
gh run list --repo cha1latte/ReadAny --workflow shlai-phone-release.yml --commit $mergeSha --json databaseId,status,conclusion,headSha
$runId = gh run list --repo cha1latte/ReadAny --workflow shlai-phone-release.yml --commit $mergeSha --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch --repo cha1latte/ReadAny $runId
gh release view --repo cha1latte/ReadAny shlai-preview-v1.3.6.1 --json tagName,isPrerelease,targetCommitish,assets,body
```

Expected: successful run, target is the exact merge SHA, prerelease true, one exact APK, one checksum, and one `Android versionCode: 2` line.

- [ ] **Step 3: Independently verify and install the APK with replace semantics**

```powershell
gh release download --repo cha1latte/ReadAny shlai-preview-v1.3.6.1 --pattern 'ReadAny-Shlai-Preview.apk*' --dir D:\dev\ReadAny-shlai-artifacts\phone-release-1
Get-FileHash D:\dev\ReadAny-shlai-artifacts\phone-release-1\ReadAny-Shlai-Preview.apk -Algorithm SHA256
D:\dev\_toolchains\readany-android\sdk\build-tools\35.0.0\aapt2.exe dump badging D:\dev\ReadAny-shlai-artifacts\phone-release-1\ReadAny-Shlai-Preview.apk
D:\dev\_toolchains\readany-android\sdk\build-tools\35.0.0\apksigner.bat verify --verbose --print-certs D:\dev\ReadAny-shlai-artifacts\phone-release-1\ReadAny-Shlai-Preview.apk
D:\dev\_toolchains\readany-android\sdk\platform-tools\adb.exe -s 55311JEBF05878 install -r D:\dev\ReadAny-shlai-artifacts\phone-release-1\ReadAny-Shlai-Preview.apk
```

Expected: checksum matches the published file; package/certificate are exact; versionCode is 2; ADB reports `Success` without uninstalling.

- [ ] **Step 4: Complete live combined-feature acceptance**

Open the app and prove:

```text
Hitchhiker and Dracula remain in the library.
Existing reading progress, credentials, model selection, and theme remain.
The existing DRM-free Hitchhiker MOBI reaches Indexed and answers a vector search.
Project Gutenberg and Chinese Gutenberg open, search, and import a book.
The imported book has readable Book Details metadata.
The AI text box remains visible with the keyboard and Deep Thinking/Spoiler-Free controls visible.
EPUB body text is justified.
OLED Black is selectable and uses a truly black background.
```

Capture screenshots and relevant filtered logcat. A device failure blocks completion; do not replace it with unit-test claims.

- [ ] **Step 5: Publish a second harmless increment from the same main SHA**

```powershell
gh workflow run shlai-phone-release.yml --repo cha1latte/ReadAny --ref main
gh run list --repo cha1latte/ReadAny --workflow shlai-phone-release.yml --branch main --limit 1 --json databaseId,status,conclusion,headSha
$secondRunId = gh run list --repo cha1latte/ReadAny --workflow shlai-phone-release.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch --repo cha1latte/ReadAny $secondRunId
```

Expected: `shlai-preview-v1.3.6.2`, versionCode 3, same source SHA, exact package/certificate/assets, and no mutation of the first release.

- [ ] **Step 6: Prove the in-app updater end to end**

On the first combined build, open Settings → About → Check for updates. Tap Download update. Verify the app shows download and verification progress, Android's installer opens, and no browser fallback is used. Confirm the installer, reopen the app, and verify versionCode 3 plus the same books/settings.

Expected: the second build replaces the first, the library remains intact, and the update prompt no longer offers the installed version.

- [ ] **Step 7: Hand off the stable friend workflow**

Send Decidetto:

```text
https://github.com/cha1latte/ReadAny/releases
```

Tell them to choose the newest `shlai-preview-v…` prerelease and download only `ReadAny-Shlai-Preview.apk`. After their first install, later approved updates appear inside the app and require one Android confirmation. Record the exact first release link in the final handoff.

---

## Final completion proof

Completion requires all of the following at the same final main SHA or its deterministic release rerun:

```text
[ ] Combined source branch and integration PR are merged.
[ ] Core, Expo, desktop, TypeScript, Biome, reader determinism, and workflow contracts pass.
[ ] Canonical preview release 1 installs over versionCode 1 with ADB replace semantics.
[ ] Pixel data survives and MOBI, OPDS, metadata, keyboard, justification, and OLED pass live checks.
[ ] Canonical preview release 2 is discovered, checksum-verified, and installed from inside the app.
[ ] Decidetto has the permanent public release link and future-update instructions.
[ ] Official upstream PRs #689, #690, and #693 remain independent and ready for maintainer review.
```
