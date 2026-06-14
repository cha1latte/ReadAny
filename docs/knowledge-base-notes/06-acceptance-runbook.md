# Acceptance Runbook

This runbook turns the knowledge-base design docs into evidence that can be
checked before the branch is considered ready. Passing one narrow test is not
enough; the feature is accepted only when the data model, desktop UX, mobile UX,
sync/export, AI tools, and ReadAny cards all preserve the same vault document
model.

## Release Gate

The branch is ready for final PR review when all of these are true:

- The worktree is clean and pushed.
- Core knowledge, AI, sync, export, desktop, and mobile TypeScript checks pass.
- Desktop and mobile both show a vault hierarchy before editing.
- Folder nodes open folder browsers, not empty document editors.
- Document nodes open a WYSIWYG Tiptap surface with quiet autosave.
- The same document path appears in tree rows, breadcrumbs, search results,
  import/export previews, AI results, proposal cards, and failure cards.
- AI write tools create confirmation-required proposals only; applying a
  proposal is the first database write.
- ReadAny cards preserve type, version, source attrs, structured data, schema
  migrations, and Markdown fallback on desktop, mobile, export, and AI context.
- Unsupported or future card versions render safe fallback cards instead of raw
  JSON or disappearing content.

## Automated Evidence

Run these before each stable commit:

```bash
pnpm --filter @readany/core exec vitest run \
  src/db/__tests__/knowledge-queries.test.ts \
  src/sync/__tests__/simple-sync.integration.test.ts \
  src/knowledge/document-utils.test.ts \
  src/knowledge/vault-path-fidelity.test.ts \
  src/knowledge/editor-profile.test.ts \
  src/knowledge/editor-projection.test.ts \
  src/knowledge/mobile-editor-bridge.test.ts \
  src/knowledge/rich-text-preservation.test.ts \
  src/knowledge/card-registry.test.ts \
  src/knowledge/proposals.test.ts \
  src/knowledge/compact-summary.test.ts \
  src/ai/__tests__/knowledge-context.test.ts \
  src/ai/__tests__/knowledge-tool-result.test.ts \
  src/ai/tools/knowledge-tools.test.ts

pnpm --filter @readany/core exec tsc --noEmit
pnpm --filter app exec tsc --noEmit
pnpm --filter app-expo exec tsc --noEmit
git diff --check
```

Evidence mapping:

| Contract | Evidence |
| --- | --- |
| Knowledge tables, queries, tombstones, and sync metadata exist. | `knowledge-queries.test.ts`, `simple-sync.integration.test.ts` |
| Vault paths survive folders, moves, orphans, search, AI, and export. | `document-utils.test.ts`, `vault-path-fidelity.test.ts`, `knowledge-tools.test.ts` |
| Desktop/mobile editor profiles expose the right rich-text features by scenario. | `editor-profile.test.ts`, TypeScript checks |
| Tiptap JSON projects to Markdown/HTML without losing supported rich blocks. | `editor-projection.test.ts`, `rich-text-preservation.test.ts` |
| Mobile WebView messages, draft recovery, and error states are typed. | `mobile-editor-bridge.test.ts`, `app-expo` TypeScript |
| AI reads knowledge safely and writes only through confirmation proposals. | `knowledge-context.test.ts`, `knowledge-tool-result.test.ts`, `knowledge-tools.test.ts`, `proposals.test.ts` |
| Compact summaries are retrieval memory, not user-content rewrites. | `compact-summary.test.ts`, `knowledge-tools.test.ts` |
| ReadAny cards preserve attrs, data, schema migrations, fallback rendering, and unknown versions. | `card-registry.test.ts`, `editor-projection.test.ts`, `rich-text-preservation.test.ts` |

## Desktop Manual Checks

Use the desktop app with a book that has existing highlights and notes.

1. Open the notes/knowledge entry for the book.
2. Confirm the first visible structure is a left vault tree, center workspace,
   and quiet right context panel.
3. Select the vault root. The center should show child folders/documents.
4. Create a folder, then create a standalone note inside it. The create target
   must show that folder path.
5. Create another folder and move the note into it. The tree, breadcrumb, search
   result, and move target preview should all update to the same path.
6. Open a document and edit the title/body directly in the WYSIWYG surface.
   Markdown source or JSON should not be the default editing UI.
7. Insert headings, lists, quote/callout/source cards, an image block, an
   internal link, and a custom ReadAny card.
8. Expand the ReadAny card details and edit source title, source id, CFI, and
   structured data. Invalid JSON should show an inline error and not corrupt the
   card.
9. Trigger AI knowledge tools from chat: search, exact get, propose create,
   propose update, tag update, link create, and summary compression.
10. Confirm successful proposals render confirmation cards, and failed tool calls
    render visible failure cards with tool name, reason, path when available,
    and a no-write hint.
11. Export an Obsidian vault and open it. Wikilinks, frontmatter IDs, folder
    paths, images, and ReadAny card fallbacks should be readable.

## Mobile Manual Checks

Use a real iOS or Android device because keyboard, safe area, and WebView focus
are part of the acceptance criteria.

1. Open the book knowledge area from the mobile notes screen.
2. Confirm the first mode is vault browsing, not one long stacked dashboard.
3. Navigate into a folder. The path should remain visible and rows should show
   child folders before child documents.
4. Open a document. The editor should become focused, WYSIWYG, and
   keyboard-aware.
5. Type long body content, use the toolbar, insert a link, image, source
   reference, and ReadAny card.
6. Open card details in the WebView editor and edit source attrs/data. Invalid
   JSON should show an error and preserve the previous valid attrs.
7. Background and reopen the app. Draft recovery should offer the latest unsaved
   content instead of silently losing it.
8. Run AI chat with a knowledge proposal and a failing knowledge tool. Proposal
   cards and failure cards should be visible and actionable on mobile.
9. Sync with a second device. Folder hierarchy, content JSON/Markdown, links,
   attachments metadata, card templates, and card attrs should arrive with the
   same document paths.

## Regression Traps

Reject the branch if any of these appear:

- Folder hierarchy is hidden behind tags, groups, or filters.
- A folder opens a blank editor.
- The body editor looks like a raw Markdown textarea by default.
- A create/move/import/AI proposal does not show its destination path.
- AI says a document was saved before the user confirms the proposal.
- Tool failures spin forever or disappear without a failure card.
- Custom card data can be replaced by invalid JSON.
- Unsupported card versions lose their metadata.
- Mobile keyboard covers the editor controls.
- Obsidian export flattens folders or makes duplicate titles ambiguous.
