import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { normalizePath } from "@/lib/cms/redirects";
import { createRedirect, exportBrandRedirects, listRedirects } from "@/lib/cms/redirects-server";
import type { CmsBrand } from "@/lib/cms/types";
import { brandValue, isUuid } from "@/lib/cms/validation";

const FORMATS = { vercel: "application/json", json: "application/json", nginx: "text/plain", cloudfront: "text/javascript" } as const;

/** List the legacy URL map, or export it as an edge routing file with ?format=vercel|nginx|cloudfront|json. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const url = new URL(request.url);
    const brandParam = url.searchParams.get("brand");
    const brands: CmsBrand[] = brandParam ? (assertBrand(user, brandParam), [brandParam]) : user.brands;
    const format = url.searchParams.get("format");
    if (format) {
      if (!(format in FORMATS)) throw new CmsError(422, "Unknown export format.", "validation_failed");
      const body = await exportBrandRedirects(brands, format as keyof typeof FORMATS);
      return new Response(body, { headers: { "Content-Type": FORMATS[format as keyof typeof FORMATS], "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="redirects-${brands.join("-")}.${format === "nginx" ? "conf" : format === "cloudfront" ? "js" : "json"}"` } });
    }
    const redirects = await listRedirects(brands, (url.searchParams.get("q") ?? "").trim().slice(0, 200), Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200)));
    return cmsJson({ redirects });
  } catch (error) { return cmsFailure(error); }
}

/** Add one redirect by hand. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    const body = await readJson(request, 10_000);
    const brand = brandValue(body.brand);
    assertBrand(user, brand);
    const legacyPath = typeof body.legacy_path === "string" ? normalizePath(body.legacy_path) : "";
    if (legacyPath.length < 2 || legacyPath.length > 2048) throw new CmsError(422, "Enter the legacy path to redirect from.", "validation_failed");
    const target = typeof body.target_path === "string" && body.target_path.trim() ? body.target_path.trim() : null;
    if (target && !/^(\/|https?:\/\/)/.test(target)) throw new CmsError(422, "The target must be a site path or a full URL.", "validation_failed");
    const documentId = typeof body.document_id === "string" && body.document_id ? body.document_id : null;
    if (documentId && !isUuid(documentId)) throw new CmsError(422, "Invalid document.", "validation_failed");
    const status = body.status === undefined ? 301 : Number(body.status);
    if (![301, 302, 307, 308, 410].includes(status)) throw new CmsError(422, "Use status 301, 302, 307, 308 or 410.", "validation_failed");
    if (!target && !documentId && status !== 410) throw new CmsError(422, "Give the redirect a target path or a document.", "validation_failed");
    const host = typeof body.legacy_host === "string" && body.legacy_host.trim() ? body.legacy_host.trim().toLowerCase() : null;
    const redirect = await createRedirect({ brand, legacy_host: host, legacy_path: legacyPath, target_path: target, document_id: documentId, status: status as 301, source: "manual" });
    return cmsJson({ redirect }, 201);
  } catch (error) { return cmsFailure(error); }
}
