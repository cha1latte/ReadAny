import type { JSONValue, KnowledgeCardTemplate } from "../types";
import { EMPTY_TIPTAP_DOCUMENT } from "../types";
import { createKnowledgeAttachmentUri, parseKnowledgeAttachmentUri } from "./attachments";
import {
  type ReadAnyCardAttrs,
  createReadAnyCardReadOnlyModel,
  normalizeReadAnyCardAttrs,
  renderReadAnyCardMarkdownFallback,
  upgradeReadAnyCardAttrs,
  upgradeReadAnyCardAttrsWithTemplates,
} from "./card-registry";
export type { ReadAnyCardAttrs } from "./card-registry";

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: TiptapMark[];
  content?: TiptapNode[];
}

export interface MarkdownProjectionOptions {
  /** Preserve custom card metadata with fenced ReadAny blocks. */
  includeReadAnyCardMetadata?: boolean;
  /** Resolve image targets for exports, attachments, and platform-specific rendering. */
  resolveImageSrc?: (attrs: Record<string, unknown>, fallbackSrc: string) => string | undefined;
  /** Resolve internal document links for exports that need path-backed targets. */
  resolveInternalLinkTarget?: (
    attrs: Record<string, unknown>,
    fallbackTarget: string,
  ) => string | undefined;
  /** Synced custom card templates used to upgrade exported custom card attrs safely. */
  cardTemplates?: KnowledgeCardTemplate[];
}

export interface MarkdownImportOptions {
  /** Synced custom card templates used to upgrade imported custom card attrs safely. */
  cardTemplates?: KnowledgeCardTemplate[];
}

export interface NormalizeTiptapDocumentOptions {
  /** Synced custom card templates used to upgrade active editor card attrs safely. */
  cardTemplates?: KnowledgeCardTemplate[];
}

export interface ReadOnlyHtmlProjectionOptions extends MarkdownProjectionOptions {
  /** CSS class prefix for static read-only renderers. */
  classPrefix?: string;
}

function isObject(value: JSONValue | unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isTiptapNode(value: JSONValue | unknown): value is TiptapNode {
  return isObject(value) && typeof value.type === "string";
}

export function normalizeTiptapDocument(
  content: JSONValue | null | undefined,
  options: NormalizeTiptapDocumentOptions = {},
): TiptapNode {
  if (!isTiptapNode(content)) return EMPTY_TIPTAP_DOCUMENT as unknown as TiptapNode;
  return normalizeTiptapNode(content, options);
}

function normalizeTiptapNode(
  node: TiptapNode,
  options: NormalizeTiptapDocumentOptions,
): TiptapNode {
  const attrs =
    node.type === "readanyCard"
      ? ((options.cardTemplates?.length
          ? upgradeReadAnyCardAttrsWithTemplates(node.attrs ?? {}, options.cardTemplates)
          : upgradeReadAnyCardAttrs(node.attrs ?? {})) as Record<string, unknown>)
      : node.attrs;
  const content = node.content?.map((child) => normalizeTiptapNode(child, options));

  return {
    ...node,
    ...(attrs ? { attrs } : {}),
    ...(content ? { content } : {}),
  };
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\u00a0/g, " ");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value: unknown): string {
  const href = typeof value === "string" ? value.trim() : "";
  if (!href || /^javascript:/i.test(href)) return "";
  return href;
}

function className(options: ReadOnlyHtmlProjectionOptions, suffix: string): string {
  return `${options.classPrefix ?? "readany"}-${suffix}`;
}

function applyMark(markdown: string, mark: TiptapMark): string {
  if (!markdown) return markdown;

  switch (mark.type) {
    case "bold":
    case "strong":
      return `**${markdown}**`;
    case "italic":
    case "em":
      return `*${markdown}*`;
    case "strike":
      return `~~${markdown}~~`;
    case "code":
      return `\`${markdown.replace(/`/g, "\\`")}\``;
    case "link": {
      const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : "";
      return href ? `[${markdown}](${href})` : markdown;
    }
    default:
      return markdown;
  }
}

