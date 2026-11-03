import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cmsDb } from "@/lib/cms/db";
import { deliveryEnabled } from "@/lib/cms/runtime-config";
import { leadImagePath } from "@/lib/cms/lead-image";
import { sponsorship } from "@/lib/cms/sponsored";
import { onlyLive } from "./live";

/**
 * Stories published from the CMS, in the site's story-index shape (public/wa/stories.json), so the home page, the
 * story lists, search and related stories show them as soon as they are out. The static index comes from
 * scripts/wa-export-stories.py and covers everything imported from the old site; this covers what that export has
 * not seen yet: stories with published_at set (the CMS's publish step), up to now, plus the slugs of stories and ratings
 * in the static files that are no longer live (publicIndex, takenDownOf).
 * The section and dek rules follow the export script, so an entry looks the same once the export catches up.
 */
export type StoryEntry = {
  id: string; title: string; slug: string; by: string; d: string; sec: string; tags: string[]; hero: string | null; dek: string; min: string; refs: string[];
  cap?: string; credit?: string; sp?: 1; spBy?: string; kind?: string; region?: string;
};

const TAGSETS: [string, Set<string>][] = [
  ["cocktails", new Set(["Cocktails", "Cocktail", "Recipe", "Recipes", "Old Fashioned", "Highball", "Manhattan", "Hot Toddy", "Punch"])],
  ["travel", new Set(["Travel", "Bars", "Where To", "whisky bars", "Dispatches", "Distillery Tours", "Bar", "Restaurants"])],
  ["guides", new Set(["Whisky List", "How To", "Collecting", "Reviews", "Buying Guide", "Auctions", "Ratings", "Whisky 101", "Glossary", "Whisky Gear", "Gear", "Gift Guide", "Gifts", "Value"])],
  ["news", new Set(["New Releases", "News", "Industry", "Whisky News and Spirit Updates", "Trending", "Whisky Watch"])],
  ["features", new Set(["Insights", "Features", "Magazine", "Profiles", "Interviews", "History"])],
  ["life", new Set(["Whisky Life", "Pairings", "Food", "Sports", "Movies", "Music"])],
];
// The section an editor picks in the CMS ("News", "Features", ...) maps straight to the site's.
const EDITOR_SECTION: Record<string, string> = { news: "news", features: "features", feature: "features", insights: "features", "whisky life": "life", life: "life", travel: "travel", cocktails: "cocktails", guides: "guides", guide: "guides" };
const KIND_RULES: [string, Set<string>][] = [["gear", new Set(["Whisky Gear", "Gear", "Books", "Glassware"])], ["collecting", new Set(["Collecting", "Auctions", "Auction"])], ["101", new Set(["Whisky 101", "Basics", "Whisky Essentials", "Tasting Lesson", "Glossary"])], ["howto", new Set(["How To", "DIY", "Pairings", "Food", "Food Pairing"])], ["buying", new Set(["Buying Guide", "Reviews", "Ratings", "Gift Guide", "Gifts", "Value"])], ["list", new Set(["Whisky List"])]];
const REGIONS = ["Scotland", "Kentucky", "Ireland", "Japan", "Canada", "Tennessee", "England", "Wales", "India", "Australia", "Taiwan", "Texas", "New York", "Islay", "Speyside", "Highlands", "Lowlands", "Campbeltown", "Mexico", "France"];

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
const hits = (bag: Set<string>, names: Set<string>) => [...bag].some(t => names.has(t));

export function sectionOf(tags: string[], cats: string[], title: string, words: number, editor: string): string {
  const picked = EDITOR_SECTION[editor.trim().toLowerCase()];
  if (picked) return picked;
  const bag = new Set([...tags, ...cats]); const t = title.toLowerCase();
  if (/cocktail|recipe|highball|old fashioned|manhattan|toddy|sour\b|punch\b/.test(t) || hits(bag, TAGSETS[0][1])) return "cocktails";
  if (hits(bag, TAGSETS[1][1]) || /\bbars?\b|travel|distillery tour|where to drink|guide to [A-Z]/.test(title)) return "travel";
  if (hits(bag, TAGSETS[2][1]) || /^\d+ |how to|guide|best .* under|auction|collect/.test(t)) return "guides";
  if (hits(bag, TAGSETS[3][1])) return "news";
  if (hits(bag, TAGSETS[4][1]) && words >= 1100) return "features";
  if (hits(bag, TAGSETS[5][1])) return "life";
  return "news";
}

/** The calendar day of a publish time in New York, where the magazine runs (the index sorts on it). */
export function dayOf(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts.slice(0, 10);
}

