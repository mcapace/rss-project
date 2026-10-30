import { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CMS_DOCUMENT_KINDS, CMS_MIGRATION_SOURCE_KINDS, type CmsDocument, type CmsDocumentKind, type CmsIngestInput, type CmsIngestResult, type CmsJson, type CmsMigrationInventory, type CmsMigrationSourceInput, type CmsMigrationSourceResult, type CmsPrintIngestResult } from "../types";

let db: PGlite;
let inheritedHistoryPrivileges: Array<{ table_name: string; can_update: boolean; can_delete: boolean; can_truncate: boolean }>;
let preRetentionUpgrade: unknown;
let postRetentionUpgrade: unknown;
let postAuxiliaryUpgrade: unknown;

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

function auxiliary(key = "Posts:source-version", overrides: Partial<CmsMigrationSourceInput> = {}): CmsMigrationSourceInput {
  const payload = overrides.payload ?? { id: key, content: "<script>preserved as inert source text</script>" };
  return { brand: "wa", archive_sha256: "a".repeat(64), source_kind: "post_version", source_key: key,
    payload_sha256: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), payload, captured_at: null, ...overrides };
}

async function ingestAuxiliary(input: CmsMigrationSourceInput) {
  return (await db.query<{ result: CmsMigrationSourceResult }>(
    "SELECT public.cms_ingest_migration_source($1::jsonb,'test-archiver') AS result", [JSON.stringify(input)],
  )).rows[0].result;
}

async function count(table: string) {
  // table names below are static test-owned identifiers, never request input.
  return (await db.query<{ n: number }>(`SELECT count(*)::integer AS n FROM public.${table}`)).rows[0].n;
}

async function storedImport(id: string) {
  return (await db.query<{ records: unknown }>(
    "SELECT jsonb_build_object('document',(SELECT to_jsonb(d) FROM public.cms_documents d WHERE id=$1),'sources',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.cms_source_snapshots s WHERE document_id=$1),'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY revision) FROM public.cms_document_revisions r WHERE document_id=$1)) AS records", [id],
  )).rows[0].records;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;");
  // Supabase grants service_role ALL on newly created public tables by default.
  // A narrower GRANT alone cannot remove those inherited privileges.
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;");
  const migrationDir = path.resolve(process.cwd(), "supabase/migrations");
  let preservedImportId: string | undefined;
  for (const file of readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
    let upgradeDocumentId: string | undefined;
    if (file.endsWith("_cms_retained_content_types.sql")) {
      const imported = await ingest(morweb("Posts:pre-retention-upgrade"));
      await save(imported.document_id, 1, { title: "Existing editor's headline", metadata: { seo: { title: "Existing SEO" } } });
      await ingest(morweb("Posts:pre-retention-upgrade", { body_html: "<p>Previously captured source candidate.</p>" }));
      upgradeDocumentId = imported.document_id;
      preservedImportId = imported.document_id;
      preRetentionUpgrade = await storedImport(upgradeDocumentId);
    }
    await db.exec(readFileSync(path.join(migrationDir, file), "utf8"));
    if (upgradeDocumentId) postRetentionUpgrade = await storedImport(upgradeDocumentId);
    if (file.endsWith("_cms_migration_sources.sql") && preservedImportId) postAuxiliaryUpgrade = await storedImport(preservedImportId);
    if (file.endsWith("_cms_foundation.sql")) {
      inheritedHistoryPrivileges = (await db.query<{ table_name: string; can_update: boolean; can_delete: boolean; can_truncate: boolean }>(
        "SELECT relname AS table_name, has_table_privilege('service_role',oid,'UPDATE') AS can_update, has_table_privilege('service_role',oid,'DELETE') AS can_delete, has_table_privilege('service_role',oid,'TRUNCATE') AS can_truncate FROM pg_class WHERE oid IN ('public.cms_source_snapshots'::regclass,'public.cms_document_revisions'::regclass) ORDER BY relname",
      )).rows;
    }
  }
}, 60_000);

beforeEach(async () => {
  await db.exec("RESET ROLE; TRUNCATE public.cms_migration_sources, public.cms_document_revisions, public.cms_source_snapshots, public.cms_documents, public.article_images, public.articles, public.issues;");
  await db.exec("SET ROLE service_role;");
});