function renderInternalLink(node: TiptapNode, options: MarkdownProjectionOptions): string {
  const documentId = typeof node.attrs?.documentId === "string" ? node.attrs.documentId.trim() : "";
  const targetPath = typeof node.attrs?.targetPath === "string" ? node.attrs.targetPath.trim() : "";
  const fallbackTarget = targetPath || documentId;
  const target =
    options.resolveInternalLinkTarget?.(node.attrs ?? {}, fallbackTarget)?.trim() ??
    fallbackTarget;
  const label =
    typeof node.attrs?.label === "string"
      ? node.attrs.label.trim()
      : typeof node.attrs?.title === "string"
        ? node.attrs.title.trim()
        : "";

  if (target && label && label !== target) return `[[${target}|${label}]]`;
  if (target) return `[[${target}]]`;
  if (label) return `[[${label}]]`;
  return "";
}

function renderInline(node: TiptapNode, options: MarkdownProjectionOptions): string {
  if (node.type === "text") {
    return (node.marks ?? []).reduce(
      (markdown, mark) => applyMark(markdown, mark),
      escapeMarkdownText(node.text ?? ""),
    );
  }

  if (node.type === "hardBreak") return "  \n";
  if (node.type === "readanyInternalLink") {
    return renderInternalLink(node, options);
  }
  if (node.type === "readanySourceReference") {
    const label = String(node.attrs?.label ?? node.attrs?.sourceTitle ?? "Source");
    const cfi = String(node.attrs?.cfi ?? "");
    return cfi ? `[${label}](readany://cfi/${encodeURIComponent(cfi)})` : label;
  }

  return (node.content ?? []).map((child) => renderInline(child, options)).join("");
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function renderReadAnyCard(node: TiptapNode, options: MarkdownProjectionOptions): string {
  const attrs = options.cardTemplates?.length
    ? upgradeReadAnyCardAttrsWithTemplates(node.attrs ?? {}, options.cardTemplates)
    : normalizeReadAnyCardAttrs(node.attrs ?? {});
  const cardType = attrs.cardType || "custom";
  const body =
    attrs.markdown ||
    attrs.text ||
    (node.content ?? [])
      .map((child) => renderBlock(child, 0, options))
      .join("\n\n")
      .trim();

  if (!options.includeReadAnyCardMetadata) {
    return renderReadAnyCardMarkdownFallback(attrs, { body });
  }

  const attr = (name: string, value: string | number | undefined) => {
    if (value === undefined || value === "") return "";
    const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${name}="${escaped}"`;
  };
  const dataAttr = () => {
    if (attrs.data === undefined) return "";
    try {
      return attr("data", encodeURIComponent(JSON.stringify(attrs.data)));
    } catch {
      return "";
    }
  };

  const attrText = [
    attr("type", cardType),
    attr("id", attrs.id),
    attr("version", attrs.version ?? 1),
    attr("title", attrs.title),
    attr("source", attrs.sourceId),
    attr("source-title", attrs.sourceTitle),
    attr("cfi", attrs.cfi),
    dataAttr(),
  ]
    .filter(Boolean)
    .join(" ");

  return [`:::readany-card ${attrText}`, body, ":::"].filter(Boolean).join("\n");
}

export function createReadAnyCardTiptapContent(
  attrs: ReadAnyCardAttrs | Record<string, unknown>,
  options: NormalizeTiptapDocumentOptions = {},
): TiptapNode[] {
  const model = createReadAnyCardReadOnlyModel(attrs, {
    body: "",
    cardTemplates: options.cardTemplates,
  });
  const title = model.title.trim();
  const body = model.body.trim();
  const source = model.sourceTitle?.trim();
  const markdown = [
    title ? `### ${title}` : "",
    body,
    source ? `*Source: ${source}*` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const document = markdownToBasicTiptap(markdown || model.cardType, {
    cardTemplates: options.cardTemplates,
  });
  return document.content?.length ? document.content : [{ type: "paragraph" }];
}

function renderListItem(
  node: TiptapNode,
  index: number,
  ordered: boolean,
  options: MarkdownProjectionOptions,
): string {
  const marker = ordered ? `${index + 1}. ` : "- ";
  const rendered = (node.content ?? [])
    .map((child) => renderBlock(child, 0, options))
    .filter(Boolean)
    .join("\n");

  if (!rendered) return marker.trimEnd();

  const [firstLine, ...rest] = rendered.split("\n");
  return [`${marker}${firstLine}`, ...rest.map((line) => `  ${line}`)].join("\n");
}

function renderBlock(
  node: TiptapNode,
  listDepth: number,
  options: MarkdownProjectionOptions,
): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? [])
        .map((child) => renderBlock(child, listDepth, options))
        .filter(Boolean)
        .join("\n\n");
    case "paragraph":
      return (node.content ?? []).map((child) => renderInline(child, options)).join("").trim();
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      const text = (node.content ?? []).map((child) => renderInline(child, options)).join("").trim();
      return `${"#".repeat(level)} ${text}`.trimEnd();
    }
    case "blockquote": {
      const text = (node.content ?? [])
        .map((child) => renderBlock(child, listDepth, options))
        .filter(Boolean)
        .join("\n\n");
      return prefixLines(text, "> ");
    }
    case "bulletList":
      return (node.content ?? [])
        .map((child, index) => renderListItem(child, index, false, options))
        .join("\n");
    case "orderedList":
      return (node.content ?? [])
        .map((child, index) => renderListItem(child, index, true, options))
        .join("\n");
    case "taskList":
      return (node.content ?? [])
        .map((child) => renderBlock(child, listDepth + 1, options))
        .join("\n");
    case "taskItem": {
      const checked = node.attrs?.checked === true ? "x" : " ";
      const text = (node.content ?? [])
        .map((child) => renderBlock(child, listDepth + 1, options))
        .filter(Boolean)
        .join("\n");
      const [firstLine, ...rest] = text.split("\n");
      return [`- [${checked}] ${firstLine ?? ""}`, ...rest.map((line) => `  ${line}`)].join("\n");
    }
    case "listItem":
      return (node.content ?? [])
        .map((child) => renderBlock(child, listDepth + 1, options))
        .join("\n");
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = (node.content ?? [])
        .map((child) => child.text ?? renderInline(child, options))
        .join("");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      const attachmentId =
        typeof node.attrs?.attachmentId === "string" ? node.attrs.attachmentId : "";
      const resolvedSrc =
        options.resolveImageSrc?.(node.attrs ?? {}, src) ||
        (attachmentId ? createKnowledgeAttachmentUri(attachmentId) : src);
      return resolvedSrc ? `![${alt}](${resolvedSrc})` : "";
    }
    case "readanyCard":
      return renderReadAnyCard(node, options);
    default:
      return (node.content ?? [])
        .map((child) => renderBlock(child, listDepth, options))
        .filter(Boolean)
        .join("\n\n");
  }
}

