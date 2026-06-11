# Implementation Roadmap

This feature is too large for one PR. It should land as a sequence of stable,
testable layers.

## Phase 0: Research and Design

Status: completed as the initial design baseline. The current branch has moved
into layered runtime implementation.

Deliverables:

- Architecture research docs.
- Data model proposal.
- Editor and Obsidian plan.
- Implementation split.

No runtime behavior should change in this phase.

## Phase 1: Core Knowledge Model

Status: implemented on the current branch; keep expanding tests when the model
changes.

Goal:

- Add knowledge tables and core queries without replacing the UI yet.

Work:

- Add DB migrations for `knowledge_documents`, `knowledge_links`,
  `knowledge_attachments`, and `knowledge_card_templates`.
- Add core types.
- Add query modules and tests.
- Add conversion helpers:
  - `createBookHomeDocument`
  - `createHighlightNoteDocument`
  - `projectKnowledgeDocumentToMarkdown`
- Add sync table entries.
- Add simple sync integration tests for document create/update/delete.

Verification:

- Existing annotation tests still pass.
- New document query tests pass.
- Sync applies knowledge documents and tombstones across devices.

## Phase 2: Desktop Knowledge MVP

Status: implemented as an active MVP on the current branch; polish and
compatibility work continues.

Goal:

- Introduce a desktop knowledge page for books while keeping old notes usable.

Work:

- Add `KnowledgeEditor` using Tiptap JSON canonical storage.
- Auto-create and open the book home document.
- Show linked highlights and notes as source cards.
- Allow standalone book notes.
- Add basic tags and backlinks display.
- Keep `highlights.note` compatibility projection.

Verification:

- Existing notes page still works.
- Book home document persists and syncs.
- Editing a highlight note updates the linked document and old note preview.
- Export still includes old notes and new knowledge documents.

## Phase 3: Mobile WebView Tiptap Editor

Status: implemented for knowledge documents on the current branch. Legacy quick
annotation surfaces still use lightweight native editors by design.

Goal:

- Replace mobile Markdown TextInput editing with a WebView Tiptap editor.

Work:

- Build a local editor HTML bundle for Expo WebView.
- Add typed bridge messages.
- Add native toolbar state.
- Add autosave and explicit error states.
- Update `NoteCard`, `ReaderNoteViewModal`, and `SelectionPopover`.

Verification:

- iOS and Android can edit, save, focus, blur, and recover drafts.
- Keyboard does not cover the editor controls.
- WebView errors are visible and actionable.
- Existing reader selection flow remains fast.

## Phase 4: Export and Obsidian v1

Status: implemented as a desktop v1 on the current branch; mobile file-share
import and deeper conflict resolution remain future work. Document export, vault
package generation, manifests, attachment path planning, conflict detection,
ReadAny card fallbacks, Markdown file import, and linked-folder
import/reconcile exist.

Goal:

- Export the knowledge graph as a useful Markdown vault.

Work:

- Add `KnowledgeExporter`.
- Export book home, highlight notes, standalone notes, reviews, summaries, and
  assets.
- Add frontmatter with stable IDs.
- Add Obsidian callout rendering for ReadAny cards.
- Add desktop linked-folder export with manifest and conflict detection.
- Add desktop Markdown file import as confirmation-required create proposals.
- Add desktop linked-folder import/reconcile as confirmation-required update
  proposals.

Verification:

- Exported Markdown opens cleanly in Obsidian.
- Wikilinks and assets resolve.
- Re-export updates existing files by ID.
- External edits are detected before overwrite.
- Markdown imports preview the target documents before saving.
- Vault imports surface modified, missing, and unreadable files before applying
  updates.

## Phase 5: AI Knowledge Tools

Status: partially implemented. Search/get/propose/create/update/link tooling,
confirmation proposals, compact summaries, and proposal cards exist. Broader
retrieval UX and end-to-end validation still need work.

Goal:

- Let AI read and manage the user's knowledge base safely.

Work:

- Add tools for search, get, create, update, tag, and link.
- Add tool permission UI where needed.
- Include knowledge documents in retrieval.
- Add compact summaries for long documents.

Verification:

- AI can answer from book text, annotations, and knowledge documents.
- AI never silently overwrites user documents.
- Tool failures display clear failure cards on desktop and mobile.

## Phase 6: Custom Card Platform

Status: partially implemented. Built-in card registry, card templates, desktop
node views, mobile WebView card rendering, and Markdown fallbacks exist. Richer
card editing and migrations remain future work.

Goal:

- Make ReadAny cards extensible and pleasant.

Work:

- Add card registry.
- Add built-in card nodes and node views.
- Add Markdown fallback renderer for every card.
- Add static read-only rendering.
- Add card template sync.

Verification:

- Cards edit on desktop and mobile.
- Cards export to readable Markdown.
- Unsupported card versions degrade safely.
- Card attrs migrate across schema versions.

## Suggested PR Split

1. `feat/kb-core-model`
   - DB, types, queries, sync, tests.
2. `feat/kb-tiptap-core`
   - Shared editor utilities, JSON/Markdown projection, card registry skeleton.
3. `feat/kb-desktop-mvp`
   - Desktop book home document and knowledge editor.
4. `feat/kb-mobile-editor-webview`
   - Mobile WebView editor and bridge.
5. `feat/kb-export-obsidian`
   - Knowledge exporter and Obsidian vault export.
6. `feat/kb-ai-tools`
   - AI tools and retrieval integration.
7. `feat/kb-custom-cards`
   - Built-in rich cards and card UI polish.

## Test Plan by Layer

Core DB:

- Insert/update/delete knowledge documents.
- Link documents to books, highlights, CFIs, and external URLs.
- Tombstones are inserted on delete.
- Derived Markdown updates when JSON changes.

Sync:

- New tables are included in collect/apply.
- Deletions propagate.
- Linked documents survive book sync.
- Attachments are represented in file manifests.

Editor:

- JSON to Markdown projection is deterministic.
- Markdown import creates valid Tiptap JSON.
- Surface profiles expose only the rich-text features allowed for that scenario.
- Rich-text preservation tests cover desktop save, mobile save, sync apply, and
  export projection for headings, lists, source refs, cards, links, attachments,
  and AI provenance.
- Custom card nodes preserve attrs.
- Unsupported cards render fallback.

Mobile:

- WebView editor ready/error states.
- Bridge command/event contract.
- Keyboard and safe-area behavior.
- Autosave and draft recovery.

Export:

- Obsidian vault structure.
- Frontmatter ID stability.
- Wikilinks and assets.
- Re-export conflict detection.

## Open Product Questions

- Should there be a global knowledge area outside books in v1, or only
  book-scoped knowledge first?
- Should highlight notes appear inline in the reader, in the book home document,
  or both?
- Should Obsidian linked-folder mode be read-only export first, or allow import in
  the same milestone?
- Which custom cards are required for v1?
- Should AI-created documents require explicit confirmation every time?
- How much of the old Notes page should remain after the knowledge page ships?
