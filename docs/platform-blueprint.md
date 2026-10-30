# In-house CMS platform blueprint: status

This maps the consolidated requirements for the M. Shanken editorial platform
(Wine Spectator, Cigar Aficionado, Whisky Advocate, Market Watch, Impact
Databank) against what the repository implements. Status values: **Built**,
**Built, needs configuration** (code and schema are in place; a credential,
campaign or site-side step remains), **Partly built**.

Everything is additive and ships behind the existing review gate. Migrations:
`20261101100000_cms_catalog.sql`, `20261101110000_cms_blocks_redirects_delivery.sql`,
`20261101120000_cms_embeddings.sql`. Environment variables: `.env.example`.

## 1. Database and core schema

| Requirement | Status | What exists |
| --- | --- | --- |
| Relational "Shanken schema" | Built | `cms_regions` (hierarchical), `cms_producers`, `cms_varieties`, `cms_tasters`, `cms_ratings` (one row per rating document with score, price, vintage, ABV, drink window, foreign keys to the four catalogs), plus `cms_databank_brands` and `cms_databank_volumes` for Impact Databank. `cms_upsert_rating` keeps the row in step with the editor's `metadata.rating`; the editor's rating panel uses catalog typeaheads (`CatalogField.tsx`, `GET /api/cms/catalog`) so names join existing rows. `cms_search_ratings` and `cms_rating_facets` power faceted search (`GET /api/cms/ratings`, the Ratings scope on `/cms/search`, and the public `GET /api/public/{brand}/ratings`). |
| Hybrid layout modeling in JSONB | Built | `cms_documents.body_json` holds the block layout as TipTap document JSON, written by the editor on every save next to `body_html`. `src/lib/cms/blocks.ts` converts legacy HTML to blocks and back; `cms_save_document` accepts `body_json`; `cms_set_body_json` backfills without an editorial revision. |
| Multi-tenancy with RLS bound to JWT claims | Built | `cms_jwt_brands()` reads `app_metadata.cms_role` and `cms_brands` from the JWT. Policies on documents, catalogs, ratings, redirects and newsletter sends let `authenticated` read (and, for reference data, write) only inside the user's publications; documents, ratings and history are still written only through service-role RPCs so revision history cannot be skipped. The service role keeps full access for the server routes. |
| Connection pooling through Supavisor | Built, needs configuration | The app reaches Postgres only through PostgREST and Realtime, which Supabase pools. Direct connections (ad-hoc SQL, future workers) use `SUPABASE_DB_POOLER_URL`, the Supavisor transaction-mode endpoint on port 6543, documented in `.env.example`. No code path opens port 5432. |

## 2. Digital experience and editorial functionality

| Requirement | Status | What exists |
| --- | --- | --- |
| Edge-authenticated paywalls | Built, needs configuration | Readers' tiers come from Supabase Auth `app_metadata.subscription` (`tier`, `status`, `expires_at`). Editors set a document's required tier (Publishing panel) or mark single blocks premium (editor More menu, stored as `data-premium="true"` / `premium` attrs). `src/lib/delivery/paywall.ts` strips premium blocks server-side; the Supabase edge function `supabase/functions/paywall` (deployed, `verify_jwt` off because readers may be anonymous) and the Next.js `GET /api/public/{brand}/documents/{slug}` apply the same rule, so premium text never reaches a browser without entitlement. Remaining: the public sites call one of the two and populate `app_metadata.subscription` from the subscription system. |
| Native newsletter pipeline | Built, needs configuration | The Newsletter card in the editor marks a story as a Daily Alert (or weekly, breaking, custom), renders the email server-side (`src/lib/newsletter/render.ts`, the same template as the email preview), pushes it to Braze through API-triggered campaigns (`src/lib/newsletter/braze-server.ts`: `/campaigns/trigger/send` or `/schedule/create`), and logs every attempt in `cms_newsletter_sends`. Without Braze credentials sends are recorded as simulated. Remaining: create the API-triggered campaigns in Braze and set `BRAZE_REST_ENDPOINT`, `BRAZE_API_KEY` and the campaign ids. |
| Real-time collaborative editing | Built | TipTap Collaboration with Yjs over Supabase Realtime: `src/components/editorial/collab/SupabaseProvider.ts` broadcasts updates and awareness on one channel per document, newcomers catch up from the durable state in `cms_collab_documents` plus a sync request to peers, carets show each editor's name and color, and presence avatars appear in the editor bar. Saves still go through the revision-checked `cms_save_document`; the shared state is flushed after each save. The demo and workspaces without Realtime fall back to local editing. |
| Visual headless preview matrix | Built | Desktop, tablet, mobile and email widths side by side, fed through `postMessage`. |

