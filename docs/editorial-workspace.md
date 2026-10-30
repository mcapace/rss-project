# Editorial workspace (the `/cms` redesign)

The `/cms` pages share one shell modeled on the Cork audience dashboard: a
quiet, near-monochrome workspace with one accent (a deep teal, reserved for
links, focus and data), a slim collapsible navigation rail, a `⌘K` command bar,
one inverted ink hero per page, thick glass cards over a fixed ambient field,
Inter in sentence case, light and dark themes, and motion only for state
changes. Every style is scoped under the `.ed` class in
`src/components/editorial/editorial.css`, so the rest of the app is untouched.

## Pages

| Route | What it does |
| --- | --- |
| `/cms` | Home desk: greeting hero with live counts, KPI strip, review queue, recently edited, coming up (planned publish times), print intake, published this week. |
| `/cms/library` | Content library: search, status segments with counts, type filter, sortable dense table, saved views (per browser), multi-select with bulk state changes, CSV export, `j`/`k`/`x`/`↵` keyboard navigation, pagination, compact density. Supports `?issue=` to show one print issue's candidates. |
| `/cms/doc/[id]` | Document workspace: headline and byline, TipTap body with a lossless HTML fallback, Write / Preview / History / Sources / Media views, revision timeline with word-level diff and restore-to-draft, source candidates with adopt-into-draft, media captions and lead image, publishing panel (state, planned publish time), properties (section, summary, slug, URL, tags), rating fields, search metadata, `⌘S` save with optimistic-revision conflict handling and local unsaved-edit recovery. |
| `/cms/review` | Review queue grouped by print issue or source, oldest first, with a quick "back to draft" action. |
| `/cms/schedule` | Publishing calendar: published items by publication date and drafts with a planned time, plus an upcoming list. |
| `/cms/print` | Print intake: issue status, worker progress, extraction stats, links to candidates and to `/admin/[issue]`. Polls while an issue processes. |
| `/cms/migration` | Migration inventory for the selected publication. |
| `/admin/new` | Upload an issue: publication picker with the publication logos, issue ID and name, table-of-contents pages, PDF drop zone with progress. |
| `/admin/[issueUuid]` | Issue status: extraction steps, live refresh while the worker runs, counts of articles, images and notes, retry, link to the candidates. Adopts the issue's own publication if the URL names another. |
| `/reader` | Legacy editions: published RSS editions from the earlier workflow, with an item list, preview pane, image gallery and GUID copy. |
| `/login` | Sign-in card in the same style, with the publication logos and a link to the demo. |

`/admin` redirects to `/cms/print`, which is the issue inbox. The error and
not-found pages use the same card. The old demo link `/cms/demo` redirects to
`/cms?demo=1`.

## Every page shares the shell

`src/components/editorial/WorkspaceLayout.tsx` is the server layout used by
`/cms`, `/admin` and `/reader`: it loads the session (`loadWorkspaceAccess`)
and renders `CmsRoot`, which picks the demo or the connected workspace. The
theme boot script runs from the root layout so sign-in and error pages respect
the stored light or dark preference too. The earlier Tailwind header, the
`components/ui` kit and the `cms.css` access screen are gone; everything
renders through the `.ed` design system. The publication logos live in
`public/brands-cms/` (`PublicationLogo` in `Sidebar.tsx` swaps the white
variant in dark mode and inverts Market Watch, which has none).

## Demo and connected modes

`src/app/cms/layout.tsx` loads the session without redirecting
(`loadWorkspaceAccess`). `CmsRoot` then picks a mode:

- `?demo=1` on any `/cms` route opens the demo: synthetic content for all four
  publications kept in `localStorage` under `editorial-demo-store-v1`. Saves,
  revisions, creation, schedules and bulk actions all work locally. Nothing
  touches a database.
- Otherwise a signed-in CMS user gets the connected workspace over the existing
  routes under `/api/cms/*` and `/api/issues`. No API changed for this work.
- No session redirects to `/login`; a missing configuration or a denied role
  shows the access screen with a link to the demo.

The publication and demo flag travel in the query string (`?brand=`, `?demo=1`);
use `useEditorial().href(path)` to build links that keep them.

## Data layer

`src/lib/editorial/data.ts` defines `EditorialData` with a live implementation
(`createLiveData`) and a demo implementation (`createDemoData`). Pages read
through `useAsync` and refresh after any mutation via the provider's
`mutationVersion`.

Planned publish times live in `metadata.schedule.publish_at`. The list routes
do not return metadata, so the schedule and home pages scan the most recently
edited drafts and review items (bounded, cached by revision) to find them; the
UI says so when the scan is truncated. New content still cannot be published
from the workspace: the server's review gate is unchanged.

## Tests

`src/lib/editorial/__tests__/` covers the pure helpers (links, dates, diff,
schedules, saved views, ranking) and the demo store (filtering, optimistic
revisions, persistence, creation, issues, inventory). Run `npm test`,
`npm run typecheck` and `npm run build` as usual.

## Phase two: editor, images, assistant, search, audience

**Rich editor.** The body editor (`src/components/editorial/BodyEditor.tsx`)
adds fonts, sizes, text color, highlight, alignment, sub/superscript, code
blocks, tables, image insertion from the story's attached media or a URL, and
video embeds. Embeds are stored as `<figure data-embed="video">` holding the
canonical YouTube or Vimeo link, so the sanitizer keeps them and renderers turn
them into players; the editor shows the player in place. The HTML source view
remains for anything the visual editor cannot represent. `sanitizeCmsHtml`
(`src/lib/cms/html.ts`) now keeps a strict whitelist of inline styles (color,
background color, font family and size, line height, text alignment) plus
`mark`, `pre`, `code` and the embed figure; everything else is still removed.

