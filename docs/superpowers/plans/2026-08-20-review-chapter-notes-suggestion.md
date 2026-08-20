# Review Chapter Notes Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a localized “Review my notes for this chapter” suggestion to desktop and mobile book chat while preserving note-tool access for localized current-chapter requests.

**Architecture:** Keep each platform's existing local suggestion array and send the visible localized label through the existing chat handler. Reuse `getAnnotations`; add it to the focused current-chapter tool set so languages whose suggestion contains a recognized chapter cue behave like the existing broad English route.

**Tech Stack:** React 19, React Native 0.81, TypeScript 5.9, i18next 25, Vitest 4, Biome 1.9, pnpm 9.15.

## Global Constraints

- The suggestion appears in both desktop `ChatPanel` and mobile `BookChatScreen`.
- The exact English copy is `Review my notes for this chapter`.
- All seven existing chat locales define the new key.
- The implementation reuses `getAnnotations`; it does not add a second notes query or hidden prompt.
- Shlai work is based on `origin/main`; the official upstream pull request is based independently on the latest `upstream/main`.

---

### Task 1: Add the localized suggestion to both clients

**Files:**
- Create: `packages/app-expo/src/screens/book-chat-suggestions.test.ts`
- Modify: `packages/app/src/components/chat/ChatPanel.tsx:245-249`
- Modify: `packages/app-expo/src/screens/BookChatScreen.tsx:343-350`
- Modify: `packages/core/src/i18n/locales/en/chat.json:22-31`
- Modify: `packages/core/src/i18n/locales/zh/chat.json:22-31`
- Modify: `packages/core/src/i18n/locales/zh-TW/chat.json:21-30`
- Modify: `packages/core/src/i18n/locales/ja/chat.json:21-30`
- Modify: `packages/core/src/i18n/locales/ko/chat.json:21-30`
- Modify: `packages/core/src/i18n/locales/fr/chat.json:21-30`
- Modify: `packages/core/src/i18n/locales/es/chat.json:21-30`

**Interfaces:**
- Consumes: i18next key `chat.suggestions.reviewChapterNotes`.
- Produces: a fourth suggestion string passed to each existing `handleSend` callback.

- [ ] **Step 1: Write the failing cross-client and locale contract**

Create `packages/app-expo/src/screens/book-chat-suggestions.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const screensDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(screensDir, "../../../..");
const suggestionKey = 't("chat.suggestions.reviewChapterNotes")';

const clients = [
  resolve(repoRoot, "packages/app/src/components/chat/ChatPanel.tsx"),
  resolve(screensDir, "BookChatScreen.tsx"),
] as const;

const localizedCopy = {
  en: "Review my notes for this chapter",
  zh: "点评我对本章的笔记",
  "zh-TW": "點評我對本章的筆記",
  ja: "この章のメモをレビュー",
  ko: "이 챕터에 대한 내 노트 검토",
  fr: "Relire mes notes sur ce chapitre",
  es: "Revisar mis notas de este capítulo",
} as const;

describe("book chat suggestions", () => {
  for (const client of clients) {
    it(`${client} offers chapter note review`, () => {
      expect(readFileSync(client, "utf8")).toContain(suggestionKey);
    });
  }

  for (const [locale, copy] of Object.entries(localizedCopy)) {
    it(`${locale} provides the chapter note review copy`, () => {
      const messages = JSON.parse(
        readFileSync(
          resolve(repoRoot, `packages/core/src/i18n/locales/${locale}/chat.json`),
          "utf8",
        ),
      ) as { chat: { suggestions: { reviewChapterNotes?: string } } };

      expect(messages.chat.suggestions.reviewChapterNotes).toBe(copy);
    });
  }
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/screens/book-chat-suggestions.test.ts
```

Expected: FAIL because both client sources and all locale files lack `reviewChapterNotes`.

- [ ] **Step 3: Add the suggestion key and localized copy**

Append this lookup after `analyzeAuthor` in both suggestion arrays:

```ts
t("chat.suggestions.reviewChapterNotes")
```

Add `reviewChapterNotes` after `analyzeAuthor` in each locale's `chat.suggestions` object using the exact values asserted in Step 1.

- [ ] **Step 4: Run the focused test and verify green**

Run:

```powershell
pnpm --filter @readany/app-expo exec vitest run src/screens/book-chat-suggestions.test.ts
```

Expected: 9 tests PASS: two client contracts and seven locale contracts.

- [ ] **Step 5: Commit the tested UI and translation slice**

```powershell
git add -- packages/app/src/components/chat/ChatPanel.tsx packages/app-expo/src/screens/BookChatScreen.tsx packages/app-expo/src/screens/book-chat-suggestions.test.ts packages/core/src/i18n/locales/en/chat.json packages/core/src/i18n/locales/zh/chat.json packages/core/src/i18n/locales/zh-TW/chat.json packages/core/src/i18n/locales/ja/chat.json packages/core/src/i18n/locales/ko/chat.json packages/core/src/i18n/locales/fr/chat.json packages/core/src/i18n/locales/es/chat.json
git commit -m "feat(chat): add chapter notes review suggestion"
```

### Task 2: Preserve annotation access on the current-chapter route

**Files:**
- Modify: `packages/core/src/ai/__tests__/reading-agent-tools.test.ts`
- Modify: `packages/core/src/ai/agents/reading-agent.ts:169-181,337-368`

