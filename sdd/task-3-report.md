# Task 3 Report: Preserve rich desktop import metadata

## Outcome

- Desktop EPUB imports now retain publisher, language, ISBN, publication date, description, and subjects alongside title, author, and cover.
- Normal imports and deleted-book restoration use the same ordered metadata merge: saved values first, then optional catalog metadata, embedded metadata, and filename fallback.
- Existing ratings, reviews, page/chapter counts, and other saved `BookMeta` fields survive restoration.
- Foliate metadata is adapted from string and object title/author/subject shapes; extracted subjects stay in `meta.subjects` and never become library tags.
- Cover extraction failures remain non-blocking after text metadata has been captured.

## TDD evidence

- RED: `pnpm exec vitest run packages/app/src/lib/book/imported-book-meta.test.ts` failed because the desktop metadata helper was absent.
- RED: the added single-subject case failed with `expected [] to deeply equal ["Fiction"]`.
- GREEN: the focused test now passes with 3 tests.

## Verification

- `pnpm exec vitest run packages/app/src/lib/book/imported-book-meta.test.ts` - 1 file, 3 tests passed.
- `pnpm --filter app build` - passed.
- `$env:TZ='UTC'; pnpm --filter @readany/core test` - 81 files, 588 tests passed.
- `git diff --check` - passed.

## Concerns

No known Task 3 concerns. Vite emitted its pre-existing chunk-size and dynamic-import warnings during the successful desktop build.
