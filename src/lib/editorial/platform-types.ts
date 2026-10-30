import type { CmsBrand, CmsPublicationState } from "@/lib/cms/types";
import type { AccessTier } from "@/lib/delivery/paywall";
import type { NewsletterKind } from "@/lib/newsletter/render";

/* Catalog and ratings ------------------------------------------------ */

export type CatalogType = "producer" | "region" | "variety" | "taster";
export type CatalogEntry = { id: string; name: string; slug: string; detail: string; document_count: number };

export type RatingHit = {
  document_id: string; brand: CmsBrand; title: string; slug: string | null; publication_state: CmsPublicationState;
  score: number | null; price: number | null; vintage: number | null; product_name: string | null; category: string | null;
  producer: string | null; producer_slug: string | null; region: string | null; region_slug: string | null;
  variety: string | null; variety_slug: string | null; taster: string | null; taster_slug: string | null;
  drink_window: string | null; published_at: string | null; updated_at: string; total: number;
};
export type RatingFacetValue = { value: string; label: string; count: number };
export type RatingFacets = Record<"region" | "variety" | "producer" | "taster" | "score" | "price", RatingFacetValue[]>;
export type RatingFilters = {
  q?: string; min_score?: number; max_score?: number; min_price?: number; max_price?: number;
  region?: string; variety?: string; producer?: string; taster?: string; vintage_from?: number; vintage_to?: number;
  state?: CmsPublicationState; sort?: "score" | "price" | "price_desc" | "vintage" | "recent"; limit?: number; offset?: number;
};
export type RatingSearchResponse = { ratings: RatingHit[]; facets: RatingFacets; total: number };

/* Newsletter ----------------------------------------------------------- */

export type NewsletterSend = {
  id: string; document_id: string; brand: CmsBrand; kind: NewsletterKind; esp: string;
  status: "queued" | "scheduled" | "sent" | "failed" | "simulated"; subject: string; preheader: string | null;
  send_at: string | null; campaign_id: string | null; dispatch_id: string | null; error: string | null;
  requested_by: string; created_at: string; updated_at: string;
};
export type NewsletterRequest = { kind: NewsletterKind; subject: string; preheader?: string; send_at?: string | null };

/* Collaboration -------------------------------------------------------- */

export type RealtimeGrant = { url: string; key: string; token: string; expires_at: number; user: { id: string; name: string; color: string } };
export type CollabState = { state_base64: string; revision: number; updated_at: string } | null;

/* Delivery ------------------------------------------------------------- */

export type DeliveredMedia = { index: number; url: string; srcset: string; caption: string; credit: string; alt: string; is_lead: boolean; focal: { x: number; y: number } | null };
export type DeliveredDocument = {
  id: string; brand: CmsBrand; kind: string; title: string; byline: string; excerpt: string; slug: string | null; canonical_path: string | null;
  section: string; tags: string[]; seo: { title: string; description: string; no_index: boolean };
  published_at: string | null; updated_at: string; media: DeliveredMedia[];
  body: { html: string; blocks: unknown | null }; access: { required: AccessTier; reader: AccessTier; full: boolean; removed_blocks: number };
};
