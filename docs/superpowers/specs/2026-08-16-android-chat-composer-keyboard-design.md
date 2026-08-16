# Android Chat Composer Keyboard Design

## Problem

On Android, opening the software keyboard in either chat screen lifts the multiline text input, but the composer action row remains underneath the keyboard. At maximum input height this hides the Deep Thinking and Spoiler-Free switches, along with the dismiss and send controls.

The current `react-native-keyboard-controller` `KeyboardAvoidingView` is nested below the screen safe area and header. Its overlap calculation uses the nested layout position, but neither chat screen supplies the missing top safe-area offset. The resulting lift is short by approximately `insets.top`, matching the device reproduction.

## Desired Behavior

- In the regular AI chat and per-book/selected-text chat, the entire composer stays above the Android keyboard.
- The text input, Deep Thinking switch, Spoiler-Free switch, dismiss control, and send control remain visible and tappable.
- The guarantee holds while the multiline input is at its maximum height.
- The chat header remains stationary; the message or empty-state area absorbs the reduced height.
- iOS behavior remains unchanged.

## Design

Keep the existing nested `KeyboardAvoidingView` in both chat screens and pass `keyboardVerticalOffset={insets.top}`. Both screens already obtain `insets` through `useSafeAreaInsets`, so this uses the keyboard controller's intended device-specific offset without introducing a fixed padding value.

The affected screens are:

- `packages/app-expo/src/screens/ChatScreen.tsx`
- `packages/app-expo/src/screens/BookChatScreen.tsx`

Update `packages/app-expo/src/screens/chat-keyboard-layout.test.ts` so it fails unless both Android keyboard-avoidance wrappers consume the top safe-area inset and continue to contain their `ChatInput`.

## Rejected Alternatives

- Moving the avoidance wrapper around the entire screen would change header, sidebar, and wider-layout behavior for a small offset bug.
- Adding fixed bottom padding or translating `ChatInput` would depend on device and keyboard dimensions, could double-shift on some layouts, and would hide the actual coordinate mismatch.

## Verification

1. Observe the regression test fail before implementation and pass after it.
2. Run the focused Expo test and type/lint checks, followed by the repository's shipping checks for the changed lane.
3. Build the exact Shlai preview commit and install it over the existing preview package without clearing app data.
4. On the connected Android phone, enter enough text to reach the maximum composer height in both chat routes and confirm all four action-row controls remain visible above the keyboard.
5. Update the existing upstream keyboard PR with the focused implementation commit; keep Shlai-specific design and release material out of that PR.

## Scope

This change does not redesign the composer, alter keyboard behavior on iOS, change switch semantics, or modify text-input sizing.
