/**
 * Build a self-contained Tiptap knowledge editor for React Native WebView.
 *
 * Run: node scripts/build-knowledge-editor.js
 */
const esbuild = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");

const ASSETS_DIR = path.resolve(__dirname, "../assets/editor");
const TEMPLATE = path.resolve(ASSETS_DIR, "knowledge-editor.template.html");
const OUTPUT = path.resolve(ASSETS_DIR, "knowledge-editor.html");
const MARKER = "<!-- __READANY_KNOWLEDGE_EDITOR_BUNDLE_INSERT_POINT_9d5b2a7c__ -->";

async function buildKnowledgeEditor() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const entryContent = `
    import { Editor, Node, mergeAttributes } from "@tiptap/core";
    import Link from "@tiptap/extension-link";
    import Placeholder from "@tiptap/extension-placeholder";
    import TaskItem from "@tiptap/extension-task-item";
    import TaskList from "@tiptap/extension-task-list";
    import StarterKit from "@tiptap/starter-kit";
    import { createReadAnyCardReadOnlyModel, createReadAnyCardTiptapContent } from "@readany/core/knowledge";

    const EMPTY_DOC = { type: "doc", content: [] };
    let editor = null;
    let ready = false;
    let pendingInit = null;
    let changeTimer = null;
    let cardBodyPlaceholder = "Write inside this card...";
    let cardConvertToTextLabel = "Convert card to normal text";
    let imageUnavailableTitle = "Image attachment is not available on this device yet.";
    let imageUnavailableHint = "Sync again or keep the original device online to restore it.";

    const post = (payload) => {
      try {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      } catch (error) {
        console.error("[KnowledgeEditor] postMessage failed", error);
      }
    };

    const isDoc = (value) => value && typeof value === "object" && value.type === "doc";
    const normalizeDoc = (value) => (isDoc(value) ? value : EMPTY_DOC);

    const setTheme = (theme = {}) => {
      const root = document.documentElement;
      const entries = {
        background: theme.background,
        foreground: theme.foreground,
        card: theme.card,
        border: theme.border,
        muted: theme.muted,
        mutedForeground: theme.mutedForeground,
        primary: theme.primary,
      };
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === "string" && value) {
          root.style.setProperty("--" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), value);
        }
      }
    };

    const scheduleHeight = () => {
      requestAnimationFrame(() => {
        const height = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 260);
        post({ type: "heightChanged", height });
      });
    };

    const selectionState = () => {
      if (!editor) return {};
      return {
        marks: {
          bold: editor.isActive("bold"),
          italic: editor.isActive("italic"),
          strike: editor.isActive("strike"),
          code: editor.isActive("code"),
          bulletList: editor.isActive("bulletList"),
          orderedList: editor.isActive("orderedList"),
          taskList: editor.isActive("taskList") || editor.isActive("taskItem"),
          blockquote: editor.isActive("blockquote"),
          link: editor.isActive("link"),
        },
        linkHref: editor.getAttributes("link").href || null,
        headingLevel: editor.isActive("heading", { level: 1 })
          ? 1
          : editor.isActive("heading", { level: 2 })
            ? 2
            : editor.isActive("heading", { level: 3 })
              ? 3
              : null,
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
      };
    };

    const postSelection = () => {
      post({ type: "selectionChanged", ...selectionState() });
    };

    const createContentPayload = (requestId) => {
      if (!editor) return;
      return {
        type: "contentChanged",
        ...(typeof requestId === "string" && requestId ? { requestId } : {}),
        contentJson: editor.getJSON(),
        plainText: editor.getText(),
      };
    };

    const postContent = () => {
      if (!editor) return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        const payload = createContentPayload();
        if (!payload) return;
        post(payload);
        scheduleHeight();
      }, 180);
    };

    const postContentNow = (requestId) => {
      if (!editor) return;
      clearTimeout(changeTimer);
      const payload = createContentPayload(requestId);
      if (!payload) return;
      post(payload);
      scheduleHeight();
    };

    const syncEditableControls = () => {
      if (!editor) return;
      const editable = editor.isEditable;
      document.documentElement.classList.toggle("readany-editor-readonly", !editable);
      document
        .querySelectorAll(".readany-card-title, .readany-card-preview")
        .forEach((element) => {
          element.readOnly = !editable;
          element.tabIndex = editable ? 0 : -1;
          element.setAttribute("aria-readonly", editable ? "false" : "true");
        });
      document.querySelectorAll(".readany-card-convert").forEach((element) => {
        element.disabled = !editable;
        element.tabIndex = editable ? 0 : -1;
        element.setAttribute("aria-hidden", editable ? "false" : "true");
      });
    };

    const updateCardAttrs = (node, getPos, attrs) => {
      if (!editor || !editor.isEditable || typeof getPos !== "function") return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      const nextAttrs = { ...(node.attrs || {}), ...attrs };
      editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, nextAttrs));
      postContent();
      scheduleHeight();
    };

    const fitTextArea = (element) => {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = Math.max(72, element.scrollHeight) + "px";
    };

    const cardMetaText = (attrs = {}) => {
      const model = createReadAnyCardReadOnlyModel(attrs, { body: "" });
      return [
        model.cardType,
        model.state === "supported" ? "" : model.stateLabel || "v" + model.version,
      ]
        .filter(Boolean)
        .join(" · ");
    };

    const ReadAnyCard = Node.create({
      name: "readanyCard",
      group: "block",
      atom: true,
      draggable: true,
      selectable: true,

      addAttributes() {
        return {
          cardType: { default: "callout" },
          id: { default: null },
          version: { default: 1 },
          title: { default: null },
          text: { default: null },
          sourceTitle: { default: null },
          sourceId: { default: null },
          cfi: { default: null },
          markdown: { default: null },
          data: { default: null },
        };
      },

      parseHTML() {
        return [{ tag: "readany-card" }];
      },

      renderHTML({ HTMLAttributes }) {
        return [
          "readany-card",
          mergeAttributes(HTMLAttributes, {
            "data-card-type": HTMLAttributes.cardType || "callout",
            "data-card-version": String(HTMLAttributes.version || 1),
          }),
        ];
      },

      addNodeView() {
        return ({ node, getPos }) => {
          let currentNode = node;
          const attrs = currentNode.attrs || {};
          const readOnlyModel = createReadAnyCardReadOnlyModel(attrs, { body: "" });
          const dom = document.createElement("div");
          dom.className = "readany-card";
          dom.contentEditable = "false";
          dom.dataset.cardType = readOnlyModel.cardType;

          const icon = document.createElement("div");
          icon.className = "readany-card-icon";
          icon.textContent = "◇";

          const body = document.createElement("div");
          body.className = "readany-card-body";

          const header = document.createElement("div");
          header.className = "readany-card-header";

          const meta = document.createElement("div");
          meta.className = "readany-card-meta";
          meta.textContent = cardMetaText(attrs);
          header.appendChild(meta);

          const convertButton = document.createElement("button");
          convertButton.className = "readany-card-convert";
          convertButton.type = "button";
          convertButton.textContent = "Aa";
          convertButton.title = cardConvertToTextLabel;
          convertButton.setAttribute("aria-label", cardConvertToTextLabel);
          convertButton.disabled = editor?.isEditable === false;
          convertButton.tabIndex = editor?.isEditable === false ? -1 : 0;
          convertButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!editor?.isEditable || typeof getPos !== "function") return;
            const pos = getPos();
            if (typeof pos !== "number") return;
            editor
              .chain()
              .focus()
              .insertContentAt(
                { from: pos, to: pos + currentNode.nodeSize },
                createReadAnyCardTiptapContent(currentNode.attrs || {}),
              )
              .run();
          });
          header.appendChild(convertButton);
          body.appendChild(header);

          const title = document.createElement("input");
          title.className = "readany-card-title";
          title.type = "text";
          title.value = attrs.title || "";
          title.placeholder = readOnlyModel.title;
          title.readOnly = editor?.isEditable === false;
          title.tabIndex = editor?.isEditable === false ? -1 : 0;
          title.addEventListener("input", () => {
            if (!editor?.isEditable) return;
            updateCardAttrs(currentNode, getPos, { title: title.value });
          });
          body.appendChild(title);

          const text = readOnlyModel.body;
          const preview = document.createElement("textarea");
          preview.className = "readany-card-preview";
          preview.value = text;
          preview.placeholder = cardBodyPlaceholder;
          preview.rows = Math.max(3, Math.min(8, String(text).split("\\n").length + 1));
          preview.readOnly = editor?.isEditable === false;
          preview.tabIndex = editor?.isEditable === false ? -1 : 0;
          requestAnimationFrame(() => fitTextArea(preview));
          preview.addEventListener("input", () => {
            if (!editor?.isEditable) return;
            preview.rows = Math.max(3, Math.min(8, preview.value.split("\\n").length + 1));
            fitTextArea(preview);
            updateCardAttrs(currentNode, getPos, {
              markdown: preview.value,
              text: preview.value,
            });
          });
          body.appendChild(preview);

          const source = document.createElement("div");
          source.className = "readany-card-source";
          source.style.display = readOnlyModel.sourceTitle ? "block" : "none";
          source.textContent = readOnlyModel.sourceTitle || "";
          body.appendChild(source);

          dom.appendChild(icon);
          dom.appendChild(body);
          return {
            dom,
            update(nextNode) {
              if (nextNode.type.name !== "readanyCard") return false;
              currentNode = nextNode;
              const nextAttrs = nextNode.attrs || {};
              const nextModel = createReadAnyCardReadOnlyModel(nextAttrs, { body: "" });
              dom.dataset.cardType = nextModel.cardType;
              meta.textContent = cardMetaText(nextAttrs);
              title.value = nextAttrs.title || "";
              title.placeholder = nextModel.title;
              title.readOnly = editor?.isEditable === false;
              title.tabIndex = editor?.isEditable === false ? -1 : 0;
              convertButton.disabled = editor?.isEditable === false;
              convertButton.tabIndex = editor?.isEditable === false ? -1 : 0;
              const nextText = nextModel.body;
              if (preview.value !== nextText) preview.value = nextText;
              preview.rows = Math.max(3, Math.min(8, String(nextText).split("\\n").length + 1));
              preview.readOnly = editor?.isEditable === false;
              preview.tabIndex = editor?.isEditable === false ? -1 : 0;
              fitTextArea(preview);
              source.style.display = nextModel.sourceTitle ? "block" : "none";
              source.textContent = nextModel.sourceTitle || "";
              return true;
            },
          };
        };
      },
    });

    const ReadAnyInternalLink = Node.create({
      name: "readanyInternalLink",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,

      addAttributes() {
        return {
          documentId: { default: null },
          targetPath: { default: null },
          label: { default: null },
          title: { default: null },
        };
      },

      parseHTML() {
        return [{ tag: "span[data-readany-internal-link]" }];
      },

      renderHTML({ HTMLAttributes }) {
        const label =
          HTMLAttributes.label ||
          HTMLAttributes.title ||
          HTMLAttributes.documentId ||
          HTMLAttributes.targetPath ||
          "";
        return [
          "span",
          mergeAttributes(HTMLAttributes, {
            "data-readany-internal-link":
              HTMLAttributes.documentId || HTMLAttributes.targetPath || label,
            class: "readany-internal-link",
          }),
          label,
        ];
      },

      addNodeView() {
        return ({ node }) => {
          const span = document.createElement("span");
          span.className = "readany-internal-link";
          span.contentEditable = "false";
          const update = (nextNode) => {
            const attrs = nextNode.attrs || {};
            const label =
              attrs.label || attrs.title || attrs.documentId || attrs.targetPath || "Linked note";
            span.dataset.readanyInternalLink = attrs.documentId || attrs.targetPath || label;
            span.textContent = label;
          };
          update(node);
          return {
            dom: span,
            update(nextNode) {
              if (nextNode.type.name !== "readanyInternalLink") return false;
              update(nextNode);
              return true;
            },
          };
        };
      },
    });

    const ReadAnySourceReference = Node.create({
      name: "readanySourceReference",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,

      addAttributes() {
        return {
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-label") || element.textContent || null,
            renderHTML: (attributes) =>
              attributes.label ? { "data-label": attributes.label } : {},
          },
          sourceTitle: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("data-source-title") || element.textContent || null,
            renderHTML: (attributes) =>
              attributes.sourceTitle ? { "data-source-title": attributes.sourceTitle } : {},
          },
          sourceId: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("data-source-id") ||
              element.getAttribute("data-readany-source-id") ||
              null,
            renderHTML: (attributes) =>
              attributes.sourceId ? { "data-source-id": attributes.sourceId } : {},
          },
          cfi: {
            default: null,
            parseHTML: (element) => {
              const cfi = element.getAttribute("data-cfi");
              if (cfi) return cfi;
              const legacyReference = element.getAttribute("data-readany-source-reference") || "";
              return legacyReference.startsWith("epubcfi(") ? legacyReference : null;
            },
            renderHTML: (attributes) => (attributes.cfi ? { "data-cfi": attributes.cfi } : {}),
          },
        };
      },

      parseHTML() {
        return [{ tag: "span[data-readany-source-reference]" }];
      },

      renderHTML({ node, HTMLAttributes }) {
        const label = node.attrs.label || node.attrs.sourceTitle || "Source reference";
        return [
          "span",
          mergeAttributes(HTMLAttributes, {
            "data-readany-source-reference": node.attrs.cfi || node.attrs.sourceId || label,
            class: "readany-source-reference",
          }),
          label,
        ];
      },

      addNodeView() {
        return ({ node }) => {
          const span = document.createElement("span");
          span.className = "readany-source-reference";
          span.contentEditable = "false";
          const update = (nextNode) => {
            const attrs = nextNode.attrs || {};
            const label = attrs.label || attrs.sourceTitle || "Source reference";
            span.dataset.readanySourceReference = attrs.cfi || attrs.sourceId || label;
            if (attrs.sourceId) span.dataset.readanySourceId = attrs.sourceId;
            else delete span.dataset.readanySourceId;
            span.textContent = label;
          };
          update(node);
          return {
            dom: span,
            update(nextNode) {
              if (nextNode.type.name !== "readanySourceReference") return false;
              update(nextNode);
              return true;
            },
          };
        };
      },
    });

    const KnowledgeImage = Node.create({
      name: "image",
      group: "block",
      atom: true,
      draggable: true,

      addAttributes() {
        return {
          src: { default: null },
          alt: { default: null },
          title: { default: null },
          attachmentId: { default: null },
          fileName: { default: null },
        };
      },

      parseHTML() {
        return [{ tag: "img[src]" }];
      },

      renderHTML({ HTMLAttributes }) {
        return ["img", mergeAttributes(HTMLAttributes, { "data-readany-image": "true" })];
      },

      addNodeView() {
        return ({ node }) => {
          const attrs = node.attrs || {};
          let currentAttrs = attrs;
          const figure = document.createElement("figure");
          figure.className = "readany-image";
          figure.contentEditable = "false";

          const image = document.createElement("img");
          const fallback = document.createElement("div");
          fallback.className = "readany-image-missing";

          const icon = document.createElement("div");
          icon.className = "readany-image-missing-icon";
          icon.textContent = "!";
          fallback.appendChild(icon);

          const text = document.createElement("div");
          text.className = "readany-image-missing-text";
          fallback.appendChild(text);

          const title = document.createElement("div");
          title.className = "readany-image-missing-title";
          text.appendChild(title);

          const hint = document.createElement("div");
          hint.className = "readany-image-missing-hint";
          text.appendChild(hint);

          const updateFallback = (nextAttrs = {}, failed = false) => {
            const src = typeof nextAttrs.src === "string" ? nextAttrs.src.trim() : "";
            const attachmentId =
              typeof nextAttrs.attachmentId === "string" ? nextAttrs.attachmentId.trim() : "";
            const unresolved = attachmentId && (!src || src.startsWith("readany-attachment://"));
            const missing = failed || !src || unresolved;
            title.textContent =
              nextAttrs.fileName || nextAttrs.title || nextAttrs.alt || imageUnavailableTitle;
            hint.textContent = imageUnavailableHint;
            image.style.display = missing ? "none" : "block";
            fallback.style.display = missing ? "flex" : "none";
          };

          image.src = attrs.src || "";
          image.alt = attrs.alt || "";
          image.title = attrs.title || "";
          image.addEventListener("error", () => updateFallback(currentAttrs, true));
          figure.appendChild(image);
          figure.appendChild(fallback);

          if (attrs.alt) {
            const caption = document.createElement("figcaption");
            caption.textContent = attrs.alt;
            figure.appendChild(caption);
          }

          updateFallback(attrs);

          return {
            dom: figure,
            update(nextNode) {
              if (nextNode.type.name !== "image") return false;
              const nextAttrs = nextNode.attrs || {};
              currentAttrs = nextAttrs;
              image.src = nextAttrs.src || "";
              image.alt = nextAttrs.alt || "";
              image.title = nextAttrs.title || "";
              updateFallback(nextAttrs);
              const nextAlt = nextAttrs.alt || "";
              let caption = figure.querySelector("figcaption");
              if (nextAlt && !caption) {
                caption = document.createElement("figcaption");
                figure.appendChild(caption);
              }
              if (caption) {
                if (nextAlt) caption.textContent = nextAlt;
                else caption.remove();
              }
              return true;
            },
          };
        };
      },
    });

    const createEditor = (payload = {}) => {
      const el = document.getElementById("editor");
      if (!el) throw new Error("Editor root not found");
      setTheme(payload.theme);
      cardBodyPlaceholder =
        typeof payload.cardBodyPlaceholder === "string" && payload.cardBodyPlaceholder
          ? payload.cardBodyPlaceholder
          : "Write inside this card...";
      cardConvertToTextLabel =
        typeof payload.cardConvertToTextLabel === "string" && payload.cardConvertToTextLabel
          ? payload.cardConvertToTextLabel
          : "Convert card to normal text";
      imageUnavailableTitle =
        typeof payload.imageUnavailableTitle === "string" && payload.imageUnavailableTitle
          ? payload.imageUnavailableTitle
          : "Image attachment is not available on this device yet.";
      imageUnavailableHint =
        typeof payload.imageUnavailableHint === "string" && payload.imageUnavailableHint
          ? payload.imageUnavailableHint
          : "Sync again or keep the original device online to restore it.";
      editor?.destroy();
      editor = new Editor({
        element: el,
        extensions: [
          StarterKit.configure({
            heading: { levels: [1, 2, 3] },
            dropcursor: false,
            gapcursor: false,
          }),
          Link.configure({
            autolink: true,
            openOnClick: false,
          }),
          TaskList,
          TaskItem.configure({
            nested: true,
          }),
          ReadAnyInternalLink,
          ReadAnySourceReference,
          KnowledgeImage,
          ReadAnyCard,
          Placeholder.configure({
            placeholder: payload.placeholder || "",
            emptyEditorClass: "is-editor-empty",
          }),
        ],
        content: normalizeDoc(payload.contentJson),
        editable: payload.readOnly !== true,
        editorProps: {
          attributes: {
            class: "readany-prosemirror",
          },
        },
        onCreate: () => {
          post({ type: "ready" });
          syncEditableControls();
          postSelection();
          scheduleHeight();
        },
        onUpdate: () => postContent(),
        onSelectionUpdate: () => postSelection(),
        onTransaction: () => {
          syncEditableControls();
          scheduleHeight();
        },
        onFocus: () => post({ type: "focusChanged", focused: true }),
        onBlur: () => {
          postContentNow();
          post({ type: "focusChanged", focused: false });
        },
      });
      ready = true;
    };

    const scrollToOutline = (index) => {
      if (!editor) return;
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex) || numericIndex < 0) return;
      const headings = Array.from(
        document.querySelectorAll(".readany-prosemirror h1, .readany-prosemirror h2, .readany-prosemirror h3, .readany-prosemirror h4, .readany-prosemirror h5, .readany-prosemirror h6"),
      );
      const target = headings[Math.floor(numericIndex)];
      if (!target) return;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.animate?.(
        [
          { outline: "0 solid transparent", outlineOffset: "0px" },
          { outline: "2px solid var(--primary)", outlineOffset: "4px" },
          { outline: "0 solid transparent", outlineOffset: "8px" },
        ],
        { duration: 900, easing: "ease-out" },
      );
    };

    const runCommand = (command, attrs = {}) => {
      if (!editor) return;
      const readOnlyAllowedCommands = new Set(["focus", "blur", "scrollToOutline"]);
      if (!editor.isEditable && !readOnlyAllowedCommands.has(command)) {
        postSelection();
        scheduleHeight();
        return;
      }
      const chain = editor.chain().focus();
      switch (command) {
        case "undo":
          editor.chain().focus().undo().run();
          break;
        case "redo":
          editor.chain().focus().redo().run();
          break;
        case "bold":
          chain.toggleBold().run();
          break;
        case "italic":
          chain.toggleItalic().run();
          break;
        case "strike":
          chain.toggleStrike().run();
          break;
        case "code":
          chain.toggleCode().run();
          break;
        case "setLink":
          if (typeof attrs.href === "string" && attrs.href.trim()) {
            editor.chain().focus().extendMarkRange("link").setLink({ href: attrs.href.trim() }).run();
          }
          break;
        case "unsetLink":
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          break;
        case "heading":
          chain.toggleHeading({ level: attrs.level || 2 }).run();
          break;
        case "bulletList":
          chain.toggleBulletList().run();
          break;
        case "orderedList":
          chain.toggleOrderedList().run();
          break;
        case "taskList":
          chain.toggleTaskList().run();
          break;
        case "blockquote":
          chain.toggleBlockquote().run();
          break;
        case "codeBlock":
          chain.toggleCodeBlock().run();
          break;
        case "horizontalRule":
          chain.setHorizontalRule().run();
          break;
        case "insertImage": {
          if (typeof attrs.src === "string" && attrs.src.trim()) {
            chain
              .insertContent({
                type: "image",
                attrs: {
                  src: attrs.src.trim(),
                  alt: typeof attrs.alt === "string" ? attrs.alt.trim() : "",
                  title: typeof attrs.title === "string" ? attrs.title.trim() : "",
                  attachmentId:
                    typeof attrs.attachmentId === "string" ? attrs.attachmentId.trim() : "",
                  fileName: typeof attrs.fileName === "string" ? attrs.fileName.trim() : "",
                },
              })
              .run();
          }
          break;
        }
        case "insertInternalLink": {
          const linkAttrs = attrs && typeof attrs === "object" ? attrs : {};
          const label =
            typeof linkAttrs.label === "string" && linkAttrs.label.trim()
              ? linkAttrs.label.trim()
              : typeof linkAttrs.title === "string" && linkAttrs.title.trim()
                ? linkAttrs.title.trim()
                : typeof linkAttrs.documentId === "string"
                  ? linkAttrs.documentId.trim()
                  : "";
          if (label) {
            chain
              .insertContent({
                type: "readanyInternalLink",
                attrs: {
                  label,
                  title: label,
                  documentId:
                    typeof linkAttrs.documentId === "string" && linkAttrs.documentId.trim()
                      ? linkAttrs.documentId.trim()
                      : null,
                  targetPath:
                    typeof linkAttrs.targetPath === "string" && linkAttrs.targetPath.trim()
                      ? linkAttrs.targetPath.trim()
                      : null,
                },
              })
              .run();
          }
          break;
        }
        case "insertSourceReference": {
          const sourceAttrs = attrs && typeof attrs === "object" ? attrs : {};
          const label =
            typeof sourceAttrs.label === "string" && sourceAttrs.label.trim()
              ? sourceAttrs.label.trim()
              : typeof sourceAttrs.sourceTitle === "string" && sourceAttrs.sourceTitle.trim()
                ? sourceAttrs.sourceTitle.trim()
                : "";
          if (label) {
            chain
              .insertContent([
                {
                  type: "readanySourceReference",
                  attrs: {
                    label,
                    sourceTitle:
                      typeof sourceAttrs.sourceTitle === "string" &&
                      sourceAttrs.sourceTitle.trim()
                        ? sourceAttrs.sourceTitle.trim()
                        : label,
                    sourceId:
                      typeof sourceAttrs.sourceId === "string" && sourceAttrs.sourceId.trim()
                        ? sourceAttrs.sourceId.trim()
                        : null,
                    cfi:
                      typeof sourceAttrs.cfi === "string" && sourceAttrs.cfi.trim()
                        ? sourceAttrs.cfi.trim()
                        : null,
                  },
                },
                { type: "text", text: " " },
              ])
              .run();
          }
          break;
        }
        case "insertCard": {
          const cardAttrs = attrs && typeof attrs === "object" ? attrs : {};
          chain
            .insertContent({
              type: "readanyCard",
              attrs: {
                cardType:
                  typeof cardAttrs.cardType === "string" && cardAttrs.cardType
                    ? cardAttrs.cardType
                    : "callout",
                version: typeof cardAttrs.version === "number" ? cardAttrs.version : 1,
                id: typeof cardAttrs.id === "string" ? cardAttrs.id : null,
                title: typeof cardAttrs.title === "string" ? cardAttrs.title : null,
                text: typeof cardAttrs.text === "string" ? cardAttrs.text : null,
                sourceTitle:
                  typeof cardAttrs.sourceTitle === "string" ? cardAttrs.sourceTitle : null,
                sourceId: typeof cardAttrs.sourceId === "string" ? cardAttrs.sourceId : null,
                cfi: typeof cardAttrs.cfi === "string" ? cardAttrs.cfi : null,
                markdown: typeof cardAttrs.markdown === "string" ? cardAttrs.markdown : "",
                data: cardAttrs.data ?? null,
              },
            })
            .run();
          break;
        }
        case "focus":
          editor.commands.focus(attrs.position || "end");
          break;
        case "scrollToOutline":
          scrollToOutline(attrs.index);
          break;
        case "blur":
          editor.commands.blur();
          break;
        default:
          post({ type: "error", code: "unknown_command", message: "Unknown editor command: " + command });
      }
      postSelection();
      scheduleHeight();
    };

    const receive = (message) => {
      try {
        if (!message || typeof message !== "object") return;
        switch (message.type) {
          case "init":
            pendingInit = message;
            createEditor(message);
            break;
          case "setContent":
            editor?.commands.setContent(normalizeDoc(message.contentJson));
            postContent();
            break;
          case "setTheme":
            setTheme(message.theme);
            break;
          case "setEditable":
            editor?.setEditable(message.editable !== false);
            syncEditableControls();
            postSelection();
            scheduleHeight();
            break;
          case "focus":
            runCommand("focus", { position: message.position });
            break;
          case "blur":
            runCommand("blur");
            break;
          case "runCommand":
            runCommand(message.command, message.attrs);
            break;
          case "requestContent":
            postContentNow(message.requestId);
            break;
          default:
            post({ type: "error", code: "unknown_message", message: "Unknown bridge message: " + message.type });
        }
      } catch (error) {
        post({
          type: "error",
          code: "bridge_error",
          message: error && error.message ? error.message : String(error),
        });
      }
    };

    window.__ReadAnyKnowledgeEditor = { receive };

    window.addEventListener("message", (event) => {
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        receive(data);
      } catch (error) {
        post({ type: "error", code: "parse_error", message: String(error) });
      }
    });

    document.addEventListener("DOMContentLoaded", () => {
      post({ type: "loaded" });
      if (pendingInit && !ready) createEditor(pendingInit);
    });
  `;

  const entryFile = path.resolve(__dirname, "../.knowledge-editor-entry.mjs");
  fs.writeFileSync(entryFile, entryContent);

  try {
    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      format: "iife",
      target: "es2020",
      minify: true,
      write: false,
      resolveExtensions: [".ts", ".tsx", ".js", ".mjs"],
    });

    const bundledJS = result.outputFiles[0].text;
    const template = fs.readFileSync(TEMPLATE, "utf-8");
    const parts = template.split(MARKER);
    if (parts.length < 2) {
      throw new Error("Knowledge editor template marker not found");
    }
    const html = `${parts[0]}<script>\n${bundledJS}\n</script>${parts.slice(1).join(MARKER)}`;
    fs.writeFileSync(OUTPUT, html);
    console.log(`Built knowledge-editor.html (${Math.round(html.length / 1024)}KB)`);
  } finally {
    if (fs.existsSync(entryFile)) fs.unlinkSync(entryFile);
  }
}

buildKnowledgeEditor().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
