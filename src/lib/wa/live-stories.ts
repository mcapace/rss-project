import "server-only";
import { cmsDb } from "@/lib/cms/db";
import { leadImagePath } from "@/lib/cms/lead-image";
import { sponsorship } from "@/lib/cms/sponsored";

/**
 * Stories published from the CMS, in the site's story-index shape (public/wa/stories.json), so the home page, the
 * story lists, search and related stories show them as soon as they are out. The static index comes from
 * scripts/wa-export-stories.py and covers everything imported from the old site; this covers what that export has
 * not seen yet: stories with published_at set (the CMS's publish step), up to now, plus the slugs taken down since.
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

export async function liveStories(): Promise<{ stories: StoryEntry[]; removed: string[]; sponsored: { slug: string; by?: string }[] }> {
  const now = new Date().toISOString();
  const [published, takenDown] = await Promise.all([
    cmsDb().from("cms_documents").select("id,slug,title,byline,excerpt,body_html,published_at,metadata").eq("brand", "wa").in("kind", ["article", "legacy_record"])
      .eq("publication_state", "published").not("slug", "is", null).not("published_at", "is", null).lte("published_at", now).order("published_at", { ascending: false }).limit(300),
    // Stories taken off the site in the last 120 days, so the static index stops listing them.
    cmsDb().from("cms_documents").select("slug").eq("brand", "wa").in("kind", ["article", "legacy_record"]).neq("publication_state", "published")
      .not("slug", "is", null).gte("updated_at", new Date(Date.now() - 120 * 864e5).toISOString()).limit(500),
  ]);
  if (published.error) throw new Error(published.error.message);
  if (takenDown.error) throw new Error(takenDown.error.message);
  const stories = ((published.data || []) as Row[]).map(entryOf);
  // A slug is only removed when no published document still carries it (an unpublished duplicate never hides a live story).
  const downSlugs = [...new Set(((takenDown.data || []) as { slug: string }[]).map(row => row.slug))];
  const stillLive = new Set<string>();
  for (let i = 0; i < downSlugs.length; i += 100) {
    const { data, error } = await cmsDb().from("cms_documents").select("slug").eq("brand", "wa").eq("publication_state", "published").in("slug", downSlugs.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of (data || []) as { slug: string }[]) stillLive.add(row.slug.toLowerCase());
  }
  return {
    stories,
    removed: downSlugs.filter(slug => !stillLive.has(slug.toLowerCase())),
    sponsored: stories.filter(s => s.sp).map(s => (s.spBy ? { slug: s.slug, by: s.spBy } : { slug: s.slug })),
  };
}
