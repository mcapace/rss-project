import { createHash } from "node:crypto";
import type { CmsBrand, CmsDocumentKind, CmsIngestInput, CmsJsonObject, CmsPublicationState } from "./types";
import { CMS_DOCUMENT_KINDS } from "./types";

type RawRecord = Record<string, unknown>;

export interface MorwebEnvelope {
  source_collection: "Posts" | "Pages";
  record: RawRecord;
  source_cache_key?: string;
  /** Explicitly assembled, qualified Page body; Blocks are never concatenated automatically. */
  body_html?: string;
  archive_version_hashes?: string[];
  selected_record_sha256?: string;
  page_context_count?: number;
}

export interface MorwebImportOptions {
  brand?: CmsBrand;
  sourceOrigin?: string;
  /** Preserve every structurally valid identity by default. Strict mode holds records needing review. */
  policy?: "preserve" | "strict";
  /** Explicit, reviewed mappings keyed by Posts:123 or Pages:456. */
  kindOverrides?: Record<string, CmsDocumentKind>;
  publicationOverrides?: Record<string, { state: CmsPublicationState; evidence: string }>;
  categoryNames?: Record<string, string>;
  tagNames?: Record<string, string>;
  /** Optional reconciliation against served copies. Absence means unverified, not missing. */
  assetStatus?: Record<string, "captured" | "missing">;
}

export interface MorwebFinding {
  source_key: string;
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface MorwebPreparedRecord {
  source_key: string;
  source_collection: "Posts" | "Pages";
  kind: CmsDocumentKind | null;
  document: CmsIngestInput | null;
  public_url: string | null;
  findings: MorwebFinding[];
  review_reasons: string[];
  media: { url: string; status: "captured" | "missing" | "unverified" }[];
}

export interface MorwebImportPlan {
  documents: CmsIngestInput[];
  report: {
    format: "morweb-import-plan";
    policy: "preserve" | "strict";
    source_records: number;
    unique_identities: number;
    duplicate_identical_records: number;
    eligible_records: number;
    held_records: number;
    fatal_records: number;
    review_required_records: number;
    review_required_by_kind: Record<CmsDocumentKind, number>;
    eligible_by_kind: Record<CmsDocumentKind, number>;
    classified_by_kind: Record<CmsDocumentKind, number>;
    eligible_by_publication_state: Record<CmsPublicationState, number>;
    finding_counts: Record<string, number>;
    findings: MorwebFinding[];
    held: { source_key: string; reasons: string[] }[];
    url_collisions: { public_url: string; source_keys: string[] }[];
    media: { unique_references: number; captured: number; missing: number; unverified: number };
    historical_revision_conversion: "Latest declared source version only; earlier source versions remain in the preservation archive.";
    target_write_performed: false;
  };
}

const ARTICLE_CATEGORY_IDS = new Set(["18", "28", "34", "37", "51", "52", "54", "60", "65", "70", "71", "72", "79"]);
const TEST_CATEGORY_IDS = new Set(["66", "67", "77", "78", "81", "84", "86", "87"]);
const TYPED_CATEGORY_IDS: Record<string, CmsDocumentKind> = { "32": "collection_entry", "33": "directory_entry", "50": "rating", "62": "glossary_entry", "74": "product_review" };
const ARTICLE_CATEGORY_NAMES = new Set(["news", "whisky life", "whisky 101", "magazine", "whisky gear", "insights", "rating & reviews", "migrated", "migration", "whiskyfest", "homepage slider", "homepage news slider", "90plus"]);
const PLACEMENT_CATEGORIES = {
  "28": { slot: "homepage_slider", label: "Homepage Slider" },
  "65": { slot: "homepage_news_slider", label: "Homepage News Slider" },
} as const;
const DATE_KEYS = ["date", "created", "modified", "published_date", "publish_dateStamp", "unpublished_date", "secondary_date"];
const PUBLICATION_KEYS = ["published", "published_flag", "published_switch", "published_class", "status", "status_id", "publish", "draft", "archive", "unpublished_flag", "secondary_flag"];
const SEO_KEYS = ["canonical_url", "meta_title", "meta_description", "meta_keywords", "og_title", "og_description", "og_image", "no_index", "no_follow", "noindex", "nosearch"];

function object(value: unknown): RawRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : null;
}

