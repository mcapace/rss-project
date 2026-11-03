import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, future, past } from "./fake-db";

/**
 * /api/wa/latest's takedown lists are public (CORS *, read by every page), so they may only name slugs the public
 * static files already show. A draft or a review item that was never published must never appear in them.
 */
const mocks = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cms/db", async original => ({ ...(await original<typeof import("@/lib/cms/db")>()), cmsDb: () => mocks.db }));

import { liveStories } from "@/lib/wa/live-stories";
import { GET as latest } from "@/app/api/wa/latest/route";
import { GET as producerRoute } from "@/app/wa/producers/[name]/route";

const PUBLIC = path.join(__dirname, "../../../../public/wa");
const read = (name: string) => JSON.parse(readFileSync(path.join(PUBLIC, name), "utf8"));
const recent = read("stories.json") as { slug: string }[];
const archived = read("stories-archive.json") as { slug: string }[];
const ratingsFile = read("ratings.json") as { cols: string[]; rows: unknown[][] };
const ratingSlugs = ratingsFile.rows.map(row => String(row[ratingsFile.cols.indexOf("slug")]));
const inIndex = new Set([...recent, ...archived].map(s => s.slug.toLowerCase()));

type Row = Record<string, unknown>;
const doc = (id: string, kind: string, slug: string, publication_state: string, published_at: string | null, extra: Row = {}): Row => ({
  id, brand: "wa", kind, slug, title: slug.replace(/-/g, " "), byline: "Staff", excerpt: "", body_html: "<p>Text.</p>",
  publication_state, published_at, updated_at: past(), metadata: {}, ...extra,
});

// Slugs from the real public files, and ones that are in none of them.
const UNPUBLISHED = recent[0].slug, ARCHIVE_DOWN = archived[0].slug, BACK_TO_REVIEW = recent[1].slug, SCHEDULED_AGAIN = recent[2].slug, DUPLICATE = recent[3].slug, STILL_LIVE = recent[4].slug;
const RATING_DOWN = ratingSlugs[0], RATING_DRAFT_DUP = ratingSlugs[1], RATING_LIVE = ratingSlugs[2];
const DRAFT = "a-draft-nobody-has-seen-yet-9f3c", REVIEW = "an-item-waiting-in-review-7d21", RATING_DRAFT = "a-rating-never-published-4b6e";

let documents: Row[];
beforeEach(() => {
  documents = [
    doc("d-draft", "article", DRAFT, "draft", null),
    doc("d-review", "legacy_record", REVIEW, "review", null),
    doc("d-down", "article", UNPUBLISHED, "unpublished", past(40)),
    doc("d-archive", "legacy_record", ARCHIVE_DOWN, "archived", null, { updated_at: past(900) }),
    doc("d-back", "article", BACK_TO_REVIEW.toUpperCase(), "review", past(400)),
    doc("d-sched", "article", SCHEDULED_AGAIN, "published", future(3)),
    doc("d-dup-old", "article", DUPLICATE, "unpublished", past(10)),
    doc("d-dup-live", "article", DUPLICATE, "published", null),
    doc("d-live", "article", STILL_LIVE, "published", past(2)),
    doc("r-down", "rating", RATING_DOWN, "unpublished", null),
    doc("r-dup-draft", "rating", RATING_DRAFT_DUP, "draft", null),
    doc("r-dup-live", "rating", RATING_DRAFT_DUP, "published", null),
    doc("r-live", "rating", RATING_LIVE, "published", null),
    doc("r-draft", "rating", RATING_DRAFT, "draft", null),
  ];
  mocks.db = fakeDb({ cms_documents: documents });
});

