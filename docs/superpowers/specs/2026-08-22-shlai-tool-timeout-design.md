# Shlai Tool Timeout Recovery Design

## Goal

Stop ReadAny Shlai's mobile reading assistant from timing out while reading an unindexed local book, and prevent one unavailable source from producing a cascade of failed fallback tool calls.

## Confirmed Failure

On the connected Pixel, two `fallbackSearch` calls entered the mobile fallback provider together and both waited about 45 seconds. `fallbackToc` and `fallbackChapterContext` then repeated the same extraction. Android froze the invisible WebView renderer while those requests were pending. The active EPUB is only about 1.1 MB, so book size is not the cause.

The relevant ownership and concurrency defects are:

- `LibraryScreen` owns and registers the fallback extractor even though book chat runs on screens above it.
- `ExtractorWebView` is rendered at zero width and height, allowing Android to treat its renderer as non-visible work.
- `FallbackContentService` caches only completed results and does not coalesce concurrent reads for the same book.
- The reading agent does not remember that the original-file fallback source has already failed during the current turn.

## Design

### Persistent fallback extraction host

Add a `MobileFallbackExtractorHost` beside the root navigator. It owns a dedicated `ExtractorWebView` for original-file AI tools and registers the fallback provider for the lifetime of the application. `LibraryScreen` keeps its existing extractor for interactive vectorization, but no longer owns the AI fallback provider.

The host renders the WebView in a one-pixel, non-interactive container instead of a zero-sized view. It remains attached while navigation moves between Library, Reader, and Book Chat, without exposing visible UI or accepting touches.

The file resolution, local-file validation, MIME selection, Base64 conversion, and extraction call move unchanged from `LibraryScreen` into a testable provider helper used by the root host.

### Per-book in-flight coalescing

`FallbackContentService` stores the pending extraction promise by book ID. Concurrent tools requesting the same book share that promise. The entry is removed after success or failure so a later user turn can retry. Completed chapters keep the existing five-minute cache.

Changing the registered provider clears both completed and pending maps. A stale provider completion cannot populate the new provider's cache.

### Per-turn fallback circuit breaker

The reading-agent wrapper records an original-file fallback error returned by `fallbackSearch`, `fallbackToc`, or `fallbackChapterContext`. Later fallback calls in the same agent turn receive a structured source-unavailable result immediately and do not invoke extraction again. A new user turn creates fresh state and may retry normally.

The existing 45-second extraction safety limit remains. The fix removes the freeze and duplicated work rather than hiding them behind a longer timeout.

## Testing

- Prove concurrent `getChapters` calls share one provider request and the same result.
- Prove a failed in-flight request is cleared and a later call retries.
- Prove provider replacement prevents stale completion from warming the cache.
- Prove one fallback-source error suppresses later fallback tools during the same agent turn, while unrelated tools still run.
- Prove the mobile provider helper resolves local paths, rejects remote or missing files, and calls the extractor with the expected payload.
- Add a source contract proving the persistent host is mounted at app root and the AI provider is no longer registered by `LibraryScreen`.
- Run focused tests, affected package suites, TypeScript, Biome, and whitespace validation, then install a local debug/preview build on the connected Pixel for an end-to-end retry if build tooling is available.

## Non-goals

- Replacing the reader HTML extractor with a new native EPUB parser.
- Increasing timeout values.
- Changing vectorization behavior or the visible chat UI.
- Publishing, committing, or merging without separate authorization.
