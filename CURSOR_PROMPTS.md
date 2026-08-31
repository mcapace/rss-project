# CURSOR_PROMPTS.md — Build sequence for the Digital Edition RSS Platform

Run these in order, one Cursor agent session per step. Every prompt assumes
PLATFORM_SPEC.md and the worker/ folder are already in the repo root, and
worker/process-issue.yml has been moved to .github/workflows/.

Before Step 1 (manual, not Cursor):
- [ ] Move worker/process-issue.yml -> .github/workflows/process-issue.yml
- [ ] GitHub repo secrets: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
      AWS_REGION, S3_BUCKET, ANTHROPIC_API_KEY, SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
- [ ] Vercel env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
      AWS keys + region, S3_BUCKET, GITHUB_TOKEN (repo scope),
      GITHUB_REPO=mcapace/rss-project, ADMIN_PASSWORD
- [ ] S3 bucket CORS: allow PUT from your Vercel domain + localhost:3000,
      allow GET from *

---

## Step 1 — Design system and app shell

```
Read PLATFORM_SPEC.md for context on what this platform does.

Establish the visual design system for this app and refactor the layout
around it. This is an internal publishing tool for a premium magazine
company (Wine Spectator, Whisky Advocate, Cigar Aficionado, Market Watch),
so it should feel editorial and expensive, not like a generic admin
dashboard.

Direction:
- Keep the existing dark theme but refine it: near-black background
  (#0A0A0B), elevated surfaces (#141416), hairline borders
  (rgba(255,255,255,0.08)), never pure white text (use #EDEDED / #9A9AA0
  for secondary).
- One accent per brand, used sparingly (status dots, active states, the
  primary button): MW #C9A227 (gold), WS #8E2C35 (bordeaux), CA #7A5C3E
  (tobacco). Store these in a brands config object.
- Typography: a display serif for page titles and issue names (use
  next/font with Fraunces or Playfair Display), Inter for UI, JetBrains
  Mono for feed URLs, keys, and stats. Generous letter-spacing on small
  uppercase labels.
- Spacing: airy. 8pt grid, max-w-6xl centered content, cards with 24px
  padding and 12px radius. No drop shadows; use borders and subtle
  background elevation instead.
- Motion: 150ms ease transitions on hover/focus only. No gratuitous
  animation.

Build: a root layout with a slim top nav (wordmark "Editions" in the serif,
links: Issues, New Issue, Reader), a shared <Card>, <Button> (primary /
ghost variants), <StatusBadge> (queued/processing/published/failed with
brand-colored dot and subtle pulse while processing), and <BrandMark>
(small colored square + brand initials) in components/ui. Restyle the
existing feed reader pages to use these components so the whole app is
coherent. Show me the shell with placeholder pages for /admin and
/admin/new.
```

## Step 2 — Database schema

```
Read PLATFORM_SPEC.md, section "Supabase schema". Create the SQL migration
exactly as specified (issues, articles, article_images, issue_status enum)
in supabase/migrations/, plus a typed Supabase client helper in lib/ using
@supabase/supabase-js: a server-side client with the service role key
(never imported into client components) and generated TypeScript types for
the three tables. Simplification for this build: the worker publishes
directly, so treat 'review' as unused; the flow is queued -> processing ->
published | failed. Give me the SQL to paste into the Supabase SQL editor
as well.
```

## Step 3 — Upload flow (the BlueToad-replacement moment)

```
Read PLATFORM_SPEC.md. Build the New Issue flow at /admin/new, gated by a
simple password check against ADMIN_PASSWORD (httpOnly cookie set via
/api/login; redirect unauthenticated /admin/* traffic to a minimal login
screen styled per our design system).

The form, on one elegant card:
- Brand: three large selectable tiles using <BrandMark> (MW / WS / CA),
  not a dropdown.
- Issue ID (e.g. 2026-09) and Issue label (e.g. "September 2026").
- TOC pages, default "3,4", small helper text "printed pages holding the
  table of contents".
- PDF dropzone: full-width, dashed hairline border, drag-and-drop + click,
  accepts .pdf up to 500MB, shows filename and size once selected.

On submit:
1. POST /api/upload-url {brand, issueId, filename} -> returns a presigned
   S3 PUT URL for key pdfs/inbox/{brand}-{issueId}.pdf (use
   @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner, 30 min expiry).
2. PUT the file directly from the browser with XMLHttpRequest so we get
   real progress events; render a thin gold progress bar with percentage.
   The PDF must never pass through a Next.js route.
3. On upload success, POST /api/process {brand, issueId, issueLabel,
   tocPages, pdfKey} then redirect to /admin/[issueUuid].

Handle failures at each stage with an inline error state on the card, not
alerts.
```

