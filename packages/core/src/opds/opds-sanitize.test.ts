import { describe, expect, it } from "vitest";
import { sanitizeOpdsDescription } from "./opds-sanitize";

describe("sanitizeOpdsDescription", () => {
  it("retains only the safe description markup allowlist", () => {
    const input = `<div class="wrapper">
      <p onclick="steal()">Hello<br><em>there</em> <strong>reader</strong></p>
      <ul><li>One</li><li><span>Two</span></li></ul>
      <ol><li>Three</li></ol>
      <blockquote cite="https://evil.test">Quoted</blockquote>
    </div>`;

    expect(sanitizeOpdsDescription(input)).toBe(
      "\n      <p>Hello<br><em>there</em> <strong>reader</strong></p>\n      <ul><li>One</li><li>Two</li></ul>\n      <ol><li>Three</li></ol>\n      <blockquote>Quoted</blockquote>\n    ",
    );
  });

  it("removes executable and remotely embedded content", () => {
    const input =
      '<p>Safe<script>alert(1)</script><style>body{display:none}</style><iframe src="https://evil.test"></iframe><img src="https://evil.test/pixel" onerror="steal()"> tail</p>';

    const result = sanitizeOpdsDescription(input);
    expect(result).toBe("<p>Safe tail</p>");
    expect(result).not.toMatch(/script|style|iframe|img|onerror|evil\.test|alert/i);
  });

  it.each([
    ["relative", "chapters/1"],
    ["root relative", "/books/1"],
    ["http", "http://catalog.test/books/1"],
    ["https", "https://catalog.test/books/1"],
  ])("retains a safe %s link", (_name, href) => {
    expect(sanitizeOpdsDescription(`<a href="${href}" title="removed">Book</a>`)).toBe(
      `<a href="${href}">Book</a>`,
    );
  });

  it.each(["javascript:alert(1)", "data:text/html,evil", "file:///etc/passwd", "//evil.test"])(
    "removes an unsafe link scheme: %s",
    (href) => {
      expect(sanitizeOpdsDescription(`<a href="${href}">Book</a>`)).toBe("<a>Book</a>");
    },
  );

  it("escapes plain text that resembles markup", () => {
    expect(sanitizeOpdsDescription("2 < 3 & 5 > 4")).toBe("2 &lt; 3 &amp; 5 &gt; 4");
  });
});