**Interfaces:**
- Consumes: the existing `getAnnotations` tool registered for book chat.
- Produces: `getFocusedToolNames("current_chapter_context", ...)` retaining `getAnnotations` for indexed and non-indexed books, ordered after the lightweight current-context reads.

- [ ] **Step 1: Write a failing localized routing regression**

Add this test beside the existing current-page and chapter routing tests in `reading-agent-tools.test.ts`:

```ts
it.each([
  "Review my notes for this chapter",
  "点评我对本章的笔记",
])("keeps note access for the chapter review suggestion: %s", async (prompt) => {
  let capturedTools: any[] = [];
  createReactAgentMock.mockImplementation((config) => {
    capturedTools = config.tools;
    return {
      streamEvents: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          // no-op stream
        },
      })),
    };
  });

  for await (const event of streamReadingAgent(
    {
      aiConfig: makeAIConfig(),
      book: null,
      bookId: "book-1",
      semanticContext: null,
      enabledSkills: [],
      isVectorized: true,
      getAvailableTools,
    },
    prompt,
  )) {
    void event;
  }

  const toolNames = capturedTools.map((tool) => tool.name);
  expect(toolNames).toContain("getAnnotations");
  expect(toolNames).toContain("getCurrentChapter");
});
```

- [ ] **Step 2: Run the focused routing regression and verify red**

Run:

```powershell
pnpm --filter @readany/core exec vitest run src/ai/__tests__/reading-agent-tools.test.ts -t "keeps note access for the chapter review suggestion"
```

Expected: the English case passes through the broad book route, but the Simplified Chinese case FAILS because `current_chapter_context` filters out `getAnnotations`.

- [ ] **Step 3: Add `getAnnotations` to the focused route**

In `CATEGORY_TOOL_ORDER.current_chapter_context`, insert:

```ts
"getAnnotations",
```

after `getReadingProgress`. Add the same name after `getReadingProgress` in both the indexed and fallback arrays returned by `getFocusedToolNames` for `current_chapter_context`.

- [ ] **Step 4: Run focused routing and suggestion tests**

Run:

```powershell
pnpm --filter @readany/core exec vitest run src/ai/__tests__/reading-agent-tools.test.ts -t "keeps note access for the chapter review suggestion"
pnpm --filter @readany/app-expo exec vitest run src/screens/book-chat-suggestions.test.ts
```

Expected: both routing cases and all 9 suggestion contracts PASS.

- [ ] **Step 5: Commit the routing regression and fix**

```powershell
git add -- packages/core/src/ai/__tests__/reading-agent-tools.test.ts packages/core/src/ai/agents/reading-agent.ts
git commit -m "fix(ai): retain notes access for chapter requests"
```

### Task 3: Verify and publish the Shlai and upstream branches

**Files:**
- Verify only; no new source files.

**Interfaces:**
- Consumes: the two tested feature commits from Tasks 1 and 2.
- Produces: one Shlai fork pull request and one focused official-upstream pull request.

- [ ] **Step 1: Run full affected-lane verification**

Run:

```powershell
pnpm --filter @readany/core test
pnpm --filter @readany/app-expo test
pnpm --filter @readany/core exec tsc --noEmit
pnpm --filter @readany/app-expo exec tsc --noEmit
pnpm exec biome check packages/app/src/components/chat/ChatPanel.tsx packages/app-expo/src/screens/BookChatScreen.tsx packages/app-expo/src/screens/book-chat-suggestions.test.ts packages/core/src/ai/agents/reading-agent.ts packages/core/src/ai/__tests__/reading-agent-tools.test.ts packages/core/src/i18n/locales/en/chat.json packages/core/src/i18n/locales/zh/chat.json packages/core/src/i18n/locales/zh-TW/chat.json packages/core/src/i18n/locales/ja/chat.json packages/core/src/i18n/locales/ko/chat.json packages/core/src/i18n/locales/fr/chat.json packages/core/src/i18n/locales/es/chat.json
git diff --check origin/main...HEAD
```

Expected: all tests, type checks, formatting checks, and whitespace checks PASS.

- [ ] **Step 2: Inspect and publish the Shlai branch**

Confirm `git status --short --branch`, `git diff --stat origin/main...HEAD`, and `git log --oneline origin/main..HEAD`. Push only `feat/review-chapter-notes-suggestion` to `origin`, then create one pull request against `cha1latte/ReadAny:main` describing the two-platform suggestion, existing-tool reuse, routing regression, and verification.

- [ ] **Step 3: Create a clean official-upstream worktree**

Fetch `upstream/main`, create `D:\dev\ReadAny-notes-review-upstream-worktree` on branch `feat/review-chapter-notes-suggestion-upstream` from the fetched official head, and install the pinned workspace dependencies.

- [ ] **Step 4: Apply only the general feature commits**

Cherry-pick the Task 1 and Task 2 commits. Do not cherry-pick either Superpowers documentation commit or any Shlai branding/release changes. Resolve nothing by copying fork-only files.

- [ ] **Step 5: Verify and publish the official-upstream branch**

Repeat Step 1 in the official-upstream worktree. Inspect the final diff against `upstream/main`, push the focused upstream branch to `origin`, and create one draft pull request with base `codedogQBY/ReadAny:main` and head `cha1latte:feat/review-chapter-notes-suggestion-upstream`.
