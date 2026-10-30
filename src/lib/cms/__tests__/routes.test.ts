import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsDocument } from "../types";

const mocks = vi.hoisted(() => ({
  requireCmsUser: vi.fn(), getAuthClient: vi.fn(), cmsDb: vi.fn(),
  getS3Client: vi.fn(), getSignedUrl: vi.fn(), verifyPdfUpload: vi.fn(), createPresignedUploadUrl: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../auth-server", () => ({ requireCmsUser: mocks.requireCmsUser, getAuthClient: mocks.getAuthClient }));
vi.mock("../db", async (original) => ({ ...(await original<typeof import("../db")>()), cmsDb: mocks.cmsDb }));
vi.mock("@/lib/s3", () => ({ getS3Client: mocks.getS3Client, verifyPdfUpload: mocks.verifyPdfUpload, createPresignedUploadUrl: mocks.createPresignedUploadUrl }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.getSignedUrl }));

import { CmsError } from "../access";
import { GET as listDocuments, POST as createDocument } from "@/app/api/cms/documents/route";
import { GET as readDocument, PATCH as editDocument } from "@/app/api/cms/documents/[id]/route";
import { GET as readHistory } from "@/app/api/cms/documents/[id]/history/route";
import { GET as readMedia } from "@/app/api/cms/documents/[id]/media/route";
import { GET as readOverview } from "@/app/api/cms/overview/route";
import { GET as readSession } from "@/app/api/cms/session/route";
import { POST as login } from "@/app/api/login/route";
import { POST as logout } from "@/app/api/logout/route";
import { POST as processIssue } from "@/app/api/process/route";
import { POST as createUpload } from "@/app/api/upload-url/route";

const documentId = "c400788c-3282-4077-a993-4f31b8251111";
const issueId = "d400788c-3282-4077-a993-4f31b8251111";
const editor = { id: "verified-editor", email: "editor@example.test", role: "editor", brands: ["wa"] };
const context = () => ({ params: Promise.resolve({ id: documentId }) });
const request = (path: string, method = "GET", body?: unknown, origin = "https://cms.example") => new Request(`https://cms.example${path}`, {
  method, headers: { Origin: origin, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const originalDocument: CmsDocument = {
  id: documentId, brand: "wa", kind: "article", source_system: "print",
  source_key: `issue:${issueId}:folio:10`, source_hash: "a".repeat(64), body_json: null,
  identity_anchor: { issue_uuid: issueId, anchor_type: "printed_folio", start_page: 10 },
  title: "A private draft", byline: "Writer", body_html: "<p>Draft body.</p>", excerpt: "Summary",
  slug: null, public_url: null, publication_state: "review", published_at: null,
  issue_uuid: issueId, metadata: {}, revision: 1, created_at: "2026-10-30T12:00:00Z", updated_at: "2026-10-30T12:00:00Z",
};

type DbResult = { data: unknown; error: null | { code?: string; message?: string }; count?: number };
let document: CmsDocument | null;
let rpc: ReturnType<typeof vi.fn>;
let from: ReturnType<typeof vi.fn>;
let queries: Array<{ table: string; methods: Record<string, ReturnType<typeof vi.fn>> }>;
let auth: { signInWithPassword: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
let issueUpdateError: null | { code: string; message: string };
let issueUpdateMatches: boolean;

beforeEach(() => {
  vi.resetAllMocks();
  document = structuredClone(originalDocument);
  issueUpdateError = null;
  issueUpdateMatches = true;
  queries = [];
  rpc = vi.fn().mockResolvedValue({ data: { ...document, revision: 2 }, error: null });
  from = vi.fn((table: string) => {
    const methods: Record<string, ReturnType<typeof vi.fn>> = {};
    const result = (): DbResult => ({ data: table === "cms_documents" && document ? [document] : [], error: null, count: 1 });
    for (const method of ["select", "eq", "in", "ilike", "order", "update"]) methods[method] = vi.fn(() => methods);
    methods.maybeSingle = vi.fn(async () => ({
      data: table === "cms_documents" ? document : table === "issues" && issueUpdateMatches ? { id: issueId } : null,
      error: table === "issues" ? issueUpdateError : null,
    }));
    methods.range = vi.fn(async () => result());
    methods.limit = vi.fn(async () => result());
    methods.then = vi.fn((resolve: (value: DbResult) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject));
    queries.push({ table, methods });
    return methods;
  });
  mocks.cmsDb.mockReturnValue({ from, rpc });
  mocks.requireCmsUser.mockResolvedValue(editor);
  mocks.getS3Client.mockReturnValue({});
  mocks.getSignedUrl.mockResolvedValue("https://signed.example.test/image");
  mocks.verifyPdfUpload.mockResolvedValue(undefined);
  mocks.createPresignedUploadUrl.mockResolvedValue("https://signed.example.test/upload");
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  auth = {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: editor.id, app_metadata: { cms_role: "editor", cms_brands: ["wa"] } } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  mocks.getAuthClient.mockResolvedValue({ auth });
  vi.stubEnv("S3_BUCKET", "test-assets");
  vi.stubEnv("GITHUB_TOKEN", "test-worker-token");
  vi.stubEnv("GITHUB_REPO", "mcapace/rss-project");
  vi.stubEnv("GITHUB_WORKFLOW_REF", "codex/test-worker");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("CMS routes enforce authorization before privileged work", () => {
  it("rejects unsigned reads and writes without creating a database or storage client", async () => {
    mocks.requireCmsUser.mockRejectedValue(new CmsError(401, "Sign in", "sign_in_required"));
    const responses = await Promise.all([
      listDocuments(request("/api/cms/documents")),
      readDocument(request(`/api/cms/documents/${documentId}`), context()),
      readHistory(request(`/api/cms/documents/${documentId}/history`), context()),
      readMedia(request(`/api/cms/documents/${documentId}/media`), context()),
      readOverview(request("/api/cms/overview")), readSession(),
      createDocument(request("/api/cms/documents", "POST", { brand: "wa", kind: "article", title: "Title" })),
      editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", { expected_revision: 1, patch: { title: "Title" } }), context()),
    ]);
    expect(responses.every((response) => response.status === 401)).toBe(true);
    expect(mocks.cmsDb).not.toHaveBeenCalled();
    expect(mocks.getS3Client).not.toHaveBeenCalled();
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects cross-publication library, counts and creation before database access", async () => {
    const responses = await Promise.all([
      listDocuments(request("/api/cms/documents?brand=ws")),
      readOverview(request("/api/cms/overview?brand=ws")),
      createDocument(request("/api/cms/documents", "POST", { brand: "ws", kind: "article", title: "Other brand" })),
    ]);
    expect(responses.every((response) => response.status === 403)).toBe(true);
    expect(mocks.cmsDb).not.toHaveBeenCalled();
  });

  it("looks up an individual document within the user's brands before editing or reading its history/media", async () => {
    document = null; // A real scoped lookup cannot return the other publication's row.
    const responses = await Promise.all([
      readDocument(request(`/api/cms/documents/${documentId}`), context()),
      editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", { expected_revision: 1, patch: { title: "Wrong brand" } }), context()),
      readHistory(request(`/api/cms/documents/${documentId}/history`), context()),
      readMedia(request(`/api/cms/documents/${documentId}/media`), context()),
    ]);
    expect(responses.every((response) => response.status === 404)).toBe(true);
    expect(queries).toHaveLength(4);
    for (const query of queries) {
      expect(query.table).toBe("cms_documents");
      expect(query.methods.eq).toHaveBeenCalledWith("id", documentId);
      expect(query.methods.in).toHaveBeenCalledWith("brand", ["wa"]);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it("applies brand scope and server-side pagination to successful library reads", async () => {
    const response = await listDocuments(request("/api/cms/documents?page=2&kind=article&state=review"));
    expect(response.status).toBe(200);
    expect(queries[0].methods.in).toHaveBeenCalledWith("brand", ["wa"]);
    expect(queries[0].methods.range).toHaveBeenCalledWith(50, 99);
    expect(queries[0].methods.eq).toHaveBeenCalledWith("kind", "article");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });

  it("accepts the retained content types while keeping creation and listings scoped to the publication", async () => {
    for (const kind of ["glossary_entry", "directory_entry", "collection_entry", "product_review", "legacy_record"]) {
      expect((await listDocuments(request(`/api/cms/documents?kind=${kind}`))).status).toBe(200);
      expect(queries.at(-1)!.methods.eq).toHaveBeenCalledWith("kind", kind);
      expect(queries.at(-1)!.methods.in).toHaveBeenCalledWith("brand", ["wa"]);
      expect((await createDocument(request("/api/cms/documents", "POST", { brand: "wa", kind, title: "Specialized content" }))).status).toBe(201);
      expect(rpc.mock.calls.at(-1)).toEqual(["cms_ingest_document", expect.objectContaining({
        p_document: expect.objectContaining({ brand: "wa", kind, source_system: "manual", publication_state: "draft" }),
        p_actor: editor.id,
      })]);
    }
  });

  it("rejects forged origins before sign-in, saving, creation or logout", async () => {
    const responses = await Promise.all([
      login(request("/api/login", "POST", { email: "editor@example.test", password: "test" }, "https://evil.example")),
      logout(request("/api/logout", "POST", {}, "https://evil.example")),
      createDocument(request("/api/cms/documents", "POST", { brand: "wa", kind: "article", title: "Title" }, "https://evil.example")),
      editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", { expected_revision: 1, patch: { title: "Title" } }, "https://evil.example"), context()),
    ]);
    expect(responses.every((response) => response.status === 403)).toBe(true);
    expect(mocks.requireCmsUser).not.toHaveBeenCalled();
    expect(mocks.getAuthClient).not.toHaveBeenCalled();
    expect(mocks.cmsDb).not.toHaveBeenCalled();
  });
});

describe("CMS editing and media routes", () => {
  it("preserves incomplete review records and nullable scores during ordinary editorial saves", async () => {
    document = { ...originalDocument, kind: "rating", title: "", body_html: "", metadata: {
      review: { required: true, reasons: ["missing_title", "invalid_rating_score"] },
      rating: { score: null, price: null },
    } };
    rpc.mockResolvedValue({ data: { ...document, revision: 2 }, error: null });
    const response = await editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", {
      expected_revision: 1, patch: { title: "", body_html: "<p>Copy under review.</p>", metadata: { rating: { score: null, price: null } } },
    }), context());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("cms_save_document", expect.objectContaining({
      p_patch: { title: "", body_html: "<p>Copy under review.</p>", metadata: { rating: { score: null, price: null } } },
      p_expected_revision: 1,
    }));
    // Unmentioned metadata is merged by the atomic save; no gate-clear operation is emitted.
    expect(rpc.mock.calls[0][1].p_patch.metadata).not.toHaveProperty("review");
  });

  it("rejects client attempts to clear review requirements or publish incomplete records before the save RPC", async () => {
    document!.metadata.review = { required: true, reasons: ["page_body_assembly_required"] };
    const patches = [
      { metadata: { review: null } },
      { metadata: { review: { required: false, reasons: [] } } },
      { metadata: { review: { required: true, reasons: ["different_reason"] } } },
      { metadata: { review: { required: "true", reasons: ["page_body_assembly_required"] } } },
      { publication_state: "published" },
    ];
    for (const patch of patches) {
      expect((await editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", { expected_revision: 1, patch }), context())).status).toBe(422);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("allows an unchanged review gate to round-trip without treating it as resolved", async () => {
    document!.metadata.review = { required: true, reasons: ["missing_body"] };
    const response = await editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", {
      expected_revision: 1, patch: { metadata: { review: { reasons: ["missing_body"], required: true }, seo: { title: "Pending" } } },
    }), context());
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0][1].p_patch.metadata.review).toEqual(document!.metadata.review);
  });

  it("rejects empty titles without a stored review gate and invalid organization metadata", async () => {
    for (const patch of [{ title: " " }, { metadata: { organization: "invalid" } }]) {
      expect((await editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", { expected_revision: 1, patch }), context())).status).toBe(422);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the verified actor and expected revision to an atomic save, sanitizing working HTML", async () => {
    const response = await editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", {
      expected_revision: 1, actor: "forged-admin", patch: { body_html: '<p>New text</p><script>alert(1)</script><img src="x" onerror="alert(2)">' },
    }), context());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("cms_save_document");
    expect(args).toMatchObject({ p_document_id: documentId, p_expected_revision: 1, p_actor: editor.id });
    expect(args.p_patch.body_html).toContain("<p>New text</p>");
    expect(args.p_patch.body_html).not.toMatch(/script|onerror/);
  });

  it("returns HTTP409 for a stale editor revision without reporting a save", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "revision_conflict: reload" } });
    const response = await editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", { expected_revision: 1, patch: { title: "Stale" } }), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "revision_conflict" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses missing revisions and source identity tampering before the write RPC", async () => {
    const badBodies = [{ patch: { title: "Title" } }, { expected_revision: 1, patch: { source_key: "other" } }];
    for (const body of badBodies) {
      expect((await editDocument(request(`/api/cms/documents/${documentId}`, "PATCH", body), context())).status).toBe(422);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("signs only assets inside the authorized document's own publication and issue prefix", async () => {
    document!.metadata.media = [
      { s3_key: `cms/print/wa/${issueId}/assets/photo.jpg` },
      { s3_key: `cms/print/ws/${issueId}/assets/private.jpg` },
      { s3_key: `cms/print/wa/${issueId}/../other/private.jpg` },
      { s3_key: "secrets/private.pdf" },
    ];
    const response = await readMedia(request(`/api/cms/documents/${documentId}/media`), context());
    expect(response.status).toBe(200);
    expect(mocks.getSignedUrl).toHaveBeenCalledOnce();
    expect(mocks.getSignedUrl.mock.calls[0][1].input.Key).toBe(`cms/print/wa/${issueId}/assets/photo.jpg`);
    const result = await response.json();
    expect(result.media).toHaveLength(1);
  });
});

describe("CMS sign-in routes", () => {
  it("does not report successful sign-out when the identity provider returns an error", async () => {
    auth.signOut.mockResolvedValue({ error: { message: "Provider unavailable" } });
    const response = await logout(request("/api/logout", "POST", {}));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "sign_out_failed" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("refuses a valid provider account without CMS authorization and signs it back out", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "outsider", user_metadata: { cms_role: "admin" } } }, error: null });
    const response = await login(request("/api/login", "POST", { email: "outsider@example.test", password: "test-password" }));
    expect(response.status).toBe(403);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(mocks.cmsDb).not.toHaveBeenCalled();
  });

  it("returns a generic credential error and no private data for a failed provider sign-in", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "provider-internal-detail" } });
    const response = await login(request("/api/login", "POST", { email: "unknown@example.test", password: "bad" }));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("provider-internal-detail");
  });
});

