import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), cookies: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { assertBrand, assertSameOrigin, CmsError, cmsPermissions, readJson, safeRedirect } from "../access";
import { authConfiguration, getAuthClient, requireCmsUser } from "../auth-server";
import { documentPatch, printInput } from "../validation";
import { sanitizeCmsHtml } from "../html";
import { databaseError } from "../db";

const configVariables = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD", "VERCEL_ENV", "CMS_ENABLE_CONNECTED_PREVIEW"];
const user = { id: "editor-id", email: "editor@example.test", app_metadata: { cms_role: "editor", cms_brands: ["wa"] } };

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of configVariables) vi.stubEnv(key, undefined);
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
});
afterEach(() => vi.unstubAllEnvs());

describe("CMS authorization", () => {
  it("uses only administrator-managed app_metadata for permissions", () => {
    const malicious = { id: "attacker", user_metadata: { cms_role: "admin", cms_brands: ["wa", "ws", "ca", "mw"] } };
    expect(() => cmsPermissions(malicious)).toThrow(CmsError);
    expect(() => cmsPermissions({ ...malicious, app_metadata: { cms_role: "viewer", cms_brands: ["wa"] } })).toThrow(CmsError);
    expect(cmsPermissions(user)).toEqual({ id: "editor-id", email: "editor@example.test", role: "editor", brands: ["wa"] });
  });

  it("does not turn malformed or absent brand assignments into broad editor access", () => {
    for (const cms_brands of [undefined, [], "wa", ["*"], ["unknown"]]) {
      expect(() => cmsPermissions({ ...user, app_metadata: { cms_role: "editor", cms_brands } })).toThrow(CmsError);
    }
    expect(cmsPermissions({ ...user, app_metadata: { cms_role: "admin" } }).brands).toEqual(["wa", "ws", "ca", "mw"]);
    expect(() => assertBrand(cmsPermissions(user), "ws")).toThrow(CmsError);
    expect(() => assertBrand(cmsPermissions(user), "wa")).not.toThrow();
  });

  it("fails closed when sign-in configuration is missing, even with a service key or old shared password", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.example.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-test-key");
    vi.stubEnv("ADMIN_PASSWORD", "legacy-test-password");
    expect(authConfiguration()).toBeNull();
    await expect(getAuthClient()).rejects.toMatchObject({ status: 503, code: "setup_required" });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("authorizes from a verified current user instead of a cached session or cookie claim", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.example.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
    const getSession = vi.fn();
    mocks.createServerClient.mockReturnValue({ auth: { getUser, getSession } });
    expect(await requireCmsUser()).toMatchObject({ role: "editor", brands: ["wa"] });
    expect(getUser).toHaveBeenCalledOnce();
    expect(getSession).not.toHaveBeenCalled();
    const options = mocks.createServerClient.mock.calls[0][2];
    expect(options.cookieOptions).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("rejects expired, absent and unauthorized authenticated users", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.example.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    for (const result of [
      { data: { user: null }, error: null },
      { data: { user }, error: { message: "expired" } },
    ]) {
      mocks.createServerClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue(result) } });
      await expect(requireCmsUser()).rejects.toMatchObject({ status: 401 });
    }
    mocks.createServerClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "unauthorized" } }, error: null }) } });
    await expect(requireCmsUser()).rejects.toMatchObject({ status: 403 });
  });
});

