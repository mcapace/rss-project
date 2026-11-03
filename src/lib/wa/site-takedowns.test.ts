// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * public/wa/site.js against /api/wa/latest: the stories and ratings it names as taken down leave every list a page
 * builds from (the recent index, the archive the header search and story lookups use, data.json and ratings.json).
 */
// catalog-core.js first, as every page loads it.
const SRC = ["catalog-core.js", "site.js"].map(name => readFileSync(path.join(__dirname, "../../../public/wa", name), "utf8")).join("\n;\n");
type Story = { slug: string; title: string; d: string; sec: string; tags: string[]; refs: string[]; dek: string; by: string };
type Rating = { slug: string; n: string };
type WA = {
  stories(cb: (s: Story[]) => void, opts?: { all?: boolean }): void;
  storiesAll(cb: (s: Story[]) => void): void;
  storyBySlug(slug: string, cb: (s: Story | null, all: Story[]) => void): void;
  archive(cb: (rows: Rating[] & { bySlug: Record<string, Rating> }) => void): void;
  ready(cb: (rows: Rating[]) => void): void;
  data(): Rating[] | null;
};
const w = window as unknown as Window & { WA?: WA };

const story = (slug: string, d: string): Story => ({ slug, title: slug, d, sec: "news", tags: [], refs: [], dek: "", by: "Staff" });
const COLS = ["slug", "n", "c", "s", "p", "pr", "d"];
const ratingRow = (slug: string) => [slug, slug.replace(/-/g, " "), "Single Malt Scotch", 90, 60, "House", "2025-01-01"];

let latest: unknown;
// Set to hold /api/wa/latest's answer until the test releases it (a slow route).
let routeGate: Promise<void> | null = null;
function files(url: string): unknown {
  if (url.includes("/api/wa/latest")) return latest;
  if (url.endsWith("stories.json")) return [story("recent-kept", "2026-10-01"), story("recent-gone", "2026-09-01")];
  if (url.endsWith("stories-archive.json")) return [story("archive-kept", "2020-01-01"), story("Archive-Gone", "2019-01-01"), story("live-copy", "2018-01-01")];
  if (url.endsWith("ratings.json")) return { cols: COLS, rows: ["rating-kept", "rating-gone", "Rating-Gone-Too"].map(ratingRow), words: [] };
  if (url.endsWith("data.json")) return [{ slug: "rating-kept", n: "kept" }, { slug: "rating-gone", n: "gone" }];
  throw new Error(`unexpected fetch ${url}`);
}

function run(): WA {
  new Function(SRC)();
  return w.WA!;
}
const call = <T,>(fn: (cb: (v: T) => void) => void) => new Promise<T>(resolve => fn(resolve));

