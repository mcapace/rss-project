import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, future, past } from "./fake-db";

/**
 * A scheduled story (publication_state 'published', published_at still ahead) must stay off every public surface.
 * The fake database answers wa_match_documents and cms_match_embeddings the way the functions did before
 * 20261103180000_wa_match_live_only.sql (publication_state only), so these tests prove the code drops scheduled rows
 * on its own, before the migration is applied.
 */
const mocks = vi.hoisted(() => ({ db: null as unknown, create: vi.fn(), requireCmsUser: vi.fn(), s3Send: vi.fn(), render: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cms/db", async original => ({ ...(await original<typeof import("@/lib/cms/db")>()), cmsDb: () => mocks.db }));
vi.mock("@/lib/editorial/server/embeddings", () => ({ embeddingsConfigured: () => true, embedTexts: async () => [[0.1, 0.2, 0.3]] }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: mocks.create }; } }));
vi.mock("@/lib/cms/auth-server", () => ({ requireCmsUser: mocks.requireCmsUser }));
vi.mock("@/lib/s3", () => ({ getS3Client: () => ({ send: mocks.s3Send }) }));
vi.mock("@/lib/media/keys", () => ({ allowedMediaKey: () => true }));
vi.mock("@/lib/media/renditions", async original => ({ ...(await original<typeof import("@/lib/media/renditions")>()), renderRendition: mocks.render }));

import { CmsError } from "@/lib/cms/access";
import { searchRatings } from "@/lib/cms/catalog-server";
import { resolveFront } from "@/lib/cms/front-server";
import { GET as meaning } from "@/app/api/wa/meaning/route";
import { GET as answer } from "@/app/api/wa/answer/route";
import { POST as ask } from "@/app/api/wa/ask/route";
import { GET as similar } from "@/app/api/wa/similar/route";
import { GET as bottlesLike } from "@/app/api/wa/bottles-like/route";
import { GET as front } from "@/app/api/wa/front/route";
import { GET as story } from "@/app/api/wa/story/route";
import { POST as shelfScan } from "@/app/api/wa/shelf-scan/route";
import { GET as publicRatings } from "@/app/api/public/[brand]/ratings/route";
import { GET as media } from "@/app/api/media/[id]/[index]/route";
import { loadDoc } from "@/lib/wa/seo";
import { matchDocuments } from "@/lib/wa/semantic";

type Row = Record<string, unknown>;
const doc = (id: string, kind: string, slug: string, published_at: string | null, extra: Row = {}): Row => ({
  id, brand: "wa", kind, slug, title: slug.replace(/-/g, " "), byline: "Staff", excerpt: `About ${slug}`, body_html: "<p>Text.</p>",
  publication_state: "published", published_at, updated_at: past(), metadata: {}, ...extra,
});
const rating = (id: string, slug: string, published_at: string | null, brand: string, score = 90) =>
  doc(id, "rating", slug, published_at, { rating: { brand, category: "Single Malt Scotch", score, price: 60 }, flavor: null });

let documents: Row[];
let similarity: Record<string, number>;

/** wa_match_documents as it was before the live-only migration: publication_state only. */
function matchOld(args: Row) {
  const kinds = args.p_kinds as string[];
  return documents.filter(d => d.publication_state === "published" && d.slug && kinds.includes(d.kind as string) && d.id !== args.p_exclude)
    .map(d => ({ document_id: d.id, kind: d.kind, slug: d.slug, title: d.title, similarity: similarity[d.id as string] ?? 0.7 }))
    .sort((a, b) => b.similarity - a.similarity).slice(0, Number(args.p_limit));
}

/** cms_match_embeddings, which the similar route called before this fix: every published document, state only. */
function matchEmbeddingsOld(args: Row) {
  return documents.filter(d => d.publication_state === "published")
    .map(d => ({ document_id: d.id, brand: d.brand, kind: d.kind, title: d.title, publication_state: d.publication_state, similarity: similarity[d.id as string] ?? 0.7 }))
    .sort((a, b) => b.similarity - a.similarity).slice(0, Number(args.p_limit ?? 12));
}

