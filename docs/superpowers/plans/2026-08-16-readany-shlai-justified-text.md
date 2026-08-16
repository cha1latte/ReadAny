# ReadAny Shlai Justified Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-on reader setting that justifies ordinary reflowable EPUB prose without changing intentional alignment or fixed-layout content.

**Architecture:** Persist `justifyBodyText` with existing `ReadSettings`, pass it through the existing React Native/WebView settings bridge, and let a small reader-side helper mark only eligible paragraphs after inspecting their original computed alignment. The build script inlines that helper into the generated `reader.html`, allowing its real eligibility and cleanup behavior to be unit-tested independently from the WebView.

**Tech Stack:** TypeScript, React Native, Zustand persistence, Vitest, plain browser JavaScript, Foliate WebView reader, esbuild.

## Global Constraints

- **Justify body text** is enabled by default for new and existing Shlai users.
- Disabling the setting restores the EPUB's original alignment without modifying the EPUB source.
- Only ordinary horizontal reflowable EPUB paragraphs are eligible.
- Preserve centered/right-aligned text, headings, line-break poetry, vertical writing, code, tables, captions, forms, PDFs, comics, and fixed-layout content.
- The generated `packages/app-expo/assets/reader/reader.html` must contain the same helper behavior as its template inputs.
- Produce a pull-request preview only; do not merge or publish a stable Shlai release.

---

### Task 1: Persist and expose the reader setting

**Files:**
- Create: `packages/app-expo/src/screens/reader/justified-text-contract.test.ts`
- Modify: `packages/core/src/types/book.ts`
- Modify: `packages/core/src/stores/settings-store.ts`
- Modify: `packages/app-expo/src/screens/reader/ReaderSettingsPanel.tsx`
- Modify: `packages/app-expo/src/hooks/use-reader-bridge.ts`
- Modify: `packages/core/src/i18n/locales/en/reader.json`
- Modify: `packages/core/src/i18n/locales/es/reader.json`
- Modify: `packages/core/src/i18n/locales/fr/reader.json`
- Modify: `packages/core/src/i18n/locales/ja/reader.json`
- Modify: `packages/core/src/i18n/locales/ko/reader.json`
- Modify: `packages/core/src/i18n/locales/zh/reader.json`
- Modify: `packages/core/src/i18n/locales/zh-TW/reader.json`

**Interfaces:**
- Produces: `ReadSettings.justifyBodyText?: boolean` with runtime meaning `value !== false`.
- Produces: WebView settings payload field `justifyBodyText?: boolean`.

- [ ] **Step 1: Write the failing cross-layer contract test**

Create a Vitest test that reads the exact source files and asserts the optional type, default, migration, settings toggle, centralized bridge propagation, and English translation are present. The central assertions are:

```ts
expect(bookTypes).toMatch(/justifyBodyText\?: boolean/);
expect(settingsStore).toMatch(/justifyBodyText: true/);
expect(settingsStore).toMatch(/readSettings\?\.justifyBodyText === undefined[\s\S]*justifyBodyText: true/);
expect(settingsPanel).toMatch(/t\("reader\.justifyBodyText"/);
expect(settingsPanel).toMatch(/onUpdateSetting\("justifyBodyText", readSettings\.justifyBodyText === false\)/);
expect(readerBridge).toMatch(/justifyBodyText\?: boolean/);
expect(readerBridge).toContain("function withJustifiedTextSetting");
expect(readerBridge).toContain("useSettingsStore.getState().readSettings.justifyBodyText !== false");
expect(readerBridge.match(/withJustifiedTextSetting\(/g)).toHaveLength(3);
expect(englishReader.justifyBodyText).toBe("Justify body text");
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm --filter @readany/app-expo test -- src/screens/reader/justified-text-contract.test.ts
```

Expected: FAIL because `justifyBodyText` is absent from the settings model and UI.

- [ ] **Step 3: Add the optional setting, default, and migration**

