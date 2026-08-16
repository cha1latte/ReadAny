# Task 1 Report: Ordered metadata merge contract

## Outcome

Implemented the ordered metadata merge contract for book details.

- Added `mergeBookMetadataSources`, preserving the first nonblank normalized value across sources.
- Applied language, ISBN, publish-date, and subject normalization while merging.
- Exported the merge function through `packages/core/src/utils/index.ts`.
- Stopped automatic details repair from copying subjects into user library tags.
- Added focused regression coverage for precedence, normalization, invalid candidates, and subject/tag separation.

## TDD evidence

The new focused test was run before production changes and failed for the expected reasons: the merge function was absent, and subject repair populated `tagsText`. After implementation, the same test passed.

## Verification

- `TZ=UTC pnpm --filter @readany/core test -- src/utils/book-metadata.test.ts` — 1 file, 3 tests passed.
- `TZ=UTC pnpm --filter @readany/core test` — 81 files, 587 tests passed.
- `git diff --check` — passed.

## Concerns

No known concerns within Task 1 scope. The merge contract intentionally handles metadata fields only; user tags remain independent from extracted subjects.

## Follow-up regression: empty user tags

Files changed:

- `packages/core/src/utils/book-metadata.ts`
- `packages/core/src/utils/book-metadata.test.ts`
- `sdd/task-1-report.md`

RED: `$env:TZ='UTC'; pnpm --filter @readany/core test -- src/utils/book-metadata.test.ts` — failed 1 of 4 tests because complete publication metadata with empty `tagsText` still returned `true` from `hasMissingBookMetadataAutoFillTargets`.

GREEN: `$env:TZ='UTC'; pnpm --filter @readany/core test -- src/utils/book-metadata.test.ts` — 1 file, 4 tests passed.

Full verification: `$env:TZ='UTC'; pnpm --filter @readany/core test` — 81 files, 588 tests passed.

Fix: removed `tagsText` from the autofill predicate so intentionally empty user tags do not trigger repeated metadata extraction.