function install(extra: Record<string, Row[]> = {}, rpcs: Record<string, (args: Row) => unknown> = {}) {
  const db = fakeDb({ cms_documents: documents, cms_embeddings: documents.map(d => ({ document_id: d.id, kind: "document", embedding: "[0.1,0.2,0.3]" })), ...extra }, { wa_match_documents: matchOld, cms_match_embeddings: matchEmbeddingsOld, ...rpcs });
  mocks.db = db;
  return db;
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
  documents = [
    doc("s-soon", "article", "scheduled-story", future(2)),
    doc("s-live", "article", "live-story", past(2)),
    doc("s-old", "article", "old-story", null),
    doc("s-legacy", "legacy_record", "legacy-story", null),
    doc("s-down", "article", "taken-down-story", past(30), { publication_state: "unpublished" }),
    rating("r-soon", "scheduled-rating", future(1), "Glenfuture"),
    rating("r-live", "live-rating", null, "Ardbeg"),
    rating("r-other", "another-rating", past(5), "Lagavulin", 88),
  ];
  // The scheduled ones read closest, so a leak would put them first.
  similarity = { "s-soon": 0.95, "r-soon": 0.95, "s-live": 0.9, "s-old": 0.88, "s-legacy": 0.87, "r-live": 0.9, "r-other": 0.89 };
});

const slugs = (list: unknown) => (list as { slug: string }[]).map(x => x.slug);

describe("matchDocuments", () => {
  it("drops matches that are not live and asks for a few more to fill the list", async () => {
    const db = install();
    const out = await matchDocuments(db as never, [0.1], ["article"], 2);
    expect(out.map(m => m.slug)).toEqual(["live-story", "old-story"]);
    expect(db.rpcCalls[0].args.p_limit).toBeGreaterThan(2);
    expect(db.fromCalls.find(c => c.table === "cms_documents")?.filters).toContain("in:id");
  });
});

describe("search by meaning", () => {
  it("/api/wa/meaning leaves out scheduled stories and ratings", async () => {
    install();
    const res = await meaning(new Request("https://wa.test/api/wa/meaning?q=smoky%20scotch"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(slugs(body.stories)).toEqual(["live-story", "old-story"]);
    expect(slugs(body.bottles)).toEqual(["live-rating", "another-rating"]);
  });

  it("/api/wa/answer never cites a scheduled story or bottle", async () => {
    install();
    const res = await answer(new Request("https://wa.test/api/wa/answer?q=what%20should%20I%20drink"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(slugs(body.stories)).toEqual(["live-story", "old-story"]);
    expect(slugs(body.bottles)).toEqual(["live-rating", "another-rating"]);
  });

  it("/api/wa/answer gives the model only live ratings and stories", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    install();
    mocks.create.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ answer: "Try these.", bottles: [{ slug: "scheduled-rating", why: "x" }, { slug: "live-rating", why: "y" }], stories: ["scheduled-story", "live-story"] }) }] });
    const body = await (await answer(new Request("https://wa.test/api/wa/answer?q=what%20should%20I%20drink"))).json();
    const prompt = JSON.stringify(mocks.create.mock.calls[0][0]);
    expect(prompt).not.toContain("scheduled-");
    expect(slugs(body.bottles)).toEqual(["live-rating"]);
    expect(slugs(body.stories)).toEqual(["live-story"]);
  });

  it("/api/wa/ask adds only live bottles by meaning", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    install();
    mocks.create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ answer: "Try these.", picks: ["scheduled-rating", "live-rating"], followups: [], actions: [] }) }] });
    const res = await ask(new Request("https://wa.test/api/wa/ask", { method: "POST", headers: { "x-forwarded-for": "10.0.0.1" }, body: JSON.stringify({ turns: [{ role: "user", text: "something smoky" }], bottles: [] }) }));
    const body = await res.json();
    expect(JSON.stringify(mocks.create.mock.calls[0][0])).not.toContain("scheduled-rating");
    expect(body.picks).toEqual(["live-rating"]);
    expect(slugs(body.cards)).toEqual(["live-rating"]);
  });
});

