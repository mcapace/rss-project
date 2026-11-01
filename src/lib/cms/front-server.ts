import { cmsDb, databaseError } from "@/lib/cms/db";
import { CmsError } from "@/lib/cms/access";
import type { CmsBrand } from "@/lib/cms/types";
import { sponsorship } from "./sponsored";

/**
 * The home page's news rotator. Five positions: a pinned position shows the
 * document an editor chose (a sponsored story, an older feature) until it is
 * cleared or its end time passes; every other position shows the newest
 * published story in order, so with nothing pinned the rotator is the five
 * newest. Pinned documents never repeat among the newest.
 */
export const FRONT_POSITIONS = 5;
export const FRONT_LABELS = { "": "No label", sponsored: "Sponsored", archive: "From the archive", editors: "Editors' pick" } as const;
export type FrontLabel = keyof typeof FRONT_LABELS;

export type FrontStory = { id: string; slug: string | null; title: string; byline: string; excerpt: string; section: string; date: string | null; published: boolean; hero: string | null; sponsored: boolean; sponsor: string };
export type FrontSlot = { position: number; pinned: (FrontStory & { label: FrontLabel; ends_at: string | null; set_by: string; updated_at: string }) | null; fallback: FrontStory | null };

type DocRow = { id: string; slug: string | null; title: string; byline: string; excerpt: string; publication_state: string; metadata: Record<string, unknown> };

function story(row: DocRow): FrontStory {
  const meta = row.metadata || {};
  const dates = (meta.legacy_dates && typeof meta.legacy_dates === "object" ? meta.legacy_dates : {}) as Record<string, unknown>;
  const date = typeof dates.published_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(dates.published_date) ? dates.published_date.slice(0, 10) : typeof dates.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(dates.date) ? dates.date.slice(0, 10) : null;
  const cats = Array.isArray(meta.categories) ? meta.categories.filter((c): c is string => typeof c === "string") : [];
  // The lead picture: the first media item the CMS holds, else the legacy thumbnail path made absolute.
  const media = Array.isArray(meta.media) ? (meta.media as Record<string, unknown>[]) : [];
  const first = media.find(m => m && typeof m === "object" && (typeof m.url === "string" || typeof m.src === "string"));
  const legacyMedia = (meta.legacy_media && typeof meta.legacy_media === "object" ? meta.legacy_media : {}) as Record<string, unknown>;
  const thumb = typeof legacyMedia.thumb_file === "string" ? legacyMedia.thumb_file : typeof legacyMedia.banner === "string" ? legacyMedia.banner : "";
  const hero = first ? String(first.url || first.src) : thumb ? (thumb.startsWith("/") ? "https://whiskyadvocate.com" + thumb : thumb) : null;
  const sp = sponsorship(meta, row.byline);
  return { id: row.id, slug: row.slug, title: row.title, byline: row.byline, excerpt: row.excerpt, section: cats[0] || "", date, published: row.publication_state === "published", hero, sponsored: sp.on, sponsor: sp.by };
}

const DOC_FIELDS = "id,slug,title,byline,excerpt,publication_state,metadata";

/** The newest published articles by their publish date, enough to fill the positions after the pinned ones. */
export async function newestStories(brand: CmsBrand, count = FRONT_POSITIONS * 3): Promise<FrontStory[]> {
  const { data, error } = await cmsDb().from("cms_documents").select(DOC_FIELDS).eq("brand", brand).eq("kind", "article").eq("publication_state", "published")
    .order("metadata->legacy_dates->>published_date", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false }).limit(count);
  if (error) databaseError(error);
  return ((data || []) as DocRow[]).map(story);
}

/** Every pinned position for the brand, with its document. */
export async function pinnedSlots(brand: CmsBrand) {
  const { data, error } = await cmsDb().from("cms_front_slots").select(`position,label,ends_at,set_by,updated_at,document:cms_documents(${DOC_FIELDS})`).eq("brand", brand).order("position");
  if (error) databaseError(error);
  return ((data || []) as unknown as { position: number; label: FrontLabel; ends_at: string | null; set_by: string; updated_at: string; document: DocRow | DocRow[] | null }[])
    .map(row => ({ ...row, document: Array.isArray(row.document) ? row.document[0] || null : row.document }))
    .filter(row => row.document);
}

/** The five positions as the site will show them: pinned where set and live, newest elsewhere. */
export async function resolveFront(brand: CmsBrand, { includeExpired = false } = {}): Promise<FrontSlot[]> {
  const [pins, newest] = await Promise.all([pinnedSlots(brand), newestStories(brand)]);
  const now = Date.now();
  const live = pins.filter(pin => includeExpired || !pin.ends_at || new Date(pin.ends_at).getTime() > now);
  const taken = new Set(live.map(pin => pin.document!.id));
  const queue = newest.filter(s => !taken.has(s.id));
  const slots: FrontSlot[] = [];
  for (let position = 1; position <= FRONT_POSITIONS; position += 1) {
    const pin = live.find(p => p.position === position);
    slots.push({ position, pinned: pin ? { ...story(pin.document!), label: pin.label, ends_at: pin.ends_at, set_by: pin.set_by, updated_at: pin.updated_at } : null, fallback: queue.shift() || null });
  }
  return slots;
}

/** Pin a document into a position (replacing what was there), or clear the position with no document. */
export async function setFrontSlot(brand: CmsBrand, position: number, input: { documentId: string | null; label: FrontLabel; endsAt: string | null; actor: string }) {
  if (!Number.isInteger(position) || position < 1 || position > FRONT_POSITIONS) throw new CmsError(422, `Positions run 1 to ${FRONT_POSITIONS}.`, "validation_failed");
  const db = cmsDb();
  if (!input.documentId) {
    const { error } = await db.from("cms_front_slots").delete().eq("brand", brand).eq("position", position);
    if (error) databaseError(error);
    return null;
  }
  const { data: doc, error: docError } = await db.from("cms_documents").select("id,brand,kind,publication_state").eq("id", input.documentId).maybeSingle();
  if (docError) databaseError(docError);
  if (!doc || doc.brand !== brand || doc.kind !== "article") throw new CmsError(422, "Pick an article from this publication.", "validation_failed");
  if (doc.publication_state !== "published") throw new CmsError(422, "Only a published article can run on the front.", "validation_failed");
  const { data: other, error: otherError } = await db.from("cms_front_slots").select("position").eq("brand", brand).eq("document_id", input.documentId).neq("position", position).maybeSingle();
  if (otherError) databaseError(otherError);
  if (other) throw new CmsError(409, `That story is already pinned at position ${other.position}.`, "conflict");
  const { error } = await db.from("cms_front_slots").upsert({ brand, position, document_id: input.documentId, label: input.label, ends_at: input.endsAt, set_by: input.actor, updated_at: new Date().toISOString() }, { onConflict: "brand,position" });
  if (error) databaseError(error);
  return true;
}
