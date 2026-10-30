import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsDocument, CmsMigrationSource } from "../types";

const mocks = vi.hoisted(() => ({ requireCmsUser: vi.fn(), cmsDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../auth-server", () => ({ requireCmsUser: mocks.requireCmsUser }));
vi.mock("../db", async original => ({ ...(await original<typeof import("../db")>()), cmsDb: mocks.cmsDb }));

import { CmsError } from "../access";
import { CMS_DOCUMENT_KINDS, CMS_MIGRATION_SOURCE_KINDS, CMS_PUBLICATION_STATES } from "../types";
import { GET as readInventory } from "@/app/api/cms/migration/inventory/route";
import { GET as readSources } from "@/app/api/cms/documents/[id]/migration-sources/route";

const documentId = "c400788c-3282-4077-a993-4f31b8251111";
const sourceId = "d400788c-3282-4077-a993-4f31b8251111";
const editor = { id: "verified-editor", email: "editor@example.test", role: "editor", brands: ["wa"] };
const request = (path: string) => new Request(`https://cms.example${path}`);
const context = () => ({ params: Promise.resolve({ id: documentId }) });
const sourceRoute = (query = "") => request(`/api/cms/documents/${documentId}/migration-sources${query}`);
const zeroMap = (keys: readonly string[]) => Object.fromEntries(keys.map(key => [key, 0]));

let document: CmsDocument | null;
let source: CmsMigrationSource;
let inventory: Record<string, unknown>;
let queries: Array<{ table: string; methods: Record<string, ReturnType<typeof vi.fn>> }>;
let rpc: ReturnType<typeof vi.fn>;
let sourceError: null | { code: string; message?: string };

beforeEach(() => {
  vi.resetAllMocks();
  document = {
    id: documentId, brand: "wa", kind: "page", source_system: "morweb", source_key: "Pages:12", source_hash: "a".repeat(64), identity_anchor: {},
    title: "Synthetic page metadata", body_html: "", byline: "", excerpt: "", slug: "synthetic-page", public_url: "https://example.test/synthetic-page",
    publication_state: "review", published_at: null, issue_uuid: null,
    metadata: { review: { required: true, reasons: ["page_body_assembly_required"] } }, revision: 1,
    created_at: "2026-10-30T12:00:00Z", updated_at: "2026-10-30T12:00:00Z",
  };
  source = {
    id: sourceId, brand: "wa", archive_sha256: "b".repeat(64), source_kind: "page_context", source_key: "Pages:12:context:synthetic",
    payload_sha256: "c".repeat(64), source_sha256: null, captured_at: null, actor: "archive-importer", created_at: "2026-10-30T12:00:00Z",
    payload: { html: '<script>alert("synthetic")</script><img src=x onerror="synthetic()">', text: "A&B\u2028C\u2029D" },
  };
  inventory = {
    brand: "wa",
    documents: { total: 2, by_kind: { ...zeroMap(CMS_DOCUMENT_KINDS), page: 1, article: 1 }, by_publication_state: { ...zeroMap(CMS_PUBLICATION_STATES), review: 1, published: 1 }, by_source_system: { morweb: 2, print: 0, manual: 0, web_archive: 0 }, review_required: 1, pages_awaiting_assembly: 1 },
    sources: { total: 5, archive_count: 1, by_source_kind: { ...zeroMap(CMS_MIGRATION_SOURCE_KINDS), page_context: 2, post_version: 3 } },
  };
  sourceError = null;
  queries = [];
  rpc = vi.fn(async () => ({ data: inventory, error: null }));
  const from = vi.fn((table: string) => {
    const methods: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "in", "like", "order"]) methods[method] = vi.fn(() => methods);
    methods.maybeSingle = vi.fn(async () => ({ data: table === "cms_documents" ? document : source, error: table === "cms_migration_sources" ? sourceError : null }));
    methods.range = vi.fn(async () => ({ data: [source], error: sourceError, count: 1 }));
    queries.push({ table, methods });
    return methods;
  });
  mocks.cmsDb.mockReturnValue({ from, rpc });
  mocks.requireCmsUser.mockResolvedValue(editor);
});

describe("migration inventory is authenticated and aggregate-only", () => {
  it("rejects unsigned inventory, source-list, and raw-source reads before privileged work", async () => {
    mocks.requireCmsUser.mockRejectedValue(new CmsError(401, "Sign in", "sign_in_required"));
    const responses = await Promise.all([
      readInventory(request("/api/cms/migration/inventory?brand=wa")),
      readSources(sourceRoute(), context()),
      readSources(sourceRoute(`?source_id=${sourceId}`), context()),
    ]);
    expect(responses.every(response => response.status === 401)).toBe(true);
    expect(mocks.cmsDb).not.toHaveBeenCalled();
  });

  it("requires an allowed explicit publication before invoking the service RPC", async () => {
    expect((await readInventory(request("/api/cms/migration/inventory?brand=ws"))).status).toBe(403);
    expect((await readInventory(request("/api/cms/migration/inventory"))).status).toBe(422);
    expect(mocks.cmsDb).not.toHaveBeenCalled();
  });

  it("keeps document counts, unfinished page assembly, and auxiliary evidence separate", async () => {
    inventory.payload = { hidden: "unexpected captured raw data" };
    const response = await readInventory(request("/api/cms/migration/inventory?brand=wa"));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("cms_migration_inventory", { p_brand: "wa" });
    expect(queries).toHaveLength(0);
    const body = await response.json();
    expect(body.inventory.documents).toMatchObject({ total: 2, pages_awaiting_assembly: 1 });
    expect(body.inventory.sources).toMatchObject({ total: 5, archive_count: 1 });
    expect(body.inventory).not.toHaveProperty("payload");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });

  it("reports an unapplied schema without leaking database details", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private database details" } });
    const response = await readInventory(request("/api/cms/migration/inventory?brand=wa"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database details");
  });

  it("rejects a mismatched publication or invalid count response", async () => {
    inventory.brand = "ws";
    expect((await readInventory(request("/api/cms/migration/inventory?brand=wa"))).status).toBe(500);
    inventory.brand = "wa";
    (inventory.documents as Record<string, unknown>).total = -1;
    expect((await readInventory(request("/api/cms/migration/inventory?brand=wa"))).status).toBe(500);
  });
});

describe("document migration sources require exact publication and legacy linkage", () => {
  it("lists only summaries with scoped, stable server-side pagination", async () => {
    const response = await readSources(sourceRoute("?page=2"), context());
    expect(response.status).toBe(200);
    expect(queries[0].table).toBe("cms_documents");
    expect(queries[0].methods.eq).toHaveBeenCalledWith("id", documentId);
    expect(queries[0].methods.in).toHaveBeenCalledWith("brand", ["wa"]);
    const query = queries[1];
    expect(query.table).toBe("cms_migration_sources");
    expect(query.methods.eq).toHaveBeenCalledWith("brand", "wa");
    expect(query.methods.like).toHaveBeenCalledWith("source_key", "Pages:12:%");
    expect(query.methods.in).toHaveBeenCalledWith("source_kind", ["page_version", "page_context", "page_editor_capture", "rendered_page_snapshot", "source_part"]);
    expect(query.methods.select.mock.calls[0][0].split(",")).not.toContain("payload");
    expect(query.methods.range).toHaveBeenCalledWith(50, 99);
    expect(query.methods.order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(query.methods.order).toHaveBeenNthCalledWith(2, "id", { ascending: true });
    const body = await response.json();
    expect(body).toMatchObject({ document_id: documentId, source_identity: "Pages:12", total: 1, page: 2, pageSize: 50 });
    expect(body.sources[0]).not.toHaveProperty("payload");
    expect(body.sources[0]).not.toHaveProperty("payload_json");
    expect(JSON.stringify(body)).not.toContain("onerror");
  });

  it("does not query sources when the scoped document does not exist", async () => {
    document = null;
    expect((await readSources(sourceRoute(), context())).status).toBe(404);
    expect(queries.map(query => query.table)).toEqual(["cms_documents"]);
  });

  it.each([
    { brand: "ws", source_key: "Pages:12:context:synthetic", source_kind: "page_context" },
    { brand: "wa", source_key: "Pages:120:context:synthetic", source_kind: "page_context" },
    { brand: "wa", source_key: "Posts:12:version:synthetic", source_kind: "post_version" },
    { brand: "wa", source_key: "Pages:12:category:synthetic", source_kind: "category" },
  ])("rejects a raw source with mismatched brand/identity/type: %j", async mismatch => {
    source = { ...source, ...mismatch } as CmsMigrationSource;
    const response = await readSources(sourceRoute(`?source_id=${sourceId}`), context());
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("onerror");
  });

  it("returns escaped JSON only for an explicitly requested linked source UUID", async () => {
    const response = await readSources(sourceRoute(`?source_id=${sourceId}`), context());
    expect(response.status).toBe(200);
    const query = queries[1];
    expect(query.methods.eq).toHaveBeenCalledWith("id", sourceId);
    expect(query.methods.eq).toHaveBeenCalledWith("brand", "wa");
    expect(query.methods.like).toHaveBeenCalledWith("source_key", "Pages:12:%");
    const body = await response.json();
    expect(body).toMatchObject({ source_identity: "Pages:12", payload_format: "escaped-json", read_only: true });
    expect(body.source).not.toHaveProperty("payload");
    expect(body.payload_json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(body.payload_json).toContain("\\u003cscript");
    expect(JSON.parse(body.payload_json)).toEqual(source.payload);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each(["manual", "print", "web_archive"] as const)("does not attach Morweb evidence to a %s source", async system => {
    document!.source_system = system;
    expect((await readSources(sourceRoute(), context())).status).toBe(200);
    expect(queries.map(query => query.table)).toEqual(["cms_documents"]);
    expect((await readSources(sourceRoute(`?source_id=${sourceId}`), context())).status).toBe(404);
    expect(queries.every(query => query.table === "cms_documents")).toBe(true);
  });

  it("never converts an unexpected source key into a wildcard query", async () => {
    document!.source_key = "Pages:12:%";
    const response = await readSources(sourceRoute(), context());
    expect(await response.json()).toMatchObject({ source_identity: null, sources: [], total: 0 });
    expect(queries.every(query => query.table === "cms_documents")).toBe(true);
  });

  it("rejects invalid pagination or UUIDs before source queries", async () => {
    expect((await readSources(sourceRoute("?page=-1"), context())).status).toBe(422);
    expect((await readSources(sourceRoute("?page=NaN"), context())).status).toBe(422);
    expect((await readSources(sourceRoute("?source_id=invalid"), context())).status).toBe(404);
    expect(mocks.cmsDb).not.toHaveBeenCalled();
  });
});
