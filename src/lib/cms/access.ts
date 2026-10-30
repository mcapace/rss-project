import { CMS_BRANDS, type CmsBrand } from "./types";

export class CmsError extends Error {
  constructor(public status: number, message: string, public code = "request_failed") {
    super(message);
  }
}

export interface CmsUser {
  id: string;
  email: string;
  role: "admin" | "editor";
  brands: CmsBrand[];
}

/** Authorization comes only from administrator-managed app_metadata. */
export function cmsPermissions(user: {
  id: string; email?: string; app_metadata?: Record<string, unknown>;
}): CmsUser {
  const role = user.app_metadata?.cms_role;
  if (role !== "admin" && role !== "editor") {
    throw new CmsError(403, "Your account has not been granted CMS access.", "access_denied");
  }
  const configuredBrands = user.app_metadata?.cms_brands;
  const brands = role === "admin" ? [...CMS_BRANDS] : CMS_BRANDS.filter(
    (brand) => Array.isArray(configuredBrands) && configuredBrands.includes(brand),
  );
  if (!brands.length) throw new CmsError(403, "Your account has no assigned publications.", "access_denied");
  return { id: user.id, email: user.email || "Editor", role, brands };
}

export function assertBrand(user: CmsUser, brand: string): asserts brand is CmsBrand {
  if (!user.brands.includes(brand as CmsBrand)) {
    throw new CmsError(403, "You do not have access to this publication.", "access_denied");
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new CmsError(403, "This request must come from the CMS.", "invalid_origin");
  }
}

export function safeRedirect(value: string | null): string {
  return value && /^\/(?:cms|admin|reader)(?:[/?]|$)/.test(value) && !value.includes("\\") ? value : "/cms";
}

export async function readJson(request: Request, maxBytes = 2_000_000): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new CmsError(415, "Send JSON content.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new CmsError(400, "The request body is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new CmsError(413, "This request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new CmsError(400, "The request contains invalid JSON."); }
}