type Row = { id: string; slug: string; title: string; byline: string | null; excerpt: string | null; body_html: string | null; published_at: string; metadata: Record<string, unknown> };

export function entryOf(row: Row): StoryEntry {
  const meta = row.metadata || {};
  const cats = strs(meta.categories);
  const ai = strs(meta.ai_tags);
  let tags = strs(meta.tags).filter(t => !cats.includes(t) && !/^[a-z0-9_]+$/.test(t));
  if (ai.length) tags = [...new Set([...ai, ...tags])].slice(0, 14);
  const body = row.body_html || "";
  const words = text(body).split(" ").filter(Boolean).length;
  const editor = typeof meta.section === "string" ? meta.section : "";
  const sec = sectionOf(strs(meta.tags), cats, row.title || "", words, editor);
  const seo = obj(meta.seo);
  const first = text((body.match(/<p[^>]*>([\s\S]*?)<\/p>/) || ["", ""])[1]);
  const dek = String((typeof seo.description === "string" && seo.description) || row.excerpt || first).slice(0, 320).trim();
  const lead = obj(meta.media && Array.isArray(meta.media) ? (meta.media as unknown[]).find(m => obj(m).is_lead === true) : meta.lead_image);
  const entry: StoryEntry = {
    id: row.id, title: row.title, slug: row.slug, by: row.byline || "", d: dayOf(row.published_at), sec, tags, hero: leadImagePath(row.id, meta),
    dek, min: String(Math.max(1, Math.round(words / 230))), refs: [],
  };
  if (typeof lead.caption === "string" && lead.caption.trim()) entry.cap = lead.caption.trim();
  if (typeof lead.credit === "string" && lead.credit.trim()) entry.credit = lead.credit.trim();
  const sp = sponsorship(meta, row.byline);
  if (sp.on) { entry.sp = 1; if (sp.by) entry.spBy = sp.by; }
  if (sec === "guides") entry.kind = KIND_RULES.find(([, names]) => hits(new Set(tags), names))?.[0] || "list";
  if (sec === "travel") { const region = REGIONS.find(r => tags.includes(r) || new RegExp(`\\b${r}\\b`).test(row.title)); if (region) entry.region = region; }
  return entry;
}

/**
 * The slugs the public static files carry, read from disk once per server instance (lowercased to the file's own
 * spelling): stories.json with stories-archive.json, and ratings.json. next.config.ts traces the three files into the
 * /api/wa/latest bundle. A takedown list is only ever cut from these, so it can name nothing the public files do not
 * already show: a draft or review item never published is never in them, and so never in the list.
 */
export type StaticIndex = { stories: Map<string, string>; ratings: Map<string, string> };
let staticIndex: Promise<StaticIndex> | null = null;
export function publicIndex(): Promise<StaticIndex> {
  if (!staticIndex) {
    // One literal path per read. The route's bundle also carries the rest of public/wa, but not because of these reads:
    // the "/wa/[slug]" key in next.config.ts's outputFileTracingIncludes is a glob whose [slug] is a character class,
    // so it also matches /api/wa/latest (and /api/wa/story, /similar, /shelf-scan) and adds its files to them.
    staticIndex = Promise.all([
      readFile(path.join(process.cwd(), "public/wa/stories.json"), "utf8"),
      readFile(path.join(process.cwd(), "public/wa/stories-archive.json"), "utf8"),
      readFile(path.join(process.cwd(), "public/wa/ratings.json"), "utf8"),
    ]).then(texts => texts.map(text => JSON.parse(text) as unknown)).then(([recent, archive, ratings]) => {
      const stories = new Map<string, string>();
      for (const list of [recent, archive]) for (const s of (Array.isArray(list) ? list : []) as { slug?: unknown }[]) if (typeof s?.slug === "string" && s.slug) stories.set(s.slug.toLowerCase(), s.slug);
      const table = obj(ratings), cols = Array.isArray(table.cols) ? table.cols : [], at = cols.indexOf("slug"), rated = new Map<string, string>();
      if (at >= 0 && Array.isArray(table.rows)) for (const row of table.rows as unknown[][]) { const slug = Array.isArray(row) ? row[at] : null; if (typeof slug === "string" && slug) rated.set(slug.toLowerCase(), slug); }
      return { stories, ratings: rated };
    }).catch(error => { staticIndex = null; throw error; });
  }
  return staticIndex;
}

