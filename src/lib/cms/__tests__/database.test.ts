import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CmsDocument, CmsIngestInput, CmsIngestResult, CmsPrintIngestResult } from "../types";

let db: PGlite;

function source(input: Omit<CmsIngestInput, "source_hash">): CmsIngestInput {
  return { ...input, source_hash: createHash("sha256").update(JSON.stringify(input)).digest("hex") };
}

function morweb(key = "Posts:100", overrides: Partial<Omit<CmsIngestInput, "source_hash">> = {}) {
  return source({
    brand: "wa", kind: "article", source_system: "morweb", source_key: key,
    title: "Imported article", body_html: "<p>Original article.</p>",
    publication_state: "published", published_at: "2025-06-01T14:00:00Z",
    metadata: { categories: ["News"], migration: { original_date: "2025-06-01 10:00:00" } },
    source_payload: { id: key, content: "<p>Original article.</p>" },
    ...overrides,
  });
}

function printed(issue: string, folio = 12, overrides: Partial<Omit<CmsIngestInput, "source_hash">> = {}) {
  return source({
    brand: "wa", kind: "article", source_system: "print",
    source_key: `issue:${issue}:folio:${folio}`, issue_uuid: issue,
    identity_anchor: { issue_uuid: issue, anchor_type: "printed_folio", start_page: folio },
    title: "Extracted title", body_html: "<p>Extracted copy.</p>",
    publication_state: "published", // The database must force new print intake into review.
    metadata: { warnings: ["Check image association"], media: [{ s3_key: "sample/photo.jpg" }] },
    source_payload: { pdf_sha256: "a".repeat(64), pages: [folio, folio + 1] },
    ...overrides,
  });
}

async function issue(status = "processing", brand = "wa") {
  const id = randomUUID();
  await db.query("INSERT INTO public.issues(id,brand,issue_id,issue_label,pdf_key,status,stats) VALUES($1,$2,$3,'Test issue','test.pdf',$4::issue_status,'{\"extracted_pages\":20}')", [id, brand, id, status]);
  return id;
}

async function ingest(input: CmsIngestInput) {
  const result = await db.query<{ result: CmsIngestResult }>(
    "SELECT public.cms_ingest_document($1::jsonb, 'test-importer') AS result", [JSON.stringify(input)],
  );
  return result.rows[0].result;
}

async function ingestIssue(id: string, inputs: CmsIngestInput[], token: string | null = null) {
  const result = await db.query<{ result: CmsPrintIngestResult }>(
    "SELECT public.cms_ingest_print_issue($1::uuid,$2::jsonb,'test-worker',$3::uuid) AS result", [id, JSON.stringify(inputs), token],
  );
  return result.rows[0].result;
}

async function save(id: string, revision: number, patch: object) {
  const result = await db.query<{ result: CmsDocument }>(
    "SELECT public.cms_save_document($1::uuid,$2::integer,$3::jsonb,'editor@example.test') AS result",
    [id, revision, JSON.stringify(patch)],
  );
  return result.rows[0].result;
}

async function count(table: string) {
  // table names below are static test-owned identifiers, never request input.
  return (await db.query<{ n: number }>(`SELECT count(*)::integer AS n FROM public.${table}`)).rows[0].n;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;");
  const migrationDir = path.resolve(process.cwd(), "supabase/migrations");
  for (const file of readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(migrationDir, file), "utf8"));
  }
  // Supabase service_role already has table grants on the existing RSS schema;
  // this fresh local PostgreSQL instance has no platform default privileges.
  await db.exec("GRANT SELECT, INSERT, UPDATE ON public.issues, public.articles, public.article_images TO service_role;");
}, 60_000);

beforeEach(async () => {
  await db.exec("RESET ROLE; TRUNCATE public.cms_document_revisions, public.cms_source_snapshots, public.cms_documents, public.article_images, public.articles, public.issues;");
  await db.exec("SET ROLE service_role;");
});

afterAll(async () => { await db?.close(); });