describe("CMS request boundaries", () => {
  it("requires an exact Origin on writes", () => {
    for (const origin of [null, "null", "https://attacker.example", "https://cms.example.evil.test", "http://cms.example"]) {
      const headers: Record<string, string> = origin === null ? {} : { Origin: origin };
      expect(() => assertSameOrigin(new Request("https://cms.example/api/cms/documents", { method: "POST", headers }))).toThrow(CmsError);
    }
    expect(() => assertSameOrigin(new Request("https://cms.example/api/cms/documents", { method: "POST", headers: { Origin: "https://cms.example" } }))).not.toThrow();
  });

  it("restricts post-login redirects to CMS paths", () => {
    for (const redirect of [null, "https://attacker.example", "//attacker.example", "/\\attacker.example", "/cms\\attacker.example", "/other"]) {
      expect(safeRedirect(redirect)).toBe("/cms");
    }
    expect(safeRedirect("/cms/documents/123?mode=edit")).toBe("/cms/documents/123?mode=edit");
  });

  it("limits JSON by received UTF-8 bytes and rejects nonobject payloads", async () => {
    const request = (body: string, contentType = "application/json") => new Request("https://cms.example/api/cms/documents", { method: "POST", headers: { "Content-Type": contentType, "Content-Length": "1" }, body });
    const encoded = JSON.stringify({ title: "éééé" });
    await expect(readJson(request(encoded), encoded.length)).rejects.toMatchObject({ status: 413 });
    for (const body of ["[]", "null", "42", "{bad"]) await expect(readJson(request(body))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(request("{}", "text/plain"))).rejects.toMatchObject({ status: 415 });
    expect(await readJson(request('{"title":"Valid"}'))).toEqual({ title: "Valid" });
  });

  it("rejects source identity edits and invalid scores before database calls", () => {
    for (const patch of [{ source_key: "other" }, { source_system: "print" }, { brand: "ws" }, { revision: 100 }]) {
      expect(() => documentPatch(patch)).toThrow(CmsError);
    }
    expect(() => documentPatch({ metadata: { rating: { score: 101 } } })).toThrow(CmsError);
    expect(() => documentPatch({ metadata: { rating: { price: -1 } } })).toThrow(CmsError);
    for (const rating of ["invalid", [], 90, true]) {
      expect(() => documentPatch({ metadata: { rating } })).toThrow(CmsError);
    }
    expect(documentPatch({ metadata: { rating: { score: 90, price: 25 } } })).toEqual({ metadata: { rating: { score: 90, price: 25 } } });
  });

  it("binds a print PDF key to its publication and issue", () => {
    const base = { brand: "wa", issueId: "2026-11", issueLabel: "November 2026", tocPages: [3, 4] };
    expect(() => printInput({ ...base, pdfKey: "pdfs/inbox/ws-2026-11.pdf" })).toThrow(CmsError);
    expect(() => printInput({ ...base, pdfKey: "pdfs/inbox/wa/2026-11/../../other.pdf" })).toThrow(CmsError);
    expect(printInput({ ...base, pdfKey: "pdfs/inbox/wa/2026-11/c400788c-3282-4077-a993-4f31b8251111.pdf" }).brand).toBe("wa");
    expect(() => printInput({ ...base, pdfKey: "pdfs/inbox/wa-2026-11.pdf", tocPages: [0] })).toThrow(CmsError);
  });

  it("maps PostgreSQL revision conflicts to an actionable HTTP conflict", () => {
    expect(() => databaseError({ code: "40001", message: "revision_conflict: reload" })).toThrowError(expect.objectContaining({ status: 409, code: "revision_conflict" }));
    expect(() => databaseError({ code: "23505", message: "internal constraint detail" })).toThrowError(expect.objectContaining({ status: 409, code: "duplicate_record" }));
    expect(() => databaseError({ code: "P0002", message: "Document not found" })).toThrowError(expect.objectContaining({ status: 404, code: "not_found" }));
  });
});

describe("CMS HTML handling", () => {
  it("removes executable markup, event handlers, inline CSS and unsafe URLs while retaining article structure", () => {
    const hostile = '<p style="background:url(https://evil.example)">Text <strong>bold</strong></p><script>alert(1)</script><img src="https://images.example/photo.jpg" onerror="alert(2)" alt="Caption"><a href="javascript:alert(3)" onclick="alert(4)">bad link</a><iframe srcdoc="<script>alert(5)</script>"></iframe><svg onload="alert(6)"><foreignObject>bad</foreignObject></svg><img src="data:image/svg+xml,evil"><a href="https://example.com" target="_blank">Safe</a>';
    const clean = sanitizeCmsHtml(hostile);
    expect(clean).not.toMatch(/<script|<iframe|<svg|foreignObject|onerror|onclick|onload|style=|javascript:|data:image/i);
    expect(clean).toContain("<strong>bold</strong>");
    expect(clean).toContain('src="https://images.example/photo.jpg"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(documentPatch({ body_html: hostile }).body_html).toBe(clean);
  });
});
