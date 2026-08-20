# Review Chapter Notes Suggestion Design

## Goal

Add a fourth book-chat suggestion, "Review my notes for this chapter", to ReadAny's desktop and mobile AI assistants. Selecting it must send the localized suggestion through the existing chat flow and allow the reading agent to inspect the user's existing notes while retaining current-chapter context.

## Scope

- Show the suggestion in the empty-state chapter suggestion list in desktop `ChatPanel` and mobile `BookChatScreen`.
- Add the `reviewChapterNotes` translation key to every currently supported chat locale: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, and Spanish.
- Reuse ReadAny's existing `getAnnotations` tool. Do not add a second notes-loading path, preload note contents in either client, or change annotation storage/query behavior.
- Make `getAnnotations` available to the reading agent's `current_chapter_context` route. The Chinese copy uses the recognized current-chapter cue “本章” so it does not collide with ReadAny's broader specific-chapter matcher.
- Deliver the feature to ReadAny Shlai first, then open a focused official-upstream pull request from the latest `codedogQBY/ReadAny:main`.

## User Experience

The new suggestion appears after "Analyze the author's argument" in the existing list. It uses the same visual treatment and interaction as the other suggestions. Clicking or tapping it sends its localized visible text as a normal user message; there is no hidden prompt and no new loading state.

The reading agent receives the same book and current-chapter context it already receives for chapter questions. It may call `getAnnotations` to retrieve the current book's highlights and notes, whose results include chapter titles, and use the current chapter name to identify the relevant entries. The English suggestion already retains annotation access through the broad book route; adding the existing tool to the focused chapter route keeps localized suggestions equivalent. Chinese uses “本章”, a natural current-chapter phrase that follows the focused route without changing the classifier's existing specific-chapter behavior. If the current chapter has no usable notes, the model should say so rather than inventing a review. Existing chat configuration and tool errors continue through the current error handling.

## Architecture and Data Flow

1. Each client resolves `chat.suggestions.reviewChapterNotes` with i18next and adds it to its existing suggestion array.
2. The existing suggestion handler sends that string through `handleSend` with the active `bookId`.
3. The reading agent classifies each localized sentence using its existing routing rules. English currently uses the broad book route, while the Chinese “本章” cue uses `current_chapter_context`.
4. The focused chapter route retains its current chapter-retrieval tools and additionally permits the already-registered `getAnnotations` tool, matching the broad route's note access.
5. `getAnnotations` returns the current book's existing annotation data, including each available `chapterTitle`; the model relates those results to the current chapter context and responds normally.

No new shared UI abstraction is needed. The two short suggestion arrays remain local to their platform components, matching the current code structure.

## Testing

- Add a focused suggestion contract test that reads both client sources and verifies that each includes `chat.suggestions.reviewChapterNotes` in the chapter suggestion list.
- Verify that every chat locale defines a non-empty `reviewChapterNotes` value and that the English copy is exactly "Review my notes for this chapter".
- Add reading-agent routing regressions using the exact English and Simplified Chinese suggestions. Assert that `getAnnotations` is available for both and that the localized current-chapter request retains its focused chapter tools.
- Run the focused tests in their owning packages, then the core and Expo test suites, TypeScript checks, changed-file Biome checks, and `git diff --check` before publishing.

## Delivery

The Shlai branch is based on the fork's current `origin/main` and contains the feature plus its tests. After the Shlai pull request is merged, create a separate worktree and branch from the freshly fetched official `upstream/main`, apply only the general feature commits, rerun validation, push the focused branch to Celia's fork, and open a non-draft pull request against `codedogQBY/ReadAny:main`.