describe("similar stories and bottles", () => {
  it("/api/wa/similar lists only other live stories", async () => {
    const db = install();
    const res = await similar(new Request("https://wa.test/api/wa/similar?slug=live-story"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(slugs(body.stories)).toEqual(["old-story", "legacy-story"]);
    expect(db.rpcCalls.find(c => c.name === "wa_match_documents")?.args).toMatchObject({ p_kinds: ["article", "legacy_record"], p_exclude: "s-live" });
  });

  it("/api/wa/similar has nothing for a story that is not out yet", async () => {
    const db = install();
    const res = await similar(new Request("https://wa.test/api/wa/similar?slug=scheduled-story"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.stories).toEqual([]);
    // The source story's own liveness stops it: no embedding read, no match of either kind.
    expect(db.fromCalls.filter(c => c.table === "cms_embeddings")).toHaveLength(0);
    expect(db.rpcCalls.filter(c => c.name === "wa_match_documents" || c.name === "cms_match_embeddings")).toHaveLength(0);
  });

  it("/api/wa/bottles-like is a 404 for a scheduled rating and never lists one", async () => {
    install();
    expect((await bottlesLike(new Request("https://wa.test/api/wa/bottles-like?slug=scheduled-rating"))).status).toBe(404);
    const body = await (await bottlesLike(new Request("https://wa.test/api/wa/bottles-like?slug=live-rating"))).json();
    expect(slugs(body.bottles)).toEqual(["another-rating"]);
  });
});

describe("front-page pins", () => {
  const slot = (position: number, document: Row, extra: Row = {}) => ({ brand: "wa", position, label: "", ends_at: null, set_by: "editor@example.test", updated_at: past(), document, ...extra });
  const pins = () => [
    slot(1, documents.find(d => d.id === "s-soon")!),
    slot(2, documents.find(d => d.id === "s-down")!),
    slot(3, documents.find(d => d.id === "s-old")!, { label: "archive" }),
  ];

  it("a scheduled or taken-down pin gives its position to the newest story", async () => {
    install({ cms_front_slots: pins() });
    const slots = await resolveFront("wa");
    expect(slots[0].pinned).toBeNull();
    expect(slots[0].fallback?.id).toBe("s-live");
    expect(slots[1].pinned).toBeNull();
    expect(slots[2].pinned?.id).toBe("s-old");
    expect(slots.flatMap(s => [s.pinned?.id, s.fallback?.id])).not.toContain("s-soon");
  });

  it("the editor's view keeps every pin", async () => {
    install({ cms_front_slots: pins() });
    const slots = await resolveFront("wa", { includeExpired: true });
    expect(slots.map(s => s.pinned?.id)).toEqual(["s-soon", "s-down", "s-old", undefined, undefined]);
  });

  it("/api/wa/front never shows the scheduled story", async () => {
    install({ cms_front_slots: pins() });
    const body = await (await front()).json();
    const shown = body.stories as { id: string; position: number; pinned: boolean }[];
    expect(shown.map(s => s.id)).not.toContain("s-soon");
    expect(shown.map(s => s.id)).not.toContain("s-down");
    expect(shown.find(s => s.position === 1)).toMatchObject({ id: "s-live", pinned: false });
    expect(shown.find(s => s.position === 3)).toMatchObject({ id: "s-old", pinned: true });
  });
});

describe("story reads", () => {
  it("/api/wa/story and loadDoc 404 a scheduled story", async () => {
    install();
    expect((await story(new Request("https://wa.test/api/wa/story?slug=scheduled-story"))).status).toBe(404);
    expect((await story(new Request("https://wa.test/api/wa/story?slug=live-story"))).status).toBe(200);
    expect(await loadDoc("scheduled-story")).toBeNull();
    expect((await loadDoc("old-story"))?.id).toBe("s-old");
  });
});

describe("ratings served publicly", () => {
  it("/api/wa/shelf-scan matches a label only to a live rating", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const ratingRows = [
      { brand: "wa", product_name: "Glenmore 12 Year Old", category: "Single Malt Scotch", score: 95, price: 50, cms_documents: { slug: "scheduled-rating", publication_state: "published", published_at: future(), metadata: {} } },
      { brand: "wa", product_name: "Glenmore 12", category: "Single Malt Scotch", score: 88, price: 45, cms_documents: { slug: "live-rating", publication_state: "published", published_at: null, metadata: {} } },
    ];
    install({ cms_ratings: ratingRows });
    mocks.create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ bottles: [{ brand: "Glenmore", name: "12 Year Old", confidence: 0.9, x: 0, y: 0, w: 0.2, h: 0.5 }] }) }] });
    const res = await shelfScan(new Request("https://wa.test/api/wa/shelf-scan", { method: "POST", headers: { "x-forwarded-for": "10.0.0.2" }, body: JSON.stringify({ image: "data:image/jpeg;base64,AAAA" }) }));
    const body = await res.json();
    expect(body.bottles[0].rating.slug).toBe("live-rating");
  });

  type Hit = Row & { document_id: string; slug: string; producer_slug: string | null; published_at: string | null };
  const hit = (document_id: string, slug: string, published_at: string | null, producer: string, score: number): Hit => ({
    document_id, brand: "wa", title: slug, slug, publication_state: "published", score, price: 50, vintage: null, product_name: slug, category: "",
    producer, producer_slug: producer.toLowerCase(), region: null, region_slug: null, variety: null, variety_slug: null, taster: null, taster_slug: null,
    drink_window: null, published_at, updated_at: past(),
  });
  // A scheduled rating that ranks first, from a producer no live rating has, and two live ones.
  const hits = () => [hit("r-soon", "scheduled-rating", future(), "Glenfuture", 99), hit("r-live", "live-rating", null, "Ardbeg", 92), hit("r-other", "another-rating", past(5), "Lagavulin", 88)];
  const liveHit = (h: Hit) => h.publication_state === "published" && (h.published_at == null || Date.parse(h.published_at) <= Date.now());
  /** cms_search_ratings and cms_rating_facets with 20261103190000_cms_ratings_live.sql: p_live filters before paging and counting. */
  const ratingsRpcs = (missingLive = false) => ({
    cms_search_ratings: (args: Row) => {
      if (missingLive && "p_live" in args) throw { code: "PGRST202", message: "Could not find the function public.cms_search_ratings" };
      const matched = hits().filter(h => (!args.p_state || h.publication_state === args.p_state) && (!args.p_live || liveHit(h)) && (!args.p_producer || h.producer_slug === args.p_producer));
      const offset = Number(args.p_offset ?? 0);
      return matched.slice(offset, offset + Number(args.p_limit)).map(h => ({ ...h, total: matched.length }));
    },
    cms_rating_facets: (args: Row) => {
      if (missingLive && "p_live" in args) throw { code: "PGRST202", message: "Could not find the function public.cms_rating_facets" };
      return hits().filter(h => !args.p_live || liveHit(h)).map(h => ({ facet: "producer", value: h.producer_slug, label: h.producer, document_count: 1 }));
    },
  });
  const listRatings = (query = "") => publicRatings(new Request(`https://wa.test/api/public/wa/ratings${query}`), { params: Promise.resolve({ brand: "wa" }) });

  it("/api/public/<brand>/ratings leaves a scheduled rating out of the rows, the total, the pages and the facets", async () => {
    const db = install({}, ratingsRpcs());
    const res = await listRatings("?limit=1");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(slugs(body.ratings)).toEqual(["live-rating"]);
    expect(body.total).toBe(2);
    expect((body.facets.producer as { value: string }[]).map(f => f.value)).toEqual(["ardbeg", "lagavulin"]);
    expect(db.rpcCalls.map(c => c.args.p_live)).toEqual([true, true]);
    // A scheduled rating's producer gives nothing away: no rows and no count.
    const glen = await (await listRatings("?producer=glenfuture")).json();
    expect(glen.ratings).toEqual([]);
    expect(glen.total).toBe(0);
  });

  it("/api/public/<brand>/ratings still drops a scheduled rating before the live migration is applied", async () => {
    const db = install({}, ratingsRpcs(true));
    const res = await listRatings();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(slugs(body.ratings)).toEqual(["live-rating", "another-rating"]);
    expect(db.rpcCalls.filter(c => c.name === "cms_search_ratings").map(c => "p_live" in c.args)).toEqual([true, false]);
  });

  it("the editors' ratings search keeps scheduled ratings", async () => {
    const db = install({}, ratingsRpcs());
    const result = await searchRatings(["wa"], { state: "published", limit: 10 });
    expect(result.ratings.map(r => r.slug)).toEqual(["scheduled-rating", "live-rating", "another-rating"]);
    expect(db.rpcCalls.every(c => !("p_live" in c.args))).toBe(true);
  });
});

