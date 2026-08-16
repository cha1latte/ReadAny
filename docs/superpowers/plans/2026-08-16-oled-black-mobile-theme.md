# OLED Black Mobile Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted OLED Black mobile theme with true-black app and reader backgrounds while preserving dark-gray elevated surfaces and every existing theme.

**Architecture:** Extend the Expo app's centralized `ThemeMode` and palette map with an `oled` entry, then expose that mode through the two existing theme pickers. Pass the new mode through the existing reader bridge and treat it as dark for navigation, status-bar, illustration, and PDF behavior while using a dedicated pure-black PDF inversion filter.

**Tech Stack:** React Native 0.81, Expo 54, React Context, Expo SecureStore, React Navigation, i18next JSON locales, Foliate reader WebView, Vitest, TypeScript, Biome.

## Global Constraints

- OLED Black is a fourth option; do not replace or change Light, Dark, or Sepia.
- `oledColors.background` must be exactly `#000000`.
- Cards, dialogs, inputs, borders, text, accents, highlights, and fallback-cover colors must retain the current Dark palette values.
- OLED applies throughout the Expo app, EPUB reader, and PDF reader; desktop/Tauri is out of scope.
- Both `dark` and `oled` must follow dark-mode behavioral branches.
- Theme choices must use a two-column, two-row phone layout in onboarding and Appearance settings.
- All seven existing settings locales must include the OLED Black label.
- Use TDD: capture the intended failure before each implementation slice.

---

### Task 1: Theme Model, Persistence, and Dark Semantics

**Files:**
- Create: `packages/app-expo/src/styles/oled-theme-contract.test.ts`
- Modify: `packages/app-expo/src/styles/ThemeContext.tsx`
- Modify: `packages/app-expo/src/App.tsx`

**Interfaces:**
- Produces: `ThemeMode = "light" | "dark" | "sepia" | "oled"`
- Produces: `oledColors: ThemeColors` and `THEME_MAP.oled`
- Produces: `ThemeContextValue.isDark === true` for `dark` and `oled`
- Consumes: existing SecureStore key `readany-theme`

- [ ] **Step 1: Write the failing theme-model test**

Create `packages/app-expo/src/styles/oled-theme-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("OLED Black mobile theme", () => {
  it("defines, restores, and maps OLED as a dark theme with a pure-black background", () => {
    const context = read("packages/app-expo/src/styles/ThemeContext.tsx");
    const app = read("packages/app-expo/src/App.tsx");

    expect(context).toContain('export type ThemeMode = "light" | "dark" | "sepia" | "oled"');
    expect(context).toMatch(/const oledColors: ThemeColors = \{[\s\S]*?\.\.\.darkColors,[\s\S]*?background: "#000000"/);
    expect(context).toMatch(/oled: oledColors/);
    expect(context).toMatch(/saved === "oled"/);
    expect(context).toContain('isDark: mode === "dark" || mode === "oled"');
    expect(app).toContain('<StatusBar style={isDark ? "light" : "dark"} />');
  });
});
```

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/styles/oled-theme-contract.test.ts -t "defines, restores, and maps"
```

Expected: FAIL because `oled` is absent from the mode, palette, persistence validation, and dark branches.

- [ ] **Step 3: Implement the minimal theme model**

In `ThemeContext.tsx`, make these exact structural changes:

```ts
export type ThemeMode = "light" | "dark" | "sepia" | "oled";

const oledColors: ThemeColors = {
  ...darkColors,
  background: "#000000",
};

const THEME_MAP: Record<ThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
  sepia: sepiaColors,
  oled: oledColors,
};
```

Accept the stored value without altering existing values:

```ts
if (saved === "light" || saved === "dark" || saved === "sepia" || saved === "oled") {
  setModeState(saved);
}
```

Set dark semantics and export the palette:

```ts
isDark: mode === "dark" || mode === "oled",
```

```ts
export { lightColors, darkColors, sepiaColors, oledColors, THEME_MAP };
```

In `App.tsx`, make status-bar behavior use the derived dark semantic:

```tsx
<StatusBar style={isDark ? "light" : "dark"} />
```

- [ ] **Step 4: Run the focused test and TypeScript**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/styles/oled-theme-contract.test.ts -t "defines, restores, and maps"
pnpm --filter @readany/app-expo exec tsc --noEmit
```

