import { requireCmsUser } from "@/lib/cms/auth-server";
import { assertBrand, assertSameOrigin, CmsError, readJson } from "@/lib/cms/access";
import { cmsFailure, cmsJson } from "@/lib/cms/http";
import { ga4Configuration } from "@/lib/editorial/server/ga4";
import type { ConnectionStatus } from "@/lib/editorial/analytics-types";
import { deleteCredentials, googleOAuthConfig, listProperties, loadCredentials, saveCredentials, validAccessToken, type Ga4Property } from "@/lib/editorial/server/google-oauth";



async function status(brand: string, includeProperties: boolean): Promise<ConnectionStatus> {
  const credentials = await loadCredentials(brand as "wa" | "ws" | "ca" | "mw");
  let properties: Ga4Property[] = [];
  let propertiesError: string | null = null;
  if (includeProperties && credentials?.refresh_token) {
    try { properties = await listProperties(await validAccessToken(credentials)); }
    catch (error) { propertiesError = error instanceof Error ? error.message : "Properties could not be listed."; }
  }
  return {
    brand, oauth_available: !!googleOAuthConfig(), connected: !!credentials?.refresh_token,
    google_email: credentials?.google_email ?? null, property_id: credentials?.property_id ?? null, property_name: credentials?.property_name ?? null,
    connected_by: credentials?.connected_by ?? null, connected_at: credentials?.connected_at ?? null,
    service_account_property: ga4Configuration()?.properties[brand as "wa"] ?? null,
    properties, properties_error: propertiesError,
  };
}

/** Connection status, property choice and disconnect for one publication. */
export async function GET(request: Request) {
  try {
    const user = await requireCmsUser();
    const url = new URL(request.url);
    const brand = url.searchParams.get("brand") ?? "";
    assertBrand(user, brand);
    return cmsJson(await status(brand, user.role === "admin" && url.searchParams.get("properties") === "1"));
  } catch (error) { return cmsFailure(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    if (user.role !== "admin") throw new CmsError(403, "Only administrators can change the Analytics connection.", "access_denied");
    const body = await readJson(request, 10_000);
    const brand = typeof body.brand === "string" ? body.brand : "";
    assertBrand(user, brand);
    const propertyId = typeof body.property_id === "string" ? body.property_id.trim() : "";
    if (!/^\d{3,20}$/.test(propertyId)) throw new CmsError(422, "Enter a numeric GA4 property id.", "validation_failed");
    const credentials = await loadCredentials(brand);
    if (!credentials?.refresh_token) throw new CmsError(409, "Connect a Google account before choosing a property.", "validation_failed");
    const name = typeof body.property_name === "string" ? body.property_name.slice(0, 200) : null;
    await saveCredentials({ brand, property_id: propertyId, property_name: name });
    return cmsJson(await status(brand, false));
  } catch (error) { return cmsFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCmsUser();
    if (user.role !== "admin") throw new CmsError(403, "Only administrators can change the Analytics connection.", "access_denied");
    const brand = new URL(request.url).searchParams.get("brand") ?? "";
    assertBrand(user, brand);
    await deleteCredentials(brand);
    return cmsJson(await status(brand, false));
  } catch (error) { return cmsFailure(error); }
}