function string(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(string).filter(Boolean) : [];
}

function taxonomyIds(value: unknown): string[] {
  return [...new Set(strings(value).map(id => id.replace(/^id(?=\d+$)/, "")))];
}

function pick(record: RawRecord, keys: string[]): CmsJsonObject {
  return jsonObject(Object.fromEntries(keys.filter(key => key in record).map(key => [key, record[key]])));
}

function jsonObject(value: RawRecord): CmsJsonObject {
  return JSON.parse(JSON.stringify(value)) as CmsJsonObject;
}

/** Stable source hashes do not depend on JSON property order, filenames, or run time. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().filter(key => (value as RawRecord)[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJson((value as RawRecord)[key])}`).join(",")}}`;
}

export function hashMorwebInput(input: Omit<CmsIngestInput, "source_hash">): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

/** Parse supported export containers explicitly; never evaluate captured JavaScript or HTML. */
export function readMorwebInput(input: unknown): MorwebEnvelope[] {
  const root = object(input);
  if (root?.format === "whisky_advocate_migration_archive" && Array.isArray(root.records)) {
    const contexts = Array.isArray(root.page_block_context_captures) ? root.page_block_context_captures : [];
    const contextCounts = new Map<string, number>();
    for (const candidate of contexts) {
      const context = object(candidate);
      const identity = object(context?.linked_source_identity);
      if (!context || identity?.source_collection !== "Pages" || context.qualified_http200_editor_dataset === false || context.response_http_status === 404) continue;
      const id = string(identity.source_record_id);
      if (id) contextCounts.set(id, (contextCounts.get(id) ?? 0) + 1);
    }
    return root.records.map((candidate, index) => {
      const entry = object(candidate);
      const collection = entry?.source_collection;
      if (!entry || (collection !== "Posts" && collection !== "Pages") || !Array.isArray(entry.versions)) {
        throw new Error(`Unsupported archive record at index ${index}; expected Posts or Pages version envelope.`);
      }
      const versions = entry.versions.map(object).filter((version): version is RawRecord => version !== null);
      const matches = versions.filter(version => version.record_sha256 === entry.latest_record_sha256);
      if (matches.length !== 1 || !object(matches[0].raw_record)) {
        throw new Error(`Archive record ${collection}:${string(entry.source_record_id)} has no unique declared latest version.`);
      }
      return {
        source_collection: collection,
        record: matches[0].raw_record as RawRecord,
        source_cache_key: string(entry.source_record_id),
        selected_record_sha256: string(entry.latest_record_sha256),
        archive_version_hashes: versions.map(version => string(version.record_sha256)),
        page_context_count: collection === "Pages" ? contextCounts.get(string(entry.source_record_id)) ?? 0 : undefined,
      };
    });
  }

  if (root?.source_collection !== undefined && !["mwData.Pages", "Pages", "mwData.Posts", "Posts"].includes(String(root.source_collection))) throw new Error("Unsupported source_collection; only Posts and Pages are accepted.");
  const sourceCollection = root?.source_collection === "mwData.Pages" || root?.source_collection === "Pages" ? "Pages" : "Posts";
  const list = Array.isArray(input) ? input : Array.isArray(root?.records) ? root.records : null;
  if (list) return list.map((candidate, index) => {
    const envelope = object(candidate);
    const record = object(envelope?.record);
    if (!record || !envelope) throw new Error(`Record ${index} needs an explicit {record, source_collection?} envelope.`);
    const collection = envelope.source_collection ?? sourceCollection;
    if (collection !== "Posts" && collection !== "Pages") throw new Error(`Record ${index} has an unsupported source_collection.`);
    return {
      source_collection: collection,
      record,
      source_cache_key: string(envelope.source_cache_key) || undefined,
      body_html: typeof envelope.body_html === "string" ? envelope.body_html : undefined,
    };
  });

  const envelopes: MorwebEnvelope[] = [];
  for (const collection of ["Posts", "Pages"] as const) {
    const records = object(root?.[collection]);
    if (!records) continue;
    for (const [key, candidate] of Object.entries(records)) {
      const record = object(candidate);
      if (!record) throw new Error(`Invalid ${collection} record ${key}.`);
      envelopes.push({ source_collection: collection, source_cache_key: key, record });
    }
  }
  if (envelopes.length) return envelopes;
  throw new Error("Unsupported input. Supply a preservation archive JSON, browser cache export, Posts/Pages map, or explicit record envelopes.");
}

