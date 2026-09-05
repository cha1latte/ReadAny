# Selection Native Auto-Scroll Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Android native text selection aligned to its starting page while preserving deliberate held-edge cross-page selection.

**Architecture:** Extend the framework-free paginator touch helper with a selection-position guard, then wire that guard at the paginator's outer scroll ownership boundary. Native WebView drift is restored synchronously; only the existing explicit selection-edge navigation temporarily authorizes scrolling and then rebases the guard.

**Tech Stack:** JavaScript ES modules, Foliate paginator, Expo-bundled WebView reader, Vitest, Biome, pnpm.

## Global Constraints

- Preserve ordinary taps, swipes, keyboard selection, vertical/scrolled mode, and non-selection navigation.
- Preserve deliberate cross-page selection through the existing one-second held-edge navigation path.
- Do not redesign selection handles, annotations, EPUB layout, or page navigation.
- Use a `0.5` pixel tolerance for sub-pixel scroll noise.
- Rebuild `packages/app-expo/assets/reader/reader.html` after source changes.

---

### Task 1: Selection position state machine

**Files:**
- Modify: `packages/foliate-js/paginator-touch.js`
- Modify: `packages/app-expo/src/lib/reader/paginator-touch-navigation.test.js`

**Interfaces:**
- Consumes: `PaginatorTouchTracker.state.startPosition` recorded by `start(touch, timeStamp, startPosition)`.
- Produces: `PaginatorTouchTracker.takeSelectionStart(currentPosition): number`.
- Produces: `SelectionPositionGuard.begin(position)`, `correctionFor(currentPosition)`, `beginNavigation()`, `finishNavigation(position)`, `end()`, and `active`.

- [ ] **Step 1: Write failing state-machine regression tests**

Extend the existing import:

```js
import {
  PaginatorTouchTracker,
  SelectionPositionGuard,
  hasActiveTextSelection,
} from "../../../../foliate-js/paginator-touch.js";
```

Add focused tests that express the live failure and authorized-navigation behavior:

```js
it("retains the aligned touch start when selection takes ownership before swipe movement", () => {
  const tracker = new PaginatorTouchTracker();
  tracker.start(touch, 100, 1080);

  expect(tracker.takeSelectionStart(1410)).toBe(1080);
  expect(tracker.state).toBeUndefined();
  expect(tracker.scrolled).toBe(false);
});

it("falls back to the current position when selection starts without tracked touch state", () => {
  expect(new PaginatorTouchTracker().takeSelectionStart(1080)).toBe(1080);
});

it("restores unowned native selection drift but ignores sub-pixel noise", () => {
  const guard = new SelectionPositionGuard();
  guard.begin(1080);

  expect(guard.correctionFor(1410)).toBe(1080);
  expect(guard.correctionFor(1080.4)).toBeNull();
});

it("allows explicit edge navigation and rebases protection afterward", () => {
  const guard = new SelectionPositionGuard();
  guard.begin(1080);
  guard.beginNavigation();

  expect(guard.correctionFor(2160)).toBeNull();
  guard.finishNavigation(2160);
  expect(guard.correctionFor(2450)).toBe(2160);
});

it("releases position ownership when selection ends", () => {
  const guard = new SelectionPositionGuard();
  guard.begin(1080);
  guard.end();

  expect(guard.active).toBe(false);
  expect(guard.correctionFor(1410)).toBeNull();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/lib/reader/paginator-touch-navigation.test.js
```

Expected: FAIL because `SelectionPositionGuard` and `takeSelectionStart` are not exported.

- [ ] **Step 3: Implement the minimal state machine**

Add this tracker method and class to `paginator-touch.js`:

```js
takeSelectionStart(currentPosition) {
  const position = Number.isFinite(this.state?.startPosition)
    ? this.state.startPosition
    : currentPosition;
  this.state = undefined;
  this.scrolled = false;
  return position;
}

export class SelectionPositionGuard {
  position;
  navigating = false;

  get active() {
    return Number.isFinite(this.position);
  }

  begin(position) {
    if (!this.active && Number.isFinite(position)) this.position = position;
  }

  correctionFor(currentPosition) {
    if (!this.active || this.navigating || !Number.isFinite(currentPosition)) return null;
    return Math.abs(currentPosition - this.position) > 0.5 ? this.position : null;
  }

  beginNavigation() {
    if (this.active) this.navigating = true;
  }

  finishNavigation(position) {
    if (this.active && Number.isFinite(position)) this.position = position;
    this.navigating = false;
  }

  end() {
    this.position = undefined;
    this.navigating = false;
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command again.

Expected: all helper tests PASS; the later paginator wiring assertions remain unchanged and pass.

- [ ] **Step 5: Commit the independently tested helper**

```powershell
git add -- packages/foliate-js/paginator-touch.js packages/app-expo/src/lib/reader/paginator-touch-navigation.test.js
git commit -m "fix(reader): guard native selection position"
```

---

### Task 2: Paginator ownership wiring

**Files:**
- Modify: `packages/foliate-js/paginator.js`
- Modify: `packages/app-expo/src/lib/reader/paginator-touch-navigation.test.js`
- Modify: `packages/app-expo/assets/reader/reader.html`

**Interfaces:**
- Consumes: `SelectionPositionGuard` and `PaginatorTouchTracker.takeSelectionStart(currentPosition)` from Task 1.
- Produces: guarded outer-container scrolling and explicitly authorized held-edge navigation.

- [ ] **Step 1: Write failing paginator wiring assertions**

Update the source-wiring test to require all owner boundaries:

```js
expect(paginatorSource).toContain(
  "const restorePosition = this.#selectionPosition.correctionFor(this.containerPosition)",
);
expect(paginatorSource).toContain("this.#beginTextSelection()" );
expect(paginatorSource).toContain("this.#selectionPosition.end()" );
expect(paginatorSource).toContain("this.#selectionPosition.beginNavigation()" );
expect(paginatorSource).toContain(
  "this.#selectionPosition.finishNavigation(this.containerPosition)",
);
```

Keep the existing assertions for three delayed-selection guards and explicit `prev()` / `next()` calls.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/lib/reader/paginator-touch-navigation.test.js
```

