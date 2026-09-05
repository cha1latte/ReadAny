# Shlai Tool Timeout Recovery Implementation Plan

**Goal:** Make unindexed local-book tools complete reliably on Android and fail once, not repeatedly, when the source is genuinely unavailable.

**Architecture:** Register a dedicated, persistent mobile fallback extractor at app root; coalesce extraction by book in core; add a per-turn failure circuit breaker around fallback tools.

## Task 1: Coalesce core fallback extraction

- Add failing concurrency, retry-after-failure, and provider-replacement tests in `packages/core/src/ai/__tests__/fallback-content-service.test.ts`.
- Add an in-flight promise map and provider-generation guard in `packages/core/src/ai/fallback-content-service.ts`.
- Run the focused service tests.

## Task 2: Stop repeated fallback failures per turn

- Add a failing agent regression in `packages/core/src/ai/__tests__/reading-agent-tools.test.ts`.
- Track the first fallback-source error in `packages/core/src/ai/agents/reading-agent.ts` and short-circuit later fallback tools only for that turn.
- Run the focused agent tests.

## Task 3: Move fallback extraction to a persistent mobile host

- Extract the provider construction into `packages/app-expo/src/lib/rag/mobile-fallback-content-provider.ts` with focused tests.
- Add `packages/app-expo/src/components/rag/MobileFallbackExtractorHost.tsx`.
- Mount the host in `packages/app-expo/src/App.tsx` beside navigation.
- Remove fallback-provider ownership from `packages/app-expo/src/screens/LibraryScreen.tsx` while preserving its vectorization extractor.
- Make the extraction WebView non-zero-sized and add a root-ownership source contract.
- Run the focused Expo tests.

## Task 4: Verify

- Run affected core and Expo test suites.
- Run TypeScript and Biome checks for changed files.
- Run `git diff --check` and inspect the complete diff against `origin/main`.
- If local Android build tooling is ready, install over the connected Shlai preview and repeat the exact unindexed-book prompt while collecting bounded logs.

No commit, push, pull request, or release action is included without separate authorization.
