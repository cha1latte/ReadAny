# Current State

## Data Model

The current annotation system has three main concepts:

- `Highlight`
  - Stored in the `highlights` table.
  - Fields include `book_id`, `cfi`, selected `text`, `color`, optional inline
    `note`, `chapter_title`, timestamps, and sync metadata after migration.
- `Note`
  - Stored in the `notes` table.
  - Fields include `book_id`, optional `highlight_id`, optional `cfi`, `title`,
    Markdown `content`, `chapter_title`, `tags`, timestamps, and sync metadata.
- `Bookmark`
  - Stored in `bookmarks`.

Important mismatch:

- The global Notes UI mostly uses `highlightsWithBooks` and treats
  `highlight.note` as the user's note.
- The standalone `notes` table exists and is synced, but it is not the main
  product workflow.
- Export currently passes `[] as Note[]` in key places, so standalone notes are
  often ignored by the user-facing note export flow.

## Desktop Editing

Desktop already has a Tiptap-based Markdown editor:

- File: `packages/app/src/components/ui/markdown-editor.tsx`
- Uses `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`, and
  placeholder support.
- Initializes with `contentType: "markdown"`.
- Persists `editor.getMarkdown()` through the existing note field.

This is a good starting point, but it is not yet a reusable knowledge editor.
It is coupled to small note editing and stores Markdown only.

## Mobile Editing

Mobile currently uses a native React Native editor:

- File: `packages/app-expo/src/components/ui/RichTextEditor.tsx`
- Uses a multiline `TextInput`.
- Has a Markdown toolbar and preview mode.
- Used by note cards, reader note modal, and selection popover.

This cannot support Tiptap node views or ReadAny custom cards. The mobile
knowledge editor should move to a WebView editor bundle and a typed bridge.

## Notes UI

Desktop and mobile both present notes as book-grouped notebooks:

- Desktop: `packages/app/src/components/notes/NotesPage.tsx`
- Mobile: `packages/app-expo/src/screens/NotesView.tsx`

Current tabs are essentially:

- Notes: highlights with `note`
- Highlights: highlights without `note`

This is useful for annotation review, but not enough for a knowledge base. A
knowledge base needs document editing, source cards, backlinks, book home pages,
and cross-book search.

## Export

The existing exporter supports:

- Markdown
- JSON
- Obsidian Markdown with frontmatter and callouts
- Notion-friendly clipboard text

File: `packages/core/src/export/annotation-exporter.ts`

Limitations:

- It exports annotations, not a document graph.
- Obsidian support is one-shot Markdown output, not a linked vault workflow.
- Custom cards have no serialization policy.

## Sync

The current sync service is per-device JSON changesets:

- File: `packages/core/src/sync/simple-sync.ts`
- `SYNC_TABLES` includes books, highlights, notes, bookmarks, threads, messages,
  skills, tags, groups, and reading sessions.
- Deletions use `sync_tombstones`.
- Conflict behavior is mostly last-write-wins based on timestamp columns.

New knowledge tables must be added to this system. If Markdown files,
attachments, or Obsidian vault outputs are synced as files, they must also be
represented in file sync manifests.

## Testing Baseline

Relevant existing tests:

- `packages/core/src/db/__tests__/note-queries.test.ts`
- `packages/core/src/stores/annotation-store.test.ts`
- `packages/core/src/sync/__tests__/simple-sync.integration.test.ts`
- `packages/core/src/sync/__tests__/sync-files.test.ts`

The next feature should add tests at the DB, store, conversion, and sync layers
before large UI work lands.

## Current Risks

- `highlights.note` and `notes.content` can diverge if both remain writable.
- Markdown-only storage cannot faithfully represent rich custom cards.
- JSON-only storage would weaken Obsidian/export unless a stable Markdown
  projection exists.
- Mobile WebView editing needs a robust bridge, autosave, keyboard handling, and
  error states.
- Obsidian "live sync" can create hard conflict cases if ReadAny and Obsidian
  edit the same file independently.