export function renderKnowledgeJsonToMarkdown(
  content: JSONValue | null | undefined,
  options: MarkdownProjectionOptions = {},
): string {
  const document = normalizeTiptapDocument(content, { cardTemplates: options.cardTemplates });
  return renderBlock(document, 0, options).trim();
}

function applyHtmlMark(html: string, mark: TiptapMark): string {
  if (!html) return html;

  switch (mark.type) {
    case "bold":
    case "strong":
      return `<strong>${html}</strong>`;
    case "italic":
    case "em":
      return `<em>${html}</em>`;
    case "strike":
      return `<s>${html}</s>`;
    case "code":
      return `<code>${html}</code>`;
    case "link": {
      const href = safeHref(mark.attrs?.href);
      return href ? `<a href="${escapeHtml(href)}" rel="noreferrer">${html}</a>` : html;
    }
    default:
      return html;
  }
}

function renderHtmlInternalLink(
  node: TiptapNode,
  options: ReadOnlyHtmlProjectionOptions,
): string {
  const documentId = typeof node.attrs?.documentId === "string" ? node.attrs.documentId.trim() : "";
  const targetPath = typeof node.attrs?.targetPath === "string" ? node.attrs.targetPath.trim() : "";
  const fallbackTarget = targetPath || documentId;
  const target =
    options.resolveInternalLinkTarget?.(node.attrs ?? {}, fallbackTarget)?.trim() ??
    fallbackTarget;
  const label =
    typeof node.attrs?.label === "string"
      ? node.attrs.label.trim()
      : typeof node.attrs?.title === "string"
        ? node.attrs.title.trim()
        : target;
  const attrs = [
    `class="${className(options, "internal-link")}"`,
    documentId ? `data-document-id="${escapeHtml(documentId)}"` : "",
    target ? `data-target="${escapeHtml(target)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<span ${attrs}>${escapeHtml(label || "Linked note")}</span>`;
}

function renderHtmlInline(node: TiptapNode, options: ReadOnlyHtmlProjectionOptions): string {
  if (node.type === "text") {
    return (node.marks ?? []).reduce(
      (html, mark) => applyHtmlMark(html, mark),
      escapeHtml(node.text ?? ""),
    );
  }

  if (node.type === "hardBreak") return "<br>";
  if (node.type === "readanyInternalLink") return renderHtmlInternalLink(node, options);
  if (node.type === "readanySourceReference") {
    const label = String(node.attrs?.label ?? node.attrs?.sourceTitle ?? "Source");
    const cfi = typeof node.attrs?.cfi === "string" ? node.attrs.cfi.trim() : "";
    const attrs = [
      `class="${className(options, "source-reference")}"`,
      cfi ? `data-cfi="${escapeHtml(cfi)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<span ${attrs}>${escapeHtml(label)}</span>`;
  }

  return (node.content ?? []).map((child) => renderHtmlInline(child, options)).join("");
}

function renderPlainTextHtmlBlock(text: string, options: ReadOnlyHtmlProjectionOptions): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= 1) return `<p>${escapeHtml(text)}</p>`;
  return `<pre class="${className(options, "card-pre")}">${escapeHtml(text)}</pre>`;
}

