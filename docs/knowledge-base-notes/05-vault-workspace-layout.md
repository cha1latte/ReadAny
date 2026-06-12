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

## Non-Negotiable Product Shape

These decisions are part of the feature contract, not implementation details:

- The knowledge base is a vault. A flat document list with filters is not enough.
- The folder tree is spatial navigation, like Obsidian. Tags and groups are
  secondary organization layers.
- The editor is a WYSIWYG writing canvas. Users should not feel like they are
  editing Markdown, JSON, or a large textarea.
- Desktop and mobile should share the same information model, but not the same
  layout.
- The workspace must look like a focused reader/writer tool, not a dashboard,
  settings page, or note-card wall.

### User Experience Correction

The knowledge-base UI must be judged by three simultaneous signals:

- Hierarchy is visible before content density. The user should immediately see
  folders, nested documents, the active path, and where a new document will be
  created.
- Writing is direct manipulation. The document body is a WYSIWYG canvas powered
  by Tiptap, not a Markdown textarea, JSON editor, or settings-style form.
- Layout supports the mental model. Desktop should feel like a vault sidebar
  plus writing canvas plus quiet inspector; mobile should feel like native vault
  browsing into a focused editor. A stacked card feed fails this feature even if
  the underlying data model is correct.

This means hierarchy, editor fidelity, and layout are inseparable acceptance
criteria. If any of them regresses, the feature has drifted back into the old
notes system.

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

### Obsidian-Like Hierarchy Expectations

Users should be able to build a mental map of their book knowledge:

```text
Book Knowledge Vault
├── Book Home
├── Chapter Notes
│   ├── Chapter 01.md
│   ├── Chapter 02.md
│   └── Themes
│       └── Fate and Choice.md
├── Characters
│   ├── Main Characters.md
│   └── Relationships.md
└── Reading Reviews
    └── First Read.md
```

Implications:

- The breadcrumb, tree indentation, export path, and sync path must all describe
  the same hierarchy.
- Creating a document while a folder is selected creates it inside that folder.
- Moving a folder moves the whole subtree and must update visible paths
  immediately.
- Duplicate names are allowed in different folders, but not ambiguous inside the
  same folder unless the UI clearly disambiguates them.
- Deleted or missing parents after sync are shown in an orphan area instead of
  silently flattening the document.
- Obsidian export should preserve this tree as real folders and Markdown files,
  not only as frontmatter fields.

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

### WYSIWYG Interaction Expectations

The editor should behave like a modern document editor:

- Click in the body and type directly.
- Use a small floating toolbar for selected text.
- Use a slash menu or insert button for blocks: heading, quote, list, divider,
  image, source card, AI card, review card, callout, and custom ReadAny cards.
- Drag or use block handles for block reordering on desktop when feasible.
- Mobile uses a keyboard-aware insert toolbar and focused bottom sheets for
  block configuration.
- Markdown shortcuts are welcome, but they transform into rich blocks
  immediately.
- Markdown source view can exist later as an advanced/export/debug mode, never
  as the default authoring experience.

## Desktop Workspace

