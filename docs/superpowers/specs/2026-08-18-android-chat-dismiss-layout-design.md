# Android Chat Dismiss Layout Design

## Goal

Restore the full-height mobile chat layout immediately after the Android keyboard closes while preserving the existing behavior that keeps the chat composer above an open keyboard.

## Reproduction Evidence

- Device: Pixel 9a, 1080 x 2424 at 420 dpi.
- Installed app: ReadAny Shlai Preview `1.3.6-shlai.2`, Android versionCode `3`.
- Package: `io.github.cha1latte.readanyshlai.preview`.
- With the keyboard visibly closed, the root surface remained `[0,0][1080,2424]` while the keyboard-avoiding chat content ended at y=1459.
- The retained 965-pixel reduction matches a stale keyboard-sized layout adjustment and produces the large dead area below the composer.

## Root Cause

`ChatScreen` and `BookChatScreen` correctly keep the `react-native-keyboard-controller` `KeyboardAvoidingView` active throughout the Android keyboard animation. The defect is inside the pinned controller's `height` behavior: while open it emits `{ height, flex: 0 }`, but when closed it emits `{}`.

Reanimated only updates properties present in the next animated-style object. The empty object therefore does not unset the previously applied native `height` and `flex`, leaving the view keyboard-shortened after dismissal.

## Selected Design

Keep both screen wrappers unchanged and patch pinned `react-native-keyboard-controller@1.18.5` so the closed/disabled `height` branch emits `{ height: undefined, flex: undefined }`. Reanimated then explicitly clears the stale native properties and the screen's existing `flex: 1` style takes over again.

The patch is registered through pnpm's existing `patchedDependencies` mechanism and applies to the package source used by React Native plus its CommonJS and module builds. This preserves the controller's full opening animation and fixes every ReadAny consumer of its `height` behavior.

## Alternatives Rejected

### Gate the controller on `useKeyboardInsets().isVisible`

This was rejected after review. Returning `{}` when disabled does not clear the stale Reanimated keys, and Android's React Native hook only becomes visible at `keyboardDidShow`, which would disable avoidance throughout the opening animation.

### Upgrade `react-native-keyboard-controller`

This expands the change to a dependency upgrade without proof that a newer release fixes this exact stale-state path. It also increases native-build and cross-platform risk for a two-screen bug.

### Replace the controller with React Native's avoiding view

React Native's component clears its height normally, but replacing the controller would discard the open-keyboard behavior already proven on the Pixel and reopen the earlier covered-composer bug.

## Tests

Update the existing `chat-keyboard-layout.test.ts` contract before the dependency patch so it fails until:

- both screens retain the controller `KeyboardAvoidingView`, `height` behavior, Android enablement, and vertical offset;
- root `package.json` registers the pinned controller patch; and
- the installed controller source explicitly emits `height` and `flex` reset keys in the closed branch.

Run the focused regression through a red-green cycle, then run the complete Expo tests, TypeScript, scoped Biome checks, and `git diff --check`.

## Device Verification

Install the next preview APK with `adb install -r` only. Do not uninstall the package, clear storage, or replace the package identity.

On the existing selected-text AI Reading Assistant conversation:

1. Confirm saved app state remains present after the update.
2. Open the keyboard and confirm the composer/actions remain above it.
3. Dismiss the keyboard and confirm the content/composer parent returns to the full available height with no keyboard-sized dead area.
4. Capture a screenshot and UI hierarchy bounds as proof.

## Delivery

- Fork fix: branch from current `cha1latte/ReadAny` `main`, commit, push to `origin`, open a fork PR, wait for required checks, merge to fork `main`, and let the `Shlai Phone Release` workflow publish the next preview release.
- Phone update: download the exact published APK, verify package/version/signature/checksum, install it in place, and verify preserved app data plus the fixed live layout.
- Upstream fix: create a separate branch from the latest `codedogQBY/ReadAny` `main`, apply only the focused source/test commit, push that branch to `cha1latte/ReadAny`, and open a ready-for-review PR against official `main` without pushing to the upstream remote.
