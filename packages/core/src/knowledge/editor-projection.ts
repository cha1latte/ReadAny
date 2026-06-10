import type { JSONValue } from "../types";
import { EMPTY_TIPTAP_DOCUMENT } from "../types";

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

export interface ReadAnyCardAttrs {
  cardType?: string;
  id?: string;
  version?: number;
  title?: string;
  text?: string;
  sourceTitle?: string;
  sourceId?: string;
  cfi?: string;
  markdown?: string;
  data?: unknown;
}

export interface MarkdownProjectionOptions {
  /** Preserve custom card metadata with fenced ReadAny blocks. */
  includeReadAnyCardMetadata?: boolean;
}

function isObject(value: JSONValue | unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isTiptapNode(value: JSONValue | unknown): value is TiptapNode {
  return isObject(value) && typeof value.type === "string";
}

export function normalizeTiptapDocument(content: JSONValue | null | undefined): TiptapNode {
  if (isTiptapNode(content)) return content;
  return EMPTY_TIPTAP_DOCUMENT as unknown as TiptapNode;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\u00a0/g, " ");
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

function renderInline(node: TiptapNode): string {
  if (node.type === "text") {
    return (node.marks ?? []).reduce(
      (markdown, mark) => applyMark(markdown, mark),
      escapeMarkdownText(node.text ?? ""),
    );
  }

  if (node.type === "hardBreak") return "  \n";
  if (node.type === "readanyInternalLink") {
    const label = String(node.attrs?.label ?? node.attrs?.title ?? node.attrs?.documentId ?? "");
    const id = String(node.attrs?.documentId ?? "");
    return id ? `[[${label || id}]]` : label;
  }
  if (node.type === "readanySourceReference") {
    const label = String(node.attrs?.label ?? node.attrs?.sourceTitle ?? "Source");
    const cfi = String(node.attrs?.cfi ?? "");
    return cfi ? `[${label}](readany://cfi/${encodeURIComponent(cfi)})` : label;
  }

  return (node.content ?? []).map(renderInline).join("");
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function renderReadAnyCard(node: TiptapNode, options: MarkdownProjectionOptions): string {
  const attrs = (node.attrs ?? {}) as ReadAnyCardAttrs;
  const cardType = attrs.cardType || "custom";
  const title = attrs.title || attrs.sourceTitle || cardType;
  const body =
    attrs.markdown ||
    attrs.text ||
    (node.content ?? [])
      .map((child) => renderBlock(child, 0, options))
      .join("\n\n")
      .trim();

  if (!options.includeReadAnyCardMetadata) {
    const lines = [`> [!note] ${title}`];
    if (body) lines.push(prefixLines(body, "> "));
    if (attrs.sourceTitle) lines.push(`> Source: ${attrs.sourceTitle}`);
    return lines.join("\n");
  }

  const attrText = [
    `type="${cardType}"`,
    attrs.id ? `id="${attrs.id}"` : "",
    `version="${attrs.version ?? 1}"`,
    attrs.sourceId ? `source="${attrs.sourceId}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return [`:::readany-card ${attrText}`, body, ":::"].filter(Boolean).join("\n");
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
      return (node.content ?? []).map(renderInline).join("").trim();
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      const text = (node.content ?? []).map(renderInline).join("").trim();
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
      const code = (node.content ?? []).map((child) => child.text ?? renderInline(child)).join("");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return src ? `![${alt}](${src})` : "";
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
  const document = normalizeTiptapDocument(content);
  return renderBlock(document, 0, options).trim();
}

function textNode(text: string): TiptapNode {
  return { type: "text", text };
}

function paragraphNode(text: string): TiptapNode {
  return text ? { type: "paragraph", content: [textNode(text)] } : { type: "paragraph" };
}

export function markdownToBasicTiptap(markdown: string): TiptapNode {
  const blocks = markdown
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const content = blocks.map<TiptapNode>((block) => {
    const heading = block.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      return {
        type: "heading",
        attrs: { level: heading[1].length },
        content: [textNode(heading[2])],
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
