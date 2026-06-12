import { describe, expect, it } from "vitest";
import {
  markdownToBasicTiptap,
  normalizeTiptapDocument,
  renderKnowledgeJsonToMarkdown,
} from "./editor-projection";

describe("editor projection", () => {
  it("renders common Tiptap nodes to Markdown", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Chapter Notes" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "deeply", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "slowly", marks: [{ type: "italic" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "A quote" }] }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }],
            },
          ],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Review" }] }],
            },
          ],
        },
        { type: "horizontalRule" },
        { type: "image", attrs: { src: "cover.png", alt: "Cover" } },
        { type: "image", attrs: { attachmentId: "att-1", src: "asset://cover.png", alt: "Local" } },
      ],
    });

    expect(markdown).toBe(
      [
        "## Chapter Notes",
        "Read **deeply** and *slowly*.",
        "> A quote",
        "- One\n- Two",
        "- [x] Review",
        "---",
        "![Cover](cover.png)",
        "![Local](readany-attachment://att-1)",
      ].join("\n\n"),
    );
  });

  it("allows export callers to resolve image attachment targets", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { attachmentId: "att-1", src: "asset://cover.png", alt: "Cover" },
          },
        ],
      },
      {
        resolveImageSrc: (attrs) =>
          attrs.attachmentId === "att-1" ? "../Assets/cover.png" : undefined,
      },
    );

    expect(markdown).toBe("![Cover](../Assets/cover.png)");
  });

  it("renders ReadAny cards as Obsidian-friendly callouts by default", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            title: "Important Quote",
            text: "Reading is thinking.",
            sourceTitle: "Chapter 1",
          },
        },
      ],
    });

    expect(markdown).toBe(
      "> [!quote] Important Quote\n> Reading is thinking.\n> Source: Chapter 1",
    );
  });

  it("uses card registry fallbacks for built-in ReadAny card types", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiSummary",
            title: "AI Summary",
            markdown: "A compact summary.",
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "mermaid",
            title: "Flow",
            markdown: "graph TD\n  A --> B",
          },
        },
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiToolFailure",
            data: {
              toolName: "searchKnowledgeBase",
              error: "Index unavailable",
            },
          },
        },
      ],
    });

    expect(markdown).toBe(
      [
        "> [!summary] AI Summary\n> A compact summary.",
        "> [!abstract] Flow\n```mermaid\ngraph TD\n  A --> B\n```",
        "> [!failure] searchKnowledgeBase\n> Tool: searchKnowledgeBase\n> Error: Index unavailable",
      ].join("\n\n"),
    );
  });

  it("normalizes legacy card attrs into readable fallbacks", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            type: "legacyTimeline",
            version: "2",
            title: "Reading timeline",
            source: "highlight-1",
            "source-title": "Chapter 2",
            text: "A -> B",
          },
        },
      ],
    });

    expect(markdown).toBe("> [!note] Reading timeline\n> A -> B");
  });

  it("upgrades card attrs while normalizing Tiptap documents", () => {
    expect(
      normalizeTiptapDocument({
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              type: "bookQuote",
              data: {
                quote: "A precise quote.",
                chapterTitle: "Chapter 3",
                highlightId: "hl-3",
              },
            },
          },
        ],
      }),
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            version: 1,
            markdown: "A precise quote.",
            text: "A precise quote.",
            sourceTitle: "Chapter 3",
            sourceId: "hl-3",
            data: {
              quote: "A precise quote.",
              chapterTitle: "Chapter 3",
              highlightId: "hl-3",
            },
          },
        },
      ],
    });
  });

  it("exports upgraded card metadata for round-tripping", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              type: "bookQuote",
              data: {
                quote: "A precise quote.",
                chapterTitle: "Chapter 3",
                highlightId: "hl-3",
              },
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="bookQuote" version="1" source="hl-3" source-title="Chapter 3" data="%7B%22quote%22%3A%22A%20precise%20quote.%22%2C%22chapterTitle%22%3A%22Chapter%203%22%2C%22highlightId%22%3A%22hl-3%22%7D"\nA precise quote.\n:::',
    );
  });

  it("can preserve ReadAny card metadata for round-tripping", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              cardType: "bookQuote",
              id: "card-1",
              version: 2,
              sourceId: "hl-1",
              markdown: "> Quote",
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="bookQuote" id="card-1" version="2" source="hl-1"\n> Quote\n:::',
    );
  });

  it("preserves normalized legacy card metadata when requested", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              type: "legacyTimeline",
              version: "2",
              title: "Reading timeline",
              source: "highlight-1",
              "source-title": "Chapter 2",
              cfi: "epubcfi(/6/8)",
              markdown: "A -> B",
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="legacyTimeline" version="2" title="Reading timeline" source="highlight-1" source-title="Chapter 2" cfi="epubcfi(/6/8)"\nA -> B\n:::',
    );
  });

  it("preserves ReadAny card title and CFI metadata when requested", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              cardType: "bookQuote",
              id: "card-1",
              version: 2,
              title: 'Quoted "Idea"',
              sourceId: "hl-1",
              cfi: "epubcfi(/6/2)",
              markdown: "Reading is thinking.",
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      ':::readany-card type="bookQuote" id="card-1" version="2" title="Quoted \\"Idea\\"" source="hl-1" cfi="epubcfi(/6/2)"\nReading is thinking.\n:::',
    );
  });

  it("preserves card source titles and structured data metadata when requested", () => {
    const markdown = renderKnowledgeJsonToMarkdown(
      {
        type: "doc",
        content: [
          {
            type: "readanyCard",
            attrs: {
              cardType: "aiSummary",
              id: "card-ai-1",
              version: 3,
              title: "AI memory",
              sourceId: "doc-1",
              sourceTitle: "Chapter 1",
              markdown: "A compact answer.",
              data: {
                citations: [{ cfi: "epubcfi(/6/4)", text: "Evidence" }],
                toolState: "confirmed",
              },
            },
          },
        ],
      },
      { includeReadAnyCardMetadata: true },
    );

    expect(markdown).toBe(
      [
        ':::readany-card type="aiSummary" id="card-ai-1" version="3" title="AI memory" source="doc-1" source-title="Chapter 1" data="%7B%22citations%22%3A%5B%7B%22cfi%22%3A%22epubcfi(%2F6%2F4)%22%2C%22text%22%3A%22Evidence%22%7D%5D%2C%22toolState%22%3A%22confirmed%22%7D"',
        "A compact answer.",
        ":::",
      ].join("\n"),
    );

    expect(markdownToBasicTiptap(markdown)).toEqual({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "aiSummary",
            id: "card-ai-1",
            version: 3,
            title: "AI memory",
            sourceId: "doc-1",
            sourceTitle: "Chapter 1",
            markdown: "A compact answer.",
            data: {
              citations: [{ cfi: "epubcfi(/6/4)", text: "Evidence" }],
              toolState: "confirmed",
            },
          },
        },
      ],
    });
  });

  it("imports ReadAny card metadata blocks without losing card attrs or body spacing", () => {
    const json = markdownToBasicTiptap(
      [
        ':::readany-card type="bookQuote" id="card-1" version="2" title="Quoted \\"Idea\\"" source="hl-1" cfi="epubcfi(/6/2)"',
        "Line 1",
        "",
        "Line 2",
        ":::",
      ].join("\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "readanyCard",
          attrs: {
            cardType: "bookQuote",
            id: "card-1",
            version: 2,
            title: 'Quoted "Idea"',
            sourceId: "hl-1",
            cfi: "epubcfi(/6/2)",
            markdown: "Line 1\n\nLine 2",
          },
        },
      ],
    });
  });

  it("imports basic Markdown blocks into Tiptap JSON", () => {
    const json = markdownToBasicTiptap(
      ["# Title", "Paragraph", "> Quote", "- A\n- B", "1. One\n2. Two", "---"].join("\n\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "Paragraph" }] },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Quote" }] }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }],
            },
          ],
        },
        { type: "horizontalRule" },
      ],
    });
  });

  it("imports inline rich text into Tiptap marks and source nodes", () => {
    const json = markdownToBasicTiptap(
      [
        "Read **deeply**, *slowly*, ~~carefully~~, and `quote accurately`.",
        "Open [ReadAny](https://readany.example) and cite [Chapter 1](readany://cfi/epubcfi%28%2F6%2F2%29).",
        "Link [[doc-1|Durable note]] and [[Loose idea]].",
      ].join("\n\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "deeply", marks: [{ type: "bold" }] },
            { type: "text", text: ", " },
            { type: "text", text: "slowly", marks: [{ type: "italic" }] },
            { type: "text", text: ", " },
            { type: "text", text: "carefully", marks: [{ type: "strike" }] },
            { type: "text", text: ", and " },
            { type: "text", text: "quote accurately", marks: [{ type: "code" }] },
            { type: "text", text: "." },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open " },
            {
              type: "text",
              text: "ReadAny",
              marks: [{ type: "link", attrs: { href: "https://readany.example" } }],
            },
            { type: "text", text: " and cite " },
            {
              type: "readanySourceReference",
              attrs: { label: "Chapter 1", cfi: "epubcfi(/6/2)" },
            },
            { type: "text", text: "." },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Link " },
            {
              type: "readanyInternalLink",
              attrs: { documentId: "doc-1", label: "Durable note", title: "Durable note" },
            },
            { type: "text", text: " and " },
            {
              type: "readanyInternalLink",
              attrs: { label: "Loose idea", title: "Loose idea" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });
  });

  it("exports Obsidian-style internal links without losing aliases", () => {
    const markdown = renderKnowledgeJsonToMarkdown({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Link " },
            {
              type: "readanyInternalLink",
              attrs: { documentId: "doc-1", label: "Durable note", title: "Durable note" },
            },
            { type: "text", text: " and " },
            {
              type: "readanyInternalLink",
              attrs: { label: "Loose idea", title: "Loose idea" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    });

    expect(markdown).toBe("Link [[doc-1|Durable note]] and [[Loose idea]].");
  });

  it("imports Markdown image and fenced code blocks without losing blank lines", () => {
    const json = markdownToBasicTiptap(
      ["![Cover](assets/cover.png)", "```ts\nconst a = 1;\n\nconst b = 2;\n```"].join("\n\n"),
    );

    expect(json).toEqual({
      type: "doc",
      content: [
        { type: "image", attrs: { alt: "Cover", src: "assets/cover.png" } },
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const a = 1;\n\nconst b = 2;" }],
        },
      ],
    });
  });

  it("imports Markdown task lists into task item nodes", () => {
    const json = markdownToBasicTiptap("- [x] Done\n- [ ] Later");

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Later" }] }],
            },
          ],
        },
      ],
    });
  });

  it("normalizes invalid content to an empty Tiptap document", () => {
    expect(normalizeTiptapDocument(null)).toEqual({ type: "doc", content: [] });
    expect(renderKnowledgeJsonToMarkdown(null)).toBe("");
  });
});
