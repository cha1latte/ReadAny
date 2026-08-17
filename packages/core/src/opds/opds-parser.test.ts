import { describe, expect, it } from "vitest";
import { parseOpdsDocument } from "./opds-parser";

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:dc="http://purl.org/dc/terms/">
  <title>Catalog</title>
  <subtitle>Books for everyone</subtitle>
  <link rel="next" href="page-2.xml" type="application/atom+xml;profile=opds-catalog" />
  <link rel="previous" href="../page-0.xml" type="application/atom+xml;profile=opds-catalog" />
  <link rel="search" href="search.xml" type="application/opensearchdescription+xml" title="Search books" />
  <link rel="http://opds-spec.org/facet" href="facets/fiction.xml" title="Fiction"
        type="application/atom+xml;profile=opds-catalog" opds:facetGroup="Genre" />
  <entry>
    <id>urn:isbn:9780000000001</id>
    <title>Book</title>
    <author><name>Author</name></author>
    <dc:publisher>Press</dc:publisher>
    <dc:language>en</dc:language>
    <dc:identifier>9780000000001</dc:identifier>
    <dc:issued>2026-08-16</dc:issued>
    <category label="Fiction" term="fiction" />
    <content type="html">&lt;p onclick="steal()"&gt;A &lt;em&gt;safe&lt;/em&gt; description.&lt;/p&gt;&lt;script&gt;steal()&lt;/script&gt;</content>
    <link rel="http://opds-spec.org/image" href="covers/book.jpg" type="image/jpeg" />
    <link rel="http://opds-spec.org/acquisition" href="files/book.epub" type="application/epub+zip" />
    <link rel="http://opds-spec.org/acquisition" href="files/book.weird" type="application/x-made-up" />
  </entry>
