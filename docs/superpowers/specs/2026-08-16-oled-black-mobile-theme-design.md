# OLED Black Mobile Theme Design

## Goal

Add an optional OLED Black theme to the Expo mobile app without replacing or changing the existing Dark theme. OLED Black should use true black for full-screen backgrounds throughout the app and reader while retaining dark-gray elevated surfaces so cards, dialogs, and inputs remain visually distinct.

## Scope

This change covers the Expo mobile app, including onboarding, Appearance settings, navigation chrome, ordinary screens, EPUB content, and PDF reader theming. It does not add or change a desktop/Tauri theme.

## Theme Model

- Extend `ThemeMode` with a persisted `oled` value.
- Add an `oledColors` palette based on the existing dark palette.
- Set `oledColors.background` to `#000000`.
- Keep the current dark values for cards, muted surfaces, borders, text, accents, semantic colors, highlights, and fallback-cover colors.
- Treat both `dark` and `oled` as dark modes for navigation, status-bar content, theme-aware illustrations, and any other dark/light behavioral branch.
- Preserve all existing saved `light`, `dark`, and `sepia` values. A saved `oled` value must restore correctly on launch.

## Selection UI

Add **OLED Black** as a fourth choice in both Appearance settings and the onboarding appearance step. Reflow the theme choices into a two-column, two-row layout on phones so labels and tap targets remain comfortable. Selection remains immediate and uses the existing persistence path.

Add the OLED Black label to every locale that already supplies the Light, Dark, and Sepia labels. Missing or invalid stored values continue to fall back through the existing initial-theme behavior.

## Reader Behavior

The reader receives the OLED palette and `oled` theme mode through the existing theme bridge.

- Reflowable EPUB documents use `#000000` for the page background and the existing dark foreground colors.
- Reader shell, loading, error, and overlay surfaces use the OLED palette through existing theme consumers.
- PDF rendering treats OLED as a dark theme. Light PDF pages receive a black-matched inversion filter, while already-dark pages retain the existing smart-skip behavior.
- Centered, justified, highlighted, fixed-layout, and vertical-writing behavior is unchanged.

## Compatibility and Failure Behavior

No migration is needed because the stored theme is a string and all existing values remain valid. SecureStore read/write behavior remains unchanged. If persistence fails, the in-memory selection still behaves as it does for the current themes; this feature does not add a new error surface.

## Verification

Automated checks will prove:

- `oled` is accepted, persisted, restored, and mapped to its own palette.
- OLED background is exactly `#000000`, while elevated surfaces retain dark-gray values.
- OLED follows dark-mode branches for navigation and status-bar presentation.
- Appearance settings and onboarding both expose all four themes in a phone-safe layout.
- Every supported locale contains the OLED Black label.
- The reader bridge accepts `oled`, the generated reader asset includes the change, and PDF theming handles OLED as dark.
- Existing Light, Dark, and Sepia behavior remains unchanged.

After local and hosted checks, install the exact Shlai preview APK on the connected Android phone and visually verify the library, settings, chat, EPUB reader, and a PDF or representative PDF-theme path.
