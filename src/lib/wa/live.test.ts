import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isLive, liveFilter, liveIds, onlyLive, onlyLiveJoined } from "./live";
import { fakeDb, future, past } from "./__tests__/fake-db";

const NOW = Date.parse("2026-11-03T15:00:00.000Z");

describe("isLive", () => {
  it("treats a published document with no time as live (the imported stories)", () => {
    expect(isLive({ publication_state: "published", published_at: null }, NOW)).toBe(true);
    expect(isLive({ publication_state: "published" }, NOW)).toBe(true);
  });
  it("is live once the time has passed, and exactly at it", () => {
    expect(isLive({ publication_state: "published", published_at: "2026-11-03T14:59:59.999Z" }, NOW)).toBe(true);
    expect(isLive({ publication_state: "published", published_at: "2026-11-03T15:00:00.000Z" }, NOW)).toBe(true);
    expect(isLive({ publication_state: "published", published_at: "2026-11-03T10:00:00-05:00" }, NOW)).toBe(true);
  });
  it("keeps a scheduled document out until its time", () => {
    expect(isLive({ publication_state: "published", published_at: "2026-11-03T15:00:00.001Z" }, NOW)).toBe(false);
    expect(isLive({ publication_state: "published", published_at: "2026-12-01T00:00:00Z" }, new Date(NOW))).toBe(false);
  });
  it("is never live unless published", () => {
    for (const state of ["draft", "review", "unpublished", null, undefined]) expect(isLive({ publication_state: state, published_at: null }, NOW)).toBe(false);
    expect(isLive(null, NOW)).toBe(false);
    expect(isLive(undefined, NOW)).toBe(false);
  });
  it("refuses a time it cannot read", () => {
    expect(isLive({ publication_state: "published", published_at: "not a date" }, NOW)).toBe(false);
  });
  it("defaults to the current time", () => {
    expect(isLive({ publication_state: "published", published_at: past() })).toBe(true);
    expect(isLive({ publication_state: "published", published_at: future() })).toBe(false);
  });
});

describe("query helpers", () => {
  const builder = () => {
    const q = { eq: vi.fn(), or: vi.fn() };
    q.eq.mockReturnValue(q); q.or.mockReturnValue(q);
    return q;
  };

  it("writes the PostgREST filter for empty or past published_at", () => {
    expect(liveFilter(NOW)).toBe("published_at.is.null,published_at.lte.2026-11-03T15:00:00.000Z");
  });
  it("onlyLive adds the state and the time to a cms_documents query and returns the same builder", () => {
    const q = builder();
    expect(onlyLive(q, NOW)).toBe(q);
    expect(q.eq).toHaveBeenCalledWith("publication_state", "published");
    expect(q.or).toHaveBeenCalledWith("published_at.is.null,published_at.lte.2026-11-03T15:00:00.000Z");
  });
  it("onlyLiveJoined filters the embedded relation", () => {
    const q = builder();
    expect(onlyLiveJoined(q, "cms_documents", NOW)).toBe(q);
    expect(q.eq).toHaveBeenCalledWith("cms_documents.publication_state", "published");
    expect(q.or).toHaveBeenCalledWith("published_at.is.null,published_at.lte.2026-11-03T15:00:00.000Z", { referencedTable: "cms_documents" });
  });
  it("onlyLive keeps live rows and drops scheduled and unpublished ones", async () => {
    const db = fakeDb({ cms_documents: [
      { id: "old", publication_state: "published", published_at: null },
      { id: "out", publication_state: "published", published_at: past() },
      { id: "soon", publication_state: "published", published_at: future() },
      { id: "down", publication_state: "unpublished", published_at: past() },
    ] });
    const { data } = await onlyLive(db.from("cms_documents").select("id"));
    expect((data as { id: string }[]).map(r => r.id)).toEqual(["old", "out"]);
  });
  it("onlyLiveJoined drops parents whose document is not live", async () => {
    const db = fakeDb({ cms_ratings: [
      { product_name: "A", cms_documents: { slug: "a", publication_state: "published", published_at: null } },
      { product_name: "B", cms_documents: { slug: "b", publication_state: "published", published_at: future() } },
      { product_name: "C", cms_documents: { slug: "c", publication_state: "draft", published_at: null } },
    ] });
    const { data } = await onlyLiveJoined(db.from("cms_ratings").select("product_name,cms_documents!inner(slug)"));
    expect((data as { product_name: string }[]).map(r => r.product_name)).toEqual(["A"]);
  });
});

describe("liveIds", () => {
  it("returns only the live ids, a hundred per query", async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: `d${i}`, publication_state: "published", published_at: i % 3 === 0 ? future() : i % 3 === 1 ? past() : null }));
    const db = fakeDb({ cms_documents: rows });
    const live = await liveIds(db as unknown as SupabaseClient, [...rows.map(r => r.id), "d1", "missing"]);
    expect(live.size).toBe(100);
    expect(live.has("d0")).toBe(false);
    expect(live.has("d1")).toBe(true);
    expect(live.has("missing")).toBe(false);
    expect(db.fromCalls).toHaveLength(2);
  });
  it("asks nothing for no ids", async () => {
    const db = fakeDb({});
    expect((await liveIds(db as unknown as SupabaseClient, [])).size).toBe(0);
    expect(db.fromCalls).toHaveLength(0);
  });
});