afterAll(async () => { await db?.close(); });

describe("CMS PostgreSQL transactions", () => {
  it("leaves existing edited documents and their complete history unchanged during the retention upgrade", () => {
    expect(preRetentionUpgrade).toBeDefined();
    expect(postRetentionUpgrade).toEqual(preRetentionUpgrade);
    expect(postAuxiliaryUpgrade).toEqual(preRetentionUpgrade);
  });

  it("retains specialized content types without changing source identity on repeated imports", async () => {
    const kinds: CmsDocumentKind[] = ["glossary_entry", "directory_entry", "collection_entry", "product_review", "legacy_record"];
    for (const kind of kinds) {
      const input = morweb(`Posts:${kind}`, { kind });
      const created = await ingest(input);
      expect((await ingest(input))).toMatchObject({ document_id: created.document_id, action: "unchanged", revision: 1 });
      expect((await db.query<{ kind: string }>("SELECT kind FROM public.cms_documents WHERE id=$1", [created.document_id])).rows[0].kind).toBe(kind);
    }
    await expect(ingest(morweb("Posts:glossary_entry", { kind: "legacy_record" }))).rejects.toThrow("cms_documents_morweb_source_unique");
    expect(await count("cms_documents")).toBe(kinds.length);
    expect(await count("cms_source_snapshots")).toBe(kinds.length);
  });

  it("retains incomplete originals with empty titles and null scores as review items without inventing content", async () => {
    const input = morweb("Posts:incomplete-rating", {
      kind: "rating", title: "", body_html: "",
      metadata: { review: { required: true, reasons: ["missing_title", "missing_body", "invalid_rating_score"] }, rating: { score: null, price: null } },
      source_payload: { title: null, content: "", published: "2", custom_rating_score: "" },
    });
    const created = await ingest(input);
    const doc = (await db.query<CmsDocument>("SELECT * FROM public.cms_documents WHERE id=$1", [created.document_id])).rows[0];
    expect(doc).toMatchObject({ title: "", body_html: "", publication_state: "review", published_at: null, metadata: { rating: { score: null, price: null } } });
    const { source_hash, ...original } = input;
    expect(doc.source_hash).toBe(source_hash);
    expect((await db.query<{ payload: unknown }>("SELECT payload FROM public.cms_source_snapshots WHERE document_id=$1", [created.document_id])).rows[0].payload).toEqual(original);
    const edited = await save(created.document_id, 1, { body_html: "<p>Editorial work in progress.</p>", publication_state: "draft", metadata: { seo: { title: "Pending review" } } });
    expect(edited.metadata.review).toEqual(input.metadata!.review);
    expect(edited.metadata.rating).toEqual({ score: null, price: null });
    expect((await ingest(input)).action).toBe("unchanged");
    const after = (await db.query<CmsDocument>("SELECT * FROM public.cms_documents WHERE id=$1", [created.document_id])).rows[0];
    expect(after).toMatchObject({ body_html: "<p>Editorial work in progress.</p>", publication_state: "draft", revision: 2 });
    expect(await count("cms_source_snapshots")).toBe(1);
  });

  it("keeps review requirements through ordinary saves and rejects attempts to clear or bypass them", async () => {
    const gate = { required: true, reasons: ["page_body_assembly_required"] };
    const created = await ingest(morweb("Pages:pending-template", { kind: "page", body_html: "", metadata: { review: gate } }));
    for (const review of [null, {}, { required: false, reasons: [] }, { required: true, reasons: ["different_reason"] }]) {
      await expect(save(created.document_id, 1, { metadata: { review } })).rejects.toThrow("Review gates cannot be changed");
    }
    await expect(save(created.document_id, 1, { publication_state: "published" })).rejects.toThrow("Publishing is not enabled");
    await expect(db.query("UPDATE public.cms_documents SET publication_state='published' WHERE id=$1", [created.document_id])).rejects.toThrow("requiring review cannot be published");
    await expect(db.query("UPDATE public.cms_documents SET metadata='{}'::jsonb WHERE id=$1", [created.document_id])).rejects.toThrow("Review gates cannot be changed");
    expect(await count("cms_document_revisions")).toBe(1);
    const saved = await save(created.document_id, 1, { metadata: { review: gate, seo: { title: "A page under review" } }, publication_state: "unpublished" });
    expect(saved.metadata.review).toEqual(gate);
    expect(saved.publication_state).toBe("unpublished");
    expect(saved.revision).toBe(2);
  });

  it("rejects malformed review gates and unreviewed missing titles atomically", async () => {
    const invalidReviews: CmsJson[] = [null, [], true, { required: "true", reasons: ["missing_body"] }, { required: true, reasons: [] }, { required: true, reasons: [42] }, { required: true, reasons: ["not a code"] }, { required: true, reasons: ["missing_body"], extra: true }];
    for (const [index, review] of invalidReviews.entries()) {
      await expect(ingest(morweb(`Posts:invalid-review-${index}`, { metadata: { review } }))).rejects.toThrow();
    }
    await expect(ingest(morweb("Posts:missing-title", { title: "" }))).rejects.toThrow("cms_documents_title_check");
    await expect(ingest(morweb("Posts:missing-title-false-gate", { title: "", metadata: { review: { required: false, reasons: [] } } }))).rejects.toThrow("cms_documents_title_check");
    expect(await count("cms_documents")).toBe(0);
    expect(await count("cms_source_snapshots")).toBe(0);
    expect(await count("cms_document_revisions")).toBe(0);
  });

  it("retains a colliding source URL as a separate review record without overwriting its current owner", async () => {
    const publicUrl = "https://whiskyadvocate.com/Shared-Source-Alias";
    const owner = await ingest(morweb("Posts:url-owner", { public_url: publicUrl }));
    const originalOwner = await storedImport(owner.document_id);
    const duplicate = morweb("Posts:url-duplicate", { kind: "legacy_record", public_url: null,
      metadata: { review: { required: true, reasons: ["duplicate_public_url"] }, migration: { original_public_url: publicUrl } },
      source_payload: { id: "url-duplicate", original_public_url: publicUrl },
    });
    const retained = await ingest(duplicate);
    expect(retained.document_id).not.toBe(owner.document_id);
    expect(await storedImport(owner.document_id)).toEqual(originalOwner);
    expect((await db.query<CmsDocument>("SELECT * FROM public.cms_documents WHERE id=$1", [retained.document_id])).rows[0]).toMatchObject({ public_url: null, publication_state: "review", source_key: "Posts:url-duplicate" });
    const snapshot = (await db.query<{ payload: CmsIngestInput }>("SELECT payload FROM public.cms_source_snapshots WHERE document_id=$1", [retained.document_id])).rows[0];
    expect(snapshot.payload.source_payload?.original_public_url).toBe(publicUrl);
    expect(await count("cms_documents")).toBe(2);
  });

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

  it("removes Supabase default destructive history privileges instead of relying only on row triggers", async () => {
    expect(inheritedHistoryPrivileges).toHaveLength(2);
    for (const before of inheritedHistoryPrivileges) {
      expect(before).toMatchObject({ can_update: true, can_delete: true, can_truncate: true });
    }
    await ingest(morweb());
    for (const table of ["cms_source_snapshots", "cms_document_revisions"]) {
      const rights = (await db.query<{ can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean; can_truncate: boolean; can_trigger: boolean }>(
        "SELECT has_table_privilege('service_role',$1,'SELECT') AS can_select, has_table_privilege('service_role',$1,'INSERT') AS can_insert, has_table_privilege('service_role',$1,'UPDATE') AS can_update, has_table_privilege('service_role',$1,'DELETE') AS can_delete, has_table_privilege('service_role',$1,'TRUNCATE') AS can_truncate, has_table_privilege('service_role',$1,'TRIGGER') AS can_trigger",
        [`public.${table}`],
      )).rows[0];
      expect(rights).toEqual({ can_select: true, can_insert: true, can_update: false, can_delete: false, can_truncate: false, can_trigger: false });
      await expect(db.exec(`UPDATE public.${table} SET actor='changed'`)).rejects.toThrow("permission denied");
      await expect(db.exec(`DELETE FROM public.${table}`)).rejects.toThrow("permission denied");
      await expect(db.exec(`TRUNCATE public.${table}`)).rejects.toThrow("permission denied");
      expect(await count(table)).toBe(1);
    }
    const workingRights = (await db.query<{ can_select: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean; can_truncate: boolean }>(
      "SELECT has_table_privilege('service_role','public.cms_documents','SELECT') AS can_select, has_table_privilege('service_role','public.cms_documents','INSERT') AS can_insert, has_table_privilege('service_role','public.cms_documents','UPDATE') AS can_update, has_table_privilege('service_role','public.cms_documents','DELETE') AS can_delete, has_table_privilege('service_role','public.cms_documents','TRUNCATE') AS can_truncate",
    )).rows[0];
    expect(workingRights).toEqual({ can_select: true, can_insert: true, can_update: true, can_delete: false, can_truncate: false });
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
      await expect(db.exec("SELECT public.cms_guard_retained_document()")).rejects.toThrow("permission denied");
      await db.exec("RESET ROLE");
    }
  });
});