function renderReadAnyCardHtml(
  node: TiptapNode,
  options: ReadOnlyHtmlProjectionOptions,
): string {
  const model = createReadAnyCardReadOnlyModel(node.attrs ?? {}, {
    body: (node.content ?? [])
      .map((child) => renderBlock(child, 0, options))
      .join("\n\n")
      .trim(),
    cardTemplates: options.cardTemplates,
  });
  const metaItems =
    model.state === "supported"
      ? model.metadata.filter((item) => item.key === "source" || item.key === "cfi")
      : model.metadata;
  const metadataHtml = metaItems.length
    ? `<dl class="${className(options, "card-meta-list")}">${metaItems
        .map(
          (item) =>
            `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`,
        )
        .join("")}</dl>`
    : "";
  const stateLabel = model.stateLabel
    ? `<span class="${className(options, "card-state")}">${escapeHtml(model.stateLabel)}</span>`
    : "";
  const bodyHtml = model.body
    ? `<div class="${className(options, "card-body")}">${renderPlainTextHtmlBlock(
        model.body,
        options,
      )}</div>`
    : "";

  return [
    `<article class="${className(options, "card")} ${className(options, `card-${model.state}`)}" data-readany-card-type="${escapeHtml(model.cardType)}" data-readany-card-version="${escapeHtml(String(model.version))}" data-readany-card-state="${escapeHtml(model.state)}">`,
    `<header class="${className(options, "card-header")}"><span class="${className(options, "card-type")}">${escapeHtml(model.cardType)}</span>${stateLabel}<h4>${escapeHtml(model.title)}</h4></header>`,
    bodyHtml,
    metadataHtml,
    "</article>",
  ]
    .filter(Boolean)
    .join("");
}