Desktop should use a calm three-zone workspace.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Book switcher / vault title / search / compact actions                      │
├───────────────┬───────────────────────────────────────┬─────────────────────┤
│ Vault tree    │ WYSIWYG document canvas               │ Context panel       │
│ folders/docs  │ breadcrumb, title, body, blocks        │ sources, backlinks  │
│ search/move   │ folder overview when folder selected   │ outline, AI memory  │
└───────────────┴───────────────────────────────────────┴─────────────────────┘
```

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
- Width should be stable, roughly 240-300px, with graceful collapse on small
  desktop windows.
- The tree is the primary navigation, not a side decoration.

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
- Empty documents should show one elegant writing placeholder and focused insert
  affordances, not a stack of setup cards.
- Folder nodes should show a compact folder overview with child rows; they must
  not show a blank editor pretending to be a note.

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
- The right panel should feel like an inspector, not another feed. Keep it
  quiet, scannable, and secondary to the document.

### Desktop Layout Anti-Patterns

Do not ship a desktop knowledge layout that:

- Starts with a large dashboard/header card instead of the vault tree and
  current document.
- Shows every document as a card grid while hiding hierarchy.
- Puts the editor inside multiple nested cards.
- Treats title, tags, source, and body as a long settings form.
- Uses oversized empty states that push the editor below the fold.
- Makes the right context panel visually heavier than the writing canvas.

## Mobile Workspace

Mobile should not mirror the desktop grid. It needs a native, focused flow.

```text
Vault Browser -> Document Editor -> Context / Insert Sheets
```

### Screen 1: Vault Browser

Purpose: navigate the hierarchy quickly.

The browser screen contains:

- Compact book header.
- Current vault path.
- Search.
- Native tree/list with folder indentation.
- Create button.
- Folder overview and children.
- Recently edited documents can be a small section, but never replace the tree.

Visual direction:

- No large knowledge hero card.
- Avoid stacking explorer, editor, relations, and AI cards in one long scroll.
- Use rows and grouped sections, not a dashboard.
- Create/move actions use bottom sheets.
- The current path should be visible and horizontally scrollable when long.
- Folder rows open into the folder; document rows open into the editor.

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
- Context, tags, sources, backlinks, and AI actions open from a compact header
  action or bottom sheet. They should not sit above the writing surface as a
  permanent block.

### Mobile Layout Anti-Patterns

Do not ship a mobile knowledge layout that:

- Stacks vault navigation, document body, sources, AI, tags, and stats in one
  long scroll.
- Uses desktop-like side panels squeezed into mobile.
- Forces long-form body editing through a tiny modal input.
- Lets the keyboard cover the editor toolbar or the active line.
- Hides the user's folder path while they are browsing.
- Uses decorative hero/metric cards before the user can reach their documents.

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

## Layout Quality Bar

The knowledge workspace should feel closer to a quiet writing app with a
powerful vault sidebar than to a CRUD admin page.

Quality requirements:

- The first screen must make hierarchy obvious within two seconds.
- The current document title and body must be visually dominant.
- The editor body should preserve readable line length and calm whitespace.
- Navigation density should be high enough for real libraries, but never cramped.
- Metadata appears as supporting context, not as the main content.
- Every editable affordance should be discoverable through placement, hover,
  focus, or a small icon button with accessible label.
- Visual states must be clear: active folder, active document, unsaved/synced,
  collapsed, orphaned, missing attachment, and conflict.
- Desktop should support keyboard-heavy users; mobile should support thumb-first
  navigation and keyboard-aware editing.

## Implementation Order for Layout

Build the workspace in this order so the feature does not drift back into a
flat notes page:

1. Lock the data hierarchy: folder nodes, document nodes, path/breadcrumb,
   move/rename/delete, orphan handling, and export path projection.
2. Build the desktop vault shell: left tree, center canvas, right inspector,
   responsive collapse.
3. Build the mobile vault browser and focused editor as separate screens.
4. Replace form-like editing with Tiptap WYSIWYG block editing and contextual
   toolbars.
5. Add custom ReadAny cards and attachment rendering inside the editor canvas.
6. Add Obsidian export/import polish once hierarchy and editor state are stable.

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
- The active path is visible in the desktop vault sidebar, desktop document
  canvas, and mobile vault browser.
- Selecting a folder behaves like browsing a folder; selecting a document opens
  a real writing surface.
- Search finds documents inside collapsed folders.
- Desktop can edit a document while seeing the vault tree and context.
- Mobile can browse the vault and open a focused WYSIWYG editor.
- Folder screens never look like broken empty document screens.
- Export to Obsidian preserves folder paths and stable IDs.
- Imported Obsidian changes reconcile by document ID where possible.
- The editor never exposes raw Markdown or JSON as the default writing surface.