Expected: focused test PASS; TypeScript PASS.

- [ ] **Step 5: Commit the theme model**

```powershell
git add -- packages/app-expo/src/styles/oled-theme-contract.test.ts packages/app-expo/src/styles/ThemeContext.tsx packages/app-expo/src/App.tsx
git commit -m "feat(mobile): add OLED black theme model"
```

---

### Task 2: Theme Pickers and Localized Copy

**Files:**
- Modify: `packages/app-expo/src/styles/oled-theme-contract.test.ts`
- Modify: `packages/app-expo/src/screens/settings/AppearanceSettingsScreen.tsx`
- Modify: `packages/app-expo/src/components/onboarding/steps/AppearancePage.tsx`
- Modify: `packages/core/src/i18n/locales/en/settings.json`
- Modify: `packages/core/src/i18n/locales/es/settings.json`
- Modify: `packages/core/src/i18n/locales/fr/settings.json`
- Modify: `packages/core/src/i18n/locales/ja/settings.json`
- Modify: `packages/core/src/i18n/locales/ko/settings.json`
- Modify: `packages/core/src/i18n/locales/zh/settings.json`
- Modify: `packages/core/src/i18n/locales/zh-TW/settings.json`

**Interfaces:**
- Consumes: `ThemeMode` and `setMode(mode: ThemeMode)` from Task 1
- Produces: `settings.oled` in all supported locales
- Produces: two-column theme selectors in both selection entry points

- [ ] **Step 1: Add the failing picker and translation test**

Append inside the existing `describe` block:

```ts
  it("offers OLED in both phone-safe theme pickers and every settings locale", () => {
    const settings = read("packages/app-expo/src/screens/settings/AppearanceSettingsScreen.tsx");
    const onboarding = read("packages/app-expo/src/components/onboarding/steps/AppearancePage.tsx");

    for (const source of [settings, onboarding]) {
      expect(source).toMatch(/id: "oled"/);
      expect(source).toMatch(/flexWrap: "wrap"/);
      expect(source).toMatch(/width: "48%"/);
    }

    const labels = {
      en: "OLED Black",
      es: "Negro OLED",
      fr: "Noir OLED",
      ja: "OLEDブラック",
      ko: "OLED 블랙",
      zh: "OLED 纯黑",
      "zh-TW": "OLED 純黑",
    } as const;

    for (const [locale, label] of Object.entries(labels)) {
      const messages = JSON.parse(
        read(`packages/core/src/i18n/locales/${locale}/settings.json`),
      ) as { settings: Record<string, string> };
      expect(messages.settings.oled).toBe(label);
    }
  });
```

- [ ] **Step 2: Run the picker test and capture RED**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/styles/oled-theme-contract.test.ts -t "offers OLED"
```

Expected: FAIL because neither picker nor locale files contain OLED.

- [ ] **Step 3: Add OLED to both theme arrays**

In `AppearanceSettingsScreen.tsx`, add:

```ts
{ id: "oled", labelKey: "settings.oled", fallback: "OLED Black", Icon: MoonIcon },
```

Change its picker styles to:

```ts
themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
```

and replace `flex: 1` in `themeCard` with:

```ts
themeCard: {
  width: "48%",
  alignItems: "center",
  gap: 8,
  borderRadius: radius.xl,
  borderWidth: 1,
  padding: 16,
  position: "relative",
},
```

In `AppearancePage.tsx`, add this theme entry:

```tsx
{
  id: "oled",
  name: t("settings.oled", "OLED Black"),
  icon: <Moon size={24} color={colors.foreground} />,
},
```

Change `themeGrid` and `themeBtn` to include:

```ts
themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
themeBtn: {
  width: "48%",
  alignItems: "center",
  paddingVertical: 12,
  borderRadius: 12,
  borderWidth: 2,
  position: "relative",
},
```

- [ ] **Step 4: Add exact localized labels**

Add `oled` beside `dark` and `sepia` in each locale:

```json
"oled": "OLED Black"
```

Use these exact translated values in the corresponding files: Spanish `Negro OLED`, French `Noir OLED`, Japanese `OLEDブラック`, Korean `OLED 블랙`, Simplified Chinese `OLED 纯黑`, Traditional Chinese `OLED 純黑`.

- [ ] **Step 5: Run the contract and TypeScript**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/styles/oled-theme-contract.test.ts
pnpm --filter @readany/app-expo exec tsc --noEmit
```

