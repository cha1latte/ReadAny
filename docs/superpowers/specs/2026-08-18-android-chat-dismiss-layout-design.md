# Android Chat Dismiss Layout Design

## Goal

Keep both Android chat composers above an open keyboard and restore the full-height chat layout immediately after dismissal.

## Reproduction Evidence

- Device: Pixel 9a, 1080 x 2424 at 420 dpi.
- Original app: ReadAny Shlai Preview `1.3.6-shlai.2`, versionCode `3`.
- Package: `io.github.cha1latte.readanyshlai.preview`.
- With the keyboard closed, the chat content ended at y=1459, retaining a 965-pixel keyboard-sized dead area.

## Root Cause

Both chat screens used `react-native-keyboard-controller` with `behavior="height"`. While the keyboard is open, that behavior applies animated `{ height, flex: 0 }`. Its closed branch returns `{}`, so Reanimated leaves the previous native properties in place.

The first attempted fix changed the closed branch to `{ height: undefined, flex: undefined }`. Real-device testing of `1.3.6-shlai.3` disproved it: the before/open/dismiss bounds returned identically, but clearing the animated `flex` also removed the wrapper's static `flex: 1`. The wrapper therefore remained content-height instead of reclaiming the viewport.

## Selected Design

Keep the controller and Android enablement, but switch both screen wrappers from `behavior="height"` to `behavior="padding"`.

The controller's padding behavior animates only `paddingBottom`. It never writes `height` or `flex`, so it keeps the composer above the keyboard without creating a native flex override that can survive dismissal. Its closed value is numeric zero, which Reanimated sends explicitly.

Remove the temporary `react-native-keyboard-controller@1.18.5` pnpm patch and its lockfile metadata.

## Tests

The focused source contract requires:

- both chat screens retain the controller wrapper, Android enablement, vertical offset, and `ChatInput` nesting;
- both wrappers use `behavior="padding"` and not `height`;
- the temporary controller patch is absent; and
- the installed controller padding branch returns `paddingBottom: bottom`.

Run the focused test red before implementation and green afterward, then run the complete mobile, core, web, TypeScript, build, Biome, and diff validation lanes.

## Device Verification

Install the corrected preview with `adb install -r` only. Never uninstall or clear storage.

1. Confirm package identity, unchanged `firstInstallTime`, saved books, and settings.
2. Open the selected-text AI Reading Assistant.
3. Confirm the composer remains above the open keyboard.
4. Dismiss the keyboard and confirm the content/composer parent returns to full available height with no lower dead area.
5. Capture screenshots and UI hierarchy bounds before, open, and dismissed.

## Delivery

- Merge the corrected fork PR only after required checks pass and publish the next Shlai Preview (`1.3.6-shlai.4`).
- Update the phone in place and prove the live result.
- Replace the draft upstream PR branch with the focused padding-based source/test diff from latest official `main`, then mark it ready only after checks pass.