function renderHtmlListItem(node: TiptapNode, options: ReadOnlyHtmlProjectionOptions): string {
  const rendered = (node.content ?? [])
    .map((child) => renderHtmlBlock(child, options))
    .filter(Boolean)
    .join("");
  return `<li>${rendered}</li>`;
}

function renderHtmlBlock(node: TiptapNode, options: ReadOnlyHtmlProjectionOptions): string {
  switch (node.type) {
    case "doc":
      return (node.content ?? []).map((child) => renderHtmlBlock(child, options)).join("");
    case "paragraph": {
      const html = (node.content ?? []).map((child) => renderHtmlInline(child, options)).join("");
      return html ? `<p>${html}</p>` : "";
    }
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      const html = (node.content ?? []).map((child) => renderHtmlInline(child, options)).join("");
      return html ? `<h${level}>${html}</h${level}>` : "";
    }
    case "blockquote": {
      const html = (node.content ?? []).map((child) => renderHtmlBlock(child, options)).join("");
      return html ? `<blockquote>${html}</blockquote>` : "";
    }
    case "bulletList":
      return `<ul>${(node.content ?? []).map((child) => renderHtmlListItem(child, options)).join("")}</ul>`;
    case "orderedList":
      return `<ol>${(node.content ?? []).map((child) => renderHtmlListItem(child, options)).join("")}</ol>`;
    case "taskList":
      return `<ul data-type="taskList">${(node.content ?? [])
        .map((child) => renderHtmlBlock(child, options))
        .join("")}</ul>`;
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      const html = (node.content ?? []).map((child) => renderHtmlBlock(child, options)).join("");
      return `<li data-type="taskItem" data-checked="${checked ? "true" : "false"}"><input type="checkbox" disabled${checked ? " checked" : ""}>${html}</li>`;
    }
    case "listItem":
      return renderHtmlListItem(node, options);
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = (node.content ?? [])
        .map((child) => child.text ?? renderInline(child, options))
        .join("");
      const classAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
      return `<pre><code${classAttr}>${escapeHtml(code)}</code></pre>`;
    }
    case "horizontalRule":
      return "<hr>";
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : "";
      const attachmentId =
        typeof node.attrs?.attachmentId === "string" ? node.attrs.attachmentId : "";
      const resolvedSrc =
        options.resolveImageSrc?.(node.attrs ?? {}, src) ||
        (attachmentId ? createKnowledgeAttachmentUri(attachmentId) : src);
      if (!resolvedSrc) return "";
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      const caption = alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : "";
      return `<figure class="${className(options, "image")}"><img src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(alt)}"${titleAttr}>${caption}</figure>`;
    }
    case "readanyCard":
      return renderReadAnyCardHtml(node, options);
    default:
      return (node.content ?? []).map((child) => renderHtmlBlock(child, options)).join("");
  }
}

export function renderKnowledgeJsonToReadOnlyHtml(
  content: JSONValue | null | undefined,
  options: ReadOnlyHtmlProjectionOptions = {},
): string {
  const document = normalizeTiptapDocument(content, { cardTemplates: options.cardTemplates });
  return renderHtmlBlock(document, options).trim();
}

function textNode(text: string, marks?: TiptapMark[]): TiptapNode {
  return marks?.length ? { type: "text", text, marks } : { type: "text", text };
}

