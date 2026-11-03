import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The story route's answer for a slug no published document has, on a root host (no database: the resolver is mocked).
vi.mock("server-only", () => ({}));
const rows: Record<string, Record<string, { target: string | null; status: number; brand: string }>> = {
  "whiskyadvocate.com": {
    "/retired-story": { target: null, status: 410, brand: "wa" },
    "/old-name": { target: "https://whiskyadvocate.com/Old-Name", status: 301, brand: "wa" },
    "/renamed": { target: "/wa/top20.html#2019", status: 301, brand: "wa" },
    "/wa/was-slug": { target: "/wa/Now-Slug", status: 301, brand: "wa" },
    // Stored as the importer and the redirect admin store paths (normalizePath of a URL pathname): "&" stays raw.
    "/jack-&-coke-retired": { target: null, status: 410, brand: "wa" },
    "/wa/jack-&-coke-renamed": { target: "/wa/Jack-And-Coke", status: 301, brand: "wa" },
  },
};
const resolveRedirect = vi.fn(async (path: string, host: string | null) => rows[host ?? ""]?.[path.toLowerCase()] ?? null);
vi.mock("@/lib/cms/redirects-server", () => ({ resolveRedirect: (path: string, host: string | null) => resolveRedirect(path, host) }));
vi.mock("@/lib/cms/runtime-config", () => ({ deliveryEnabled: () => true, connectedCmsEnabled: () => false }));
vi.mock("@/lib/wa/seo", async original => ({ ...(await original<object>()), loadDoc: async () => null }));

const { GET } = await import("@/app/wa/[slug]/route");
const get = (host: string, slug: string, search = "", param = slug) => GET(new NextRequest(`https://${host}/${slug}${search}`, { headers: { host } }), { params: Promise.resolve({ slug: param }) });

beforeEach(() => { vi.stubEnv("SUPABASE_URL", "http://unused.invalid"); });
afterEach(() => { vi.unstubAllEnvs(); resolveRedirect.mockClear(); });

describe("a root host's missing slug", () => {
  it("answers 410 rows, redirects with the query before the fragment, and never redirects to itself", async () => {
    expect((await get("whiskyadvocate.com", "Retired-Story")).status).toBe(410);
    const renamed = await get("whiskyadvocate.com", "Renamed", "?utm_source=nl");
    expect(renamed.status).toBe(301);
    expect(renamed.headers.get("location")).toBe("https://whiskyadvocate.com/top20.html?utm_source=nl#2019");
    expect((await get("whiskyadvocate.com", "Old-Name")).status).toBe(404);
    const moved = await get("whiskyadvocate.com", "Was-Slug");
    expect(moved.headers.get("location")).toBe("https://whiskyadvocate.com/Now-Slug");
  });

  it("looks up the segment as sent, so a row with a reserved character such as \"&\" answers like a multi-segment path", async () => {
    for (const param of ["Jack-&-Coke-Retired", "Jack-%26-Coke-Retired"]) {
      resolveRedirect.mockClear();
      expect((await get("whiskyadvocate.com", "Jack-&-Coke-Retired", "", param)).status).toBe(410);
      expect(resolveRedirect).toHaveBeenCalledWith("/Jack-&-Coke-Retired", "whiskyadvocate.com");
    }
    const renamed = await get("whiskyadvocate.com", "Jack-&-Coke-Renamed", "", "Jack-%26-Coke-Renamed");
    expect(renamed.status).toBe(301);
    expect(renamed.headers.get("location")).toBe("https://whiskyadvocate.com/Jack-And-Coke");
    expect(resolveRedirect).toHaveBeenCalledWith("/wa/Jack-&-Coke-Renamed", "whiskyadvocate.com");
  });

  it("looks up a staging alias's rows under the legacy domain, like the proxy", async () => {
    vi.stubEnv("WA_ROOT_HOSTS", "whiskyadvocate.com,www.whiskyadvocate.com,staging.whiskyadvocate.com");
    vi.stubEnv("REDIRECT_HOST_ALIASES", "staging.whiskyadvocate.com=whiskyadvocate.com");
    expect((await get("staging.whiskyadvocate.com", "Retired-Story")).status).toBe(410);
    expect(resolveRedirect).toHaveBeenCalledWith("/Retired-Story", "whiskyadvocate.com");
    const moved = await get("staging.whiskyadvocate.com", "Was-Slug");
    expect(moved.headers.get("location")).toBe("https://staging.whiskyadvocate.com/Now-Slug");
  });
});
