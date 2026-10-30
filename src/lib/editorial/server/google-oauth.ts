import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CmsBrand } from "@/lib/cms/types";
import { CMS_BRANDS } from "@/lib/cms/types";
import { CmsError } from "@/lib/cms/access";
import { cmsDb, databaseError } from "@/lib/cms/db";

/**
 * Google OAuth for Analytics, the same way the audience dashboard connects:
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI (this app's
 * /api/cms/analytics/callback), optional GOOGLE_WORKSPACE_DOMAIN as a consent
 * hint. Tokens live in cms_google_credentials, one row per publication.
 */

export const GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];
const STATE_TTL_MS = 15 * 60 * 1000;
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export type GoogleCredentials = {
  brand: CmsBrand;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  google_email: string | null;
  property_id: string | null;
  property_name: string | null;
  connected_by: string | null;
  connected_at: string;
  updated_at: string;
};

export type Ga4Property = { propertyId: string; displayName: string; account: string };

export function googleOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string; domain?: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET, redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri, domain: process.env.GOOGLE_WORKSPACE_DOMAIN || undefined };
}

function requireConfig() {
  const config = googleOAuthConfig();
  if (!config) throw new CmsError(503, "Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.", "setup_required");
  return config;
}

/* State: signed with the client secret so the brand and user cannot be forged. */
export function signState(payload: { brand: CmsBrand; user: string; iat?: number }): string {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: payload.iat ?? Date.now() })).toString("base64url");
  const signature = createHmac("sha256", requireConfig().clientSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyState(state: string): { brand: CmsBrand; user: string; iat: number } {
  const dot = state.indexOf(".");
  if (dot <= 0) throw new CmsError(400, "Invalid OAuth state.", "validation_failed");
  const body = state.slice(0, dot), signature = state.slice(dot + 1);
  const expected = createHmac("sha256", requireConfig().clientSecret).update(body).digest("base64url");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new CmsError(400, "OAuth state signature mismatch.", "validation_failed");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { brand?: unknown; user?: unknown; iat?: unknown };
  if (!CMS_BRANDS.includes(parsed.brand as CmsBrand) || typeof parsed.user !== "string" || typeof parsed.iat !== "number") throw new CmsError(400, "Invalid OAuth state.", "validation_failed");
  if (Date.now() - parsed.iat > STATE_TTL_MS) throw new CmsError(400, "The sign-in link expired. Start the connection again.", "validation_failed");
  return { brand: parsed.brand as CmsBrand, user: parsed.user, iat: parsed.iat };
}

export function consentUrl(brand: CmsBrand, userId: string): string {
  const config = requireConfig();
  const params = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code",
    scope: GA4_SCOPES.join(" "), access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true",
    state: signState({ brand, user: userId }),
  });
  if (config.domain) params.set("hd", config.domain);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const json = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok) throw new CmsError(502, `Google rejected the token request${json.error_description ? `: ${json.error_description}` : ""}.`, "analytics_auth_failed");
  return json;
}

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string | null; token_expires_at: string; email: string | null }> {
  const config = requireConfig();
  const tokens = await tokenRequest({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" });
  let email: string | null = null;
  if (tokens.id_token) {
    try { email = (JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")) as { email?: string }).email ?? null; } catch { email = null; }
  }
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null, token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(), email };
}

/* Credentials storage -------------------------------------------------- */

export async function loadCredentials(brand: CmsBrand): Promise<GoogleCredentials | null> {
  const { data, error } = await cmsDb().from("cms_google_credentials").select("*").eq("brand", brand).maybeSingle();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    databaseError(error);
  }
  return (data as GoogleCredentials | null) ?? null;
}

export async function saveCredentials(row: Partial<GoogleCredentials> & { brand: CmsBrand }): Promise<void> {
  const { error } = await cmsDb().from("cms_google_credentials").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "brand" });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") throw new CmsError(503, "Apply the cms_google_credentials migration before connecting Analytics.", "setup_required");
    databaseError(error);
  }
}

export async function deleteCredentials(brand: CmsBrand): Promise<void> {
  const { error } = await cmsDb().from("cms_google_credentials").delete().eq("brand", brand);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") databaseError(error);
}

/** A valid access token for the publication's connection, refreshing when needed. */
export async function validAccessToken(credentials: GoogleCredentials): Promise<string> {
  if (credentials.access_token && credentials.token_expires_at && new Date(credentials.token_expires_at).getTime() - Date.now() > EXPIRY_BUFFER_MS) return credentials.access_token;
  if (!credentials.refresh_token) throw new CmsError(503, "Google did not grant offline access. Reconnect Analytics for this publication.", "setup_required");
  const config = requireConfig();
  const tokens = await tokenRequest({ refresh_token: credentials.refresh_token, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" });
  await saveCredentials({ brand: credentials.brand, access_token: tokens.access_token, token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString() });
  return tokens.access_token;
}

/** GA4 properties the connected Google account can see. */
export async function listProperties(accessToken: string): Promise<Ga4Property[]> {
  const properties: Ga4Property[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "200" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new CmsError(502, `Google Analytics Admin API returned ${response.status}.`, "analytics_failed");
    const json = await response.json() as { accountSummaries?: { displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[]; nextPageToken?: string };
    for (const account of json.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        const id = property.property?.replace(/^properties\//, "");
        if (id) properties.push({ propertyId: id, displayName: property.displayName ?? id, account: account.displayName ?? "" });
      }
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return properties.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

const BRAND_WORDS: Record<CmsBrand, string[]> = { wa: ["whisky", "whiskey", "advocate"], ws: ["wine", "spectator"], ca: ["cigar", "aficionado"], mw: ["market", "watch"] };

/** Suggest the property whose name best matches the publication. */
export function suggestProperty(brand: CmsBrand, properties: Ga4Property[]): Ga4Property | null {
  const words = BRAND_WORDS[brand];
  const scored = properties.map(property => ({ property, score: words.filter(word => property.displayName.toLowerCase().includes(word)).length })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  return scored[0]?.property ?? (properties.length === 1 ? properties[0] : null);
}
