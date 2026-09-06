# Reader idle work

Pixel 7a debugging on 2026-09-06 identified two sources of unnecessary work
while reading an untouched page: permanently mounted extraction WebViews
with loading spinners, and a whole-store reading-session subscription that
rendered the reader on every timer tick.

## Implementation

- Create the native extraction WebView only while extraction requests are
  pending. Release it after completion, cancellation, timeout, or failure.
  Ignore stale events from an earlier request generation and suppress the
  extractor's loading spinner.
- Subscribe to stable reading-session actions individually. Keep time
  accounting and persistence running without rendering the reader each second.
- Keep lightweight toolbars mounted for immediate native entrance animations.
  Preserve their animation bindings, cancel transition/timer work on cleanup,
  and stop the sync icon's animation while hidden without cancelling sync.
- Mount reader panels only when opened. Keep TTS playback state and lyric
  layout data outside the panel, and clean up the definition controller.
- Report trusted reading gestures so page turns and scrolling resume an
  idle-paused reading session. Synthetic events and layout changes do not
  extend reading time.

Unmounting the toolbars on every dismissal made content appear partway
through the entrance. Waiting for native layout fixed the ordering but added
noticeable delay compared with unchanged Shlai Preview. Retaining the toolbar
views and starting their native animation directly from the tap handler
restored comparable responsiveness in four recorded openings.

## Verification

Same Pixel, Dev app, same book, mA overlay disabled, approximately 30 seconds
on an untouched reading page:

| Measurement | Before | Final implementation |
| --- | ---: | ---: |
| Reader draws | 414 | 0 |
| JavaScript thread CPU seconds | 1.948 | 0.167 |
| WebView sandbox CPU seconds | 1.245 | 0.005 |
| Reader renders during ten session ticks | 10 | 0 |

The final reader retained its toolbar views during this measurement. Device
checks also covered page-touch session resume and EPUB extraction cleanup.
Automated coverage includes request lifetimes, cancellation and stale events,
reading-time accounting/persistence, gesture filtering, toolbar transitions,
and sync-animation visibility. Validation passed: 541 mobile tests, 991 core
tests, 94 desktop tests, and mobile/desktop TypeScript checks.

These USB-connected debug samples demonstrate reduced redraw and JavaScript/
WebView work, not measured battery savings. React Native Fabric still schedules
approximately 60 native callbacks per second. Overall app CPU fell from 8.223
to 6.031 seconds, while main-thread CPU rose from 3.197 to 5.038 seconds, so
this change does not eliminate all background activity. Dependencies were
not modified.

Raw recordings and traces were retained locally in
`readany-pixel-reading-trace-20260906` and
`readany-pixel-reading-fix-20260906` under the investigator's temporary directory.
Final artifacts include `retained.perfetto-trace`, `retained-comparison.json`,
`retained-counts.json`, `toolbar-retained.mp4`, and `toolbar-preview.mp4`.
