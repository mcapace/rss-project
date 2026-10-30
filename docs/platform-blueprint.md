# In-house CMS platform blueprint: status and plan

This maps the consolidated requirements for the M. Shanken editorial platform
(Wine Spectator, Cigar Aficionado, Whisky Advocate, Market Watch, Impact
Databank) against what exists in this repository today, and sets out the order
of work. Status values: **Built**, **Partly built**, **Planned**, **Decision
needed**.

## 1. Database and core schema

| Requirement | Status | Notes |
| --- | --- | --- |
| Relational "Shanken schema" for producers, regions, varieties, vintages, scores, taster profiles | Planned | Ratings today are documents of kind `rating` with a `metadata.rating` object (score, price, producer, category, reviewer). Next step is an additive migration adding `cms_producers`, `cms_regions`, `cms_varieties`, `cms_tasters`, and `cms_ratings` (document id, producer id, region id, variety id, vintage, score, price, drink window, taster id) with foreign keys, plus an editor panel that writes both the relational row and the document. Impact Databank brands, categories and volumes get their own tables in the same style. |
| Hybrid layout modeling in JSONB for article bodies | Partly built | Bodies are stored as sanitized HTML in `cms_documents.body_html` with structured metadata in JSONB. Moving to a block JSON model (TipTap's document JSON) is a one-column addition (`body_json`) written alongside the HTML; the editor already produces it. Do this with the migration normalization layer so legacy content lands as blocks once. |
| Multi-tenancy with RLS bound to JWT claims | Partly built | Access is per publication through `app_metadata.cms_role` and `cms_brands` on the Supabase Auth user, enforced in every server route (`assertBrand`). Data access uses the service role, so RLS is not yet the enforcement layer. Next step: policies on `cms_documents` and the new relational tables that read `auth.jwt()->'app_metadata'->'cms_brands'`, and a user-scoped client for reads so RLS is the second lock. |
| Connection pooling through Supavisor | Planned | Point the server's Supabase URL at the pooler (transaction mode, port 6543) for the worker and API routes; the Next.js app already uses short-lived requests. No code change beyond configuration. |

## 2. Digital experience and editorial functionality

| Requirement | Status | Notes |
| --- | --- | --- |
| Edge-authenticated paywalls | Planned | Belongs to the public delivery tier, not the CMS. Subscription tier goes in Auth `app_metadata.subscription`; a Supabase Edge Function or CloudFront Function strips premium blocks before the HTML leaves the edge. The CMS marks premium sections per block, which the block model above makes possible. |
| Native newsletter pipeline (Daily Alert to ESP) | Planned | Braze is connected to this account. Plan: a `newsletter` flag and send-time on a document, a server route that renders the email template and creates a Braze campaign message, and a status column on the document. The preview matrix below renders the same template so editors see the email before it goes. |
| Real-time collaborative editing (Supabase Realtime plus Yjs) | Planned | The editor is TipTap, which has first-class Yjs collaboration extensions. Plan: a Realtime channel per document carrying Yjs updates and presence, an awareness-driven cursor layer, and periodic persistence of the Yjs state to `cms_documents.body_json`. Optimistic revisions stay as the save guard. |
| Visual headless preview matrix | Built | The editor's Preview view renders the draft at desktop, tablet, mobile and email widths side by side in sandboxed iframes fed through `postMessage`. Swap the built-in template for the public site's and the email template once they exist. |

## 3. Historical data and media migration

| Requirement | Status | Notes |
| --- | --- | --- |
| Text structure normalization layer | Partly built | The Morweb importer (`src/lib/cms/morweb.ts`, `scripts/import-morweb.ts`) maps legacy records with a dry run and held records. Its output is HTML; adding a normalization pass (strip legacy inline CSS, map to the block JSON model) is the next step and reuses the sanitizer whitelist. |
| Legacy ID mapping and 301 redirects | Planned | Documents keep `source_key` and `public_url` from their source. Plan: a `cms_redirects` table (legacy path, document id, status, created from) filled by the importer, a `/api/redirects` export for the edge, and a Next.js `proxy.ts` rule or CloudFront function that answers 301s from it. |
| Asset extraction and optimization (WebP/AVIF, focal points) | Partly built | Print images are extracted and stored content-addressed in S3; the cropper stores per-size crops and a focal point on each image; the browser extracts a palette. Still to do: a worker step that downloads legacy image URLs found in archived bodies, re-hosts them, and writes WebP/AVIF renditions from the stored crop geometry. |

## 4. Advanced enhancements

| Requirement | Status | Notes |
| --- | --- | --- |
| AI-assisted metadata and tasting tagging | Built | The assistant reviews a story for SEO and GEO and applies headlines, descriptions, slug, keywords, captions and alt text; it describes images for search. Next step for ratings: as a taster types, suggest producer, region and variety matches against the relational tables and flag conflicts. |
| Search over review databases (pgvector or OpenSearch) | Partly built | Full-text search with ranking and highlights is live (`cms_search_*`). Faceted filtering by score, price and region arrives with the relational ratings tables. Semantic search needs an embeddings provider; recommendation is pgvector with Voyage embeddings so the data stays in Supabase. |
| Decoupled delivery through APIs and a CDN | Partly built | The CMS is already API-first (`/api/cms/*`) and the public RSS feed is served from the same data. The public sites should read a published-content API (or a read replica view) and build on their own edge deployment; nothing in the CMS depends on them. |

## Recommended order

1. Relational ratings schema plus the editor panel, with RLS policies on the new tables. This unlocks faceted search and AI tasting suggestions.
2. Block JSON body column, written by the editor and the importer's normalization pass.
3. Redirect table and edge export.
4. Newsletter bridge to Braze with the email preview already in the matrix.
5. Yjs collaboration on top of TipTap and Supabase Realtime.
6. Media optimization worker (legacy asset extraction, WebP/AVIF renditions from stored crops).
7. Edge paywall in the delivery tier once the public sites read from the content API.

Each step is additive and ships behind the existing review gate, so nothing published changes until the delivery tier is ready.