/**
 * The slugs of `listed` whose documents of these kinds are not live: unpublished, draft, review, archived or still
 * scheduled (any state but published-and-due), and with no live document of those kinds on the same slug. Only the
 * slug column of non-live rows is read, every one of them, a page at a time (PostgREST caps a response at 1,000 rows
 * whatever the limit says, and review ratings from print intake run to thousands), then intersected with the public
 * files, so the answer is bounded by what is already public. Returned in the files' own spelling.
 */
const PAGE = 1000;
async function takenDownOf(kinds: string[], listed: Map<string, string>, now: number): Promise<string[]> {
  const at = new Date(now).toISOString();
  // Public slug (lowercased) -> the spellings to check for a live copy: the document's and the file's.
  const candidates = new Map<string, Set<string>>();
  for (let from = 0; ; from += PAGE) {
    // Ordered by id, which does not change, so a page boundary never skips or repeats a row while editors work.
    const { data, error } = await cmsDb().from("cms_documents").select("slug").eq("brand", "wa").in("kind", kinds).not("slug", "is", null)
      .or(`publication_state.is.null,publication_state.neq.published,published_at.gt.${at}`).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as { slug: string | null }[];
    for (const row of rows) {
      if (!row.slug) continue;
      const key = row.slug.toLowerCase(), shown = listed.get(key);
      if (!shown) continue;
      candidates.set(key, (candidates.get(key) ?? new Set([shown])).add(row.slug));
    }
    if (rows.length < PAGE) break;
  }
  const spellings = [...new Set([...candidates.values()].flatMap(set => [...set]))];
  const stillLive = new Set<string>();
  for (let i = 0; i < spellings.length; i += 100) {
    const live = await onlyLive(cmsDb().from("cms_documents").select("slug").eq("brand", "wa"), now).in("kind", kinds).in("slug", spellings.slice(i, i + 100));
    if (live.error) throw new Error(live.error.message);
    for (const row of (live.data || []) as { slug: string }[]) stillLive.add(row.slug.toLowerCase());
  }
  return [...candidates.keys()].filter(key => !stillLive.has(key)).map(key => listed.get(key)!);
}

export type LiveList = { stories: StoryEntry[]; removed: string[]; removedRatings: string[]; sponsored: { slug: string; by?: string }[] };

export async function liveStories(): Promise<LiveList> {
  const clock = Date.now(), now = new Date(clock).toISOString();
  // What the static files list but is no longer live, so the pages stop showing it. If the files cannot be read, no
  // takedowns go out (the live stories still do): a slug the files do not hold is never published.
  const [published, index] = await Promise.all([
    cmsDb().from("cms_documents").select("id,slug,title,byline,excerpt,body_html,published_at,metadata").eq("brand", "wa").in("kind", ["article", "legacy_record"])
      .eq("publication_state", "published").not("slug", "is", null).not("published_at", "is", null).lte("published_at", now).order("published_at", { ascending: false }).limit(300),
    publicIndex().catch((error: unknown) => { console.error("[wa/latest] static index unreadable", error instanceof Error ? error.message : error); return null; }),
  ]);
  if (published.error) throw new Error(published.error.message);
  const stories = ((published.data || []) as Row[]).map(entryOf);
  const [removed, removedRatings] = index
    ? await Promise.all([takenDownOf(["article", "legacy_record"], index.stories, clock), takenDownOf(["rating"], index.ratings, clock)])
    : [[], []];
  return { stories, removed, removedRatings, sponsored: stories.filter(s => s.sp).map(s => (s.spBy ? { slug: s.slug, by: s.spBy } : { slug: s.slug })) };
}

/**
 * The ratings.json slugs (lowercased) whose documents are no longer live, for server pages built from the static
 * files, such as the producer pages crawlers index. Empty where public delivery does not read the CMS (previews, no
 * database configured), as /wa/<slug> then serves the static export as it stands too. Kept a minute per server
 * instance; a failed read is not kept, and throws for the caller to decide.
 */
let ratingTakedowns: { at: number; slugs: Promise<Set<string>> } | null = null;
export function removedRatingSlugs(): Promise<Set<string>> {
  if (!deliveryEnabled() || !(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) return Promise.resolve(new Set());
  const clock = Date.now();
  if (!ratingTakedowns || clock - ratingTakedowns.at > 60_000) {
    const slugs = publicIndex().then(index => takenDownOf(["rating"], index.ratings, clock)).then(list => new Set(list.map(slug => slug.toLowerCase())));
    slugs.catch(() => { if (ratingTakedowns?.slugs === slugs) ratingTakedowns = null; });
    ratingTakedowns = { at: clock, slugs };
  }
  return ratingTakedowns.slugs;
}
