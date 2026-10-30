import { describe, expect, it } from "vitest";
import { deliverBody, firstParagraph, readerTier, requiredTier, stripPremiumBlocks, stripPremiumHtml, tierAllows } from "../paywall";

describe("paywall", () => {
  const html = '<p>Free lede.</p><p data-premium="true">Secret <strong>analysis</strong>.</p><ul data-premium="true"><li><p>Hidden list</p></li></ul><p>Free close.</p>';

  it("strips premium blocks and leaves one marker", () => {
    const result = stripPremiumHtml(html);
    expect(result.removed).toBe(2);
    expect(result.html).toBe('<p>Free lede.</p><aside data-paywall="true"></aside><p>Free close.</p>');
    expect(result.html).not.toContain("Secret");
  });

  it("strips premium nodes from the block document", () => {
    const doc = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "Free" }] }, { type: "paragraph", attrs: { premium: true }, content: [{ type: "text", text: "Hidden" }] }, { type: "blockquote", content: [{ type: "paragraph", attrs: { premium: true } }] }] };
    const result = stripPremiumBlocks(doc);
    expect(result.removed).toBe(2);
    expect(JSON.stringify(result.document)).not.toContain("Hidden");
    expect(result.document.content[1]).toEqual({ type: "paywall" });
  });

  it("reads entitlement from app metadata and compares tiers", () => {
    expect(readerTier(null)).toBe("free");
    expect(readerTier({ subscription: { tier: "subscriber", status: "active" } })).toBe("subscriber");
    expect(readerTier({ subscription: { tier: "subscriber", status: "canceled" } })).toBe("registered");
    expect(readerTier({ subscription: { tier: "subscriber", expires_at: "2000-01-01T00:00:00Z" } })).toBe("registered");
    expect(readerTier({ subscription_tier: "registered" })).toBe("registered");
    expect(tierAllows("subscriber", "registered")).toBe(true);
    expect(tierAllows("free", "registered")).toBe(false);
    expect(requiredTier({ access: { tier: "subscriber" } })).toBe("subscriber");
    expect(requiredTier({ access: { tier: "gold" } })).toBe("free");
  });

  it("delivers the full body to entitled readers and a teaser otherwise", () => {
    const full = deliverBody({ html, body_json: null, metadata: { access: { tier: "subscriber" } } }, "subscriber");
    expect(full.access.full).toBe(true);
    expect(full.html).toBe(html);
    const teaser = deliverBody({ html, body_json: null, metadata: { access: { tier: "subscriber" } } }, "free");
    expect(teaser.access.full).toBe(false);
    expect(teaser.html).not.toContain("Secret");
    const gatedWhole = deliverBody({ html: "<p>Lede.</p><p>Body.</p>", body_json: null, metadata: { access: { tier: "registered" } } }, "free");
    expect(gatedWhole.html).toBe('<p>Lede.</p><aside data-paywall="true"></aside>');
    const open = deliverBody({ html: "<p>Lede.</p>", body_json: null, metadata: {} }, "free");
    expect(open.access.full).toBe(true);
  });

  it("strips premium blocks from a free story for anyone below subscriber", () => {
    const anonymous = deliverBody({ html, body_json: null, metadata: {} }, "free");
    expect(anonymous.html).not.toContain("Secret");
    expect(anonymous.access).toMatchObject({ required: "free", full: false, removed_blocks: 2 });
    const registered = deliverBody({ html, body_json: null, metadata: {} }, "registered");
    expect(registered.html).not.toContain("Secret");
    const subscriber = deliverBody({ html, body_json: null, metadata: {} }, "subscriber");
    expect(subscriber.html).toBe(html);
    expect(subscriber.access.full).toBe(true);
  });

  it("teases with the first paragraph even when the story opens with a container", () => {
    const doc = { type: "doc" as const, content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }, { type: "paragraph", content: [{ type: "text", text: "Second" }] }] }] }, { type: "paragraph", content: [{ type: "text", text: "Third" }] }] };
    expect(firstParagraph(doc)?.content?.[0].text).toBe("First");
    const teaser = deliverBody({ html: "<ul><li><p>First</p><p>Second</p></li></ul><p>Third</p>", body_json: doc, metadata: { access: { tier: "subscriber" } } }, "free");
    expect(JSON.stringify(teaser.body_json)).not.toContain("Second");
    expect(teaser.body_json?.content).toHaveLength(2);
    expect(teaser.html).toBe('<p>First</p><aside data-paywall="true"></aside>');
  });
});