Expected: FAIL because `paginator.js` does not yet contain the selection-position owner wiring.

- [ ] **Step 3: Wire the guard at selection start and container scroll**

Import and instantiate the guard:

```js
import {
    PaginatorTouchTracker,
    SelectionPositionGuard,
    hasActiveTextSelection,
} from './paginator-touch.js'

#touchNavigation = new PaginatorTouchTracker()
#selectionPosition = new SelectionPositionGuard()
```

At the beginning of the outer container scroll listener, restore unowned drift before dispatching any scroll or relocation event:

```js
const restorePosition = this.#selectionPosition.correctionFor(this.containerPosition)
if (restorePosition !== null) {
    this.containerPosition = restorePosition
    return
}
```

Replace the `selectstart` cancellation callback with `this.#beginTextSelection()`. Add:

```js
#beginTextSelection() {
    const startPosition = this.#touchNavigation.takeSelectionStart(this.containerPosition)
    this.#selectionPosition.begin(startPosition)
    const restorePosition = this.#selectionPosition.correctionFor(this.containerPosition)
    if (restorePosition !== null) this.containerPosition = restorePosition
}
```

Replace the three active-selection calls to `#cancelTouchNavigation()` with `#beginTextSelection()` so delayed native selection detection retains the original baseline.

- [ ] **Step 4: Release and authorize ownership at the correct boundaries**

In `selectionchange`, end protection before returning for cleared or collapsed selection:

```js
if (!sel.rangeCount || sel.isCollapsed || sel.type !== 'Range') {
    this.#selectionPosition.end()
}
```

Wrap only the held-edge navigation call:

```js
this.#selectionPosition.beginNavigation()
try {
    if (direction === 'backward') await this.prev()
    else await this.next()
} finally {
    this.#selectionPosition.finishNavigation(this.containerPosition)
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Step 2 command again.

Expected: all helper and paginator wiring tests PASS.

- [ ] **Step 6: Rebuild the embedded reader**

Run:

```powershell
pnpm --filter @readany/app-expo run build:reader
```

Expected: `Built reader.html` and a generated diff only in `packages/app-expo/assets/reader/reader.html`.

- [ ] **Step 7: Run the complete local verification lane**

Run:

```powershell
$env:TZ='UTC'; pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
pnpm exec tsc --noEmit -p packages/app-expo/tsconfig.json
pnpm exec biome check --no-errors-on-unmatched biome.json packages/foliate-js/paginator.js packages/foliate-js/paginator-touch.js packages/app-expo/src/lib/reader/paginator-touch-navigation.test.js
git diff --check
```

Expected: `935` core tests pass, at least `407` Expo tests pass with the new tests included, TypeScript exits `0`, Biome exits `0`, and `git diff --check` exits `0`.

- [ ] **Step 8: Commit the paginator integration and generated reader**

```powershell
git add -- packages/foliate-js/paginator.js packages/app-expo/src/lib/reader/paginator-touch-navigation.test.js packages/app-expo/assets/reader/reader.html
git commit -m "fix(reader): block native selection auto-scroll"
```

---

### Task 3: Ship and verify the corrected phone release

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: verified commits from Tasks 1 and 2.
- Produces: merged fork PR, exact post-merge signed preview release, and physical-phone proof in `Desire`.

- [ ] **Step 1: Audit branch scope before publication**

Run:

```powershell
git status --short --branch
git diff --check origin/main HEAD
git diff --name-status origin/main HEAD
git log --oneline origin/main..HEAD
```

Expected: only the design, plan, helper, test, paginator, and generated reader files appear; no unrelated worktree changes.

- [ ] **Step 2: Push and open one non-draft PR**

Push only to `origin`, create a PR targeting `cha1latte/ReadAny:main`, and include the physical `Desire` split-column evidence plus exact local validation counts.

- [ ] **Step 3: Wait for hosted validation and Preview APK**

Require both `Validate` and `Preview APK` to succeed on the exact final head. Re-check comments, reviews, mergeability, and head SHA before merging.

- [ ] **Step 4: Merge and verify exact main SHA**

Squash-merge the PR, fetch `origin/main`, and confirm the PR merge commit equals `origin/main`.

- [ ] **Step 5: Verify the exact post-merge release artifact**

Wait for `Shlai Phone Release` on the exact merge SHA. Download the new APK and `.sha256`, verify SHA-256, package `io.github.cha1latte.readanyshlai.preview`, a versionCode greater than `8`, and signer SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.

- [ ] **Step 6: Request the phone and install in place**

Ask Celia to plug in and unlock the Pixel only after Step 5. Record the current version and `firstInstallTime`, install with `adb install -r`, then verify the new version and unchanged `firstInstallTime`.

- [ ] **Step 7: Reproduce the exact physical failure path**

Open `Desire`, use a page with multi-column paginated content, drag a mid-page native selection handle, and capture before/after screenshots plus filtered `ReaderNav`, `SelectionPaging`, and relocation logs.

Expected: the viewport remains aligned to its starting page, selection remains active, no unowned relocation occurs, and deliberate held-edge navigation remains possible.
