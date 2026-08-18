# Android Chat Dismiss Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both Android chat screens immediately reclaim their full height after keyboard dismissal without regressing open-keyboard composer visibility.

**Architecture:** Retain `react-native-keyboard-controller` for the existing open-keyboard height adjustment, but gate it with ReadAny's React Native `useKeyboardInsets().isVisible` state. Deliver the tested fix first through the Shlai fork and preview-release lane, then cherry-pick only the focused source/test commit onto a separate latest-`upstream/main` branch for the official PR.

**Tech Stack:** React Native 0.81, Expo 54, TypeScript 5.9, `react-native-keyboard-controller` 1.18.5, Vitest 4, GitHub Actions, GitHub CLI, ADB.

## Global Constraints

- Preserve package `io.github.cha1latte.readanyshlai.preview` and all installed app data; never uninstall it or clear storage.
- Keep `behavior="height"` and `keyboardVerticalOffset={insets.top}` so the existing open-keyboard fix remains intact.
- Apply the behavior to both `ChatScreen` and `BookChatScreen`.
- Push feature branches only to `origin` (`cha1latte/ReadAny`); never push to `upstream` (`codedogQBY/ReadAny`).
- The official PR branch must start from the latest `upstream/main` and contain only the focused source/test change.
- Install the published preview with `adb install -r` and verify the actual Pixel 9a behavior.

---

### Task 1: Add the dismissal regression and minimal layout fix

**Files:**
- Modify: `packages/app-expo/src/screens/chat-keyboard-layout.test.ts`
- Modify: `packages/app-expo/src/screens/ChatScreen.tsx`
- Modify: `packages/app-expo/src/screens/BookChatScreen.tsx`

**Interfaces:**
- Consumes: the `isVisible` field returned by `useKeyboardInsets()`, `Platform.OS`, and the existing controller `KeyboardAvoidingView` props.
- Produces: both chat screens set `enabled={Platform.OS === "android" && keyboardInsets.isVisible}` on their controller wrapper.

- [ ] **Step 1: Write the failing source contract**

Replace `packages/app-expo/src/screens/chat-keyboard-layout.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const chatScreens = ["ChatScreen.tsx", "BookChatScreen.tsx"] as const;

describe("Android chat keyboard layout", () => {
  for (const screen of chatScreens) {
    it(`${screen} avoids an open keyboard and releases the height after dismissal`, () => {
      const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), screen), "utf8");

      expect(source).toMatch(
        /import\s+\{\s*KeyboardAvoidingView\s*\}\s+from\s+"react-native-keyboard-controller";/,
      );
      expect(source).toMatch(
        /import\s+\{\s*useKeyboardInsets\s*\}\s+from\s+"@\/hooks\/use-keyboard-insets";/,
      );
      expect(source).toMatch(/const keyboardInsets = useKeyboardInsets\(\);/);
      expect(source).toMatch(
        /<KeyboardAvoidingView\b[\s\S]*?behavior="height"[\s\S]*?enabled=\{Platform\.OS === "android" && keyboardInsets\.isVisible\}[\s\S]*?keyboardVerticalOffset=\{insets\.top\}[\s\S]*?<ChatInput\b[\s\S]*?<\/KeyboardAvoidingView>/,
      );
    });
  }
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/screens/chat-keyboard-layout.test.ts
```

Expected: both cases fail because neither screen imports or calls `useKeyboardInsets`, and the wrappers are still enabled for every Android keyboard state.

- [ ] **Step 3: Gate both wrappers on live keyboard visibility**

In both screen files, add:

```ts
import { useKeyboardInsets } from "@/hooks/use-keyboard-insets";
```

Immediately after each existing `const insets = useSafeAreaInsets();`, add:

```ts
const keyboardInsets = useKeyboardInsets();
```

In each `KeyboardAvoidingView`, replace the existing `enabled` prop with:

```tsx
enabled={Platform.OS === "android" && keyboardInsets.isVisible}
```

Do not change the wrapper's `behavior`, `keyboardVerticalOffset`, children, or styles.

