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

`ChatScreen` and `BookChatScreen` always enable the `react-native-keyboard-controller` `KeyboardAvoidingView` on Android. Its `height` behavior owns a separate animated keyboard state from ReadAny's React Native `useKeyboardInsets` hook. On the reproduced dismissal path, ReadAny's hook had already transitioned to hidden, but the controller wrapper retained its reduced height.

The result is two keyboard-state owners disagreeing: `ChatInput` renders its keyboard-hidden state while the parent remains keyboard-shortened.

## Selected Design

Keep the existing controller wrapper and its proven open-keyboard behavior, but gate its `enabled` prop with the same `useKeyboardInsets().isVisible` state already used by `ChatInput`.

For both chat screens:

1. Read the React Native keyboard visibility through `useKeyboardInsets`.
2. Enable the Android controller wrapper only when `Platform.OS === "android" && keyboardInsets.isVisible`.
3. Leave `behavior="height"` and `keyboardVerticalOffset={insets.top}` unchanged.

When the keyboard closes, `enabled` becomes false and the controller's animated height style is removed, allowing the existing `flex: 1` content style to fill the screen again. When the keyboard opens, the current height-avoidance behavior remains active.

## Alternatives Rejected

### Replace the controller with custom keyboard padding

This would eliminate the second state owner, but it would reimplement height calculation and animation already handled by the controller and could regress the recently fixed open-keyboard layout.

### Upgrade `react-native-keyboard-controller`

This expands the change to a dependency upgrade without proof that a newer release fixes this exact stale-state path. It also increases native-build and cross-platform risk for a two-screen bug.

### Use `padding` instead of `height`

`padding` still consumes the controller's stale progress value. It changes how the empty space is represented without resolving the state disagreement.

## Tests

Update the existing `chat-keyboard-layout.test.ts` contract before production code so it fails until both `ChatScreen` and `BookChatScreen`:

- import and call `useKeyboardInsets`;
- retain the controller `KeyboardAvoidingView`, `height` behavior, and vertical offset; and
- gate `enabled` on Android plus live keyboard visibility.

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
