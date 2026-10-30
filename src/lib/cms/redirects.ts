/**
 * The redirect engine's pure parts: deriving rows from migrated documents and
 * exporting them as edge routing files. Resolution at request time lives in
 * redirects-server.ts and the proxy.
 */
import type { CmsBrand, CmsJsonObject } from "./types";

export type RedirectRow = {
  id?: string;
  brand: CmsBrand;
  legacy_host: string | null;
  legacy_path: string;
  target_path: string | null;
  document_id: string | null;
  status: 301 | 302 | 307 | 308 | 410;
  source: "import" | "editor" | "manual" | "slug_change";
};

export type RedirectCandidateDocument = Pick<CmsJsonObject, never> & {
  id: string; brand: CmsBrand; slug: string | null; public_url: string | null; publication_state: string; metadata: CmsJsonObject;
};

/** The canonical public path of a document, matching cms_canonical_path in SQL. */
export function canonicalPath(doc: { brand: CmsBrand; slug: string | null; metadata: CmsJsonObject }): string | null {
  const explicit = doc.metadata.canonical_path;
  if (typeof explicit === "string" && explicit.startsWith("/")) return explicit;
  return doc.slug ? `/${doc.brand}/${doc.slug}` : null;
}

export function normalizePath(path: string): string {
  let out = path.trim();
  try { if (/^https?:\/\//i.test(out)) out = new URL(out).pathname; } catch { /* keep as given */ }
  out = out.split("?")[0].split("#")[0];
  if (!out.startsWith("/")) out = `/${out}`;
  out = out.replace(/\/{2,}/g, "/");
  if (out.length > 1) out = out.replace(/\/+$/, "");
  return out.toLowerCase();
}

/** Legacy routes a migrated document answered to: its public URL and any aliases recorded by the importer. */
export function legacyPathsOf(doc: RedirectCandidateDocument): { host: string | null; path: string }[] {
  const out = new Map<string, { host: string | null; path: string }>();
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    try {
      const url = new URL(value, "https://legacy.invalid");
      const host = url.hostname === "legacy.invalid" ? null : url.hostname.toLowerCase();
      const path = normalizePath(url.pathname);
      if (path === "/") return;
      out.set(`${host ?? ""}${path}`, { host, path });
    } catch { /* not a URL */ }
  };
  add(doc.public_url);
  const migration = doc.metadata.migration;
  if (migration && typeof migration === "object" && !Array.isArray(migration)) {
    const record = migration as CmsJsonObject;
    add(record.source_public_url);
    for (const alias of Array.isArray(record.aliases) ? record.aliases : []) add(alias);
    for (const alias of Array.isArray(record.legacy_urls) ? record.legacy_urls : []) add(alias);
  }
  for (const alias of Array.isArray(doc.metadata.legacy_paths) ? doc.metadata.legacy_paths : []) add(alias);
  return [...out.values()];
}

/** Rows to insert for a set of documents: every legacy route that differs from the canonical path. */
export function buildRedirectRows(documents: RedirectCandidateDocument[]): RedirectRow[] {
  const rows: RedirectRow[] = [];
  const seen = new Set<string>();
  for (const doc of documents) {
    const target = canonicalPath(doc);
    if (!target) continue;
    for (const { host, path } of legacyPathsOf(doc)) {
      if (normalizePath(target) === path) continue;
      const key = `${host ?? ""}${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ brand: doc.brand, legacy_host: host, legacy_path: path, target_path: null, document_id: doc.id, status: doc.publication_state === "unpublished" ? 410 : 301, source: "import" });
    }
  }
  return rows;
}

export type ResolvedRedirect = RedirectRow & { resolved_target: string | null };

/** Export rows as an edge routing file. */
export function exportRedirects(rows: ResolvedRedirect[], format: "vercel" | "nginx" | "json" | "cloudfront"): string {
  const usable = rows.filter(row => row.status === 410 || row.resolved_target);
  switch (format) {
    case "vercel":
      return JSON.stringify({ redirects: usable.filter(row => row.status !== 410).map(row => ({ source: row.legacy_path, destination: row.resolved_target, permanent: row.status === 301 || row.status === 308, ...(row.legacy_host ? { has: [{ type: "host", value: row.legacy_host }] } : {}) })) }, null, 2);
    case "nginx":
      return usable.map(row => row.status === 410 ? `location = ${row.legacy_path} { return 410; }` : `location = ${row.legacy_path} { return ${row.status} ${row.resolved_target}; }`).join("\n") + "\n";
    case "cloudfront":
      return `// CloudFront Function (viewer-request). Generated from cms_redirects.\nvar REDIRECTS = ${JSON.stringify(Object.fromEntries(usable.map(row => [row.legacy_path, { to: row.resolved_target, status: row.status }])))};\nfunction handler(event) {\n  var uri = event.request.uri.toLowerCase().replace(/\\/+$/, '') || '/';\n  var hit = REDIRECTS[uri];\n  if (!hit) return event.request;\n  if (hit.status === 410) return { statusCode: 410, statusDescription: 'Gone' };\n  return { statusCode: hit.status, statusDescription: 'Redirect', headers: { location: { value: hit.to } } };\n}\n`;
    default:
      return JSON.stringify(usable.map(row => ({ brand: row.brand, host: row.legacy_host, from: row.legacy_path, to: row.resolved_target, status: row.status, source: row.source })), null, 2);
  }
}
