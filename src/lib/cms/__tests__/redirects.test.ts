import { describe, expect, it } from "vitest";
import { buildRedirectRows, canonicalPath, exportRedirects, legacyPathsOf, normalizePath } from "../redirects";

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", brand: "ws" as const, slug: "napa-cabernet-2023", public_url: "https://www.winespectator.com/articles/Napa-Cabernet-2023/", publication_state: "published",
  metadata: { migration: { aliases: ["/articles/12345", "https://www.winespectator.com/wine/napa-cab?utm=x"] }, legacy_paths: ["/old/napa"] }, ...overrides,
});

describe("redirect engine", () => {
  it("normalizes paths", () => {
    expect(normalizePath("https://Example.com/A/B/?q=1#x")).toBe("/a/b");
    expect(normalizePath("no-slash")).toBe("/no-slash");
    expect(normalizePath("//double//slash//")).toBe("/double/slash");
    expect(normalizePath("/")).toBe("/");
  });

  it("collects every legacy route and builds rows to the canonical path", () => {
    const paths = legacyPathsOf(doc());
    expect(paths).toEqual([
      { host: "www.winespectator.com", path: "/articles/napa-cabernet-2023" },
      { host: null, path: "/articles/12345" },
      { host: "www.winespectator.com", path: "/wine/napa-cab" },
      { host: null, path: "/old/napa" },
    ]);
    const rows = buildRedirectRows([doc()]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ brand: "ws", legacy_path: "/articles/napa-cabernet-2023", status: 301, source: "import", target_path: null, document_id: doc().id });
    expect(canonicalPath(doc())).toBe("/ws/napa-cabernet-2023");
  });

  it("skips documents without a canonical path, dedupes, and retires unpublished content", () => {
    expect(buildRedirectRows([doc({ slug: null, metadata: {} })])).toEqual([]);
    const rows = buildRedirectRows([doc(), doc({ id: "22222222-2222-4222-8222-222222222222", slug: "other" })]);
    expect(rows.filter(row => row.legacy_path === "/old/napa")).toHaveLength(1);
    expect(buildRedirectRows([doc({ publication_state: "unpublished" })])[0].status).toBe(410);
    expect(canonicalPath(doc({ metadata: { canonical_path: "/wine/custom" } }))).toBe("/wine/custom");
  });

  it("exports edge routing files", () => {
    const rows = buildRedirectRows([doc()]).map(row => ({ ...row, resolved_target: "/ws/napa-cabernet-2023" }));
    const vercel = JSON.parse(exportRedirects(rows, "vercel"));
    expect(vercel.redirects[0]).toEqual({ source: "/articles/napa-cabernet-2023", destination: "/ws/napa-cabernet-2023", permanent: true, has: [{ type: "host", value: "www.winespectator.com" }] });
    expect(exportRedirects(rows, "nginx")).toContain("location = /old/napa { return 301 /ws/napa-cabernet-2023; }");
    expect(exportRedirects(rows, "cloudfront")).toContain("function handler(event)");
    expect(JSON.parse(exportRedirects(rows, "json"))).toHaveLength(4);
  });
});