describe("takedown lists on /api/wa/latest", () => {
  it("the fixtures stand where the tests say: drafts outside the public files, the rest inside", () => {
    for (const slug of [DRAFT, REVIEW]) expect(inIndex.has(slug)).toBe(false);
    expect(ratingSlugs).not.toContain(RATING_DRAFT);
    expect(new Set([UNPUBLISHED, ARCHIVE_DOWN, BACK_TO_REVIEW, SCHEDULED_AGAIN, DUPLICATE, STILL_LIVE]).size).toBe(6);
  });

  it("names only stories the static files list whose documents are not live", async () => {
    const { removed, removedRatings } = await liveStories();
    expect(removed).not.toContain(DRAFT);
    expect(removed).not.toContain(REVIEW);
    expect(removed).toContain(UNPUBLISHED);
    expect(removed).toContain(ARCHIVE_DOWN);              // in stories-archive.json, changed long ago (no time window)
    expect(removed).toContain(BACK_TO_REVIEW);            // moved back to review after it was public, in the file's spelling
    expect(removed).toContain(SCHEDULED_AGAIN);           // published again with a time still ahead: not live yet
    expect(removed).not.toContain(DUPLICATE);             // a live document still carries the slug
    expect(removed).not.toContain(STILL_LIVE);
    expect(removedRatings).toEqual([RATING_DOWN]);
    for (const slug of removed) expect(inIndex.has(slug.toLowerCase())).toBe(true);
    for (const slug of removedRatings) expect(ratingSlugs).toContain(slug);
  });

  it("a live document of another kind does not keep a story or a rating listed", async () => {
    documents.push(doc("p-same", "page", UNPUBLISHED, "published", null), doc("a-same", "article", RATING_DOWN, "published", null));
    const { removed, removedRatings } = await liveStories();
    expect(removed).toContain(UNPUBLISHED);
    expect(removedRatings).toContain(RATING_DOWN);
  });

  it("the route answers with both lists and never a draft's slug", async () => {
    const res = await latest();
    expect(res.status).toBe(200);
    const body = await res.text();
    const json = JSON.parse(body) as { removed: string[]; removedRatings: string[] };
    expect(json.removed).toContain(UNPUBLISHED);
    expect(json.removedRatings).toEqual([RATING_DOWN]);
    for (const slug of [DRAFT, REVIEW, RATING_DRAFT]) expect(body).not.toContain(slug);
  });

  it("reads every non-live row, past the 1,000 rows PostgREST returns per request", async () => {
    // Thousands of ratings waiting in review (print intake), and the takedown after them in the table's order.
    const reviews = Array.from({ length: 2400 }, (_, i) => doc(`r-review-${i}`, "rating", `a-rating-in-review-${i}`, "review", null));
    const late = ratingSlugs[3];
    mocks.db = fakeDb({ cms_documents: [...reviews, ...documents, doc("r-late", "rating", late, "unpublished", null)] }, {}, { maxRows: 1000 });
    const { removedRatings } = await liveStories();
    expect(removedRatings).toEqual([RATING_DOWN, late]);
  });
});

describe("server-rendered producer pages", () => {
  const COLS = ratingsFile.cols, at = (c: string) => COLS.indexOf(c);
  const rows = ratingsFile.rows.filter(row => row[at("pr")] === "Ardbeg");
  const [down, kept] = [String(rows[0][at("slug")]), String(rows[1][at("slug")])];
  const env = { SUPABASE_URL: process.env.SUPABASE_URL };
  const page = async () => (await producerRoute(new Request("https://rss-project-ten.vercel.app/wa/producers/Ardbeg"), { params: Promise.resolve({ name: "Ardbeg" }) })).text();
  beforeEach(() => { documents.push(doc("r-ardbeg-down", "rating", down, "unpublished", null)); });
  afterEach(() => { if (env.SUPABASE_URL === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.SUPABASE_URL; });

  it("leave out ratings taken down since the export: no link, and not in the count", async () => {
    process.env.SUPABASE_URL = "https://fake.invalid";
    const html = await page();
    expect(html).not.toContain(`/${encodeURIComponent(down)}"`);
    expect(html).toContain(`/${encodeURIComponent(kept)}"`);
    expect(html).toContain(`${rows.length - 1} published Whisky Advocate ratings for Ardbeg`);
  });

  it("are the static export as it stands where no database is configured (previews), without asking the CMS", async () => {
    delete process.env.SUPABASE_URL;
    mocks.db = { from() { throw new Error("must not query"); } };
    const html = await page();
    expect(html).toContain(`/${encodeURIComponent(down)}"`);
    expect(html).toContain(`${rows.length} published Whisky Advocate ratings for Ardbeg`);
  });
});