function paragraphNode(text: string): TiptapNode {
  const content = parseInlineMarkdown(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function linkNode(label: string, href: string): TiptapNode {
  if (href.startsWith("readany://cfi/")) {
    return {
      type: "readanySourceReference",
      attrs: {
        label,
        cfi: decodeURIComponent(href.slice("readany://cfi/".length)),
      },
    };
  }

  return textNode(label, [{ type: "link", attrs: { href } }]);
}

function looksLikeStableKnowledgeDocumentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readAnyInternalLinkNode(value: string): TiptapNode {
  const [target, alias] = value.split("|", 2).map((part) => part.trim());
  const isPathTarget = target.includes("/") || /\.md$/i.test(target);
  const label =
    alias || (isPathTarget ? target.split("/").pop()?.replace(/\.md$/i, "") : target) || target;
  const documentId =
    !isPathTarget && (alias || looksLikeStableKnowledgeDocumentId(target)) ? target : undefined;
  return {
    type: "readanyInternalLink",
    attrs: {
      label,
      title: label,
      ...(documentId ? { documentId } : {}),
      ...(isPathTarget ? { targetPath: target } : {}),
    },
  };
}

function parseInlineMarkdown(markdown: string): TiptapNode[] {
  const nodes: TiptapNode[] = [];
  let index = 0;

  const pushPlainUntil = (nextIndex: number) => {
    if (nextIndex > index) nodes.push(textNode(markdown.slice(index, nextIndex)));
    index = nextIndex;
  };

  const nextSpecialIndex = () => {
    const candidates = ["**", "~~", "`", "[[", "[", "*"]
      .map((token) => markdown.indexOf(token, index))
      .filter((position) => position >= 0);
    return candidates.length ? Math.min(...candidates) : markdown.length;
  };

  while (index < markdown.length) {
    if (markdown.startsWith("**", index)) {
      const end = markdown.indexOf("**", index + 2);
      if (end > index + 2) {
        nodes.push(textNode(markdown.slice(index + 2, end), [{ type: "bold" }]));
        index = end + 2;
        continue;
      }
    }

    if (markdown.startsWith("~~", index)) {
      const end = markdown.indexOf("~~", index + 2);
      if (end > index + 2) {
        nodes.push(textNode(markdown.slice(index + 2, end), [{ type: "strike" }]));
        index = end + 2;
        continue;
      }
    }

    if (markdown.startsWith("`", index)) {
      const end = markdown.indexOf("`", index + 1);
      if (end > index + 1) {
        nodes.push(textNode(markdown.slice(index + 1, end), [{ type: "code" }]));
        index = end + 1;
        continue;
      }
    }

    if (markdown.startsWith("[[", index)) {
      const end = markdown.indexOf("]]", index + 2);
      if (end > index + 2) {
        nodes.push(readAnyInternalLinkNode(markdown.slice(index + 2, end)));
        index = end + 2;
        continue;
      }
    }

    if (markdown.startsWith("[", index)) {
      const match = markdown.slice(index).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        nodes.push(linkNode(match[1], match[2]));
        index += match[0].length;
        continue;
      }
    }

    if (markdown.startsWith("*", index)) {
      const end = markdown.indexOf("*", index + 1);
      if (end > index + 1) {
        nodes.push(textNode(markdown.slice(index + 1, end), [{ type: "italic" }]));
        index = end + 1;
        continue;
      }
    }

    const nextIndex = nextSpecialIndex();
    if (nextIndex > index) {
      pushPlainUntil(nextIndex);
    } else {
      nodes.push(textNode(markdown[index]));
      index += 1;
    }
  }

  return nodes;
}

function splitMarkdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let buffer: string[] = [];
  let inFence = false;
  let inReadAnyCard = false;

  const flush = () => {
    const block = buffer.join("\n").trim();
    if (block) blocks.push(block);
    buffer = [];
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!inFence && !inReadAnyCard && /^:::readany-card(?:\s|$)/.test(trimmedLine)) {
      flush();
      buffer.push(line);
      inReadAnyCard = true;
      continue;
    }

    if (inReadAnyCard) {
      buffer.push(line);
      if (trimmedLine === ":::") {
        inReadAnyCard = false;
        flush();
      }
      continue;
    }

    if (line.startsWith("```")) {
      buffer.push(line);
      inFence = !inFence;
      if (!inFence) flush();
      continue;
    }

    if (!inFence && !line.trim()) {
      flush();
      continue;
    }

    buffer.push(line);
  }

  flush();
  return blocks;
}

