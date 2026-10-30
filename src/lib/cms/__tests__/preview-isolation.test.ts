import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(), cookies: vi.fn(), cmsDb: vi.fn(),
  getS3Client: vi.fn(), verifyPdfUpload: vi.fn(), createPresignedUploadUrl: vi.fn(),
  getSignedUrl: vi.fn(), getIssueFeedXml: vi.fn(), readExternalRss: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("../db", () => ({ cmsDb: mocks.cmsDb, databaseError: vi.fn() }));
vi.mock("@/lib/s3", () => ({ getS3Client: mocks.getS3Client, verifyPdfUpload: mocks.verifyPdfUpload, createPresignedUploadUrl: mocks.createPresignedUploadUrl }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.getSignedUrl }));
vi.mock("@/lib/feed-builder", () => ({ getIssueFeedXml: mocks.getIssueFeedXml }));
vi.mock("@/lib/legacy-rss", () => ({ legacyFeedTarget: vi.fn(), parseLegacyRss: vi.fn(), readExternalRss: mocks.readExternalRss }));

// Keep real auth/config functions: replacing them would hide a preview bypass.
import { authConfiguration, getAuthClient, requireCmsUser } from "../auth-server";
import { authorizeCmsPage } from "../page-access";
import { proxy } from "@/proxy";
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
import { GET as listIssues } from "@/app/api/issues/route";
import { GET as readIssue } from "@/app/api/issues/[issueUuid]/route";
import { GET as readLegacyRss } from "@/app/api/feed/route";

const id = "c400788c-3282-4077-a993-4f31b8251111";
const user = { id: "verified-editor", email: "editor@example.test", app_metadata: { cms_role: "editor", cms_brands: ["wa"] } };
const context = () => ({ params: Promise.resolve({ id }) });
const request = (path: string, method = "GET", body?: unknown) => new Request(`https://preview.example${path}`, {
  method, headers: { Origin: "https://preview.example", "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let auth: { getUser: ReturnType<typeof vi.fn>; getClaims: ReturnType<typeof vi.fn>; signInWithPassword: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CMS_ENABLE_CONNECTED_PREVIEW", undefined);
  vi.stubEnv("SUPABASE_URL", "https://inherited.example.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) vi.stubEnv(key, undefined);
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
  auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    getClaims: vi.fn().mockResolvedValue({ data: { claims: {} }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user }, error: null }),
  };
  mocks.createServerClient.mockReturnValue({ auth });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No external requests are allowed in this test.")));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Vercel preview isolation", () => {
  it("blocks every connected private API and page before auth, database, storage or dispatch calls", async () => {
    expect(authConfiguration()).toBeNull();
    for (const path of ["/cms", "/admin", "/admin/new", "/reader"]) {
      expect(await authorizeCmsPage(path)).toEqual({ ok: false, reason: "setup" });
    }
    const responses = await Promise.all([
      readSession(), readOverview(request("/api/cms/overview?brand=wa")), listDocuments(request("/api/cms/documents?brand=wa")),
      createDocument(request("/api/cms/documents", "POST", {})), readDocument(request(`/api/cms/documents/${id}`), context()),
      editDocument(request(`/api/cms/documents/${id}`, "PATCH", {}), context()), readHistory(request(`/api/cms/documents/${id}/history`), context()),
      readMedia(request(`/api/cms/documents/${id}/media`), context()), listIssues(request("/api/issues")),
      readIssue(request(`/api/issues/${id}`), { params: Promise.resolve({ issueUuid: id }) }),
      readLegacyRss(request("/api/feed")), processIssue(request("/api/process", "POST", {})),
      createUpload(request("/api/upload-url", "POST", {})), logout(request("/api/logout", "POST")),
      login(request("/api/login", "POST", { email: user.email, password: "synthetic-password" })),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "preview_disabled" });
    }
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, "false", "TRUE", "1"])("does not treat %s as a connected preview opt-in", async flag => {
    vi.stubEnv("CMS_ENABLE_CONNECTED_PREVIEW", flag);
    await expect(getAuthClient()).rejects.toMatchObject({ status: 503, code: "preview_disabled" });
    await proxy(new NextRequest("https://preview.example/cms"));
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it("allows an explicit development opt-in through normal login, verified auth and session refresh", async () => {
    vi.stubEnv("CMS_ENABLE_CONNECTED_PREVIEW", "true");
    expect(authConfiguration()).not.toBeNull();
    expect((await login(request("/api/login", "POST", { email: user.email, password: "synthetic-password" }))).status).toBe(200);
    expect(await requireCmsUser()).toMatchObject({ role: "editor", brands: ["wa"] });
    await proxy(new NextRequest("https://preview.example/cms"));
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.getClaims).toHaveBeenCalledOnce();
  });

  it.each([undefined, "development", "production"])("preserves configured access outside preview (%s)", async environment => {
    vi.stubEnv("VERCEL_ENV", environment);
    vi.stubEnv("CMS_ENABLE_CONNECTED_PREVIEW", "false");
    expect(authConfiguration()).not.toBeNull();
    expect(await requireCmsUser()).toMatchObject({ role: "editor", brands: ["wa"] });
    await proxy(new NextRequest("https://workspace.example/cms"));
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.getClaims).toHaveBeenCalledOnce();
  });

  it("keeps the demo outside session refresh even with connected preview enabled", async () => {
    vi.stubEnv("CMS_ENABLE_CONNECTED_PREVIEW", "true");
    const response = await proxy(new NextRequest("https://preview.example/cms/demo"));
    expect(response.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("preserves the missing-configuration setup state locally", async () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);
    expect(await authorizeCmsPage()).toEqual({ ok: false, reason: "setup" });
    await expect(getAuthClient()).rejects.toMatchObject({ status: 503, code: "setup_required" });
    await proxy(new NextRequest("http://localhost:3000/cms"));
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
