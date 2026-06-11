# Vault Workspace Layout

This document is the product and UI contract for the knowledge-base workspace.
The knowledge base is not a prettier notes list. It is a book-centered vault with
folders, documents, source links, attachments, and a WYSIWYG writing canvas.

## Design North Star

ReadAny's knowledge base should feel like this:

```text
Book -> Vault tree -> WYSIWYG document -> Sources / backlinks / AI context
```

The user should always understand three things:

- Where this document lives in the vault hierarchy.
- What document they are editing.
- Which book positions, highlights, notes, files, and AI outputs are connected
  to it.

The interface must avoid the old "form full of fields" feeling. A knowledge
document is a document, not a settings panel.

## Directory Model

The directory hierarchy is a first-class product model, similar to Obsidian.

Rules:

- Folders and documents are siblings in the same tree.
- A folder can contain folders and documents.
- A normal document cannot contain children.
- Each book has a pinned `book_home` document at the top of its vault.
- `parent_id` is the single source of truth for hierarchy.
- Tags and groups are filters/metadata. They must not fake folder structure.
- Search works across the whole vault, even inside collapsed folders.
- Missing parents after sync/import become visible orphaned roots.
- Moves and renames preserve stable document IDs so sync and Obsidian reconcile
  by identity, not only by path text.

The tree should support:

- Expand/collapse.
- Indentation and subtle connector lines.
- Active document and active path.
- Create inside current folder.
- Move to another folder.
- Rename inline where it feels natural.
- Context actions without overwhelming every row.

## WYSIWYG Contract

The primary editing surface must be WYSIWYG. Markdown is an export and
interoperability projection, not the UI the user writes in by default.

Required behavior:

- Desktop and mobile knowledge documents use the Tiptap document model.
- The title is edited as a real document title, not as a small form input.
- Headings, lists, quotes, images, source cards, callouts, AI cards, and custom
  ReadAny cards render as real editor blocks.
- Placeholder and empty states should look like a writing canvas, not a textarea.
- Toolbar actions should be contextual: compact top toolbar, slash menu, floating
  bubble menu, or focused insert sheet depending on platform.
- Autosave is the default. Save status is quiet and never competes with writing.
- Unsupported cards render readable fallback blocks rather than raw JSON.

Do not expose arbitrary font, color, layout, raw HTML, or iframe editing in v1.
Those make mobile editing, sync, Obsidian export, and AI retrieval unreliable.

## Desktop Workspace

Desktop should use a calm three-zone workspace.

### Left: Vault Navigator

Purpose: answer "where am I?"

The left zone contains:

- Current book knowledge vault.
- Document/folder tree.
- Search.
- Create button with document type menu.
- Move and delete row actions.
- Optional book switcher when space allows.

Visual direction:

- Dense but breathable rows.
- Small icons, not oversized decorative icons.
- Active row uses theme primary subtly.
- Folders show child counts only when useful.
- Row actions appear on hover/focus.
- No giant hero card above the tree.

### Center: Document Canvas

Purpose: answer "what am I writing?"

The center zone contains:

- Breadcrumb path.
- Large inline title.
- Compact metadata line: document type, book, sync/save state.
- Tags as quiet chips when relevant.
- Tiptap WYSIWYG canvas.
- Folder overview when the active node is a folder.

Visual direction:

- The editor should feel like a page on the app background, not a card nested
  inside more cards.
- Keep the main writing width readable, around 680-820px.
- The outer shell can have borders, but the editable document should not feel
  boxed in.
- Use CSS variables from the app theme for all colors.
- Avoid marketing-style hero sections, large metrics blocks, and decorative
  panels inside the writing path.

### Right: Context Panel

Purpose: answer "what is connected?"

The right zone contains:

- Source links and CFI/highlight references.
- Backlinks.
- Document outline for long documents.
- AI memory/summary state.
- Selected card details.
- Export/import conflict notices when needed.

Rules:

- The right panel is supportive and collapsible.
- It should not steal vertical space from the document.
- On smaller desktop widths, collapse it behind a context button.

## Mobile Workspace

Mobile should not mirror the desktop grid. It needs a native, focused flow.

### Screen 1: Vault Browser

Purpose: navigate the hierarchy quickly.

The browser screen contains:

- Compact book header.
- Current vault path.
- Search.
- Native tree/list with folder indentation.
- Create button.
- Folder overview and children.

Visual direction:

- No large knowledge hero card.
- Avoid stacking explorer, editor, relations, and AI cards in one long scroll.
- Use rows and grouped sections, not a dashboard.
- Create/move actions use bottom sheets.

### Screen 2: Document Editor

Purpose: write without distractions.

The editor screen contains:

- Sticky compact header with back, path, title, status, and more actions.
- Full-screen WYSIWYG WebView editor.
- Keyboard-aware toolbar.
- Insert card/image/link actions through focused sheets.
- Tags and source/context can live in a secondary sheet, not above the editor.

Rules:

- Editing should feel like a document screen, not a form.
- The keyboard must not cover editor controls.
- Title editing can be inline, but long-form body editing owns most of the
  viewport.
- Folder nodes open a folder browser, not an empty editor.

## Folder View

A folder is a browsing surface, not a document editor pretending to be empty.

Folder view should show:

- Folder title and path.
- Child folders first, then documents.
- Small metadata per child: type, updated time or excerpt.
- Empty state with two direct actions: new folder, new note.

It should not show:

- A giant decorative icon block.
- Blank editor space.
- Heavy cards that make the folder feel like a dashboard.

## Visual Principles

Use a quiet reader/productivity style:

- Semantic theme variables only.
- 8px radius or the app's existing radius tokens.
- Fine borders and restrained shadows.
- Primary color as accent, not a full-page wash.
- Compact typography in navigation; comfortable typography in document body.
- Real empty states, not feature explanations.
- No nested cards around cards.
- No decorative orbs, blobs, or marketing visuals in the workspace.

The strongest visual moment should be the document itself: title, readable body,
source cards, and custom knowledge cards.

## Implementation Implications

Current MVP pieces are useful, but the layout should move toward this structure:

- Keep the existing `parent_id`, folder document type, tree builder, breadcrumbs,
  and move validation.
- Desktop should reduce card nesting around the editor and make the document
  canvas the center of the page.
- Mobile should split the current single scrolling knowledge page into a vault
  browser and a focused editor screen.
- The mobile knowledge hero/metric treatment should be removed or reduced to a
  compact book header.
- Context panels/cards should move out of the main writing flow where possible.
- Attachment sync must make image blocks reliable across devices before local
  image insertion is advertised as complete.

## Acceptance Checklist

Before this ships:

- Creating folders and documents produces a visible hierarchy.
- Moving a document updates the tree, breadcrumb, export path, and sync state.
- Search finds documents inside collapsed folders.
- Desktop can edit a document while seeing the vault tree and context.
- Mobile can browse the vault and open a focused WYSIWYG editor.
- Folder screens never look like broken empty document screens.
- Export to Obsidian preserves folder paths and stable IDs.
- Imported Obsidian changes reconcile by document ID where possible.
- The editor never exposes raw Markdown or JSON as the default writing surface.