- [ ] **Step 4: Run the focused test and verify green**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/screens/chat-keyboard-layout.test.ts
```

Expected: one test file passes with two passing cases.

- [ ] **Step 5: Run the complete local validation lane**

Run:

```powershell
pnpm --filter @readany/app-expo test
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
pnpm exec biome check packages/app-expo/src/screens/chat-keyboard-layout.test.ts packages/app-expo/src/screens/ChatScreen.tsx packages/app-expo/src/screens/BookChatScreen.tsx
git diff --check origin/main...HEAD
```

Expected: all Expo tests, TypeScript, Biome, and whitespace validation pass.

- [ ] **Step 6: Commit only the focused code and test**

Run:

```powershell
git add packages/app-expo/src/screens/chat-keyboard-layout.test.ts packages/app-expo/src/screens/ChatScreen.tsx packages/app-expo/src/screens/BookChatScreen.tsx
git commit -m "fix(mobile): restore chat height after keyboard dismiss"
```

Expected: the new commit contains exactly the two screen changes and their regression contract.

---

### Task 2: Ship the fork fix, preview release, and in-place phone update

**Files:**
- No additional source files.
- Artifact: `D:\dev\ReadAny-shlai-artifacts\1.3.6-shlai.3\ReadAny-Shlai-Preview.apk`
- Evidence: `D:\dev\_artifacts\readany-layout-fixed.png`
- Evidence: `D:\dev\_artifacts\readany-layout-fixed.xml`

**Interfaces:**
- Consumes: the verified fork branch, fork PR checks, `Shlai Phone Release`, preview release assets, and connected Pixel 9a `55311JEBF05878`.
- Produces: merged fork PR, `shlai-preview-v1.3.6.3`, in-place package update to versionCode `4`, preserved user data, and live fixed-layout proof.

- [ ] **Step 1: Inspect and publish the intended fork branch**

Run:

```powershell
gh --version
gh auth status
git status -sb
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
git push -u origin agent/fix-chat-dead-space
```

Expected: authenticated GitHub CLI; only the approved design, plan, and focused fix are ahead of fork `main`; push targets `origin`.

- [ ] **Step 2: Open the fork PR**

Create a pull request into `cha1latte/ReadAny:main` titled `fix(mobile): restore chat height after keyboard dismiss`. Its body must explain the 965-pixel retained height, the disagreement between the controller and React Native keyboard state, the visibility gate, the tests, and the Pixel verification plan.

Expected: a non-draft fork PR from `agent/fix-chat-dead-space` into `main`.

- [ ] **Step 3: Wait for required checks and merge**

Run:

```powershell
$forkPrNumber = gh pr view agent/fix-chat-dead-space --repo cha1latte/ReadAny --json number --jq '.number'
gh pr checks $forkPrNumber --repo cha1latte/ReadAny --watch
gh pr merge $forkPrNumber --repo cha1latte/ReadAny --squash --delete-branch
```

Expected: every required check passes before the squash merge; fork `main` advances to the merge commit.

- [ ] **Step 4: Wait for the exact phone-preview workflow and release**

Find the `Shlai Phone Release` run whose `headSha` is the fork merge SHA and watch it with:

```powershell
$mergeSha = gh pr view $forkPrNumber --repo cha1latte/ReadAny --json mergeCommit --jq '.mergeCommit.oid'
$run = gh run list --repo cha1latte/ReadAny --workflow shlai-phone-release.yml --branch main --event push --limit 20 --json databaseId,headSha | ConvertFrom-Json | Where-Object headSha -eq $mergeSha | Select-Object -First 1
gh run watch $run.databaseId --repo cha1latte/ReadAny --exit-status
gh release view shlai-preview-v1.3.6.3 --repo cha1latte/ReadAny --json tagName,targetCommitish,isPrerelease,assets,url
```

Expected: the workflow succeeds and publishes prerelease `shlai-preview-v1.3.6.3` from the exact fork merge commit with the APK and checksum assets.

- [ ] **Step 5: Download and verify the published APK**

Run:

```powershell
gh release download shlai-preview-v1.3.6.3 --repo cha1latte/ReadAny --pattern 'ReadAny-Shlai-Preview.apk*' --dir D:\dev\ReadAny-shlai-artifacts\1.3.6-shlai.3
Get-FileHash -Algorithm SHA256 D:\dev\ReadAny-shlai-artifacts\1.3.6-shlai.3\ReadAny-Shlai-Preview.apk
```

Use Android build tools `aapt2` and `apksigner` to verify package `io.github.cha1latte.readanyshlai.preview`, versionName `1.3.6-shlai.3`, versionCode `4`, one valid signer, and the published checksum.

- [ ] **Step 6: Capture the pre-update data identity and install in place**

After Celia reconnects the Pixel, run:

```powershell
$adb='D:\dev\scrcpy-win64-v4.0\adb.exe'
& $adb devices -l
& $adb shell dumpsys package io.github.cha1latte.readanyshlai.preview | Select-String 'versionName=|versionCode=|firstInstallTime=|lastUpdateTime='
& $adb install -r D:\dev\ReadAny-shlai-artifacts\1.3.6-shlai.3\ReadAny-Shlai-Preview.apk
```

Expected: `adb install -r` returns `Success`; package identity and original `firstInstallTime` remain unchanged; no uninstall or clear command is used.

- [ ] **Step 7: Verify the actual phone layout**

On the existing AI Reading Assistant conversation, focus the composer to open the keyboard and confirm the composer/action buttons remain above it. Dismiss the keyboard and use ADB to capture a screenshot and UI hierarchy.

Expected after dismissal: the keyboard is absent, the chat content/composer parent extends to the bottom safe-area region instead of ending near y=1459, the 965-pixel dead area is gone, and the selected-text conversation remains present.

---

### Task 3: Publish the focused official-upstream PR

**Files:**
- Modify: `packages/app-expo/src/screens/chat-keyboard-layout.test.ts`
- Modify: `packages/app-expo/src/screens/ChatScreen.tsx`
- Modify: `packages/app-expo/src/screens/BookChatScreen.tsx`

**Interfaces:**
- Consumes: latest fetched `upstream/main` and the focused source/test commit from Task 1.
- Produces: `origin/fix/android-chat-dismiss-layout` and a ready-for-review PR into `codedogQBY/ReadAny:main`.

- [ ] **Step 1: Create a separate latest-upstream worktree**

From the primary repository, run:

```powershell
git fetch upstream --prune
git fetch origin --prune
git worktree add D:\dev\ReadAny-chat-layout-upstream-worktree -b fix/android-chat-dismiss-layout upstream/main
```

Expected: the new worktree's parent is the current `upstream/main`, not fork `main`.

- [ ] **Step 2: Apply only the focused code commit**

Run in the upstream worktree:

```powershell
$focusedCommit = git -C D:\dev\ReadAny-chat-layout-fix-worktree log --format=%H --grep '^fix(mobile): restore chat height after keyboard dismiss$' -1
git cherry-pick $focusedCommit
git diff --stat upstream/main...HEAD
git log --oneline upstream/main..HEAD
```

Expected: one commit ahead, changing only the two screens and `chat-keyboard-layout.test.ts`; no Shlai documentation, branding, workflow, or release files.

- [ ] **Step 3: Verify the upstream branch**

Install dependencies if needed, then run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/screens/chat-keyboard-layout.test.ts
pnpm --filter @readany/app-expo test
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
pnpm exec biome check packages/app-expo/src/screens/chat-keyboard-layout.test.ts packages/app-expo/src/screens/ChatScreen.tsx packages/app-expo/src/screens/BookChatScreen.tsx
git diff --check upstream/main...HEAD
```

Expected: focused and complete Expo tests, TypeScript, Biome, and diff checks all pass.

- [ ] **Step 4: Push only to Celia's fork and open the official PR ready for review**

Run:

```powershell
git push -u origin fix/android-chat-dismiss-layout
```

Open a non-draft PR against `codedogQBY/ReadAny:main` with head `cha1latte:fix/android-chat-dismiss-layout`, title `fix(mobile): restore chat height after keyboard dismiss`, and a body covering root cause, user impact, tests, and Pixel 9a proof.

Expected: the official PR is ready for review; `git remote get-url --push upstream` is never used by a push command.