describe("media", () => {
  const id = "c400788c-3282-4077-a993-4f31b8250001";
  const context = { params: Promise.resolve({ id, index: "0" }) };
  beforeEach(() => {
    process.env.S3_BUCKET = "test-bucket";
    mocks.requireCmsUser.mockRejectedValue(new CmsError(401, "Sign in to continue.", "unauthorized"));
    mocks.s3Send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) }, ContentType: "image/jpeg" });
    mocks.render.mockResolvedValue({ body: Buffer.from([1]), contentType: "image/webp", width: 10, height: 10 });
  });
  const withDocument = (published_at: string | null) => {
    documents = [{ ...doc(id, "article", "pictured", published_at), issue_uuid: null, revision: 1, metadata: { media: [{ s3_key: "wa/lead.jpg" }] } }];
    install();
  };

  it("a scheduled story's pictures need an editor's session", async () => {
    withDocument(future());
    const res = await media(new Request(`https://wa.test/api/media/${id}/0`), { params: Promise.resolve({ id, index: "0" }) });
    expect(res.status).toBe(401);
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("a live story's pictures are public and cacheable", async () => {
    withDocument(past());
    const res = await media(new Request(`https://wa.test/api/media/${id}/0`), context);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("public");
    expect(mocks.requireCmsUser).not.toHaveBeenCalled();
  });
});