function unescapeReadAnyCardAttr(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

function parseReadAnyCardMetadata(rawAttrs: string): ReadAnyCardAttrs {
  const attrs: ReadAnyCardAttrs = {};
  const matches = rawAttrs.matchAll(/([A-Za-z][\w-]*)="((?:\\.|[^"\\])*)"/g);

  for (const match of matches) {
    const key = match[1];
    const value = unescapeReadAnyCardAttr(match[2]);

    if (key === "type") attrs.cardType = value;
    else if (key === "id") attrs.id = value;
    else if (key === "title") attrs.title = value;
    else if (key === "source") attrs.sourceId = value;
    else if (key === "source-title") attrs.sourceTitle = value;
    else if (key === "cfi") attrs.cfi = value;
    else if (key === "data") {
      try {
        attrs.data = JSON.parse(decodeURIComponent(value));
      } catch {
        attrs.data = value;
      }
    } else if (key === "version") {
      const version = Number.parseInt(value, 10);
      if (Number.isFinite(version) && version > 0) attrs.version = version;
    }
  }

  return attrs;
}

export function markdownToBasicTiptap(
  markdown: string,
  options: MarkdownImportOptions = {},
): TiptapNode {
  const blocks = splitMarkdownBlocks(markdown);

  const content = blocks.map<TiptapNode>((block) => {
    const readAnyCard = block.match(/^:::readany-card(?:\s+([^\n]*))?\n([\s\S]*?)\n?:::$/);
    if (readAnyCard) {
      const attrs = parseReadAnyCardMetadata(readAnyCard[1] ?? "");
      const body = readAnyCard[2].trim();
      return {
        type: "readanyCard",
        attrs: (
          options.cardTemplates?.length
            ? upgradeReadAnyCardAttrsWithTemplates(
                { ...attrs, markdown: body },
                options.cardTemplates,
              )
            : upgradeReadAnyCardAttrs({
                ...attrs,
                markdown: body,
              })
        ) as Record<string, unknown>,
      };
    }

    const codeBlock = block.match(/^```([^\n]*)\n([\s\S]*?)\n?```$/);
    if (codeBlock) {
      return {
        type: "codeBlock",
        ...(codeBlock[1].trim() ? { attrs: { language: codeBlock[1].trim() } } : {}),
        content: [textNode(codeBlock[2])],
      };
    }

    const image = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const attachmentId = parseKnowledgeAttachmentUri(image[2]);
      return {
        type: "image",
        attrs: {
          alt: image[1],
          src: image[2],
          ...(attachmentId ? { attachmentId } : {}),
        },
      };
    }

    const heading = block.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      return {
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInlineMarkdown(heading[2]),
      };
    }

    if (block === "---") return { type: "horizontalRule" };

    if (block.startsWith("> ")) {
      return {
        type: "blockquote",
        content: [paragraphNode(block.replace(/^>\s?/gm, ""))],
      };
    }

    const lines = block.split("\n");
    if (lines.every((line) => /^[-*]\s+\[[ xX]\]\s+/.test(line))) {
      return {
        type: "taskList",
        content: lines.map((line) => {
          const match = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
          return {
            type: "taskItem",
            attrs: { checked: match?.[1]?.toLowerCase() === "x" },
            content: [paragraphNode(match?.[2] ?? "")],
          };
        }),
      };
    }

    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return {
        type: "bulletList",
        content: lines.map((line) => ({
          type: "listItem",
          content: [paragraphNode(line.replace(/^[-*]\s+/, ""))],
        })),
      };
    }

    if (lines.every((line) => /^\d+\.\s+/.test(line))) {
      return {
        type: "orderedList",
        content: lines.map((line) => ({
          type: "listItem",
          content: [paragraphNode(line.replace(/^\d+\.\s+/, ""))],
        })),
      };
    }

    return paragraphNode(block);
  });

  return { type: "doc", content };
}
