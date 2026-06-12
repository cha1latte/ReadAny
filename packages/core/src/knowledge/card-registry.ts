import type { KnowledgeCardTemplate } from "../types";

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

export interface ReadAnyCardMarkdownContext {
  body: string;
}

export interface ReadAnyCardDefinition {
  cardType: string;
  version: number;
  insertLabel: string;
  markdownFallback: (attrs: ReadAnyCardAttrs, context: ReadAnyCardMarkdownContext) => string;
}

export interface ReadAnyCardTemplateSchema {
  cardType?: string;
  title?: string;
  insertLabel?: string;
  description?: string;
  markdown?: string;
  text?: string;
  sourceTitle?: string;
  sourceId?: string;
  cfi?: string;
  attrs?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringAttr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return stringAttr(record[key]);
}

function numberAttr(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : undefined;
}

function templateSchema(template: KnowledgeCardTemplate): ReadAnyCardTemplateSchema {
  return isRecord(template.schemaJson) ? (template.schemaJson as ReadAnyCardTemplateSchema) : {};
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function callout(kind: string, title: string, body: string, footer?: string): string {
  const lines = [`> [!${kind}] ${title}`];
  if (body) lines.push(prefixLines(body, "> "));
  if (footer) lines.push(`> ${footer}`);
  return lines.join("\n");
}

function cardTitle(attrs: ReadAnyCardAttrs, fallback: string): string {
  return attrs.title || attrs.sourceTitle || fallback;
}

function bodyFromAttrs(attrs: ReadAnyCardAttrs, context: ReadAnyCardMarkdownContext): string {
  return attrs.markdown || attrs.text || context.body;
}

export function normalizeReadAnyCardAttrs(
  input: ReadAnyCardAttrs | Record<string, unknown> | null | undefined,
): ReadAnyCardAttrs {
  const raw = isRecord(input) ? input : {};
  const cardType = stringField(raw, "cardType") ?? stringField(raw, "type") ?? "custom";
  const definition = getReadAnyCardDefinition(cardType);
  const version = numberAttr(raw.version) ?? definition?.version ?? 1;
  const attrs: ReadAnyCardAttrs = { cardType, version };

  const id = stringField(raw, "id");
  const title = stringField(raw, "title");
  const text = stringField(raw, "text");
  const sourceTitle = stringField(raw, "sourceTitle") ?? stringField(raw, "source-title");
  const sourceId = stringField(raw, "sourceId") ?? stringField(raw, "source");
  const cfi = stringField(raw, "cfi");

  if (id) attrs.id = id;
  if (title) attrs.title = title;
  if (typeof raw.markdown === "string") attrs.markdown = raw.markdown;
  if (text) attrs.text = text;
  if (sourceTitle) attrs.sourceTitle = sourceTitle;
  if (sourceId) attrs.sourceId = sourceId;
  if (cfi) attrs.cfi = cfi;
  if ("data" in raw) attrs.data = raw.data;

  return attrs;
}

export const builtInReadAnyCards: ReadAnyCardDefinition[] = [
  {
    cardType: "bookQuote",
    version: 1,
    insertLabel: "Quote",
    markdownFallback: (attrs, context) =>
      callout(
        "quote",
        cardTitle(attrs, "Quote"),
        bodyFromAttrs(attrs, context),
        attrs.sourceTitle ? `Source: ${attrs.sourceTitle}` : undefined,
      ),
  },
  {
    cardType: "callout",
    version: 1,
    insertLabel: "Callout",
    markdownFallback: (attrs, context) =>
      callout("note", cardTitle(attrs, "Note"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "bookMetadata",
    version: 1,
    insertLabel: "Book metadata",
    markdownFallback: (attrs, context) =>
      callout("info", cardTitle(attrs, "Book metadata"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "aiSummary",
    version: 1,
    insertLabel: "AI summary",
    markdownFallback: (attrs, context) =>
      callout("summary", cardTitle(attrs, "AI summary"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "qa",
    version: 1,
    insertLabel: "Q&A",
    markdownFallback: (attrs, context) =>
      callout("question", cardTitle(attrs, "Question"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "review",
    version: 1,
    insertLabel: "Review",
    markdownFallback: (attrs, context) =>
      callout("tip", cardTitle(attrs, "Review"), bodyFromAttrs(attrs, context)),
  },
  {
    cardType: "mindmap",
    version: 1,
    insertLabel: "Mindmap",
    markdownFallback: (attrs, context) => {
      const body = bodyFromAttrs(attrs, context);
      return [`> [!abstract] ${cardTitle(attrs, "Mindmap")}`, "", "```markmap", body, "```"]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    cardType: "mermaid",
    version: 1,
    insertLabel: "Mermaid",
    markdownFallback: (attrs, context) => {
      const body = bodyFromAttrs(attrs, context);
      return [`> [!abstract] ${cardTitle(attrs, "Diagram")}`, "", "```mermaid", body, "```"]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    cardType: "relatedNotes",
    version: 1,
    insertLabel: "Related notes",
    markdownFallback: (attrs, context) =>
      callout("link", cardTitle(attrs, "Related notes"), bodyFromAttrs(attrs, context)),
  },
];

const builtInCardMap = new Map(
  builtInReadAnyCards.map((definition) => [definition.cardType, definition]),
);

export function getReadAnyCardDefinition(cardType: string): ReadAnyCardDefinition | undefined {
  return builtInCardMap.get(cardType);
}

export function createDefaultReadAnyCardAttrs(
  cardType: string,
  options: { title?: string; version?: number } = {},
): ReadAnyCardAttrs {
  const definition = getReadAnyCardDefinition(cardType);
  const version = options.version ?? definition?.version ?? 1;
  const title = options.title ?? definition?.insertLabel ?? cardType;

  if (cardType === "mermaid") {
    return {
      cardType,
      version,
      title,
      markdown: "graph TD\n  A[Idea] --> B[Note]",
    };
  }

  if (cardType === "mindmap") {
    return {
      cardType,
      version,
      title,
      markdown: "# Topic\n## Branch",
    };
  }

  if (cardType === "qa") {
    return {
      cardType,
      version,
      title,
      markdown: "Q:\nA:",
    };
  }

  return {
    cardType,
    version,
    title,
    markdown: "",
  };
}

export function createReadAnyCardAttrsFromTemplate(
  template: KnowledgeCardTemplate,
): ReadAnyCardAttrs {
  const schema = templateSchema(template);
  const schemaAttrs = isRecord(schema.attrs) ? schema.attrs : {};
  const cardType =
    stringAttr(schema.cardType) ?? (template.builtIn ? template.id : `custom:${template.id}`);
  const version = numberAttr(schemaAttrs.version) ?? template.version;
  const attrs = normalizeReadAnyCardAttrs({
    ...schemaAttrs,
    cardType,
    version,
    title: stringAttr(schema.title) ?? stringAttr(schema.insertLabel) ?? template.name,
    markdown: stringAttr(schema.markdown) ?? "",
    text: schema.text,
    sourceTitle: schema.sourceTitle,
    sourceId: schema.sourceId,
    cfi: schema.cfi,
  });

  return attrs;
}

export function getReadAnyCardTemplateInsertLabel(template: KnowledgeCardTemplate): string {
  const schema = templateSchema(template);
  return stringAttr(schema.insertLabel) ?? stringAttr(schema.title) ?? template.name;
}

export function getReadAnyCardTemplateDescription(
  template: KnowledgeCardTemplate,
): string | undefined {
  return stringAttr(templateSchema(template).description);
}

export function renderReadAnyCardMarkdownFallback(
  attrs: ReadAnyCardAttrs,
  context: ReadAnyCardMarkdownContext,
): string {
  const normalizedAttrs = normalizeReadAnyCardAttrs(attrs);
  const cardType = normalizedAttrs.cardType || "custom";
  const definition = getReadAnyCardDefinition(cardType);
  if (definition) return definition.markdownFallback(normalizedAttrs, context);

  return callout(
    "note",
    cardTitle(normalizedAttrs, cardType),
    bodyFromAttrs(normalizedAttrs, context),
  );
}
