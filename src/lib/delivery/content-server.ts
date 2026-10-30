import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cmsDb, databaseError } from "@/lib/cms/db";
import { sanitizeCmsHtml } from "@/lib/cms/html";
import { canonicalPath } from "@/lib/cms/redirects";
import { CMS_BRANDS, type CmsBrand, type CmsDocument, type CmsJsonObject } from "@/lib/cms/types";
import type { BlockDocument } from "@/lib/cms/blocks";
import type { DeliveredDocument, DeliveredMedia } from "@/lib/editorial/platform-types";
import { deliverBody, readerTier, type AccessTier } from "./paywall";

export function isBrand(value: string): value is CmsBrand { return (CMS_BRANDS as readonly string[]).includes(value); }

/** The reader's tier from an optional Supabase Auth bearer token; anonymous readers are free. */
export async function readerFromRequest(request: Request): Promise<{ tier: AccessTier; authenticated: boolean }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { tier: "free", authenticated: false };
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { tier: "free", authenticated: false };
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { tier: "free", authenticated: false };
  return { tier: readerTier(data.user.app_metadata as Record<string, unknown>), authenticated: true };
}

const DOCUMENT_COLUMNS = "id,brand,kind,title,byline,body_html,body_json,excerpt,slug,public_url,publication_state,published_at,updated_at,metadata";

export async function getPublishedDocument(brand: CmsBrand, slug: string): Promise<CmsDocument | null> {
  const { data, error } = await cmsDb().from("cms_documents").select(DOCUMENT_COLUMNS).eq("brand", brand).eq("publication_state", "published")
    .or(`slug.eq.${slug.replace(/[,()]/g, "")},metadata->>canonical_path.eq./${brand}/${slug.replace(/[,()]/g, "")}`).limit(1).maybeSingle();
  if (error) databaseError(error);
  return (data as CmsDocument | null) ?? null;
}

export async function listPublishedDocuments(brand: CmsBrand, options: { kind?: string | null; section?: string | null; limit?: number; before?: string | null }) {
  const { data, error } = await cmsDb().rpc("cms_public_documents", { p_brand: brand, p_kind: options.kind ?? null, p_section: options.section ?? null, p_limit: options.limit ?? 20, p_before: options.before ?? null });
  if (error) databaseError(error);
  return (data ?? []) as { id: string; brand: CmsBrand; kind: string; title: string; byline: string; excerpt: string; slug: string | null; canonical_path: string | null; published_at: string | null; updated_at: string; metadata: CmsJsonObject }[];
}

export function deliveredMedia(doc: Pick<CmsDocument, "id" | "metadata">): DeliveredMedia[] {
  const media = Array.isArray(doc.metadata.media) ? (doc.metadata.media as CmsJsonObject[]) : [];
  return media.map((item, index) => ({ item, index })).filter(({ item }) => item && typeof item === "object" && typeof item.s3_key === "string").map(({ item, index }) => {
    const base = `/api/media/${doc.id}/${index}`;
    const focal = item.focal && typeof item.focal === "object" && !Array.isArray(item.focal) ? item.focal as { x?: number; y?: number } : null;
    return {
      index, url: `${base}?w=1600`, srcset: [480, 960, 1600].map(width => `${base}?w=${width} ${width}w`).join(", "),
      caption: typeof item.caption === "string" ? item.caption : "", credit: typeof item.credit === "string" ? item.credit : "", alt: typeof item.alt === "string" ? item.alt : "",
      is_lead: item.is_lead === true, focal: focal && typeof focal.x === "number" && typeof focal.y === "number" ? { x: focal.x, y: focal.y } : null,
    };
  });
}

/** Shape a stored document for a reader, applying the paywall. */
export function deliverDocument(doc: CmsDocument, reader: AccessTier): DeliveredDocument {
  const seo = doc.metadata.seo && typeof doc.metadata.seo === "object" && !Array.isArray(doc.metadata.seo) ? doc.metadata.seo as CmsJsonObject : {};
  const body = deliverBody({ html: sanitizeCmsHtml(doc.body_html), body_json: (doc.body_json as BlockDocument | null) ?? null, metadata: doc.metadata }, reader);
  return {
    id: doc.id, brand: doc.brand, kind: doc.kind, title: doc.title, byline: doc.byline, excerpt: doc.excerpt, slug: doc.slug, canonical_path: canonicalPath(doc),
    section: typeof doc.metadata.section === "string" ? doc.metadata.section : "", tags: Array.isArray(doc.metadata.tags) ? doc.metadata.tags.filter((tag): tag is string => typeof tag === "string") : [],
    seo: { title: typeof seo.title === "string" && seo.title ? seo.title : doc.title, description: typeof seo.description === "string" && seo.description ? seo.description : doc.excerpt, no_index: seo.no_index === true },
    published_at: doc.published_at, updated_at: doc.updated_at, media: deliveredMedia(doc),
    body: { html: body.html, blocks: body.body_json }, access: body.access,
  };
}
