/**
 * Whether a story is paid content. An editor's explicit choice in the CMS
 * (metadata.sponsored = { on, by }) wins; otherwise the legacy markers the old
 * site used decide: the byline "Sponsored Content" or a "Sponsored Content" /
 * "Sponsored" tag. scripts/wa-export-stories.py applies the same rule.
 */
export type Sponsorship = { on: boolean; by: string; explicit: boolean };

const LEGACY_TAGS = new Set(["sponsored content", "sponsored"]);

export function sponsorship(metadata: Record<string, unknown> | null | undefined, byline: string | null | undefined): Sponsorship {
  const meta = metadata || {};
  const flag = meta.sponsored;
  if (flag && typeof flag === "object" && !Array.isArray(flag)) {
    const f = flag as Record<string, unknown>;
    if (typeof f.on === "boolean") return { on: f.on, by: typeof f.by === "string" ? f.by.trim() : "", explicit: true };
  }
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const legacy = /sponsor/i.test(byline || "") || tags.some(t => typeof t === "string" && LEGACY_TAGS.has(t.trim().toLowerCase()));
  return { on: legacy, by: "", explicit: false };
}