describe("Immutable captured migration sources", () => {
  it("preserves source order and exact idempotency inside a bounded batch", async () => {
    const inputs = [auxiliary("Posts:31:version"), auxiliary("Pages:7:context", { source_kind: "page_context" })];
    const batch = () => db.query<{ result: CmsMigrationSourceResult[] }>(
      "SELECT public.cms_ingest_migration_sources_batch($1::jsonb,'test-archiver') AS result", [JSON.stringify(inputs)],
    );
    const created = (await batch()).rows[0].result;
    expect(created.map(item => item.source_key)).toEqual(inputs.map(item => item.source_key));
    expect(created.map(item => item.action)).toEqual(["created", "created"]);
    const repeated = (await batch()).rows[0].result;
    expect(repeated.map(item => item.id)).toEqual(created.map(item => item.id));
    expect(repeated.map(item => item.action)).toEqual(["unchanged", "unchanged"]);
    expect(await count("cms_migration_sources")).toBe(2);
  });

  it("rolls back the whole source batch on conflicting captured data or mixed scope", async () => {
    const original = auxiliary("Posts:42:stable");
    await ingestAuxiliary(original);
    const batch = (rows: unknown[]) => db.query(
      "SELECT public.cms_ingest_migration_sources_batch($1::jsonb,'test-archiver')", [JSON.stringify(rows)],
    );
    await expect(batch([auxiliary("Posts:43:new"), { ...original, payload: { content: "Changed under the same hash" } }])).rejects.toThrow("source_hash_collision");
    expect(await count("cms_migration_sources")).toBe(1);
    await expect(batch([auxiliary("Posts:43:new"), auxiliary("Posts:44:other", { brand: "ws" })])).rejects.toThrow("same publication and archive");
    await expect(batch([auxiliary("Posts:43:new"), auxiliary("Posts:44:other", { archive_sha256: "b".repeat(64) })])).rejects.toThrow("same publication and archive");
    expect(await count("cms_migration_sources")).toBe(1);
  });

  it("rejects oversized source batches and keeps the batch entry point service-only", async () => {
    const batch = (value: unknown) => db.query(
      "SELECT public.cms_ingest_migration_sources_batch($1::jsonb,'test-archiver')", [JSON.stringify(value)],
    );
    await expect(batch({})).rejects.toThrow("must be an array");
    await expect(batch([])).rejects.toThrow("1 to 100 rows");
    await expect(batch(Array.from({ length: 101 }, (_, i) => auxiliary(`Posts:${i}:version`)))).rejects.toThrow("1 to 100 rows");
    await expect(batch([auxiliary("Posts:large:version", { payload: { text: "x".repeat(4_194_304) } })])).rejects.toThrow("4 MiB");
    expect(await count("cms_migration_sources")).toBe(0);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`RESET ROLE; SET ROLE ${role};`);
      await expect(batch([auxiliary()])).rejects.toThrow("permission denied");
    }
  });

  it("returns publication-scoped coverage and page-assembly counts without exposing source payloads", async () => {
    await ingest(morweb("Posts:wa-inventory"));
    await ingest(morweb("Pages:wa-template", { kind: "page", body_html: "", metadata: { review: { required: true, reasons: ["page_body_assembly_required"] } } }));
    await ingest(morweb("Posts:ws-inventory", { brand: "ws", kind: "rating" }));
    await ingestAuxiliary(auxiliary("Posts:wa-inventory"));
    await ingestAuxiliary(auxiliary("Page:wa-context", { source_kind: "page_context", archive_sha256: "b".repeat(64) }));
    await ingestAuxiliary(auxiliary("Posts:ws-inventory", { brand: "ws" }));
    const inventory = (await db.query<{ result: CmsMigrationInventory }>("SELECT public.cms_migration_inventory('wa') AS result")).rows[0].result;
    expect(inventory).toMatchObject({ brand: "wa", documents: {
      total: 2, by_kind: { article: 1, page: 1, rating: 0 }, by_publication_state: { published: 1, review: 1 },
      by_source_system: { morweb: 2, print: 0, manual: 0 }, review_required: 1, pages_awaiting_assembly: 1,
    }, sources: { total: 2, archive_count: 2, by_source_kind: { post_version: 1, page_context: 1, media_file: 0 } } });
    expect(Object.keys(inventory.documents.by_kind).sort()).toEqual([...CMS_DOCUMENT_KINDS].sort());
    expect(Object.keys(inventory.sources.by_source_kind).sort()).toEqual([...CMS_MIGRATION_SOURCE_KINDS].sort());
    expect(JSON.stringify(inventory)).not.toMatch(/inert source text|Original article|wa-template/);
    const empty = (await db.query<{ result: CmsMigrationInventory }>("SELECT public.cms_migration_inventory('ca') AS result")).rows[0].result;
    expect(empty.documents.total).toBe(0);
    expect(Object.values(empty.documents.by_kind).every(n => n === 0)).toBe(true);
    expect(empty.sources.total).toBe(0);
    expect(Object.values(empty.sources.by_source_kind).every(n => n === 0)).toBe(true);
    await expect(db.exec("SELECT public.cms_migration_inventory('unknown')")).rejects.toThrow("supported publication");
  });

  it("preserves every allowed capture type privately, including source parts and inert editor markup", async () => {
    for (const source_kind of CMS_MIGRATION_SOURCE_KINDS) {
      const input = auxiliary(`capture:${source_kind}`, { source_kind, source_sha256: "b".repeat(64) });
      const result = await ingestAuxiliary(input);
      expect(result).toMatchObject({ action: "created", brand: "wa", source_kind, source_key: input.source_key, payload_sha256: input.payload_sha256 });
      expect((await ingestAuxiliary(input))).toEqual({ ...result, action: "unchanged" });
      expect((await db.query<{ payload: unknown; captured_at: null }>("SELECT payload,captured_at FROM public.cms_migration_sources WHERE id=$1", [result.id])).rows[0]).toEqual({ payload: input.payload, captured_at: null });
    }
    expect(await count("cms_migration_sources")).toBe(CMS_MIGRATION_SOURCE_KINDS.length);
    expect(await count("cms_documents")).toBe(0);
    expect(await count("cms_document_revisions")).toBe(0);
  });

  it("keeps prior versions and repeated block IDs in distinct capture contexts without deduplicating away evidence", async () => {
    const older = auxiliary("Posts:42", { payload: { title: "Earlier source", content: "Earlier body" } });
    const latest = auxiliary("Posts:42", { payload: { title: "Latest source", content: "Latest body" } });
    const oldResult = await ingestAuxiliary(older);
    const newResult = await ingestAuxiliary(latest);
    expect(newResult.id).not.toBe(oldResult.id);
    for (const key of ["Page:10:context:A", "Page:20:context:B"]) {
      await ingestAuxiliary(auxiliary(key, { source_kind: "page_context", payload: { Blocks: { "123": { base_id: "5", content: "Shared-looking block" } } } }));
    }
    expect(await count("cms_migration_sources")).toBe(4);
    expect((await db.query<{ payload: unknown }>("SELECT payload FROM public.cms_migration_sources WHERE id=$1", [oldResult.id])).rows[0].payload).toEqual(older.payload);
  });

  it("is idempotent under competing writes and rejects a reused hash with different captured data", async () => {
    const input = auxiliary("capture:stable", { source_sha256: "c".repeat(64), captured_at: "2026-10-29T12:00:00Z" });
    const results = await Promise.all([ingestAuxiliary(input), ingestAuxiliary(input)]);
    expect(results.map(result => result.action).sort()).toEqual(["created", "unchanged"]);
    expect(results[0].id).toBe(results[1].id);
    for (const changed of [
      { ...input, payload: { content: "Different payload claiming the same digest" } },
      { ...input, source_sha256: "d".repeat(64) },
      { ...input, captured_at: "2026-10-29T12:00:01Z" },
    ]) await expect(ingestAuxiliary(changed)).rejects.toThrow("source_hash_collision");
    expect(await count("cms_migration_sources")).toBe(1);
  });

  it("requires a content-only source kind, a source digest for split parts, and explicit capture timezones", async () => {
    await expect(ingestAuxiliary({ ...auxiliary(), source_kind: "user_credentials" } as unknown as CmsMigrationSourceInput)).rejects.toThrow("cms_migration_sources_source_kind_check");
    await expect(ingestAuxiliary(auxiliary("capture:part", { source_kind: "source_part" }))).rejects.toThrow("check constraint");
    await expect(ingestAuxiliary(auxiliary("capture:local-time", { captured_at: "2026-10-29 12:00:00" }))).rejects.toThrow("explicit timezone");
    expect(await count("cms_migration_sources")).toBe(0);
  });

  it("rejects oversized and deeply nested payloads before storing any partial archive row", async () => {
    await expect(ingestAuxiliary(auxiliary("capture:too-many-bytes", { payload: { text: "x".repeat(2_097_152) } }))).rejects.toThrow("exceeds 2 MiB");
    await expect(ingestAuxiliary(auxiliary("capture:too-many-nodes", { payload: Array.from({ length: 100_000 }, () => null) }))).rejects.toThrow("100000 value nodes");
    let nested: CmsJson[] = [null];
    for (let depth = 1; depth < 64; depth++) nested = [nested];
    await expect(ingestAuxiliary(auxiliary("capture:too-deep", { payload: nested }))).rejects.toThrow("64 nesting levels");
    expect(await count("cms_migration_sources")).toBe(0);
  });

  it("denies browser access and every service-role mutation except append-only insertion", async () => {
    const created = await ingestAuxiliary(auxiliary());
    const rights = (await db.query<Record<string, boolean>>(
      "SELECT has_table_privilege('service_role','public.cms_migration_sources','SELECT') AS can_select,has_table_privilege('service_role','public.cms_migration_sources','INSERT') AS can_insert,has_table_privilege('service_role','public.cms_migration_sources','UPDATE') AS can_update,has_table_privilege('service_role','public.cms_migration_sources','DELETE') AS can_delete,has_table_privilege('service_role','public.cms_migration_sources','TRUNCATE') AS can_truncate,has_table_privilege('service_role','public.cms_migration_sources','TRIGGER') AS can_trigger",
    )).rows[0];
    expect(rights).toEqual({ can_select: true, can_insert: true, can_update: false, can_delete: false, can_truncate: false, can_trigger: false });
    for (const sql of ["UPDATE public.cms_migration_sources SET actor='changed'", "DELETE FROM public.cms_migration_sources", "TRUNCATE public.cms_migration_sources"]) {
      await expect(db.exec(sql)).rejects.toThrow("permission denied");
    }
    await db.exec("RESET ROLE");
    await expect(db.exec("UPDATE public.cms_migration_sources SET actor='changed'")).rejects.toThrow("append-only");
    await expect(db.exec("DELETE FROM public.cms_migration_sources")).rejects.toThrow("append-only");
    expect((await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='public.cms_migration_sources'::regclass")).rows[0].relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.exec("SELECT * FROM public.cms_migration_sources")).rejects.toThrow("permission denied");
      await expect(db.exec("SELECT public.cms_ingest_migration_source('{}'::jsonb,'caller')")).rejects.toThrow("permission denied");
      await expect(db.exec("SELECT public.cms_migration_inventory('wa')")).rejects.toThrow("permission denied");
      await db.exec("RESET ROLE");
    }
    expect((await db.query<{ id: string }>("SELECT id FROM public.cms_migration_sources")).rows[0].id).toBe(created.id);
  });
});
