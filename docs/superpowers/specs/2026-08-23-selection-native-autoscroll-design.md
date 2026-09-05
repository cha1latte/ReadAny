# Selection Native Auto-Scroll Guard Design

## Problem

ReadAny Shlai 1.3.6-shlai.7 stops a native text-selection gesture from being
completed as a paginator swipe, but Android WebView can still auto-scroll the
paginator's outer container while a selection handle is dragged. In `Desire`,
this leaves the viewport stranded between two columns: part of one page is
visible on the left and part of the next page is visible on the right.

The live failure differs from an ordinary page turn:

- the screen is visibly between columns rather than aligned to either page;
- selection text expands into the next column;
- `ReaderScreen onRelocate` fires during selection changes;
- no `ReaderNav` swipe/tap operation owns the movement.

The first repair cancels `PaginatorTouchTracker` on `selectstart`. That tracker
only requests restoration after paginator-owned movement was marked. Native
WebView auto-scroll happens after `selectstart`, directly changes the outer
container position, and is therefore neither recorded nor restored.

## Goals

- Keep ordinary text selection locked to the page where it began.
- Prevent a native WebView auto-scroll from leaving the viewport between pages.
- Preserve deliberate cross-page selection through the existing held-edge
  navigation path.
- Preserve ordinary taps, swipes, keyboard selection, vertical/scrolled mode,
  and non-selection navigation.
- Keep the new state logic isolated and directly testable.

## Non-goals

- Redesigning Android's native selection toolbar or handles.
- Changing selection colors, annotation creation, or EPUB layout.
- Changing how normal next/previous page navigation works.
- Adding new cross-page selection gestures.

## Design

Add a small selection-position guard alongside `PaginatorTouchTracker`. It owns
only three pieces of state: whether native selection owns the gesture, the
aligned container position where that selection began, and whether an explicit
selection-edge navigation is currently allowed.

When `selectstart` fires, the paginator will:

1. retain the touch tracker's original container position;
2. cancel swipe velocity and displacement state;
3. activate the selection-position guard at that retained position.

At the outer container's scroll boundary, the paginator will ask the guard
whether the new position is authorized. While selection owns the gesture, any
unowned drift is synchronously restored to the retained position and the usual
scroll relocation path is skipped. This catches native WebView auto-scroll even
though it bypasses paginator touch handlers.

The existing one-second selection-edge hold remains the only authorized
cross-page movement. Immediately before its explicit `prev()` or `next()` call,
the guard temporarily permits container movement. When that navigation promise
finishes, the guard rebases to the newly aligned container position before
protection resumes. Errors also leave the guard in a non-navigating state.

When selection becomes collapsed or is cleared, the guard releases ownership.
Normal paginator scrolling then behaves exactly as before.

## Components and data flow

- `paginator-touch.js`: add a framework-free `SelectionPositionGuard` and a
  tracker operation that transfers the original position into selection
  ownership while clearing swipe state.
- `paginator.js`: wire `selectstart`, `selectionchange`, outer-container scroll,
  and held-edge navigation to the guard.
- `paginator-touch-navigation.test.js`: exercise the state transition and source
  wiring without needing a browser DOM.
- `reader.html`: rebuild the checked-in embedded reader after source changes.

The ownership flow is:

`touchstart -> selectstart -> guarded selection -> optional explicit edge page -> selection end`

## Error handling

- Position comparisons use a small tolerance so sub-pixel scroll noise does not
  cause correction loops.
- Explicit edge navigation uses `try/finally`; failed navigation cannot leave
  ordinary container scrolling permanently authorized.
- A missing touch start falls back to the current container position, covering
  selection-handle interactions that begin outside the original iframe event.
- Repeated `selectstart` events do not replace an already protected baseline.

## Verification

Automated regression coverage must prove:

1. selection ownership retains the gesture's original page position;
2. unowned native drift requests restoration;
3. sub-pixel drift is ignored;
4. explicit held-edge navigation is allowed and rebases protection afterward;
5. ending selection restores ordinary scroll behavior;
6. paginator wiring protects the container-scroll boundary and wraps only the
   explicit selection-edge `prev()` / `next()` path.

The test must fail against the current merged implementation before production
code changes. After implementation, run the focused regression, full Expo and
core suites, TypeScript, reader rebuild, changed-file Biome checks, and hosted
PR/release validation. Final acceptance is a physical-phone reproduction in
`Desire`: drag a mid-page selection handle and confirm the viewport remains
aligned unless the handle is deliberately held at the page edge.
