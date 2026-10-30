import { describe, expect, it } from "vitest";
import { deliverBody, readerTier, requiredTier, stripPremiumBlocks, stripPremiumHtml, tierAllows } from "../paywall";

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
});
