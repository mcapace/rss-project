// Edge-authenticated paywall for the delivery tier.
//
// GET /functions/v1/paywall?brand=ws&slug=the-story
// Authorization: Bearer <reader's Supabase Auth access token> (optional)
//
// Reads the published document with the service role, works out the reader's
// tier from Supabase Auth app_metadata.subscription, and strips every block an
// editor marked premium before the response leaves the edge. The same rules
// live in src/lib/delivery/paywall.ts for the Next.js public content API.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Tier = "free" | "registered" | "subscriber";
const RANK: Record<Tier, number> = { free: 0, registered: 1, subscriber: 2 };
const BRANDS = new Set(["wa", "ws", "ca", "mw"]);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, OPTIONS" };

function isTier(value: unknown): value is Tier { return value === "free" || value === "registered" || value === "subscriber"; }

function readerTier(appMetadata: Record<string, unknown> | undefined): Tier {
  const subscription = appMetadata?.subscription as Record<string, unknown> | undefined;
  const tier = subscription?.tier ?? appMetadata?.subscription_tier;
  if (!isTier(tier)) return "free";
  if (subscription?.status && !["active", "trialing", "grace", "comped"].includes(String(subscription.status))) return "registered";
  if (typeof subscription?.expires_at === "string" && Date.parse(subscription.expires_at) < Date.now()) return "registered";
  return tier;
}

function requiredTier(metadata: Record<string, unknown>): Tier {
  const access = metadata.access as Record<string, unknown> | undefined;
  return isTier(access?.tier) ? access.tier : "free";
}

/** Remove elements marked data-premium="true", balancing nested same-name tags. */
function stripPremium(html: string): { html: string; removed: number } {
  let removed = 0;
  let out = "";
  let cursor = 0;
  const open = /<([a-z][a-z0-9]*)\b[^>]*\bdata-premium="true"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = open.exec(html))) {
    if (match.index < cursor) continue;
    const tag = match[1].toLowerCase();
    out += html.slice(cursor, match.index);
    let end = match.index + match[0].length;
    if (["img", "hr", "br"].includes(tag)) { cursor = end; }
    else {
      let depth = 1;
      const scanner = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
      scanner.lastIndex = end;
      let inner: RegExpExecArray | null;
      while (depth > 0 && (inner = scanner.exec(html))) { depth += inner[1] ? -1 : 1; end = inner.index + inner[0].length; }
      cursor = end;
      open.lastIndex = end;
    }
    removed += 1;
    if (removed === 1) out += '<aside data-paywall="true"></aside>';
  }
  out += html.slice(cursor);
  return { html: out, removed };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const brand = url.searchParams.get("brand") ?? "";
  const slug = url.searchParams.get("slug") ?? "";
  if (!BRANDS.has(brand) || !/^[a-z0-9][a-z0-9-]{0,220}$/i.test(slug)) return Response.json({ error: "Not found." }, { status: 404, headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let tier: Tier = "free";
  let authenticated = false;
  if (token) {
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
    const { data } = await anon.auth.getUser(token);
    if (data.user) { tier = readerTier(data.user.app_metadata as Record<string, unknown>); authenticated = true; }
  }

  const { data: document, error } = await service.from("cms_documents")
    .select("id,brand,kind,title,byline,body_html,excerpt,slug,published_at,updated_at,metadata")
    .eq("brand", brand).eq("publication_state", "published").eq("slug", slug).limit(1).maybeSingle();
  if (error) return Response.json({ error: "Content is temporarily unavailable." }, { status: 503, headers: CORS });
  if (!document) return Response.json({ error: "Not found." }, { status: 404, headers: { ...CORS, "Cache-Control": "public, s-maxage=60" } });

  const metadata = (document.metadata ?? {}) as Record<string, unknown>;
  const required = requiredTier(metadata);
  const full = RANK[tier] >= RANK[required];
  let html = document.body_html as string;
  let removed = 0;
  if (!full) {
    const stripped = stripPremium(html);
    if (stripped.removed) { html = stripped.html; removed = stripped.removed; }
    else if (required !== "free") { html = `${html.match(/<p[^>]*>[\s\S]*?<\/p>/)?.[0] ?? ""}<aside data-paywall="true"></aside>`; removed = 1; }
  }
  const body = {
    document: {
      id: document.id, brand: document.brand, kind: document.kind, title: document.title, byline: document.byline, excerpt: document.excerpt, slug: document.slug,
      canonical_path: typeof metadata.canonical_path === "string" ? metadata.canonical_path : `/${document.brand}/${document.slug}`,
      section: typeof metadata.section === "string" ? metadata.section : "", published_at: document.published_at, updated_at: document.updated_at,
      body: { html }, access: { required, reader: tier, full, removed_blocks: removed },
    },
  };
  return Response.json(body, { headers: { ...CORS, Vary: "Authorization", "Cache-Control": authenticated ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300", "X-Access-Required": required, "X-Access-Full": full ? "1" : "0" } });
});
