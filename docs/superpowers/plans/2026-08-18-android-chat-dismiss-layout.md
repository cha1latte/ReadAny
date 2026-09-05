# Android Chat Dismiss Layout Implementation Plan

**Goal:** Preserve open-keyboard composer visibility and eliminate the collapsed lower-space layout after dismissal.

**Architecture:** Use the controller's `padding` behavior in both chat screens so keyboard animation never writes `height` or `flex`. Remove the disproved dependency patch, validate locally and on GitHub, publish the next Shlai Preview, then prove the real Pixel transition.

## Constraints

- Preserve package `io.github.cha1latte.readanyshlai.preview` and all app data.
- Never uninstall or clear the phone package.
- Apply the behavior to `ChatScreen` and `BookChatScreen`.
- Push branches only to `origin`; never push to official `upstream`.
- Build the upstream PR from latest `codedogQBY/ReadAny:main` with only the focused source/test diff.

## Task 1: Encode the corrected regression

- Modify `packages/app-expo/src/screens/chat-keyboard-layout.test.ts` first.
- Require `behavior="padding"` in both screens and reject `height`.
- Require the temporary controller patch registration to be absent.
- Require the installed controller padding branch to emit `paddingBottom: bottom`.
- Run the focused test and record the expected three-test failure against `1.3.6-shlai.3`.

## Task 2: Implement the minimal correction

- Change both `KeyboardAvoidingView` calls from `height` to `padding`.
- Remove `react-native-keyboard-controller@1.18.5` from `pnpm.patchedDependencies`.
- Delete `patches/react-native-keyboard-controller@1.18.5.patch`.
- Regenerate `pnpm-lock.yaml` and reinstall from the frozen lockfile.
- Run the focused test and require all three tests to pass.

## Task 3: Validate and review

Run the fork's complete local validation lane:

```powershell
$env:TZ='UTC'; pnpm --filter @readany/core test
$env:TZ='UTC'; pnpm --filter @readany/app-expo test
$env:TZ='UTC'; pnpm --dir packages/app exec vitest run src
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
pnpm --filter app build
pnpm --filter @readany/app-expo run build:reader
git diff --exit-code -- packages/app-expo/assets/reader/reader.html
pnpm exec biome check package.json packages/app-expo/src/screens/chat-keyboard-layout.test.ts packages/app-expo/src/screens/ChatScreen.tsx packages/app-expo/src/screens/BookChatScreen.tsx
git diff --check
```

Request an independent review focused on Android keyboard opening, padding dismissal, safe-area offsets, and removal of the dependency patch. Address all Critical and Important findings.

## Task 4: Ship the corrected fork preview

- Commit the focused correction in the fresh isolated worktree.
- Push to `cha1latte/ReadAny` and open a ready fork PR.
- Wait for required `Validate` and `Preview APK` checks.
- Squash-merge into fork `main`.
- Wait for the exact merge SHA's `Shlai Phone Release` workflow.
- Verify the published `1.3.6-shlai.4` APK checksum, package, versionCode, and signing identity.

## Task 5: Update and verify the Pixel

- Ask for the phone only after the APK is ready.
- Record current package metadata.
- Install with `adb install -r`.
- Confirm versionCode increments, `firstInstallTime` remains unchanged, and saved books/settings remain present.
- Reopen the selected-text AI Reading Assistant.
- Capture before/open/dismiss screenshots and hierarchy bounds.
- Confirm the composer is above the keyboard while open and returns to the full-height layout after dismissal.
- Tell the user immediately when the phone can be unplugged.

## Task 6: Correct the upstream PR

- Rebuild the upstream branch from the latest official `main` with only the two screen changes and focused test.
- Push only to the fork branch.
- Update draft PR `codedogQBY/ReadAny#699` and mark it ready after its checks pass.