Expected: both OLED contract tests PASS; TypeScript PASS.

- [ ] **Step 6: Commit the selection UI and copy**

```powershell
git add -- packages/app-expo/src/styles/oled-theme-contract.test.ts packages/app-expo/src/screens/settings/AppearanceSettingsScreen.tsx packages/app-expo/src/components/onboarding/steps/AppearancePage.tsx packages/core/src/i18n/locales/*/settings.json
git commit -m "feat(mobile): expose OLED black theme"
```

---

### Task 3: EPUB and PDF Reader Integration

**Files:**
- Modify: `packages/app-expo/src/styles/oled-theme-contract.test.ts`
- Modify: `packages/app-expo/src/hooks/use-reader-bridge.ts`
- Modify: `packages/app-expo/assets/reader/reader.template.html`
- Generate: `packages/app-expo/assets/reader/reader.html`

**Interfaces:**
- Consumes: `ThemeMode.oled` and `oledColors` from Task 1
- Produces: reader bridge payload type accepting `themeMode?: "light" | "dark" | "sepia" | "oled"`
- Produces: `PDF_THEME_FILTERS.oled = "invert(1)"`

- [ ] **Step 1: Add the failing reader contract**

Append inside the OLED test `describe` block:

```ts
  it("carries OLED into the generated reader and treats PDFs as true black", () => {
    const bridge = read("packages/app-expo/src/hooks/use-reader-bridge.ts");
    const template = read("packages/app-expo/assets/reader/reader.template.html");
    const built = read("packages/app-expo/assets/reader/reader.html");

    expect(bridge).toContain('themeMode?: "light" | "dark" | "sepia" | "oled"');
    for (const source of [template, built]) {
      expect(source).toContain("themeMode === 'oled'");
      expect(source).toMatch(/oled:\s*'invert\(1\)'/);
    }
  });
```

