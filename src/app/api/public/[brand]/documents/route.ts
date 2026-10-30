import { NextResponse } from "next/server";
import { CMS_DOCUMENT_KINDS } from "@/lib/cms/types";
import { isBrand, listPublishedDocuments } from "@/lib/delivery/content-server";
import { requiredTier } from "@/lib/delivery/paywall";

export const runtime = "nodejs";

const PUBLIC_HEADERS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };

/**
 * Published content for the public sites: lists are always free to read
 * (title, summary, media, access tier); bodies come from the detail route.
 */
export async function GET(request: Request, { params }: { params: Promise<{ brand: string }> }) {
  const { brand } = await params;
  if (!isBrand(brand)) return NextResponse.json({ error: "Unknown publication." }, { status: 404 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (kind && !(CMS_DOCUMENT_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "Unknown content type." }, { status: 422 });
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
  const before = url.searchParams.get("before");
  if (before && Number.isNaN(Date.parse(before))) return NextResponse.json({ error: "before must be an ISO timestamp." }, { status: 422 });
  try {
    const rows = await listPublishedDocuments(brand, { kind, section: url.searchParams.get("section"), limit, before });
    const documents = rows.map(row => ({
      id: row.id, brand: row.brand, kind: row.kind, title: row.title, byline: row.byline, excerpt: row.excerpt, slug: row.slug, canonical_path: row.canonical_path,
      section: typeof row.metadata.section === "string" ? row.metadata.section : "", published_at: row.published_at, updated_at: row.updated_at,
      access: requiredTier(row.metadata),
      lead_image: (() => { const media = Array.isArray(row.metadata.media) ? row.metadata.media as { is_lead?: boolean; alt?: string; caption?: string }[] : []; const index = Math.max(0, media.findIndex(item => item?.is_lead)); return media.length ? { url: `/api/media/${row.id}/${index}?w=960`, alt: media[index]?.alt ?? "", caption: media[index]?.caption ?? "" } : null; })(),
    }));
    const next = rows.length === limit ? rows[rows.length - 1].published_at ?? rows[rows.length - 1].updated_at : null;
    return NextResponse.json({ brand, documents, next_before: next }, { headers: PUBLIC_HEADERS });
  } catch {
    return NextResponse.json({ error: "Content is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization" } });
}