Add to `ViewSettings`:

```ts
justifyBodyText?: boolean; // default true: justify eligible reflowable EPUB body paragraphs
```

Add `justifyBodyText: true` to `defaultReadSettings`. In `migrateSettingsState`, copy existing state with `justifyBodyText: true` when the persisted field is `undefined`, matching the existing `useBookFonts` migration pattern.

- [ ] **Step 4: Add the Reader Settings toggle and translations**

Place this row after Paragraph Spacing:

```tsx
<View style={s.settingRow}>
  <View style={s.settingLabelBlock}>
    <Text style={s.settingLabel}>{t("reader.justifyBodyText", "Justify body text")}</Text>
    <Text style={s.settingHint}>
      {t("reader.justifyBodyTextDesc", "Align ordinary prose to both page edges")}
    </Text>
  </View>
  <TouchableOpacity
    style={[
      s.settingToggleBtn,
      readSettings.justifyBodyText !== false && s.settingToggleBtnActive,
    ]}
    onPress={() =>
      onUpdateSetting("justifyBodyText", readSettings.justifyBodyText === false)
    }
  >
    <Text
      style={[
        s.settingToggleText,
        readSettings.justifyBodyText !== false && s.settingToggleTextActive,
      ]}
    >
      {readSettings.justifyBodyText !== false
        ? t("settings.enabled")
        : t("settings.disabled")}
    </Text>
  </TouchableOpacity>
</View>
```

Add these exact localized `justifyBodyText` and `justifyBodyTextDesc` entries:

| Locale | Label | Description |
| --- | --- | --- |
| `en` | `Justify body text` | `Align ordinary prose to both page edges` |
| `es` | `Justificar el texto` | `Alinea la prosa normal con ambos bordes de la página` |
| `fr` | `Justifier le texte` | `Aligne le texte courant sur les deux bords de la page` |
| `ja` | `本文を両端揃え` | `通常の本文をページの両端に揃えます` |
| `ko` | `본문 양쪽 맞춤` | `일반 본문을 페이지 양쪽 가장자리에 맞춥니다` |
| `zh` | `正文两端对齐` | `将普通正文与页面两侧对齐` |
| `zh-TW` | `正文兩端對齊` | `將一般正文與頁面兩側對齊` |

- [ ] **Step 5: Carry the setting through every bridge payload**

Add `justifyBodyText?: boolean` to `ReaderInitialSettings` and the `applySettings` parameter. Centralize the persisted default in the bridge so both initial `openBook` commands and later partial `applySettings` commands always carry the current value:

```ts
function withJustifiedTextSetting(settings: ReaderInitialSettings = {}): ReaderInitialSettings {
  return {
    justifyBodyText: useSettingsStore.getState().readSettings.justifyBodyText !== false,
    ...settings,
  };
}
```

Apply that helper when serializing both commands, with explicit caller values taking precedence. The existing `updateSetting` callback spreads merged settings into `bridge.applySettings`, so the toggle still updates an open book immediately without another effect.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the same focused Vitest command. Expected: PASS.

- [ ] **Step 7: Commit the settings slice**

```powershell
git add packages/core/src/types/book.ts packages/core/src/stores/settings-store.ts packages/core/src/i18n/locales packages/app-expo/src/screens/reader/ReaderSettingsPanel.tsx packages/app-expo/src/hooks/use-reader-bridge.ts packages/app-expo/src/screens/reader/justified-text-contract.test.ts
git commit -m "feat(reader): add justified text setting"
```

---

### Task 2: Apply justification only to eligible EPUB paragraphs

**Files:**
- Create: `packages/app-expo/assets/reader/justified-text.js`
- Create: `packages/app-expo/src/screens/reader/justified-text-behavior.test.ts`
- Modify: `packages/app-expo/assets/reader/reader.template.html`
- Modify: `packages/app-expo/scripts/build-reader.js`
- Regenerate: `packages/app-expo/assets/reader/reader.html`