## Step 4 — Processing trigger + status page

```
Read PLATFORM_SPEC.md. Two parts:

1. /api/process (server route, service-role Supabase client): insert the
   issues row with status 'queued', then trigger the GitHub Action via
   POST https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/
   process-issue.yml/dispatches with inputs {issue_uuid, brand, issue_id,
   pdf_key, toc_pages}, using GITHUB_TOKEN. On dispatch success update
   status to 'processing'. Return the issue uuid.

2. /admin/[issueUuid] status page: hero card with the serif issue label,
   <BrandMark>, <StatusBadge>, and created date. While status is
   'processing', poll every 5s (SWR) and show a tasteful three-step
   progress indicator (Extracting -> Segmenting -> Publishing) driven by
   issue.stats when the worker writes it; it's fine for steps to be
   approximate. On 'published': swap in a success state showing the feed
   URL in JetBrains Mono inside a copy-to-clipboard field, article count,
   image count (from stats), and two buttons: "Open feed" and "Preview in
   Reader" (links to the existing reader with ?url= prefilled to our feed).
   On 'failed': show issue.error in a red-tinted card with a "Retry"
   button that re-calls /api/process.

Also update worker/publish_db.py's final status write from 'review' to
'published' (one-line change) since this build auto-publishes.
```

## Step 5 — Issues dashboard

```
Read PLATFORM_SPEC.md. Build /admin as the issues dashboard: a clean table
(not cards) listing all issues newest first — columns: brand mark, issue
label (serif), issue id, status badge, article count, created date, and a
right-aligned monospace "Copy feed URL" affordance for published issues.
Row click navigates to /admin/[issueUuid]. Empty state: centered serif
line "No issues yet" with a gold "New Issue" button. Add a subtle filter
row: brand tabs (All / MW / WS / CA). Poll with SWR every 10s so statuses
update live.
```

## Step 6 — The feed endpoint

```
Read PLATFORM_SPEC.md, section "Feed contract" — the output must match it
exactly; sample-feed.xml in the repo is the reference. Build GET
/api/feeds/[brand]/[issue]/feed.xml as a route handler:

- Look up the published issue (404 if missing or not published).
- Load included articles by sort_order, each with included images by
  sort_order.
- Emit RSS 2.0 with the media/atom/dc/wfw namespaces; per item: title,
  link + guid ({cdn or bucket base}/{issue}/article-NNN), dc:creator =
  section, pubDate, description = lead <img> tag followed by the article
  html, fully XML-escaped; one media:content element per image with
  url/type/width/height. Image URLs: https://{S3_BUCKET}.s3.amazonaws.com/
  {s3_key} for now (we'll swap to CloudFront CNAMEs later via env var
  CDN_BASE_{BRAND} if set).
- Headers: Content-Type application/rss+xml; charset=utf-8,
  Cache-Control public, s-maxage=300, stale-while-revalidate=600.
- Build the XML with a small escape helper, no heavy deps.

Add a vitest snapshot test that renders a feed from fixture rows and
asserts the structure against the contract (namespaces present, escaped
description, media:content attributes).
```

## Step 7 — Reader integration + polish pass

```
Two finishing tasks:

1. Preset our own feeds in the existing reader: replace the demo preset
   list with published issues pulled from Supabase (brand mark + issue
   label), so the Reader doubles as feed QA. Keep the custom-URL input.

2. Polish pass across /admin, /admin/new, /admin/[issueUuid], and the
   reader: consistent page headers (small uppercase tracking-wide section
   label above a serif title), focus-visible rings in the brand accent,
   loading skeletons instead of spinners, 404/error pages in the same
   design language, favicon + "Editions" metadata, and a final check that
   nothing client-side imports the service role key. Then give me a
   one-paragraph summary of any spec deviations you made.
```

---

## First real run (after Step 6 deploys)

1. Upload a Market Watch PDF at /admin/new (TOC pages: check the printed
   issue; adjust from the 3,4 default if needed).
2. Watch /admin/[uuid] go queued -> processing -> published (~3-8 min).
3. Open the feed URL, skim titles and images against the printed issue.
4. Paste the feed URL into the migration tool desk where the BlueToad
   contents-rss.php URL goes today.

If article boundaries are off on the first issue, the fix is in
worker/segment.py's two prompts, not in the app — tune them and hit Retry.
