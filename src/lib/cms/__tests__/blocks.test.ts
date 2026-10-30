import { describe, expect, it } from "vitest";
import { blockSummary, documentText, documentToHtml, htmlToDocument, normalizeLegacyHtml } from "../blocks";

describe("block normalization", () => {
  it("turns legacy markup into clean blocks and drops presentation", () => {
    const legacy = `<div class="article-body" id="x"><font face="Verdana" color="#ff0000"><p style="margin:0;color:#333;font-family: Georgia; text-align:center" align="center" class="MsoNormal">Hello <b>bold</b> <span style="background:url(evil)">and</span> <a href="https://example.com/x" onclick="steal()">link</a></p></font>
      <H1>Heading one</H1><center><p>Centered</p></center><ul><li>One</li><li><p>Two</p><p>more</p></li></ul>
      <table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>
      <figure data-embed="video"><a href="https://www.youtube.com/watch?v=abc">Watch</a><figcaption>Cap</figcaption></figure>
      <img src="https://cdn.example.com/pic.jpg" alt="A pic"><script>alert(1)</script><p data-premium="true">Members only</p></div>`;
    const doc = htmlToDocument(legacy);
    const summary = blockSummary(doc);
    expect(summary.paragraph).toBeGreaterThanOrEqual(4);
    expect(summary.heading).toBe(1);
    expect(summary.bulletList).toBe(1);
    expect(summary.table).toBe(1);
    expect(summary.videoEmbed).toBe(1);
    expect(summary.image).toBe(1);
    const html = documentToHtml(doc);
    expect(html).not.toMatch(/class=|id=|onclick|font-family: Georgia|url\(|<script|<font|<center/);
    expect(html).toContain('<p style="text-align: center">Hello <strong>bold</strong> and <a href="https://example.com/x" rel="noopener noreferrer">link</a></p>');
    expect(html).toContain("<h2>Heading one</h2>");
    expect(html).toContain("<ul><li><p>One</p></li><li><p>Two</p><p>more</p></li></ul>");
    expect(html).toContain('<th colspan="2">');
    expect(html).toContain('<figure data-embed="video"><a href="https://www.youtube.com/watch?v=abc"');
    expect(html).toContain('<p data-premium="true">Members only</p>');
    expect(doc.content.find(node => node.type === "paragraph" && node.attrs?.premium)).toBeTruthy();
  });

  it("keeps whitelisted text styles as marks and round-trips", () => {
    const html = '<p><span style="color: #0e7c6f; font-size: 18px">Teal</span> <mark data-color="#fff3a3" style="background-color: #fff3a3">hi</mark> <sup>2</sup><br>next</p>';
    const once = normalizeLegacyHtml(html).html;
    expect(once).toContain('<span style="color: #0e7c6f; font-size: 18px">Teal</span>');
    expect(once).toContain("<mark");
    expect(once).toContain("<sup>2</sup><br>next");
    expect(normalizeLegacyHtml(once).html).toBe(once);
  });

  it("never returns an empty document and yields plain text", () => {
    const doc = htmlToDocument("   ");
    expect(doc.content).toEqual([{ type: "paragraph" }]);
    expect(documentText(htmlToDocument("<p>One</p><h2>Two</h2>"))).toBe("One\nTwo");
  });
});