**Preview matrix.** The editor's Preview view renders the draft at desktop (1200px), tablet (768px), mobile (390px) and email (600px) widths side by side in sandboxed iframes, fed through `postMessage` so they update as you type. The site and newsletter templates in `PreviewMatrix.tsx` are stand-ins to be replaced by the public site's and the ESP's templates.

**Image cropper.** From a story's Media tab, Crop opens a tool with aspect
presets (16:9, 3:2, 4:3, 1:1, 4:5, 2:3, free), drag and resize, a focal point,
and a download of the cropped file when the browser is allowed to read the
image. Crops are stored as normalized geometry per preset in
`metadata.media[i].crops`, with `metadata.media[i].focal`; previews honor
them with CSS. Delivery renders the actual cuts from the geometry.

**Assistant.** The panel (⌘J, or the launcher) has two modes. *SEO & GEO
review* sends the open story to `POST /api/cms/assist` (mode `seo`), which
runs `claude-opus-5-5` with a structured output schema and returns headline
options, search title, meta description, summary, slug, keywords, captions and
alt text, a quotable direct answer, an FAQ block, named entities and ranked
issues; every item has an Apply button that edits the draft. *Ask* chats about
the open story (mode `chat`) and understands search intents such as "find images
of barrels" or "show me stories about harvest", which run the unified search.
Media descriptions (mode `describe`) send a presigned image to the model and
store subject, style, mood, tags and colors on the media item. The server needs
`ANTHROPIC_API_KEY`; without it, or in the demo, rule-based checks in
`src/lib/editorial/seo-heuristics.ts` stand in and say so.

**Unified search.** `/cms/search`, the ⌘K bar and the assistant all use
`GET /api/cms/search`, backed by the additive migration
`supabase/migrations/20261031120000_cms_search.sql`: a generated `tsvector`
column with a GIN index on `cms_documents`, and three functions
(`cms_search_documents`, `cms_search_media`, `cms_search_keywords`). Images are
found by caption, credit, file name and the stored AI description, so a search
like "moody barrel room" or "sky blue vineyard" finds images by their look. The
browser also extracts a four-color palette with plain color names for each
image, which is searchable too. Until the migration is applied the route
returns 503 with a clear message.

**Audience.** `/cms/audience` shows GA4 scorecards (sessions, readers, new
readers, page views, engagement rate, average engagement) with prior-period
deltas, a daily sessions chart with a crosshair tooltip and optional
cross-publication comparison, top pages, channels and devices. Published
stories show a Performance panel in the editor. Connection works the same way
as the audience dashboard: an administrator clicks Connect Google Analytics,
signs in with Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI` set to this site's `/api/cms/analytics/callback`,
optional `GOOGLE_WORKSPACE_DOMAIN`), and picks the property; tokens live in
`cms_google_credentials` (migration `20261031130000`). A service account
(`GA4_SERVICE_ACCOUNT_JSON` plus `GA4_PROPERTY_ID_WA/_WS/_CA/_MW`) is the
alternative. The demo shows clearly labelled sample data.

## Phase three: the platform

The blueprint status map in [`platform-blueprint.md`](platform-blueprint.md)
describes each capability. Where to look in the code:

| Capability | Code |
| --- | --- |
| Relational review database and faceted search | `supabase/migrations/20261101100000_cms_catalog.sql`, `src/lib/cms/catalog-server.ts`, `/api/cms/catalog`, `/api/cms/ratings`, `CatalogField.tsx`, `RatingsSearch.tsx` (Ratings scope on `/cms/search`). |
| Block bodies and normalization | `src/lib/cms/blocks.ts`, `body_json` on every save, `scripts/normalize-bodies.ts`, importer writes blocks for created records. |
| Premium blocks and the paywall | `Premium` extension in `BodyEditor.tsx` (More menu), reader access tier in the Publishing panel (`metadata.access.tier`), `src/lib/delivery/paywall.ts`, `supabase/functions/paywall`, `/api/public/*`. |
| Newsletter bridge | `NewsletterCard.tsx`, `/api/cms/documents/[id]/newsletter`, `src/lib/newsletter/`. |
| Collaboration | `src/components/editorial/collab/`, `/api/cms/realtime`, `/api/cms/documents/[id]/collab`. |
| Redirect engine | `src/lib/cms/redirects.ts`, `redirects-server.ts`, `/api/cms/redirects`, `/api/redirects/resolve`, the redirect step in `src/proxy.ts`, `scripts/build-redirects.ts`. |
| Media renditions and re-hosting | `src/lib/media/renditions.ts`, `/api/media/[id]/[index]`, `scripts/rehost-media.ts`. |
| Semantic search | `src/lib/editorial/server/embeddings.ts`, `src/lib/editorial/rank.ts`, `scripts/embed-content.ts`. |

Tests: `src/lib/cms/__tests__/blocks.test.ts`, `redirects.test.ts`,
`src/lib/delivery/__tests__/paywall.test.ts`, `src/lib/newsletter/__tests__/render.test.ts`.
The PGlite database test replays every migration, with `auth.jwt()` and the
`extensions` schema stubbed; the pgvector migration skips itself where the
extension is unavailable.
