# Android Chat Composer Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the complete Android chat composer, including Deep Thinking and Spoiler-Free, visible above the software keyboard in both chat routes.

**Architecture:** Retain each screen's existing nested `react-native-keyboard-controller` `KeyboardAvoidingView` and supply the missing top safe-area offset through `keyboardVerticalOffset={insets.top}`. Strengthen the source contract test so both screens must use that offset and keep `ChatInput` inside the avoidance boundary.

**Tech Stack:** React Native 0.81, Expo SDK 54, `react-native-keyboard-controller` 1.18.5, `react-native-safe-area-context`, Vitest, TypeScript, Biome, Android ADB.

## Global Constraints

- Apply the behavior to `ChatScreen` and `BookChatScreen`.
- Keep the text input, Deep Thinking, Spoiler-Free, dismiss, and send controls visible and tappable at maximum multiline input height.
- Keep the chat header stationary and let the content area shrink.
- Leave iOS behavior unchanged.
- Do not add fixed padding, keyboard-height guesses, new dependencies, or switch-behavior changes.
- Keep Shlai-only planning and release material out of upstream PR #680.

---

### Task 1: Correct the Android keyboard offset on the upstream PR branch

**Files:**
- Modify: `packages/app-expo/src/screens/chat-keyboard-layout.test.ts`
- Modify: `packages/app-expo/src/screens/ChatScreen.tsx`
- Modify: `packages/app-expo/src/screens/BookChatScreen.tsx`

**Interfaces:**
- Consumes: `insets.top: number` from the screens' existing `useSafeAreaInsets()` calls and `keyboardVerticalOffset?: number` from `KeyboardAvoidingView`.
- Produces: an Android avoidance wrapper whose effective keyboard boundary includes the screen's top safe-area inset.

- [ ] **Step 1: Create an isolated worktree for `fix/android-chat-keyboard`**

Run from `D:\dev\ReadAny`:

```powershell
git worktree add D:\dev\ReadAny-keyboard-fix-worktree fix/android-chat-keyboard
```

Expected: the existing PR branch is checked out at `D:\dev\ReadAny-keyboard-fix-worktree` without modifying the primary checkout.

- [ ] **Step 2: Verify the branch baseline**

Run:

```powershell
pnpm --filter @readany/app-expo test -- src/screens/chat-keyboard-layout.test.ts
```

Expected: the existing keyboard-containment tests pass before the stronger contract is added.

- [ ] **Step 3: Write the failing offset contract**

In `chat-keyboard-layout.test.ts`, require the avoidance wrapper to include the safe-area offset before `ChatInput`:

```ts
expect(source).toMatch(
  /<KeyboardAvoidingView\b[\s\S]*?behavior="height"[\s\S]*?enabled=\{Platform\.OS === "android"\}[\s\S]*?keyboardVerticalOffset=\{insets\.top\}[\s\S]*?<ChatInput\b[\s\S]*?<\/KeyboardAvoidingView>/,
);
```

- [ ] **Step 4: Run the focused test and prove RED**

Run:

```powershell
pnpm --filter @readany/app-expo test -- src/screens/chat-keyboard-layout.test.ts
```

Expected: two failures, one for each screen, because neither wrapper yet supplies `keyboardVerticalOffset`.

- [ ] **Step 5: Implement the minimal screen changes**

Add the existing device inset to each `KeyboardAvoidingView` immediately after the Android `enabled` prop:

```tsx
keyboardVerticalOffset={insets.top}
```

Do not move the wrapper or alter `ChatInput`.

- [ ] **Step 6: Run GREEN and focused static checks**

Run:

```powershell
pnpm --filter @readany/app-expo test -- src/screens/chat-keyboard-layout.test.ts
pnpm --filter @readany/app-expo exec tsc --noEmit
pnpm exec biome check packages/app-expo/src/screens/chat-keyboard-layout.test.ts packages/app-expo/src/screens/ChatScreen.tsx packages/app-expo/src/screens/BookChatScreen.tsx
git diff --check
```

Expected: the focused test passes for both screens; TypeScript, Biome, and whitespace checks exit successfully.

- [ ] **Step 7: Commit the focused upstream change**

Run:

```powershell
git add -- packages/app-expo/src/screens/chat-keyboard-layout.test.ts packages/app-expo/src/screens/ChatScreen.tsx packages/app-expo/src/screens/BookChatScreen.tsx
git commit -m "fix(mobile): keep chat actions above keyboard"
```

Expected: one focused commit on `fix/android-chat-keyboard` containing only the two screens and test.