</feed>`;

const OPDS2 = JSON.stringify({
  metadata: { title: "OPDS 2 Catalog", subtitle: "New books" },
  links: [
    { rel: "next", href: "pages/2.json", type: "application/opds+json" },
    { rel: ["previous"], href: "../previous.json", type: "application/opds+json" },
    {
      rel: "search",
      href: "search{?query}",
      type: "application/opds+json",
      title: "Search catalog",
      templated: true,
    },
  ],
  navigation: [{ title: "Popular", href: "popular.json", type: "application/opds+json" }],
  publications: [
    {
      metadata: {
        identifier: "urn:isbn:9780000000002",
        title: "Second Book",
        author: [{ name: "First Author" }, "Second Author"],
        publisher: "Other Press",
        language: "fr",
        published: "2025-01-02",
        description:
          '<p>Read <strong>this</strong>. <a href="chapters/1">Chapter</a><iframe src="https://evil.test"></iframe></p>',
        subject: [{ name: "Mystery" }, "Adventure"],
      },
      images: [{ rel: "cover", href: "images/cover.png", type: "image/png" }],
      links: [
        {
          rel: ["http://opds-spec.org/acquisition", "alternate"],
          href: "downloads/book.pdf",
          type: "application/pdf",
        },
      ],
    },
  ],
  groups: [
    {
      metadata: { title: "Featured" },
      navigation: [{ title: "Editors' picks", href: "groups/editors.json" }],
      publications: [],
    },
  ],
  facets: [
    {
      metadata: { title: "Language" },
      links: [{ rel: "self", href: "facets/fr.json", title: "French" }],
    },
  ],
});

describe("parseOpdsDocument", () => {
  it("normalizes an OPDS 1 Atom acquisition feed", () => {
    const feed = parseOpdsDocument(
      ATOM,
      "application/atom+xml;profile=opds-catalog",
      "https://catalog.test/root/feed.xml",
    );

    expect(feed).toMatchObject({
      title: "Catalog",
      subtitle: "Books for everyone",
      nextUrl: "https://catalog.test/root/page-2.xml",
      previousUrl: "https://catalog.test/page-0.xml",
      search: {
        kind: "openSearch",
        descriptorUrl: "https://catalog.test/root/search.xml",
        title: "Search books",
      },
    });
    expect(feed.facets).toEqual([
      {
        title: "Genre",
        links: [
          {
            rel: ["http://opds-spec.org/facet"],
            url: "https://catalog.test/root/facets/fiction.xml",
            title: "Fiction",
            type: "application/atom+xml;profile=opds-catalog",
          },
        ],
      },
    ]);
    expect(feed.publications[0]).toMatchObject({
      id: "urn:isbn:9780000000001",
      title: "Book",
      authors: ["Author"],
      publisher: "Press",
      language: "en",
      identifier: "9780000000001",
      published: "2026-08-16",
      subjects: ["Fiction"],
      description: "<p>A <em>safe</em> description.</p>",
      images: [{ url: "https://catalog.test/root/covers/book.jpg" }],
    });
    expect(feed.publications[0]?.acquisitions).toEqual([
      expect.objectContaining({
        url: "https://catalog.test/root/files/book.epub",
        format: "epub",
      }),
      expect.objectContaining({
        url: "https://catalog.test/root/files/book.weird",
        format: null,
      }),
    ]);
  });

  it("validates and normalizes an OPDS 2 feed including nested collections", () => {
    const feed = parseOpdsDocument(
      OPDS2,
      "application/opds+json; charset=utf-8",
      "https://catalog.test/root/feed.json",
    );

    expect(feed).toMatchObject({
      title: "OPDS 2 Catalog",
      subtitle: "New books",
      navigation: [{ title: "Popular", url: "https://catalog.test/root/popular.json" }],
      nextUrl: "https://catalog.test/root/pages/2.json",
      previousUrl: "https://catalog.test/previous.json",
      search: {
        kind: "template",
        urlTemplate: "https://catalog.test/root/search{?query}",
        title: "Search catalog",
      },
    });
    expect(feed.publications[0]).toMatchObject({
      id: "urn:isbn:9780000000002",
      title: "Second Book",
      authors: ["First Author", "Second Author"],
      publisher: "Other Press",
      language: "fr",
      identifier: "urn:isbn:9780000000002",
      published: "2025-01-02",
      subjects: ["Mystery", "Adventure"],
      description: '<p>Read <strong>this</strong>. <a href="chapters/1">Chapter</a></p>',
      images: [expect.objectContaining({ url: "https://catalog.test/root/images/cover.png" })],
      acquisitions: [
        expect.objectContaining({
          url: "https://catalog.test/root/downloads/book.pdf",
          format: "pdf",
        }),
      ],
    });
    expect(feed.groups[0]).toMatchObject({
      title: "Featured",
      navigation: [
        { title: "Editors' picks", url: "https://catalog.test/root/groups/editors.json" },
      ],
    });
    expect(feed.facets[0]).toEqual({
      title: "Language",
      links: [
        {
          rel: ["self"],
          url: "https://catalog.test/root/facets/fr.json",
          title: "French",
        },
      ],
    });
  });

  it("maps supported acquisition extensions and retains unknown formats", () => {
    const body = JSON.stringify({
      metadata: { title: "Formats" },
      publications: [
        {
          metadata: { title: "Format Book" },
          links: [
            { rel: "http://opds-spec.org/acquisition", href: "book.azw3" },
            {
              rel: "http://opds-spec.org/acquisition",
              href: "book-with-mime.azw3",
              type: "application/vnd.amazon.ebook",
            },
            {
              rel: "http://opds-spec.org/acquisition",
              href: "generic.zip",
              type: "application/zip",
            },
            { rel: "http://opds-spec.org/acquisition", href: "book.unknown" },
          ],
        },
      ],
    });

    expect(
      parseOpdsDocument(
        body,
        "application/opds+json",
        "https://catalog.test/feed.json",
      ).publications[0]?.acquisitions.map((item) => item.format),
    ).toEqual(["azw3", "azw3", null, null]);
  });

  it.each([
    ["application/opds+json", "{", "Invalid OPDS JSON document"],
    ["application/opds+json", JSON.stringify({ metadata: {} }), "Invalid OPDS 2 catalog"],
    ["application/opds+json", JSON.stringify([]), "Invalid OPDS 2 catalog"],
    ["application/xml", "<feed><title>Broken</feed>", "Invalid OPDS XML document"],
  ])("rejects invalid documents with stable errors", (contentType, body, message) => {
    expect(() => parseOpdsDocument(body, contentType, "https://catalog.test/feed")).toThrow(
      message,
    );
  });

  it("does not resolve external XML entities", () => {
    const body = `<?xml version="1.0"?>
<!DOCTYPE feed [<!ENTITY xxe SYSTEM "file:///definitely-not-real/XXE_SECRET">]>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Safe catalog</title>
  <entry>
    <title>Safe book</title>
    <content type="text">&xxe;</content>
    <link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />
  </entry>
</feed>`;

    const feed = parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed");
    expect(feed.publications[0]?.description ?? "").not.toContain("XXE_SECRET");
  });

  it("sanitizes an Atom XHTML description without losing safe markup", () => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>XHTML catalog</title>
  <entry>
    <title>XHTML book</title>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p onmouseover="steal()">Keep <strong>this</strong><img src="https://evil.test/pixel" /></p><script>steal()</script></div></content>
    <link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />
  </entry>
</feed>`;

    const feed = parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed");
    expect(feed.publications[0]?.description).toBe("<p>Keep <strong>this</strong></p>");
  });
});