**Interfaces:**
- Consumes: WebView settings field `justifyBodyText?: boolean` from Task 1.
- Produces: `globalThis.ReadAnyJustifiedText.apply(doc, enabled, unsupportedLayout)`.

- [ ] **Step 1: Write the failing helper behavior test**

The test must first assert the helper file exists, then execute its source with `node:vm` in an isolated context. Use lightweight fake documents and paragraphs to prove:

```ts
expect(api.shouldJustify(leftParagraph, false, fakeWindow("left"))).toBe(true);
expect(api.shouldJustify(centeredParagraph, false, fakeWindow("center"))).toBe(false);
expect(api.shouldJustify(rightParagraph, false, fakeWindow("right"))).toBe(false);
expect(api.shouldJustify(lineBreakParagraph, false, fakeWindow("left"))).toBe(false);
expect(api.shouldJustify(paragraphInTable, false, fakeWindow("left"))).toBe(false);
expect(api.shouldJustify(leftParagraph, true, fakeWindow("left"))).toBe(false);
```

Also call `apply` twice to prove it removes old reader markers before reclassification, creates one reader-owned style when enabled, and leaves no marker/style when disabled.

- [ ] **Step 2: Extend the contract test for template/build integration and verify RED**

Assert that the template contains the stable helper marker, `currentJustifyBodyText = true`, settings handling, and a call from `applyDocStyles`. Assert that `build-reader.js` reads and injects `justified-text.js`. Run both focused tests.

Expected: FAIL because the helper and integration do not exist.

- [ ] **Step 3: Implement the standalone helper**

Create an IIFE that publishes this API:

```js
(function installReadAnyJustifiedText(root) {
  const MARKER = "data-readany-justify-body";
  const STYLE_ID = "__readany_justified_text__";
  const PRESERVED_ALIGNMENTS = new Set(["center", "right", "end", "-webkit-center", "-webkit-right"]);
  const EXCLUDED_ANCESTORS = "pre, code, kbd, samp, table, caption, figcaption, form, button, input, textarea, select";

  function shouldJustify(paragraph, unsupportedLayout, view) {
    if (!paragraph || unsupportedLayout || paragraph.querySelector("br")) return false;
    if (paragraph.closest(EXCLUDED_ANCESTORS)) return false;
    return !PRESERVED_ALIGNMENTS.has(
      String(view.getComputedStyle(paragraph).textAlign || "").toLowerCase(),
    );
  }

  function apply(doc, enabled, unsupportedLayout) {
    if (!doc?.head) return;
    doc.querySelectorAll(`[${MARKER}]`).forEach((element) => element.removeAttribute(MARKER));
    doc.getElementById(STYLE_ID)?.remove();
    if (!enabled || unsupportedLayout || !doc.defaultView) return;
    doc.querySelectorAll("p").forEach((paragraph) => {
      if (shouldJustify(paragraph, unsupportedLayout, doc.defaultView)) {
        paragraph.setAttribute(MARKER, "true");
      }
    });
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `[${MARKER}="true"] { text-align: justify !important; text-justify: inter-word; }`;
    doc.head.appendChild(style);
  }

  root.ReadAnyJustifiedText = { apply, shouldJustify };
})(globalThis);
```

- [ ] **Step 4: Inline the helper and connect reader lifecycle/settings**

Add a unique helper insertion marker immediately before the template's main script. Update `build-reader.js` to read `justified-text.js`, require the marker exactly once, and replace it with `<script>...</script>` before inserting the Foliate bundle.

In `reader.template.html`:

```js
let currentJustifyBodyText = true;
```

Update it when `settings.justifyBodyText !== undefined`, include it in the settings-change condition, and call this synchronization function after settings change:

