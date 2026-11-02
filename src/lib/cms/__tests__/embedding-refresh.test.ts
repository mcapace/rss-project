import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { CmsJsonObject } from "@/lib/cms/types";
import { documentContentHash, EMBEDDING_MODEL, mediaEmbeddingText, refreshDocumentEmbeddings } from "@/lib/editorial/server/embeddings";

type Row = { kind: string; media_index: number | null; content_hash: string; model: string };

function fakeDb(stored: Row[]) {
  const upserts: { kind: string; index: number | null }[] = [];
  const deleted: number[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: stored, error: null }) }),
      delete: () => ({ eq: () => ({ eq: () => ({ in: async (_c: string, values: number[]) => { deleted.push(...values); return { error: null }; } }) }) }),
    }),
    rpc: async (_name: string, args: { p_kind: string; p_media_index: number | null }) => { upserts.push({ kind: args.p_kind, index: args.p_media_index }); return { error: null }; },
  };
  return { db: db as never, upserts, deleted };
}

const doc = {
  id: "00000000-0000-0000-0000-000000000001", title: "Islay at dusk", excerpt: "Peat and sea air.", body_html: "<p>Smoke.</p>",
  metadata: { media: [{ caption: "A bottle on the bar" }, { caption: "Warehouse" }, { src: "no-text.jpg" }] as CmsJsonObject[] },
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("refreshDocumentEmbeddings", () => {
  let calls: number;
  beforeEach(() => {
    calls = 0;
    process.env.VOYAGE_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      calls += 1;
      const { input } = JSON.parse(init.body) as { input: string[] };
      return new Response(JSON.stringify({ data: input.map((_t, index) => ({ index, embedding: [0.1, 0.2] })) }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.VOYAGE_API_KEY; });

  it("embeds the text and every described image in one request when nothing is stored", async () => {
    const { db, upserts } = fakeDb([]);
    const result = await refreshDocumentEmbeddings(db, doc);
    expect(result).toEqual({ document: true, images: 2, removed: 0 });
    expect(calls).toBe(1);
    expect(upserts).toEqual([{ kind: "document", index: null }, { kind: "media", index: 0 }, { kind: "media", index: 1 }]);
  });

  it("embeds only what changed and drops vectors for images that are gone", async () => {
    const stored: Row[] = [
      { kind: "document", media_index: null, content_hash: documentContentHash(doc), model: EMBEDDING_MODEL },
      { kind: "media", media_index: 0, content_hash: hash(mediaEmbeddingText(doc.metadata.media[0])), model: EMBEDDING_MODEL },
      { kind: "media", media_index: 1, content_hash: "old", model: EMBEDDING_MODEL },
      { kind: "media", media_index: 2, content_hash: "old", model: EMBEDDING_MODEL },
      { kind: "media", media_index: 5, content_hash: "old", model: EMBEDDING_MODEL },
    ];
    const { db, upserts, deleted } = fakeDb(stored);
    const result = await refreshDocumentEmbeddings(db, doc);
    expect(upserts).toEqual([{ kind: "media", index: 1 }]);
    expect(deleted.sort()).toEqual([2, 5]);
    expect(result).toEqual({ document: false, images: 1, removed: 2 });
  });

  it("makes no provider call when everything is current", async () => {
    const stored: Row[] = [
      { kind: "document", media_index: null, content_hash: documentContentHash(doc), model: EMBEDDING_MODEL },
      ...doc.metadata.media.slice(0, 2).map((item, index) => ({ kind: "media", media_index: index, content_hash: hash(mediaEmbeddingText(item)), model: EMBEDDING_MODEL })),
    ];
    const { db, upserts } = fakeDb(stored);
    expect(await refreshDocumentEmbeddings(db, doc)).toEqual({ document: false, images: 0, removed: 0 });
    expect(calls).toBe(0);
    expect(upserts).toEqual([]);
  });

  it("does nothing without a key", async () => {
    delete process.env.VOYAGE_API_KEY;
    const { db, upserts } = fakeDb([]);
    expect(await refreshDocumentEmbeddings(db, doc)).toEqual({ document: false, images: 0, removed: 0 });
    expect(upserts).toEqual([]);
  });
});