### Task 2: Integrate, prove on-device, and update PR #680

**Files:**
- Modify by cherry-pick: the same three Expo files on `agent/readany-shlai-implementation`.
- Generated outside Git: preview APK and Android screenshots/UI hierarchy receipts.

**Interfaces:**
- Consumes: the exact Task 1 commit and the existing Shlai preview GitHub Actions workflow.
- Produces: a tested Shlai preview APK and an updated upstream PR head containing the same fix.

- [ ] **Step 1: Cherry-pick the focused commit into Shlai**

Run from `D:\dev\ReadAny-shlai-implementation-worktree`:

```powershell
$keyboardFixSha = git -C D:\dev\ReadAny-keyboard-fix-worktree rev-parse HEAD
git cherry-pick $keyboardFixSha
```

Expected: the three upstream files apply cleanly without importing Shlai-only documentation into PR #680.

- [ ] **Step 2: Run the complete changed-lane verification on Shlai**

Run:

```powershell
$env:TZ='UTC'; pnpm --filter @readany/core test
$env:TZ='UTC'; pnpm --filter @readany/app-expo test
pnpm --filter @readany/app-expo exec tsc --noEmit
pnpm exec biome check packages/app-expo/src/screens/chat-keyboard-layout.test.ts packages/app-expo/src/screens/ChatScreen.tsx packages/app-expo/src/screens/BookChatScreen.tsx
git diff --check HEAD~1 HEAD
```

Expected: all core and Expo tests pass; TypeScript, Biome, and diff checks exit successfully.

- [ ] **Step 3: Inspect publication scope and push only to the fork**

Run in each worktree:

```powershell
git status --short
git branch --show-current
git remote -v
```

Expected: both worktrees are clean, branches are `fix/android-chat-keyboard` and `agent/readany-shlai-implementation`, and the push destination named `origin` is `cha1latte/ReadAny`.

Then run:

```powershell
git push origin fix/android-chat-keyboard
git push origin agent/readany-shlai-implementation
```

Expected: both remote branches advance without force-pushing.

- [ ] **Step 4: Build and install the exact Shlai preview**

The push updates fork PR #1 and triggers `.github/workflows/shlai-pr.yml`. Record the exact Shlai commit, find its run, wait for success, then download the artifact:

```powershell
$shlaiSha = git -C D:\dev\ReadAny-shlai-implementation-worktree rev-parse HEAD
$runs = gh run list --repo cha1latte/ReadAny --workflow shlai-pr.yml --branch agent/readany-shlai-implementation --event pull_request --json databaseId,headSha,status,conclusion,url | ConvertFrom-Json
$runId = ($runs | Where-Object { $_.headSha -eq $shlaiSha } | Select-Object -First 1).databaseId
gh run watch $runId --repo cha1latte/ReadAny --exit-status
$artifactDir = "D:\dev\ReadAny-shlai-artifacts\keyboard-clearance\$runId"
New-Item -ItemType Directory -Force -Path $artifactDir
gh run download $runId --repo cha1latte/ReadAny --dir $artifactDir
$apk = Join-Path $artifactDir 'ReadAny-Shlai-Preview-1\ReadAny-Shlai-Preview-1.apk'
Get-FileHash -Algorithm SHA256 $apk
& 'C:\Users\celia\Documents\scrcpy-win64-v3.2\scrcpy-win64-v3.2\adb.exe' install -r $apk
```

The `$runId` selection deliberately rejects runs for older branch commits.

Expected: the exact-commit workflow succeeds, the APK hash is recorded, `adb install -r` reports `Success`, and Android launches `io.github.cha1latte.readanyshlai.preview` without clearing its data.

- [ ] **Step 5: Verify both chat routes on the phone**

For the regular AI tab and per-book/selected-text chat:

1. Focus the composer and enter enough text to reach its maximum height.
2. Confirm the text box, Deep Thinking, Spoiler-Free, dismiss, and send controls are all fully above the keyboard.
3. Tap both switches to prove they remain reachable.
4. Capture a screenshot and UI hierarchy showing the action-row bounds above the keyboard bounds.

Expected: both routes satisfy the design with the keyboard open and no header movement or clipping.

- [ ] **Step 6: Confirm upstream PR #680 is updated**

Run:

```powershell
gh pr view 680 --repo codedogQBY/ReadAny --json url,state,isDraft,headRefName,headRefOid,mergeable,statusCheckRollup
```

Expected: PR #680 remains open, points to `fix/android-chat-keyboard`, and its head OID matches the pushed Task 1 commit. Report hosted check status and any remaining external review gap without merging.