function resolveUrl(value: unknown, origin: string): string | null {
  const raw = string(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, `${origin.replace(/\/$/, "")}/`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

function classify(record: RawRecord, sourceCollection: "Posts" | "Pages", override?: CmsDocumentKind): { kind: CmsDocumentKind; review: boolean } {
  if (override) return { kind: override, review: override === "legacy_record" };
  if (sourceCollection === "Pages") return { kind: "page", review: false };
  const ids = taxonomyIds(record.category_selected);
  if (ids.some(id => TEST_CATEGORY_IDS.has(id))) return { kind: "legacy_record", review: true };
  const customType = string(object(record.custom_fields)?.custom_post_type ?? record.custom_post_type).trim().toLowerCase();
  const unknownCustomType = Boolean(customType && !["post", "blog", "article"].includes(customType));
  const typed = [...new Set(ids.map(id => TYPED_CATEGORY_IDS[id]).filter(Boolean))];
  // A rating can also be in a Top 20 collection. Preserve its known type, but require
  // review when a source mixes more than one structured content type.
  if (ids.includes("50")) return { kind: "rating", review: typed.length > 1 || unknownCustomType };
  if (typed.length === 1 && !unknownCustomType) return { kind: typed[0], review: false };
  if (typed.length > 1 || unknownCustomType) return { kind: "legacy_record", review: true };
  if (ids.some(id => ARTICLE_CATEGORY_IDS.has(id))) return { kind: "article", review: false };
  const labels = string(record.category).toLowerCase().split(",").map(part => part.trim());
  return labels.some(label => ARTICLE_CATEGORY_NAMES.has(label)) ? { kind: "article", review: false } : { kind: "legacy_record", review: true };
}

function sourceState(envelope: MorwebEnvelope, override?: NonNullable<MorwebImportOptions["publicationOverrides"]>[string]): { state: CmsPublicationState; resolved: boolean } {
  if (override?.evidence?.trim()) return { state: override.state, resolved: true };
  const record = envelope.record;
  if (envelope.source_collection === "Pages") {
    // In captured Page metadata, published is a date; publish is the visibility control.
    if (record.publish === "1" || record.publish === 1 || record.publish === true) return { state: "published", resolved: true };
    if (record.publish === "0" || record.publish === 0 || record.publish === false) return { state: "unpublished", resolved: true };
    return { state: "review", resolved: false };
  }
  // Match the complete observed control combination, not published="2" in isolation.
  if (string(record.published) === "2" && string(record.published_flag) === "2" && record.published_class === "checked" && string(record.published_switch) === "0") return { state: "published", resolved: true };
  if (string(record.published) === "0" && string(record.published_flag) === "0" && record.published_class === "" && string(record.published_switch) === "1") return { state: "unpublished", resolved: true };
  return { state: "review", resolved: false };
}

function byline(record: RawRecord, kind: CmsDocumentKind): string {
  const custom = object(record.custom_fields) ?? {};
  if (kind === "rating") return string(custom.custom_rating_reviewer ?? record.custom_rating_reviewer).trim();
  const names: string[] = [];
  for (let index = 1; index <= 5; index++) {
    const key = index === 1 ? "custom_author" : `custom_author_${index}`;
    const selected = string(custom[key] ?? record[key]).trim();
    const name = ["custom", "custom author"].includes(selected.toLowerCase())
      ? string(custom[`custom_author_title_${index}`] ?? record[`custom_author_title_${index}`]).trim()
      : selected;
    if (name && !/^\d+$/.test(name) && !["custom", "custom author", "select author"].includes(name.toLowerCase())) names.push(name);
  }
  // record.author / user_id describe the CMS account, not necessarily the printed writer.
  return names.join(", ");
}

function mediaReferences(record: RawRecord, html: string, origin: string, statuses?: MorwebImportOptions["assetStatus"]): MorwebPreparedRecord["media"] {
  const urls = new Set<string>();
  const add = (value: unknown) => { const url = resolveUrl(value, origin); if (url) urls.add(url); };
  for (const key of ["thumb_file", "banner_file", "og_image"]) if (!/^\d+$/.test(string(record[key]))) add(record[key]);
  for (const match of html.matchAll(/\b(?:src|poster)\s*=\s*(["'])(.*?)\1/gi)) if (!match[2].startsWith("data:")) add(match[2]);
  for (const match of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) if (/\.(?:pdf|jpe?g|png|webp|gif|svg|avif|mp4|mp3)(?:[?#]|$)/i.test(match[2])) add(match[2]);
  return [...urls].sort().map(url => ({ url, status: statuses?.[url] ?? "unverified" }));
}

function taxonomyNames(ids: string[], display: unknown, names?: Record<string, string>): { names: string[]; unresolved: boolean } {
  if (names) return { names: ids.map(id => names[id]).filter((name): name is string => Boolean(name)), unresolved: ids.some(id => !names[id]) };
  const raw = string(display);
  if (/&hellip;|…/.test(raw)) return { names: [], unresolved: ids.length > 0 };
  // Without definitions the display string is presentation evidence, not an ID/name crosswalk.
  return { names: raw.split(",").map(part => part.trim()).filter(Boolean), unresolved: ids.length > 0 };
}

function archiveTaxonomy(input: unknown): Pick<MorwebImportOptions, "categoryNames" | "tagNames"> {
  const root = object(input);
  const contexts = Array.isArray(root?.source_contexts) ? root.source_contexts : [];
  const categories: Record<string, string> = {};
  const tags: Record<string, string> = {};
  for (const context of contexts) {
    const data = object(object(object(context)?.raw_context)?.Data);
    for (const [key, target] of [["Categories", categories], ["Tags", tags]] as const) {
      const definitions = object(data?.[key]);
      for (const candidate of Object.values(definitions ?? {})) {
        const definition = object(candidate);
        const id = string(definition?.id).replace(/^id(?=\d+$)/, "");
        const title = string(definition?.title);
        if (id && title) target[id] = title;
      }
    }
  }
  return { ...(Object.keys(categories).length ? { categoryNames: categories } : {}), ...(Object.keys(tags).length ? { tagNames: tags } : {}) };
}

export function prepareMorwebRecord(envelope: MorwebEnvelope, options: MorwebImportOptions = {}): MorwebPreparedRecord {
  const record = envelope.record;
  const origin = options.sourceOrigin ?? "https://whiskyadvocate.com";
  const id = string(record.id).trim();
  const sourceKey = `${envelope.source_collection}:${id || "missing-id"}`;
  const findings: MorwebFinding[] = [];
  const reviewReasons = new Set<string>();
  const add = (code: string, severity: "warning" | "error", message: string) => findings.push({ source_key: sourceKey, code, severity, message });
  const review = (code: string, message: string) => { reviewReasons.add(code); add(code, "warning", message); };
  if (!id || !/^\d+$/.test(id)) add("invalid_source_id", "error", "A numeric source ID is required; titles and row positions cannot identify records.");
  if (envelope.source_cache_key && envelope.source_cache_key !== id) add("cache_identity_mismatch", "error", "Cache key and source record ID disagree.");
  if ((string(record.private) && string(record.private) !== "0") || (string(record.req_auth) && string(record.req_auth) !== "0")) review("access_policy_mapping_required", "Restricted source content is retained for review; an equivalent access policy is required before publication.");
  const classification = classify(record, envelope.source_collection, options.kindOverrides?.[sourceKey]);
  const kind = classification.kind;
  if (classification.review) review("ambiguous_content_type", "The source has an ambiguous, test, or unrecognized type. Its identity and original fields are retained for a later model decision.");
  const title = string(record.title || record.name).trim();
  if (!title) review("missing_title", "The source record has no title; an empty title is retained without inventing a headline.");
  const body = envelope.source_collection === "Pages" ? envelope.body_html : typeof record.content === "string" ? record.content : undefined;
  if (body === undefined) review(envelope.source_collection === "Pages" ? "page_body_assembly_required" : "missing_body", envelope.source_collection === "Pages" ? "Page metadata is retained with an empty normalized body. Captured Blocks still require template-aware assembly." : "The source record lacks its content field; the identity is retained with an empty normalized body.");
  else if (!body.trim()) review("empty_body", "The source content field is empty; this record is retained for review as a placeholder or incomplete capture.");
  const route = envelope.source_collection === "Pages" ? record.path : record.alias_url || record.alias;
  const publicUrl = resolveUrl(route, origin);
  if (!publicUrl) review("unresolved_public_url", "No usable existing public URL was found; no slug has been invented.");
  const stateOverride = options.publicationOverrides?.[sourceKey];
  const state = sourceState(envelope, stateOverride);
  if (!state.resolved) review("unresolved_publication_state", "Publication controls are unknown or inconsistent; the retained record requires review.");
  if (stateOverride && !stateOverride.evidence.trim()) add("publication_override_without_evidence", "error", "An explicit state override requires its evidence.");
  if (Number(record.unpublished_flag) === 1 || Number(record.secondary_flag) === 1) add("legacy_schedule_review", "warning", "Legacy unpublish or secondary-date behavior needs an explicit scheduling decision.");
  const dates = pick(record, DATE_KEYS);
  if (Object.values(dates).some(value => typeof value === "string" && value && !/^0{4}-/.test(value))) add("source_timezone_unresolved", "warning", "Source date strings are retained unchanged; no UTC offset has been invented.");
  const author = byline(record, kind);
  if (kind !== "page" && !author) add("unresolved_editorial_byline", "warning", "No editorial byline was resolved; the CMS account name is retained only as source metadata.");
  const custom = object(record.custom_fields) ?? {};
  if (Object.keys(custom).some(key => key in record && stableJson(custom[key]) !== stableJson(record[key]))) review("conflicting_custom_fields", "Nested and flattened custom fields disagree. The nested values are proposed, and all originals are retained for review.");
  const categoryIds = taxonomyIds(record.category_selected);
  const categories = taxonomyNames(categoryIds, record.category, options.categoryNames);
  const tags = taxonomyNames(taxonomyIds(record.tag_selected), record.tag, options.tagNames);
  if (categories.unresolved || tags.unresolved) add("taxonomy_relationships_pending", "warning", "Some category/tag IDs lack a verified definition; display labels and original IDs are retained separately.");
  const rating: CmsJsonObject = {};
  if (kind === "rating") {
    const score = string(custom.custom_rating_score ?? record.custom_rating_score).trim();
    const numericScore = score === "" ? NaN : Number(score);
    const validScore = Number.isInteger(numericScore) && numericScore >= 0 && numericScore <= 100;
    if (!validScore) review("invalid_rating_score", "A Ratings record has a missing or invalid score; a null score and all original fields are retained for review.");
    rating.score = validScore ? numericScore : null;
    const price = string(custom.custom_rating_price ?? record.custom_rating_price).trim();
    rating.price_raw = price;
    rating.price = /^\d+(?:\.\d+)?$/.test(price) && Number.isFinite(Number(price)) ? Number(price) : null;
    if (price && rating.price === null) add("rating_price_requires_review", "warning", "The source price is a range or formatted value; the raw price is retained and no numeric price was invented.");
    for (const field of ["issue", "category", "brand", "reviewer"]) rating[field] = string(custom[`custom_rating_${field}`] ?? record[`custom_rating_${field}`]);
  }
  const media = mediaReferences(record, body ?? "", origin, options.assetStatus);
  if (media.some(asset => asset.status === "missing")) add("missing_media", "warning", "At least one referenced asset has no captured copy in the supplied reconciliation.");
  if (media.some(asset => asset.status === "unverified")) add("media_not_reconciled", "warning", "Referenced media has not been reconciled against storage in this import plan.");
  const unresolvedMediaIds = ["thumb", "banner", "slider_gallery", "slider_gallery_internal"].filter(key => string(record[key]) && string(record[key]) !== "0");
  if (unresolvedMediaIds.length) add("media_relationships_pending", "warning", "Source media/gallery IDs are retained; their target relationships need the asset crosswalk.");
  const sourcePayload: CmsJsonObject = {
    record: jsonObject(record),
    source_collection: envelope.source_collection,
    ...(envelope.body_html !== undefined ? { assembled_body_html: envelope.body_html } : {}),
    ...(envelope.selected_record_sha256 ? { selected_record_sha256: envelope.selected_record_sha256 } : {}),
    ...(envelope.archive_version_hashes ? { archive_version_hashes: envelope.archive_version_hashes } : {}),
    ...(stateOverride ? { publication_override: jsonObject(stateOverride) } : {}),
    ...(options.kindOverrides?.[sourceKey] ? { kind_override: options.kindOverrides[sourceKey] } : {}),
  };
  const metadata: CmsJsonObject = {
    legacy_source_collection: envelope.source_collection,
    legacy_source_id: id,
    legacy_dates: dates,
    source_timezone: null,
    legacy_publication: pick(record, PUBLICATION_KEYS),
    publication_state_resolved: state.resolved,
    legacy_cms_account: pick(record, ["author", "user_id"]),
    taxonomy: pick(record, ["category", "category_selected", "tag", "tag_selected"]),
    categories: categories.names,
    tags: tags.names,
    organization: {
      primary_channel: null,
      topics: [],
      source_categories: categories.names,
      placements: categoryIds.flatMap(categoryId => {
        const placement = PLACEMENT_CATEGORIES[categoryId as keyof typeof PLACEMENT_CATEGORIES];
        return placement ? [{ ...placement, starts_at: null, ends_at: null, status: "needs_review", source_category_id: categoryId }] : [];
      }),
    },
    review: { required: reviewReasons.size > 0, reasons: [...reviewReasons].sort() },
    migration: {
      source_public_url: publicUrl,
      source_route: string(route),
      source_publication_state: state.state,
      body_status: body === undefined ? (envelope.source_collection === "Pages" ? "metadata_only" : "missing") : body.trim() ? (envelope.source_collection === "Pages" ? "assembled" : "captured") : "empty",
    },
    seo: {
      title: string(record.meta_title), description: string(record.meta_description),
      canonical_url: resolveUrl(record.canonical_url, origin),
      no_index: ["1", "true"].includes(String(record.no_index ?? record.noindex ?? "0")),
    },
    legacy_seo: pick(record, SEO_KEYS),
    legacy_media: pick(record, ["thumb", "thumb_file", "banner", "banner_file", "slider_gallery", "slider_gallery_internal", "header_select"]),
    media_references: media.map(asset => ({ source_url: asset.url, capture_status: asset.status })),
    migration_warnings: findings.filter(finding => finding.severity === "warning").map(finding => finding.code),
    ...(kind === "rating" ? { rating } : {}),
    issue_label: kind === "rating" ? string(rating.issue) : "",
    ...(envelope.page_context_count !== undefined ? { captured_page_context_count: envelope.page_context_count } : {}),
  };
  let document: CmsIngestInput | null = null;
  if (!findings.some(finding => finding.severity === "error") && (options.policy !== "strict" || reviewReasons.size === 0)) {
    const input: Omit<CmsIngestInput, "source_hash"> = {
      brand: options.brand ?? "wa", kind, source_system: "morweb", source_key: sourceKey,
      title, body_html: body ?? "", byline: author, excerpt: string(record.description),
      slug: publicUrl ? new URL(publicUrl).pathname.replace(/^\//, "") : null,
      public_url: publicUrl, publication_state: reviewReasons.size > 0 ? "review" : state.state, published_at: null,
      issue_uuid: null, identity_anchor: { source_collection: envelope.source_collection, source_record_id: id },
      metadata, source_payload: sourcePayload,
    };
    document = { ...input, source_hash: hashMorwebInput(input) };
  }
  return { source_key: sourceKey, source_collection: envelope.source_collection, kind, document, public_url: publicUrl, findings, review_reasons: [...reviewReasons].sort(), media };
}

export function planMorwebImport(input: unknown, options: MorwebImportOptions = {}): MorwebImportPlan {
  options = { ...archiveTaxonomy(input), ...options };
  const policy = options.policy ?? "preserve";
  const envelopes = readMorwebInput(input);
  const prepared: MorwebPreparedRecord[] = [];
  const unique = new Map<string, { fingerprint: string; record: MorwebPreparedRecord }>();
  let duplicates = 0;
  for (const envelope of envelopes) {
    const result = prepareMorwebRecord(envelope, options);
    const fingerprint = stableJson(envelope);
    const prior = unique.get(result.source_key);
    if (prior) {
      if (prior.fingerprint === fingerprint) { duplicates++; continue; }
      prior.record.findings.push({ source_key: result.source_key, code: "conflicting_source_versions", severity: "error", message: "Multiple different versions have this identity without a declared latest selection; choose the authoritative source version." });
      prior.record.document = null;
      continue;
    }
    unique.set(result.source_key, { fingerprint, record: result });
    prepared.push(result);
  }
  const urls = new Map<string, MorwebPreparedRecord[]>();
  for (const result of prepared) if (result.public_url) urls.set(result.public_url, [...(urls.get(result.public_url) ?? []), result]);
  const collisions: MorwebImportPlan["report"]["url_collisions"] = [];
  for (const [url, records] of urls) {
    if (records.length < 2) continue;
    collisions.push({ public_url: url, source_keys: records.map(record => record.source_key) });
    for (const record of records) {
      record.findings.push({ source_key: record.source_key, code: "public_url_collision", severity: "warning", message: "Multiple legacy identities claim this public URL. All identities are retained for review with an unassigned normalized URL; the original route remains in source metadata." });
      record.review_reasons = [...new Set([...record.review_reasons, "public_url_collision"])].sort();
      if (policy === "strict") { record.document = null; continue; }
      if (record.document) {
        const { source_hash: previousHash, ...input } = record.document;
        void previousHash;
        input.public_url = null;
        input.slug = null;
        input.publication_state = "review";
        input.metadata = {
          ...input.metadata,
          review: { required: true, reasons: record.review_reasons },
          migration_warnings: record.findings.filter(finding => finding.severity === "warning").map(finding => finding.code),
        };
        record.document = { ...input, source_hash: hashMorwebInput(input) };
      }
    }
  }
  const byKind = Object.fromEntries(CMS_DOCUMENT_KINDS.map(kind => [kind, 0])) as Record<CmsDocumentKind, number>;
  const classified = { ...byKind };
  const reviewByKind = { ...byKind };
  let reviewCount = 0;
  let fatalCount = 0;
  const states = { draft: 0, review: 0, published: 0, unpublished: 0 };
  const media = new Map<string, "captured" | "missing" | "unverified">();
  const findingCounts: Record<string, number> = {};
  const findings = prepared.flatMap(record => record.findings);
  for (const finding of findings) findingCounts[finding.code] = (findingCounts[finding.code] ?? 0) + 1;
  const documents: CmsIngestInput[] = [];
  const held: MorwebImportPlan["report"]["held"] = [];
  for (const result of prepared) {
    if (result.kind) classified[result.kind]++;
    if (result.review_reasons.length) { reviewCount++; if (result.kind) reviewByKind[result.kind]++; }
    if (result.findings.some(finding => finding.severity === "error")) fatalCount++;
    for (const asset of result.media) media.set(asset.url, asset.status);
    if (!result.document) { held.push({ source_key: result.source_key, reasons: [...new Set([...result.findings.filter(finding => finding.severity === "error").map(finding => finding.code), ...result.review_reasons])].sort() }); continue; }
    documents.push(result.document);
    byKind[result.document.kind]++;
    states[result.document.publication_state ?? "review"]++;
  }
  return {
    documents,
    report: {
      format: "morweb-import-plan", policy, source_records: envelopes.length, unique_identities: prepared.length,
      duplicate_identical_records: duplicates, eligible_records: documents.length, held_records: held.length,
      fatal_records: fatalCount, review_required_records: reviewCount, review_required_by_kind: reviewByKind,
      eligible_by_kind: byKind, classified_by_kind: classified, eligible_by_publication_state: states,
      finding_counts: findingCounts, findings, held, url_collisions: collisions,
      media: { unique_references: media.size, captured: [...media.values()].filter(status => status === "captured").length, missing: [...media.values()].filter(status => status === "missing").length, unverified: [...media.values()].filter(status => status === "unverified").length },
      historical_revision_conversion: "Latest declared source version only; earlier source versions remain in the preservation archive.",
      target_write_performed: false,
    },
  };
}
