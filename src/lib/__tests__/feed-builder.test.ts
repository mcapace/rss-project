import { describe, it, expect } from "vitest";
import {
  generateRssFeed,
  escapeXml,
  unescapeHtmlEntities,
  extractAuthorFromHtml,
  FeedIssue,
} from "@/lib/feed-builder";

describe("RSS Feed Generation & BlueToad Contract Compliance", () => {
  it("escapes XML special characters correctly", () => {
    expect(escapeXml('Tom & Jerry <"Kids">')).toBe(
      "Tom &amp; Jerry &lt;&quot;Kids&quot;&gt;"
    );
  });

  it("unescapes HTML entities so description is not double-encoded", () => {
    expect(unescapeHtmlEntities("Rothman &amp; Winter")).toBe(
      "Rothman & Winter"
    );
    expect(escapeXml(unescapeHtmlEntities("Rothman &amp; Winter"))).toBe(
      "Rothman &amp; Winter"
    );
  });

  it("extracts author bylines from article HTML", () => {
    expect(
      extractAuthorFromHtml("<h2>Gin</h2><p><em>By Laura Pelner</em></p><p>Body</p>")
    ).toBe("Laura Pelner");
    expect(
      extractAuthorFromHtml("<p><strong>BY TERRI ALLAN</strong></p>")
    ).toBe("Terri Allan");
  });

  it("generates a compliant RSS 2.0 feed matching the BlueToad spec", () => {
    const fixtureIssue: FeedIssue = {
      id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      brand: "mw",
      issue_id: "2026-09",
      issue_label: "September 2026",
      pdf_key: "pdfs/inbox/mw-2026-09.pdf",
      created_at: "2026-08-31T12:00:00.000Z",
      articles: [
        {
          id: "art-1",
          sort_order: 0,
          title: "Whiskey Revival & Craft Spirits",
          section: "Spirits Report",
          author: "Laura Pelner",
          pdf_pages: [4, 5],
          html: "<h2>The Renaissance</h2><p><em>By Laura Pelner</em></p><p>American single malt whiskey continues its unprecedented rise across premium retail channels.</p><hr><p><strong>Key Growth Drivers:</strong> Aged stock &amp; boutique blending.</p>",
          include: true,
          created_at: "2026-08-31T12:00:00.000Z",
          images: [
            {
              s3_key: "mw/2026-09/images/p004_lead.jpg",
              width: 1200,
              height: 800,
              sort_order: 0,
              is_lead: true,
              include: true,
            },
            {
              s3_key: "mw/2026-09/images/p005_bottle.jpg",
              width: 600,
              height: 900,
              sort_order: 1,
              is_lead: false,
              include: true,
            },
            {
              s3_key: "mw/2026-09/images/p005_ad.jpg",
              width: 300,
              height: 250,
              sort_order: 2,
              include: false, // excluded image
            },
          ],
        },
        {
          id: "art-2",
          sort_order: 1,
          title: "Excluded Article",
          section: "Promo",
          pdf_pages: [9],
          html: "<p>Promo piece</p>",
          include: false, // excluded article
          created_at: "2026-08-31T12:00:00.000Z",
        },
      ],
    };

    const xml = generateRssFeed(
      fixtureIssue,
      "https://editions.marketwatchmag.com"
    );

    // 1. Assert RSS 2.0 and required namespaces
    expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
    expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(xml).toContain('xmlns:wfw="http://wellformedweb.org/CommentAPI/"');

    // 2. Assert Channel details
    expect(xml).toContain("<title>Market Watch — September 2026</title>");
    expect(xml).toContain(
      '<atom:link href="https://editions.marketwatchmag.com/api/feeds/mw/2026-09/feed.xml" rel="self" type="application/rss+xml" />'
    );

    // 3. Assert Article presence and exclusion
    expect(xml).toContain("<title>Whiskey Revival &amp; Craft Spirits</title>");
    expect(xml).not.toContain("Excluded Article");

    // 4. Assert GUID and Link structure ({base}/{issue}/article-NNN)
    expect(xml).toContain(
      '<guid isPermaLink="false">https://mshanken-digital-editions.s3.amazonaws.com/2026-09/article-001</guid>'
    );
    expect(xml).toContain(
      "<link>https://mshanken-digital-editions.s3.amazonaws.com/2026-09/article-001</link>"
    );

    // 5. BlueToad author mapping: dc:creator = author; category = section
    expect(xml).toContain("<dc:creator>Laura Pelner</dc:creator>");
    expect(xml).toContain("<category>Spirits Report</category>");

    // 6. Assert XML escaped description with lead <img> inline (single-escaped &)
    expect(xml).toContain("&lt;img src=&quot;https://mshanken-digital-editions.s3.amazonaws.com/mw/2026-09/images/p004_lead.jpg&quot; /&gt;");
    expect(xml).toContain("&lt;h2&gt;The Renaissance&lt;/h2&gt;");
    expect(xml).toContain("Aged stock &amp; boutique blending");
    expect(xml).not.toContain("&amp;amp;");

    // 7. Assert media:content attributes
    expect(xml).toContain(
      '<media:content url="https://mshanken-digital-editions.s3.amazonaws.com/mw/2026-09/images/p004_lead.jpg" type="image/jpeg" width="1200" height="800" medium="image" />'
    );
    expect(xml).toContain(
      '<media:content url="https://mshanken-digital-editions.s3.amazonaws.com/mw/2026-09/images/p005_bottle.jpg" type="image/jpeg" width="600" height="900" medium="image" />'
    );
    // Excluded image must not appear in media:content
    expect(xml).not.toContain("p005_ad.jpg");

    // 8. Match against Vitest Snapshot
    expect(xml).toMatchSnapshot();
  });

  it("falls back dc:creator to section when no author byline exists", () => {
    const xml = generateRssFeed(
      {
        id: "x",
        brand: "mw",
        issue_id: "2026-09",
        issue_label: "September 2026",
        pdf_key: "pdfs/inbox/mw-2026-09.pdf",
        created_at: "2026-08-31T12:00:00.000Z",
        articles: [
          {
            id: "a1",
            sort_order: 0,
            title: "Staff Note",
            section: "Departments",
            author: null,
            pdf_pages: [2],
            html: "<p>Unsigned staff piece.</p>",
            include: true,
            created_at: "2026-08-31T12:00:00.000Z",
            images: [],
          },
        ],
      },
      "https://editions.marketwatchmag.com"
    );
    expect(xml).toContain("<dc:creator>Departments</dc:creator>");
    expect(xml).not.toContain("<category>");
  });
});
