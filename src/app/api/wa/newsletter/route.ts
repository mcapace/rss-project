import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Newsletter sign-up for the Whisky Advocate site. The browser posts the
 * reader's email, the newsletters they chose and the profile fields the old
 * form collected; this route writes the profile to Braze (/users/track) and
 * sets each chosen subscription group to subscribed (/subscription/status/set).
 *
 * The subscription group ids are the ones the live sign-up page at
 * winespectator.com/newsletter/whiskyadvocate posts to, so a reader lands in
 * the same Braze channels either way.
 *
 * Environment: BRAZE_REST_ENDPOINT (for example https://rest.iad-01.braze.com)
 * and BRAZE_REST_API_KEY (the name the audience dashboard uses; BRAZE_API_KEY
 * also works) with users.track and subscription.status.set permissions.
 */
const NEWSLETTERS: Record<string, { name: string; group: string; cadence: string }> = {
  notes: { name: "WhiskyNotes", group: "573ad896-cee4-4cb6-a5e6-02a525b1e497", cadence: "Twice a month" },
  cocktails: { name: "Cocktail Club", group: "90311b3e-7ebf-48af-86f3-91f82e0d3a4a", cadence: "Once a month" },
  weekend: { name: "Whisky Weekend", group: "17f77dea-4290-43a7-b0db-3ae456cfb84a", cadence: "Fridays" },
  offers: { name: "Offers & Promotions", group: "cd1104a7-3d6c-435b-89ce-802198580f90", cadence: "As needed" },
};

const INDUSTRIES = new Set(["Consumer", "Cigar Distributor", "Cigar Manufacturer", "Cigar Retailer", "Importer", "Distiller", "Winery", "Wine/Spirits Distributor", "Beer Distributor", "Brewer", "Restaurant", "Bar", "Hotel", "Independent Retailer (Wine/Spirits/Beer)", "Chain Retailer (Wine/Spirits/Beer)", "Club (Private, Country)", "Duty Free Operator", "Finance", "Media/PR", "Other"]);

const brazeKey = () => process.env.BRAZE_REST_API_KEY || process.env.BRAZE_API_KEY || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const bucket = new Map<string, { count: number; at: number }>();

function limited(ip: string) {
  const now = Date.now(); const hit = bucket.get(ip);
  if (!hit || now - hit.at > 60_000) { bucket.set(ip, { count: 1, at: now }); return false; }
  hit.count += 1; return hit.count > 10;
}

async function braze(path: string, body: unknown) {
  const endpoint = (process.env.BRAZE_REST_ENDPOINT as string).replace(/\/+$/, "");
  const response = await fetch(`${endpoint}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${brazeKey()}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Braze ${path} ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ error: "Too many sign-ups from this connection. Try again in a minute." }, { status: 429, headers: CORS });
  let body: { email?: string; zip?: string; industry?: string; lists?: string[]; eu?: boolean; source?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send JSON." }, { status: 400, headers: CORS }); }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return NextResponse.json({ error: "That email does not look right." }, { status: 400, headers: CORS });
  const lists = Array.isArray(body.lists) ? body.lists.filter(key => typeof key === "string" && NEWSLETTERS[key]) : [];
  if (!lists.length) return NextResponse.json({ error: "Pick at least one newsletter." }, { status: 400, headers: CORS });
  const zip = String(body.zip ?? "").trim().slice(0, 12);
  const industry = INDUSTRIES.has(String(body.industry)) ? String(body.industry) : "";
  const eu = body.eu === true;
  const source = String(body.source ?? "site").slice(0, 60);

  if (!process.env.BRAZE_REST_ENDPOINT || !brazeKey()) {
    return NextResponse.json({ error: "Sign-up is not connected yet: the site needs BRAZE_REST_ENDPOINT and BRAZE_REST_API_KEY. Until then, use the sign-up page at winespectator.com/newsletter/whiskyadvocate.", fallback: "https://www.winespectator.com/newsletter/whiskyadvocate" }, { status: 503, headers: CORS });
  }

  try {
    const alias = { alias_name: email, alias_label: "email" };
    await braze("/users/track", { attributes: [{ user_alias: alias, _update_existing_only: false, email, email_subscribe: "opted_in", ...(zip ? { home_zip: zip } : {}), ...(industry ? { industry } : {}), ...(eu ? { eu_media_consent: true } : {}), signup_source: `whiskyadvocate.com ${source}`, signup_at: new Date().toISOString() }] });
    for (const key of lists) {
      await braze("/subscription/status/set", { subscription_group_id: NEWSLETTERS[key].group, subscription_state: "subscribed", email: [email] });
    }
    return NextResponse.json({ ok: true, lists: lists.map(key => NEWSLETTERS[key].name) }, { headers: CORS });
  } catch (error) {
    console.error("[wa/newsletter]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The sign-up did not go through. Try again in a moment, or use the sign-up page at winespectator.com/newsletter/whiskyadvocate.", fallback: "https://www.winespectator.com/newsletter/whiskyadvocate" }, { status: 502, headers: CORS });
  }
}