describe("CMS PostgreSQL transactions", () => {
  it("admits one issue queue request and rejects overlapping dispatches", async () => {
    const queue = () => db.query<{ result: { id: string; status: string; cms_intake_token: string } }>(
      "SELECT public.cms_queue_issue('wa','2026-11','November 2026','pdfs/inbox/wa-2026-11.pdf',ARRAY[3,4]) AS result",
    );
    const outcomes = await Promise.allSettled([queue(), queue()]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await count("issues")).toBe(1);
    const row = (await db.query<{ id: string; cms_intake_token: string; status: string }>("SELECT id,cms_intake_token,status FROM public.issues")).rows[0];
    expect(row.status).toBe("queued");
    expect(row.cms_intake_token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("requires the current queue lease when a delayed worker finishes after a retry", async () => {
    const queue = async () => (await db.query<{ result: { id: string; cms_intake_token: string } }>(
      "SELECT public.cms_queue_issue('wa','2026-11','November 2026','pdfs/inbox/wa-2026-11.pdf',ARRAY[3,4]) AS result",
    )).rows[0].result;
    const first = await queue();
    await db.query("UPDATE public.issues SET status='failed' WHERE id=$1", [first.id]);
    const retry = await queue();
    expect(retry.id).toBe(first.id);
    expect(retry.cms_intake_token).not.toBe(first.cms_intake_token);
    await expect(ingestIssue(first.id, [printed(first.id)], first.cms_intake_token)).rejects.toThrow("intake_conflict");
    await expect(ingestIssue(first.id, [printed(first.id)])).rejects.toThrow("intake_conflict");
    expect(await count("cms_documents")).toBe(0);
    await ingestIssue(retry.id, [printed(retry.id)], retry.cms_intake_token);
    expect(await count("cms_documents")).toBe(1);
  });

  it("will not replace a published legacy issue or admit invalid queue input", async () => {
    await db.query("INSERT INTO public.issues(brand,issue_id,issue_label,pdf_key,status) VALUES('wa','2026-11','Existing','original.pdf','published')");
    await expect(db.exec("SELECT public.cms_queue_issue('wa','2026-11','Changed','pdfs/inbox/new.pdf',ARRAY[3,4])")).rejects.toThrow("already active or published");
    await expect(db.exec("SELECT public.cms_queue_issue('wa','2026-12','New','pdfs/inbox/../secrets',ARRAY[3,4])")).rejects.toThrow("Invalid print issue");
    await expect(db.exec("SELECT public.cms_queue_issue('wa','2026-12','New','pdfs/inbox/new.pdf',ARRAY[0])")).rejects.toThrow("Invalid table-of-contents");
    expect(await count("issues")).toBe(1);
    expect((await db.query<{ pdf_key: string }>("SELECT pdf_key FROM public.issues")).rows[0].pdf_key).toBe("original.pdf");
  });

  it("ingests a complete print issue into review without changing the legacy RSS records", async () => {
    const id = await issue();
    const result = await ingestIssue(id, [printed(id, 12), printed(id, 20)]);
    expect(result.documents).toHaveLength(2);
    expect(result.documents.every((item) => item.action === "created")).toBe(true);
    const docs = await db.query<CmsDocument>("SELECT * FROM public.cms_documents");
    expect(docs.rows.every((doc) => doc.publication_state === "review" && doc.published_at === null)).toBe(true);
    const state = (await db.query<{ status: string; stats: Record<string, unknown> }>("SELECT status, stats FROM public.issues WHERE id=$1", [id])).rows[0];
    expect(state).toEqual({ status: "review", stats: { extracted_pages: 20, cms_document_count: 2, review_required: true, warning_count: 2 } });
    expect(await count("articles")).toBe(0);
    expect(await count("cms_document_revisions")).toBe(2);
  });

  it("keeps edited copy, selected media and workflow state when source content changes", async () => {
    const id = await issue();
    const original = printed(id);
    const created = await ingest(original);
    const saved = await save(created.document_id, 1, {
      title: "An editor's headline", body_html: "<p>Carefully edited copy.</p>",
      publication_state: "draft", metadata: { media: [{ s3_key: "editor/lead.jpg" }], seo: { title: "SEO title" } },
    });
    expect(saved.revision).toBe(2);
    expect(saved.metadata.warnings).toEqual(["Check image association"]);
    const candidate = printed(id, 12, { title: "A new extracted title", body_html: "<p>New extraction.</p>" });
    const result = await ingest(candidate);
    expect(result).toMatchObject({ document_id: created.document_id, action: "candidate", revision: 2 });
    expect((await db.query<{ doc: CmsDocument }>("SELECT to_jsonb(d) AS doc FROM public.cms_documents d WHERE id=$1", [created.document_id])).rows[0].doc).toEqual(saved);
    expect((await ingest(candidate)).action).toBe("unchanged");
    expect((await ingest(original)).action).toBe("unchanged");
    expect(await count("cms_source_snapshots")).toBe(2);
    expect(await count("cms_document_revisions")).toBe(2);
  });

  it("preserves stable identities when titles or issue ordering change", async () => {
    const id = await issue();
    const first = await ingestIssue(id, [printed(id, 12), printed(id, 20)]);
    const second = await ingestIssue(id, [printed(id, 20, { title: "Renamed" }), printed(id, 12)]);
    expect(second.documents.map((doc) => doc.document_id).sort()).toEqual(first.documents.map((doc) => doc.document_id).sort());
    expect(await count("cms_documents")).toBe(2);
  });

  it("rolls back every document and the issue state when a batch contains an invalid document", async () => {
    const id = await issue();
    const bad = printed(id, 20, { title: "" });
    await expect(ingestIssue(id, [printed(id, 12), bad])).rejects.toThrow();
    expect(await count("cms_documents")).toBe(0);
    expect(await count("cms_source_snapshots")).toBe(0);
    expect((await db.query<{ status: string }>("SELECT status FROM public.issues WHERE id=$1", [id])).rows[0].status).toBe("processing");
  });

  it("rejects competing saves against the same revision without losing the winning edit", async () => {
    const created = await ingest(morweb());
    const outcomes = await Promise.allSettled([
      save(created.document_id, 1, { title: "First editor" }),
      save(created.document_id, 1, { title: "Second editor" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain("revision_conflict");
    const row = (await db.query<CmsDocument>("SELECT * FROM public.cms_documents WHERE id=$1", [created.document_id])).rows[0];
    expect(row.revision).toBe(2);
    expect(["First editor", "Second editor"]).toContain(row.title);
    expect(await count("cms_document_revisions")).toBe(2);
  });

  it("retains historical publication state and explicit timestamp without publishing print drafts", async () => {
    const created = await ingest(morweb());
    const row = (await db.query<{ doc: CmsDocument }>("SELECT to_jsonb(d) doc FROM public.cms_documents d WHERE id=$1", [created.document_id])).rows[0].doc;
    expect(row.publication_state).toBe("published");
    expect(new Date(row.published_at!).toISOString()).toBe("2025-06-01T14:00:00.000Z");
    expect((await save(created.document_id, 1, { title: "Corrected historical headline", publication_state: "published" })).publication_state).toBe("published");
    const print = await ingest(printed(await issue()));
    await expect(save(print.document_id, 1, { publication_state: "published" })).rejects.toThrow("Publishing is not enabled");
  });

  it("holds URL collisions without replacing either content or historical records", async () => {
    const url = "https://whiskyadvocate.com/An-Existing-Path";
    await ingest(morweb("Posts:100", { public_url: url }));
    await expect(ingest(morweb("Posts:101", { public_url: url }))).rejects.toThrow("cms_documents_public_url_unique");
    expect(await count("cms_documents")).toBe(1);
    expect(await count("cms_source_snapshots")).toBe(1);
    // URL path case is preserved; no blanket lowercasing is applied by SQL.
    await ingest(morweb("Posts:102", { public_url: "https://whiskyadvocate.com/an-existing-path" }));
    expect(await count("cms_documents")).toBe(2);
  });

  it("holds a Morweb content-type remap instead of duplicating the same source record", async () => {
    await ingest(morweb("Posts:123"));
    await expect(ingest(morweb("Posts:123", { kind: "page" }))).rejects.toThrow("cms_documents_morweb_source_unique");
    expect(await count("cms_documents")).toBe(1);
    expect(await count("cms_source_snapshots")).toBe(1);
    // A Page and a Post may share their numeric legacy ID without sharing identity.
    await ingest(morweb("Pages:123", { kind: "page" }));
    expect(await count("cms_documents")).toBe(2);
  });

  it("rejects reused hashes with different payloads and changed identity anchors", async () => {
    const id = await issue();
    const original = printed(id);
    await ingest(original);
    await expect(ingest({ ...original, body_html: "<p>Different content, same claimed hash.</p>" })).rejects.toThrow("source_hash_collision");
    const changed = printed(id, 12, { identity_anchor: { issue_uuid: id, anchor_type: "pdf_page", start_page: 14 } });
    await expect(ingest(changed)).rejects.toThrow("Source identity anchor changed");
    expect(await count("cms_source_snapshots")).toBe(1);
  });

  it("refuses empty/ambiguous print batches, cross-brand issues and published legacy reprocessing", async () => {
    const id = await issue();
    await expect(ingestIssue(id, [])).rejects.toThrow("between 1 and 1000");
    await expect(ingestIssue(id, [printed(id), printed(id)])).rejects.toThrow("Duplicate source identity");
    await expect(ingestIssue(id, [printed(id, 12, { brand: "ws" })])).rejects.toThrow("does not match");
    const publishedId = await issue("published");
    await expect(ingestIssue(publishedId, [printed(publishedId)])).rejects.toThrow("Published legacy issue");
    expect(await count("cms_documents")).toBe(0);
  });

  it("prevents an editor save from changing source identity", async () => {
    const created = await ingest(morweb());
    await expect(save(created.document_id, 1, { source_key: "Posts:999" })).rejects.toThrow("not editable");
    expect(await count("cms_document_revisions")).toBe(1);
  });

  it("keeps source and revision history append-only, including for table owners", async () => {
    await ingest(morweb());
    await expect(db.exec("UPDATE public.cms_source_snapshots SET actor='changed'")).rejects.toThrow("permission denied");
    await db.exec("RESET ROLE");
    await expect(db.exec("UPDATE public.cms_source_snapshots SET actor='changed'")).rejects.toThrow("append-only");
    await expect(db.exec("DELETE FROM public.cms_document_revisions")).rejects.toThrow("append-only");
  });

  it("denies anonymous and ordinary authenticated users direct table and RPC access", async () => {
    await ingest(morweb());
    await db.exec("RESET ROLE");
    const protectedTables = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname IN ('cms_documents','cms_source_snapshots','cms_document_revisions')");
    expect(protectedTables.rows).toHaveLength(3);
    expect(protectedTables.rows.every((row) => row.relrowsecurity)).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.exec("SELECT * FROM public.cms_documents")).rejects.toThrow("permission denied");
      await expect(db.exec("SELECT public.cms_ingest_document('{}'::jsonb,'attacker')")).rejects.toThrow("permission denied");
      await db.exec("RESET ROLE");
    }
  });
});
