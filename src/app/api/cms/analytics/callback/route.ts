import { requireCmsUser } from "@/lib/cms/auth-server";
import { CmsError } from "@/lib/cms/access";
import { exchangeCode, listProperties, saveCredentials, suggestProperty, verifyState } from "@/lib/editorial/server/google-oauth";

/** Google redirects here after consent. Stores tokens, suggests a property, returns to the Audience page. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (brand: string | null, params: Record<string, string>) => Response.redirect(new URL(`/cms/audience?${new URLSearchParams({ ...(brand ? { brand } : {}), ...params })}`, url.origin), 302);
  const state = url.searchParams.get("state");
  let brand: string | null = null;
  try {
    const user = await requireCmsUser();
    if (user.role !== "admin") throw new CmsError(403, "Only administrators can connect Analytics.", "access_denied");
    if (url.searchParams.get("error")) throw new CmsError(400, `Google returned: ${url.searchParams.get("error")}`, "analytics_auth_failed");
    const code = url.searchParams.get("code");
    if (!code || !state) throw new CmsError(400, "Google did not return a sign-in code.", "validation_failed");
    const parsed = verifyState(state);
    brand = parsed.brand;
    if (parsed.user !== user.id) throw new CmsError(403, "This connection was started by a different user.", "access_denied");
    if (!user.brands.includes(parsed.brand)) throw new CmsError(403, "You do not have access to this publication.", "access_denied");
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) throw new CmsError(400, "Google did not provide offline access. Reconnect and grant the requested permissions.", "analytics_auth_failed");
    let property: { propertyId: string; displayName: string } | null = null;
    let warning = "";
    try { property = suggestProperty(parsed.brand, await listProperties(tokens.access_token)); }
    catch (error) { warning = error instanceof Error ? error.message : "Properties could not be listed."; }
    await saveCredentials({ brand: parsed.brand, access_token: tokens.access_token, refresh_token: tokens.refresh_token, token_expires_at: tokens.token_expires_at, google_email: tokens.email, connected_by: user.email, connected_at: new Date().toISOString(), property_id: property?.propertyId ?? null, property_name: property?.displayName ?? null });
    return back(parsed.brand, { connected: "1", ...(warning ? { warning } : {}) });
  } catch (error) {
    return back(brand, { error: error instanceof Error ? error.message : "The connection could not be completed." });
  }
}
