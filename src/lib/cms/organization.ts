import type { CmsDocumentKind, CmsJson, CmsJsonObject } from "./types";

export const CONTENT_TYPE_LABELS: Record<CmsDocumentKind, { singular: string; plural: string }> = {
  article: { singular: "Article", plural: "Articles" },
  rating: { singular: "Rating", plural: "Ratings" },
  page: { singular: "Page", plural: "Pages" },
  glossary_entry: { singular: "Glossary entry", plural: "Glossary" },
  directory_entry: { singular: "Directory entry", plural: "Directories" },
  collection_entry: { singular: "Collection entry", plural: "Collections" },
  product_review: { singular: "Product review", plural: "Product reviews" },
  legacy_record: { singular: "Unclassified record", plural: "Unclassified records" },
};

export const PLACEMENT_LABELS = {
  homepage_slider: "Homepage slider",
  homepage_news_slider: "Homepage news slider",
  homepage_trending: "Homepage trending",
} as const;

export type CmsPlacement = CmsJsonObject & {
  slot: keyof typeof PLACEMENT_LABELS;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  status: "needs_review" | "scheduled" | "disabled";
  source_category_id?: string;
};

export type CmsOrganization = CmsJsonObject & {
  primary_channel: string | null;
  topics: string[];
  source_categories: string[];
  placements: CmsPlacement[];
};

function object(value: unknown): value is CmsJsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const normalized = value.includes(".") ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, "0")}Z`) : value.replace(/Z$/, ".000Z");
  return new Date(value).toISOString() === normalized;
}

/** A content home and temporary promotion are independent editorial decisions. */
export function validateOrganization(value: unknown): asserts value is CmsOrganization {
  if (!object(value)) throw new Error("Organization must be an object.");
  if (value.primary_channel !== null && (typeof value.primary_channel !== "string" || !value.primary_channel.trim() || value.primary_channel.length > 120)) {
    throw new Error("Primary channel must be a name or null.");
  }
  for (const key of ["topics", "source_categories"] as const) {
    if (!Array.isArray(value[key]) || value[key].length > 300 || !value[key].every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 250)) {
      throw new Error(`${key === "topics" ? "Topics" : "Source categories"} must be a list of names.`);
    }
  }
  if (!Array.isArray(value.placements) || value.placements.length > 20) throw new Error("Placements must be a list of up to 20 assignments.");
  const seen = new Set<string>();
  for (const placement of value.placements) {
    if (!object(placement) || typeof placement.slot !== "string" || !Object.hasOwn(PLACEMENT_LABELS, placement.slot)) throw new Error("Unknown promotion placement.");
    if (seen.has(placement.slot)) throw new Error("A placement may have only one assignment per document.");
    seen.add(placement.slot);
    if (typeof placement.label !== "string" || !placement.label.trim() || placement.label.length > 250) throw new Error("A placement needs a label.");
    if (!["needs_review", "scheduled", "disabled"].includes(String(placement.status))) throw new Error("Unknown placement status.");
    for (const key of ["starts_at", "ends_at"] as const) {
      if (placement[key] !== null && !validTimestamp(placement[key])) throw new Error("Placement dates must be valid UTC timestamps or empty.");
    }
    if (placement.source_category_id !== undefined && (typeof placement.source_category_id !== "string" || !/^\d+$/.test(placement.source_category_id))) throw new Error("Invalid source category identity.");
    if (placement.status === "scheduled" && (!placement.starts_at || !placement.ends_at)) throw new Error("A scheduled placement needs both a start and an end.");
    if (typeof placement.starts_at === "string" && typeof placement.ends_at === "string" && Date.parse(placement.starts_at) >= Date.parse(placement.ends_at)) throw new Error("A placement must end after it starts.");
  }
}

/** Read-only compatibility for earlier imports; it never rewrites their source. */
export function documentOrganization(metadata: CmsJsonObject): CmsOrganization {
  if (object(metadata.organization)) {
    try { validateOrganization(metadata.organization); return metadata.organization; }
    catch { /* Older/unrecognized organization data stays in immutable history. */ }
  }
  const sourceCategories = strings(metadata.categories);
  const placements: CmsPlacement[] = [];
  for (const category of sourceCategories) {
    const name = category.trim().toLowerCase();
    const slot = name === "homepage slider" ? "homepage_slider"
      : name === "homepage news slider" || name === "homepage news" ? "homepage_news_slider" : null;
    if (slot && !placements.some(item => item.slot === slot)) placements.push({ slot, label: category, status: "needs_review", starts_at: null, ends_at: null });
  }
  return { primary_channel: null, topics: [], source_categories: sourceCategories, placements };
}

/** Expiry affects only promotion; the caller retains the same document and URL. */
export function placementIsActive(placement: CmsPlacement, at: Date): boolean {
  if (placement.status !== "scheduled" || !placement.starts_at || !placement.ends_at) return false;
  const now = at.getTime();
  return Number.isFinite(now) && Date.parse(placement.starts_at) <= now && now < Date.parse(placement.ends_at);
}

const REVIEW_LABELS: Record<string, string> = {
  missing_title: "The original record has no headline.",
  missing_body: "The body is empty and needs editorial review.",
  empty_body: "The body is empty and needs editorial review.",
  page_body_assembly_required: "Page layout and content blocks need to be assembled for the new site.",
  invalid_rating_score: "A usable rating score was not supplied by the source.",
  ambiguous_content_type: "The content type needs editorial classification.",
  duplicate_public_url: "Another preserved record shares this public URL. Route ownership needs review.",
  public_url_collision: "Another preserved record shares this public URL. Route ownership needs review.",
};

export function reviewReasons(metadata: CmsJsonObject): string[] {
  const review = object(metadata.review) ? metadata.review : {};
  return strings(review.reasons).map(reason => REVIEW_LABELS[reason] || reason.replace(/_/g, " "));
}

export function reviewRequired(metadata: CmsJsonObject): boolean {
  return object(metadata.review) && metadata.review.required === true;
}

export function preserveReviewGate(previous: CmsJsonObject, next: CmsJsonObject): CmsJsonObject {
  return Object.hasOwn(previous, "review") ? { ...next, review: previous.review as CmsJson } : next;
}