```js
function syncJustifiedTextForAllDocs() {
  const fixedLayout = Boolean(view?.isFixedLayout);
  for (const content of getRendererContents()) {
    if (!content?.doc) continue;
    const unsupportedLayout = fixedLayout || isVerticalDoc(content.doc);
    globalThis.ReadAnyJustifiedText?.apply(
      content.doc,
      currentJustifyBodyText,
      unsupportedLayout,
    );
  }
}
```

In `applyDocStyles(doc)`, after the existing PDF early return, call:

```js
const verticalDoc = isVerticalDoc(doc);
globalThis.ReadAnyJustifiedText?.apply(
  doc,
  currentJustifyBodyText,
  verticalDoc || Boolean(view?.isFixedLayout),
);
```

The existing PDF early return and the `view.isFixedLayout` check together keep PDFs, comics, and fixed-layout EPUBs out of justification.

- [ ] **Step 5: Build the reader asset and verify GREEN**

Run:

```powershell
pnpm --filter @readany/app-expo build:reader
pnpm --filter @readany/app-expo test -- src/screens/reader/justified-text-contract.test.ts src/screens/reader/justified-text-behavior.test.ts
```

Expected: reader build succeeds and both focused test files pass.

- [ ] **Step 6: Commit the rendering slice**

```powershell
git add packages/app-expo/assets/reader/justified-text.js packages/app-expo/assets/reader/reader.template.html packages/app-expo/assets/reader/reader.html packages/app-expo/scripts/build-reader.js packages/app-expo/src/screens/reader/justified-text-contract.test.ts packages/app-expo/src/screens/reader/justified-text-behavior.test.ts
git commit -m "fix(reader): justify ordinary EPUB prose"
```

---

### Task 3: Verify, publish a preview, and prove it on Android

**Files:**
- Modify only if verification exposes an in-scope defect: files from Tasks 1-2.
- Artifact output: `D:\dev\ReadAny-shlai-artifacts\pr-1\<new-run-id>\`

**Interfaces:**
- Consumes: committed setting and reader helper from Tasks 1-2.
- Produces: green local gates, a pushed PR head, a hosted preview APK, and Android screenshots with the toggle on and off.

- [ ] **Step 1: Run local verification**

```powershell
$env:TZ='UTC'
pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
pnpm --filter @readany/app-expo exec tsc --noEmit
pnpm exec biome check packages/core/src/types/book.ts packages/core/src/stores/settings-store.ts packages/core/src/i18n/locales packages/app-expo/src/screens/reader/ReaderSettingsPanel.tsx packages/app-expo/src/hooks/use-reader-bridge.ts packages/app-expo/src/screens/reader/justified-text-contract.test.ts packages/app-expo/src/screens/reader/justified-text-behavior.test.ts packages/app-expo/scripts/build-reader.js packages/app-expo/assets/reader/justified-text.js
git diff --check
```

Expected: all tests and checks pass with no formatter diff.

- [ ] **Step 2: Push the feature branch and wait for hosted checks**

```powershell
git push origin agent/readany-shlai-implementation
gh pr checks 1 --repo cha1latte/ReadAny --watch
```

Expected: `Validate` and `Preview APK` succeed on the new head.

- [ ] **Step 3: Download and install the new preview APK**

Download `ReadAny-Shlai-Preview-1`, verify the APK package is `io.github.cha1latte.readanyshlai.preview`, then install it in place with the known ADB executable and `adb install -r`.

- [ ] **Step 4: Prove default-on justification**

Import or open a deliberately left-aligned reflowable EPUB/TXT-derived book. Capture a screenshot showing an ordinary multi-line paragraph aligned to both page edges while **Justify body text** is enabled.

- [ ] **Step 5: Prove restoration when disabled**

Open Reader Settings, disable **Justify body text**, return to the same paragraph, and capture a screenshot showing the original ragged-right alignment. Re-enable the switch before handing the phone back.

- [ ] **Step 6: Report without merging or releasing**

Report the commit, PR/check state, APK identity, both screenshot paths, and any remaining manual gap. Leave PR #1 unmerged and do not run the stable release workflow.
