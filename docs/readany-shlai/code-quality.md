# ReadAny Shlai code review guards

Apply these guards to changed behavior and its callers. A finding needs a concrete
failure, contract mismatch, or maintenance cost in the diff. Existing architecture
is context, not a reason to demand a repository-wide rewrite in an unrelated PR.

## Architecture

- Shared business logic belongs in `packages/core`; platform implementations live
  in the desktop, mobile, and CLI packages. Core code must not import app internals
  or call Tauri/Expo APIs directly. Use the existing `IPlatformService` boundary.
- Core already exports React hooks and Zustand stores. Those are supported parts
  of this repository; do not impose a blanket ban on them.
- Preserve one authoritative owner for persisted reading position, annotations,
  settings, and playback state. Derived UI state should not become an independent
  writable copy without a clear reconciliation contract.
- Check all affected adapters when changing a shared interface. Preserve return
  values, errors, cancellation, resource cleanup, and unsupported-capability
  behavior. An adapter must not report success for work it did not perform.
- Keep platform-specific presentation and lifecycle code local. Share domain
  rules when desktop and mobile must agree, without forcing identical UI or
  pretending that their native capabilities are interchangeable.

## KISS and YAGNI

- Prefer a direct implementation using existing helpers. Flag added indirection,
  configuration, registries, or dependencies when they introduce a demonstrable
  cost without serving a current caller or an explicit requirement.
- Avoid speculative plugin systems, unused options, pass-through wrappers, and
  compatibility branches for unsupported scenarios. Cite the unused path and
  explain the cost before suggesting removal.
- Keep the smallest fix that satisfies the whole failure contract. A silent
  catch or an extra UI guard is not a simpler solution if it hides corrupt state.
- Do not extract an abstraction solely because two snippets look alike. Extract
  shared policy when duplicated implementations must change together; retain
  simple local code when the behaviors have different reasons to change.

## SOLID as practical review questions

- **Single responsibility:** does the change mix domain policy, persistence,
  native transport, and presentation in a way that causes unrelated changes or
  hides cleanup? Identify the conflicting responsibilities and the smallest seam.
- **Open/closed:** does an existing provider or adapter extension point already
  solve this need? Reuse it when appropriate; do not build a new framework for a
  hypothetical second implementation.
- **Substitution:** can each affected platform adapter honor the shared contract,
  including rejection, cancellation, and resource ownership?
- **Interface segregation:** does a new interface member force unrelated callers
  to depend on or fake a capability they cannot support? Consider a focused
  capability or explicit unsupported result before expanding the shared surface.
- **Dependency inversion:** keep domain policy behind existing service contracts.
  Do not require dependency-injection containers or classes for simple functions.

## Code quality and evidence

- Flag swallowed errors, fake success, stale async writes, missing disposal,
  invalid state combinations, and type assertions that bypass real validation.
- Validate untrusted data at file, WebView, provider, and network boundaries.
  Preserve database/file consistency through partial import, rollback, and sync.
- Use nearby naming, exports, and lifecycle conventions. Avoid style-only
  rewrites, arbitrary file-length limits, or blanket complexity thresholds.
- Prefer focused regression evidence for data loss, migrations, cancellation,
  import/sync, and release identity. Cosmetic changes do not need new tests.
- Keep speculative concerns as questions. Optional polish belongs in Bunny's
  limited nitpick section; do not label an acronym violation as a blocking defect.

These are review guidelines, not a new static-analysis framework. Existing Biome,
TypeScript, and package tests provide deterministic checks. Bunny supplies an
additional advisory review and cannot replace owner review or device verification.