## 3. Historical data and media migration

| Requirement | Status | What exists |
| --- | --- | --- |
| Text structure normalization layer | Built | `src/lib/cms/blocks.ts` parses legacy HTML/XML exports with htmlparser2, drops inline CSS, classes, ids, font tags and layout wrappers, and emits the block document plus clean HTML. The Morweb importer writes `body_json` for every created record; `npm run cms:normalize` backfills existing rows (dry run by default, `--rewrite-html` to also save the cleaned HTML as a revision). |
| Legacy ID mapping and 301 redirects | Built | `cms_redirects` (legacy host and path, target or document, 301/302/307/308/410, hit counts). `npm run cms:redirects` derives rows from each migrated document's public URL and recorded aliases; a slug change in the editor adds a row automatically. `cms_resolve_redirect` answers lookups; `src/proxy.ts` redirects legacy paths at the edge via `GET /api/redirects/resolve` (cached), and `GET /api/cms/redirects?format=vercel|nginx|cloudfront|json` exports routing files for the public sites' own edge. |
| Asset extraction and optimization | Built, needs configuration | `npm run cms:rehost` finds legacy image URLs in bodies, downloads them from allowed hosts, stores originals content-addressed in S3, writes WebP and AVIF renditions at 480, 960 and 1600 pixels, detects a focal point with sharp's attention strategy, attaches the image to the document and rewrites the body to the stable `/api/media/{document}/{index}` URL. That route renders any width, format, stored crop preset or focal cover crop on demand with long cache headers for published documents. Remaining: run it against the archive with the real legacy hosts and AWS credentials. |

## 4. Advanced enhancements

| Requirement | Status | What exists |
| --- | --- | --- |
| AI-assisted metadata and tasting tagging | Built | SEO and GEO review with apply actions, image descriptions for look-based search, and now the catalog typeaheads that suggest producers, regions, varieties and tasters as a taster types, linking the rating to existing records. |
| Search over review databases | Built, needs configuration | Faceted filtering by score, price, vintage, region, variety, producer and taster is live on top of the relational tables (CMS and public routes). Semantic search uses pgvector: `cms_embeddings` with an HNSW index, `cms_match_embeddings`, Voyage AI `voyage-3` embeddings (`VOYAGE_API_KEY`), refreshed after each save and backfilled with `npm run cms:embed`; the search route blends semantic and lexical hits by reciprocal rank fusion and the UI says when it did. Without a key search stays lexical. |
| Decoupled delivery architecture | Built | The public sites read `GET /api/public/{brand}/documents` (lists), `GET /api/public/{brand}/documents/{slug}` (full document with blocks, media srcsets and the paywall applied) and `GET /api/public/{brand}/ratings` (faceted reviews), all CORS-open and CDN-cacheable, with the edge function as the lowest-latency path for gated stories. Nothing in those routes depends on the CMS UI. |

## Operating notes

- Scripts are dry runs by default and write only to a development database named twice (`CMS_IMPORT_SUPABASE_URL` and `--development-target`).
- Realtime: the browser receives the signed-in user's own access token from `GET /api/cms/realtime`; channels are per document and the durable Yjs state is service-role only.
- Two editors opening a never-shared story at the same instant could both seed it from the saved body; the first save wins and the second editor reloads. The window is about a second and the seed only happens on an empty shared document.
