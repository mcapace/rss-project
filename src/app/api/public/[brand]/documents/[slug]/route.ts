import { NextResponse } from "next/server";
import { deliverDocument, getPublishedDocument, isBrand, readerFromRequest } from "@/lib/delivery/content-server";

export const runtime = "nodejs";

/**
 * One published document with the paywall applied at the server: premium
 * blocks are removed before the response leaves, so nothing on the client can
 * reveal them. Anonymous responses are cacheable; entitled ones are private.
 */
export async function GET(request: Request, { params }: { params: Promise<{ brand: string; slug: string }> }) {
  const { brand, slug } = await params;
  if (!isBrand(brand) || !/^[a-z0-9][a-z0-9-]{0,220}$/i.test(slug)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const [document, reader] = await Promise.all([getPublishedDocument(brand, slug), readerFromRequest(request)]);
    if (!document) return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, s-maxage=60" } });
    const delivered = deliverDocument(document, reader.tier);
    return NextResponse.json({ document: delivered }, {
      headers: {
        "Access-Control-Allow-Origin": "*", Vary: "Authorization",
        "Cache-Control": reader.authenticated ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=300",
        "X-Access-Required": delivered.access.required, "X-Access-Full": delivered.access.full ? "1" : "0",
      },
    });
  } catch {
    return NextResponse.json({ error: "Content is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization" } });
}