beforeEach(() => {
  latest = { stories: [story("live-copy", "2026-11-02")], removed: ["recent-gone", "archive-gone"], removedRatings: ["rating-gone", "rating-gone-too"], sponsored: [] };
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  routeGate = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/wa/latest") && routeGate) await routeGate;
    const body = files(String(url));
    return { ok: body != null, json: async () => JSON.parse(JSON.stringify(body)) };
  }));
});
// window.WA stays between tests (each run replaces it): site.js leaves animation-frame callbacks that read it.
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("site.js drops what /api/wa/latest says was taken down", () => {
  it("the recent index and the archive both lose removed stories, and the live copy replaces the archive's", async () => {
    const WA = run();
    const recent = await call<Story[]>(cb => WA.stories(cb));
    expect(recent.map(s => s.slug)).toEqual(["live-copy", "recent-kept"]);
    const all = await call<Story[]>(cb => WA.storiesAll(cb));
    expect(all.map(s => s.slug)).toEqual(["live-copy", "recent-kept", "archive-kept"]);
  });

  it("a story lookup does not find a removed archive story (story.html then asks the server, which answers 404)", async () => {
    const WA = run();
    const [found] = await new Promise<[Story | null, Story[]]>(resolve => WA.storyBySlug("archive-gone", (s, all) => resolve([s, all])));
    expect(found).toBeNull();
    const [kept] = await new Promise<[Story | null, Story[]]>(resolve => WA.storyBySlug("archive-kept", (s, all) => resolve([s, all])));
    expect(kept?.slug).toBe("archive-kept");
  });

  it("the ratings archive and data.json lose removed ratings before any page sees them", async () => {
    const WA = run();
    const rows = await call<Rating[] & { bySlug: Record<string, Rating> }>(cb => WA.archive(cb));
    expect(rows.map(r => r.slug)).toEqual(["rating-kept"]);
    expect(rows.bySlug["rating-gone"]).toBeUndefined();
    expect(WA.data()!.map(r => r.slug)).toEqual(["rating-kept"]);
  });

  it("data.json, the recent ratings WA.ready hands a page, loses them too", async () => {
    const WA = run();
    const rows = await new Promise<Rating[]>(resolve => { try { WA.ready(resolve); } catch { /* page effects need a real page */ } });
    expect(rows.map(r => r.slug)).toEqual(["rating-kept"]);
  });

  it("an old answer without removedRatings, or a failed route, keeps everything as before", async () => {
    latest = { stories: [], removed: [], sponsored: [] };
    let WA = run();
    expect((await call<Rating[]>(cb => WA.archive(cb))).map(r => r.slug)).toEqual(["rating-kept", "rating-gone", "Rating-Gone-Too"]);
    latest = null;
    WA = run();
    expect((await call<Rating[]>(cb => WA.archive(cb))).length).toBe(3);
    expect((await call<Story[]>(cb => WA.storiesAll(cb))).map(s => s.slug)).toEqual(["recent-kept", "recent-gone", "archive-kept", "Archive-Gone", "live-copy"]);
  });

  it("a page whose callback takes no ratings starts before the route answers, and DATA drops them when it does", async () => {
    let release!: () => void;
    routeGate = new Promise<void>(resolve => { release = resolve; });
    const WA = run();
    const started = Date.now();
    await new Promise<void>(resolve => WA.ready(function () { resolve(); }));
    expect(Date.now() - started).toBeLessThan(500);
    expect(WA.data()!.map(r => r.slug)).toEqual(["rating-kept", "rating-gone"]);
    release();
    await vi.waitFor(() => expect(WA.data()!.map(r => r.slug)).toEqual(["rating-kept"]));
  });

  it("a page that takes the ratings waits for the route at most a moment, then gets them all", async () => {
    routeGate = new Promise<void>(() => {});
    const WA = run();
    const started = Date.now();
    const rows = await new Promise<Rating[]>(resolve => WA.ready(function (d: Rating[]) { resolve(d); }));
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(1400);
    expect(waited).toBeLessThan(2500);
    expect(rows.map(r => r.slug)).toEqual(["rating-kept", "rating-gone"]);
  });

  it("a list that arrives after the wait still takes the ratings out of DATA and the archive, loaded before or after it", async () => {
    let release!: () => void;
    routeGate = new Promise<void>(resolve => { release = resolve; });
    let WA = run();
    const early = await call<Rating[] & { bySlug: Record<string, Rating> }>(cb => WA.archive(cb));
    expect(early.map(r => r.slug)).toEqual(["rating-kept", "rating-gone", "Rating-Gone-Too"]);
    release();
    await vi.waitFor(() => expect(early.map(r => r.slug)).toEqual(["rating-kept"]));
    expect(early.bySlug["rating-gone"]).toBeUndefined();
    expect(WA.data()!.map(r => r.slug)).toEqual(["rating-kept"]);

    // The archive starts loading only after the late list is in: it is built without them.
    routeGate = new Promise<void>(resolve => { release = resolve; });
    WA = run();
    await new Promise<void>(resolve => WA.ready(function () { resolve(); }));
    await new Promise(resolve => setTimeout(resolve, 1600));
    release();
    await vi.waitFor(() => expect(WA.data()!.map(r => r.slug)).toEqual(["rating-kept"]));
    expect((await call<Rating[]>(cb => WA.archive(cb))).map(r => r.slug)).toEqual(["rating-kept"]);
  }, 15000);
});