describe("Print intake API boundaries", () => {
  const input = { brand: "wa", issueId: "2026-11", issueLabel: "November 2026", pdfKey: "pdfs/inbox/wa/2026-11/c400788c-3282-4077-a993-4f31b8251111.pdf", tocPages: [3, 4] };

  it("does not sign uploads, inspect objects, queue jobs or dispatch workers for unsigned callers", async () => {
    mocks.requireCmsUser.mockRejectedValue(new CmsError(401, "Sign in"));
    const responses = await Promise.all([
      processIssue(request("/api/process", "POST", input)),
      createUpload(request("/api/upload-url", "POST", { brand: "wa", issueId: "2026-11" })),
    ]);
    expect(responses.every((response) => response.status === 401)).toBe(true);
    expect(mocks.verifyPdfUpload).not.toHaveBeenCalled();
    expect(mocks.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(mocks.cmsDb).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies other publications before storage or worker operations", async () => {
    const responses = await Promise.all([
      processIssue(request("/api/process", "POST", { ...input, brand: "ws", pdfKey: "pdfs/inbox/ws-2026-11.pdf" })),
      createUpload(request("/api/upload-url", "POST", { brand: "ws", issueId: "2026-11" })),
    ]);
    expect(responses.every((response) => response.status === 403)).toBe(true);
    expect(mocks.verifyPdfUpload).not.toHaveBeenCalled();
    expect(mocks.createPresignedUploadUrl).not.toHaveBeenCalled();
    expect(mocks.cmsDb).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed before creating an issue when worker configuration is absent", async () => {
    vi.stubEnv("GITHUB_WORKFLOW_REF", undefined);
    const response = await processIssue(request("/api/process", "POST", input));
    expect(response.status).toBe(503);
    expect(mocks.verifyPdfUpload).not.toHaveBeenCalled();
    expect(mocks.cmsDb).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the queue's exact lease into the configured worker revision", async () => {
    const token = "e400788c-3282-4077-a993-4f31b8251111";
    rpc.mockResolvedValue({ data: { id: issueId, cms_intake_token: token }, error: null });
    const response = await processIssue(request("/api/process", "POST", input));
    expect(response.status).toBe(202);
    expect(mocks.verifyPdfUpload).toHaveBeenCalledWith(input.pdfKey);
    expect(rpc).toHaveBeenCalledWith("cms_queue_issue", expect.objectContaining({ p_brand: "wa", p_issue_id: "2026-11", p_pdf_key: input.pdfKey }));
    const dispatched = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(dispatched).toMatchObject({ ref: "codex/test-worker", inputs: { issue_uuid: issueId, intake_token: token, brand: "wa" } });
    expect(await response.json()).toEqual({ issueUuid: issueId, status: "queued" });
  });

  it("does not dispatch a duplicate active or historically published issue", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "Issue is already active or published" } });
    const response = await processIssue(request("/api/process", "POST", input));
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rotates only the failed dispatch's current lease and reports failure instead of queued success", async () => {
    const token = "e400788c-3282-4077-a993-4f31b8251111";
    rpc.mockResolvedValue({ data: { id: issueId, cms_intake_token: token }, error: null });
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const response = await processIssue(request("/api/process", "POST", input));
    expect(response.status).toBe(502);
    const update = queries.find((query) => query.table === "issues")!;
    expect(update.methods.eq).toHaveBeenCalledWith("id", issueId);
    expect(update.methods.eq).toHaveBeenCalledWith("cms_intake_token", token);
    expect(update.methods.in).toHaveBeenCalledWith("status", ["queued", "processing"]);
    const changed = update.methods.update.mock.calls[0][0];
    expect(changed.status).toBe("failed");
    expect(changed.cms_intake_token).not.toBe(token);
    expect(await response.json()).not.toHaveProperty("issueUuid");
  });

  it("uses a new upload identity and supplies conditional PUT headers", async () => {
    const first = await createUpload(request("/api/upload-url", "POST", { brand: "wa", issueId: "2026-11" }));
    const second = await createUpload(request("/api/upload-url", "POST", { brand: "wa", issueId: "2026-11" }));
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status).toBe(200);
    expect(firstBody.pdfKey).toMatch(/^pdfs\/inbox\/wa\/2026-11\/[0-9a-f-]+\.pdf$/);
    expect(firstBody.pdfKey).not.toBe(secondBody.pdfKey);
    expect(firstBody.uploadHeaders).toEqual({ "Content-Type": "application/pdf", "If-None-Match": "*" });
  });

  it("reports uncertain dispatch state when the database cannot revoke the failed attempt", async () => {
    rpc.mockResolvedValue({ data: { id: issueId, cms_intake_token: "e400788c-3282-4077-a993-4f31b8251111" }, error: null });
    fetchMock.mockRejectedValue(new Error("Dispatch timeout"));
    issueUpdateError = { code: "connection_error", message: "Database unavailable" };
    const response = await processIssue(request("/api/process", "POST", input));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("dispatch_state_unknown");
    expect(body.error).toContain("Check the issue before retrying");
    expect(body.error).not.toContain("saved for retry");
  });

  it("does not claim a changed/completed issue was marked failed after a late dispatch response", async () => {
    rpc.mockResolvedValue({ data: { id: issueId, cms_intake_token: "e400788c-3282-4077-a993-4f31b8251111" }, error: null });
    fetchMock.mockRejectedValue(new Error("Dispatch timeout"));
    issueUpdateMatches = false;
    const response = await processIssue(request("/api/process", "POST", input));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "dispatch_state_changed" });
  });
});
