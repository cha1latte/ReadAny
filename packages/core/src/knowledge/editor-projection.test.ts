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
      ].join("\n\n"),
    );
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
      ],
    });

    expect(markdown).toBe(
      [
        "> [!summary] AI Summary\n> A compact summary.",
        "> [!abstract] Flow\n```mermaid\ngraph TD\n  A --> B\n```",
      ].join("\n\n"),
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

  it("normalizes invalid content to an empty Tiptap document", () => {
    expect(normalizeTiptapDocument(null)).toEqual({ type: "doc", content: [] });
    expect(renderKnowledgeJsonToMarkdown(null)).toBe("");
  });
});