- [ ] **Step 2: Run the reader test and capture RED**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/styles/oled-theme-contract.test.ts -t "carries OLED"
```

Expected: FAIL because bridge, template, and built reader only know Light, Dark, and Sepia.

- [ ] **Step 3: Extend the bridge and reader template**

In `use-reader-bridge.ts`, change the payload type to:

```ts
themeMode?: "light" | "dark" | "sepia" | "oled";
```

In `reader.template.html`, preserve OLED as a dark reader mode:

```js
if (themeMode === 'dark' || themeMode === 'oled' || themeMode === 'sepia') {
  currentThemeMode = themeMode;
} else {
  currentThemeMode = 'light';
}
```

Add the exact PDF filter beside `dark`:

```js
// OLED maps white PDF paper to true black while preserving the dark-page smart skip.
oled: 'invert(1)',
```

- [ ] **Step 4: Regenerate the reader and run GREEN**

Run:

```powershell
pnpm --filter @readany/app-expo run build:reader
pnpm --filter @readany/app-expo exec vitest run src/styles/oled-theme-contract.test.ts
pnpm --filter @readany/app-expo exec tsc --noEmit
```

Expected: reader builds; all three OLED contract tests PASS; TypeScript PASS.

- [ ] **Step 5: Commit reader integration**

```powershell
git add -- packages/app-expo/src/styles/oled-theme-contract.test.ts packages/app-expo/src/hooks/use-reader-bridge.ts packages/app-expo/assets/reader/reader.template.html packages/app-expo/assets/reader/reader.html
git commit -m "feat(reader): support OLED black theme"
```

---

### Task 4: Full Verification, Hosted APK, and Phone Proof

**Files:**
- Verify only; no source change expected.

**Interfaces:**
- Consumes: completed Tasks 1-3
- Produces: exact commit, hosted workflow run, APK checksum, and physical-device screenshots

- [ ] **Step 1: Run full repository checks**

Run from the worktree root:

```powershell
$env:TZ = "UTC"
pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
Remove-Item Env:TZ
pnpm --filter @readany/app-expo exec tsc --noEmit
pnpm exec biome check packages/app-expo/src/styles/ThemeContext.tsx packages/app-expo/src/styles/oled-theme-contract.test.ts packages/app-expo/src/App.tsx packages/app-expo/src/screens/settings/AppearanceSettingsScreen.tsx packages/app-expo/src/components/onboarding/steps/AppearancePage.tsx packages/app-expo/src/hooks/use-reader-bridge.ts
git diff --check HEAD~3..HEAD
git status --short
```

Expected: core and Expo suites PASS; TypeScript PASS; Biome PASS; diff check clean; worktree clean.

- [ ] **Step 2: Push the Shlai branch and run its preview workflow**

```powershell
git push origin agent/readany-shlai-implementation
gh workflow run shlai-pr.yml --repo cha1latte/ReadAny --ref agent/readany-shlai-implementation
$headSha = git rev-parse HEAD
$run = $null
for ($attempt = 0; $attempt -lt 12 -and -not $run; $attempt++) {
  Start-Sleep -Seconds 5
  $run = gh run list --repo cha1latte/ReadAny --workflow shlai-pr.yml --branch agent/readany-shlai-implementation --event workflow_dispatch --limit 10 --json databaseId,headSha | ConvertFrom-Json | Where-Object { $_.headSha -eq $headSha } | Select-Object -First 1
}
if (-not $run) { throw "No workflow_dispatch run found for $headSha" }
$runId = $run.databaseId
gh run watch $runId --repo cha1latte/ReadAny --exit-status
```

Record the dispatched run ID, exact head SHA, and wait until both Validate and Preview APK jobs succeed.

- [ ] **Step 3: Download and verify the exact APK**

```powershell
$artifactDir = "D:\dev\ReadAny-shlai-artifacts\oled-black\$runId"
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
gh run download $runId --repo cha1latte/ReadAny --dir $artifactDir
$apk = Get-ChildItem -Path $artifactDir -Recurse -Filter *.apk | Select-Object -First 1
if (-not $apk) { throw "No APK found in $artifactDir" }
Get-FileHash -Algorithm SHA256 -LiteralPath $apk.FullName
```

Expected: one preview APK artifact with a recorded SHA-256 digest.

- [ ] **Step 4: Install and visually verify on the connected Pixel**

Install with the known local Android platform tool:

```powershell
& 'C:\Users\celia\Documents\scrcpy-win64-v3.2\scrcpy-win64-v3.2\adb.exe' install -r $apk.FullName
```

Verify and capture receipts for:

1. Appearance settings shows four readable choices in a 2×2 layout.
2. OLED Black persists after leaving settings and restarting the app.
3. Library, Settings, and AI chat full-screen backgrounds are pixel-black while cards and inputs remain distinguishable.
4. An EPUB page background is pixel-black with readable dark-theme text.
5. A light PDF page uses the OLED inversion path without a gray shell seam; if no suitable PDF is installed, record that as the only manual gap and retain automated PDF-filter proof.
6. Switching back to Dark restores `#1c1c1e`, proving the old theme remains distinct.

- [ ] **Step 5: Final branch and delivery check**

```powershell
git status --short
git log -4 --oneline
gh pr list --repo codedogQBY/ReadAny --head cha1latte:agent/readany-shlai-implementation --state open
```

Expected: clean branch, exact commits present, and no accidental upstream PR mutation. Report the Shlai build/run/install receipts and ask separately before creating a new upstream feature PR unless the user has explicitly authorized it.
