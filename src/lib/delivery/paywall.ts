/**
 * Entitlements and premium stripping for the delivery tier. Pure functions so
 * the public content API, the Supabase edge function and tests share one rule:
 * premium blocks never leave the server for a reader without entitlement.
 */
import { parseDocument } from "htmlparser2";
import type { ChildNode, Element } from "domhandler";
import type { BlockDocument, BlockNode } from "@/lib/cms/blocks";
import type { CmsJsonObject } from "@/lib/cms/types";

export const ACCESS_TIERS = ["free", "registered", "subscriber"] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];
const RANK: Record<AccessTier, number> = { free: 0, registered: 1, subscriber: 2 };

export function isAccessTier(value: unknown): value is AccessTier {
  return typeof value === "string" && (ACCESS_TIERS as readonly string[]).includes(value);
}

/** The tier a document requires in full: metadata.access.tier, else free. */
export function requiredTier(metadata: CmsJsonObject | null | undefined): AccessTier {
  const access = metadata?.access;
  const tier = access && typeof access === "object" && !Array.isArray(access) ? (access as CmsJsonObject).tier : null;
  return isAccessTier(tier) ? tier : "free";
}

/** A reader's tier from Supabase Auth app_metadata.subscription (tier, status, expires_at). */
export function readerTier(appMetadata: Record<string, unknown> | null | undefined, now: Date = new Date()): AccessTier {
  if (!appMetadata) return "free";
  const subscription = appMetadata.subscription;
  const record = subscription && typeof subscription === "object" && !Array.isArray(subscription) ? subscription as Record<string, unknown> : null;
  const tier = record?.tier ?? appMetadata.subscription_tier;
  if (!isAccessTier(tier)) return "free";
  if (record?.status && !["active", "trialing", "grace", "comped"].includes(String(record.status))) return "registered";
  if (typeof record?.expires_at === "string" && !Number.isNaN(Date.parse(record.expires_at)) && Date.parse(record.expires_at) < now.getTime()) return "registered";
  return tier;
}

export function tierAllows(reader: AccessTier, required: AccessTier): boolean {
  return RANK[reader] >= RANK[required];
}

export type PaywallResult = { html: string; truncated: boolean; removed: number };

function isElement(node: ChildNode): node is Element { return node.type === "tag"; }

/** Remove every element marked data-premium="true" from HTML, replacing the first with a paywall marker. */
export function stripPremiumHtml(html: string, marker = '<aside data-paywall="true"></aside>'): PaywallResult {
  if (!/data-premium/.test(html)) return { html, truncated: false, removed: 0 };
  const dom = parseDocument(html, { decodeEntities: false });
  let removed = 0;
  const walk = (nodes: ChildNode[]): string => nodes.map(node => {
    if (node.type === "text") return node.data;
    if (node.type === "comment") return "";
    if (!isElement(node)) return "";
    if (node.attribs["data-premium"] === "true") { removed += 1; return removed === 1 ? marker : ""; }
    const attrs = Object.entries(node.attribs).map(([key, value]) => ` ${key}="${value.replace(/"/g, "&quot;")}"`).join("");
    if (["br", "hr", "img"].includes(node.name)) return `<${node.name}${attrs}>`;
    return `<${node.name}${attrs}>${walk(node.children)}</${node.name}>`;
  }).join("");
  const out = walk(dom.children);
  return { html: out, truncated: removed > 0, removed };
}

/** Remove premium blocks from a block document (top level and nested containers). */
export function stripPremiumBlocks(doc: BlockDocument): { document: BlockDocument; removed: number } {
  let removed = 0;
  const walk = (nodes: BlockNode[] | undefined): BlockNode[] | undefined => nodes?.flatMap(node => {
    if (node.attrs?.premium === true) { removed += 1; return removed === 1 ? [{ type: "paywall" }] : []; }
    return [node.content ? { ...node, content: walk(node.content) } : node];
  });
  return { document: { type: "doc", content: walk(doc.content) ?? [] }, removed };
}

/** The first paragraph in reading order, descending into lists and quotes, so a teaser never leaks a whole container. */
export function firstParagraph(doc: BlockDocument): BlockNode | null {
  const walk = (nodes: BlockNode[] | undefined): BlockNode | null => {
    for (const node of nodes ?? []) {
      if (node.type === "paragraph") return node;
      const nested = walk(node.content);
      if (nested) return nested;
    }
    return null;
  };
  return walk(doc.content);
}

/**
 * Apply the paywall to a document body for a reader. Two rules combine: the
 * story's own tier (metadata.access.tier) gates the whole body, and any block
 * marked premium needs a subscriber whatever the story's tier is.
 */
export function deliverBody(input: { html: string; body_json: BlockDocument | null; metadata: CmsJsonObject | null }, reader: AccessTier): { html: string; body_json: BlockDocument | null; access: { required: AccessTier; reader: AccessTier; full: boolean; removed_blocks: number } } {
  const required = requiredTier(input.metadata);
  const storyAllowed = tierAllows(reader, required);
  const premiumAllowed = tierAllows(reader, "subscriber");
  if (storyAllowed && premiumAllowed) return { html: input.html, body_json: input.body_json, access: { required, reader, full: true, removed_blocks: 0 } };
  const html = stripPremiumHtml(input.html);
  const blocks = input.body_json ? stripPremiumBlocks(input.body_json) : null;
  if (!storyAllowed && !html.removed) {
    // Gated as a whole with no per-block marks: only the first paragraph survives as the teaser.
    const teaser = input.html.match(/<p[^>]*>[\s\S]*?<\/p>/)?.[0] ?? "";
    const paragraph = input.body_json ? firstParagraph(input.body_json) : null;
    const removed = Math.max(1, (input.body_json?.content.length ?? 2) - 1);
    return { html: `${teaser}<aside data-paywall="true"></aside>`, body_json: input.body_json ? { type: "doc", content: [...(paragraph ? [paragraph] : []), { type: "paywall" }] } : null, access: { required, reader, full: false, removed_blocks: removed } };
  }
  if (!html.removed) return { html: input.html, body_json: input.body_json, access: { required, reader, full: true, removed_blocks: 0 } };
  return { html: html.html, body_json: blocks?.document ?? null, access: { required, reader, full: false, removed_blocks: html.removed } };
}
