# PLATFORM_SPEC.md — Digital Edition RSS Platform

> Drop this file in the repo root of `mcapace/rss-project`. It is the source of
> truth for Cursor agents building this platform. Build phases in order; each
> phase has a ready-to-paste Cursor prompt at the bottom of its section.

## What this platform does

Replaces BlueToad's assisted RSS package. Per magazine issue (Market Watch
first, then WS/CA): upload the print-production PDF, automatically extract
articles + full-resolution images, review/correct in a dashboard, publish a
BlueToad-schema RSS feed with images hosted on our own S3/CloudFront. The
migration tool (migrationtool.winespectator.com/desk) consumes the feed URL
with no changes.

## Architecture

```
┌─ Next.js on Vercel (control plane) ─────────────────────────┐
│  /admin            issue list + upload (presigned S3 PUT)   │
│  /admin/[issue]    review UI: articles, images, re-segment  │
│  /api/upload-url   returns presigned PUT for the PDF        │
│  /api/process      inserts issue row, triggers GH Action    │
│  /api/feeds/[brand]/[issue]/feed.xml   public RSS endpoint  │
└──────────────┬──────────────────────────────────────────────┘
               │ workflow_dispatch (GitHub REST API)
┌─ GitHub Action (worker, python 3.12) ───────────────────────┐
│  1. download PDF from S3 inbox                              │
│  2. extract.py   -> images/ + pages.json                    │
│  3. segment.py   -> Claude API article segmentation         │
│  4. upload images to S3, write articles to Supabase         │
│  5. PATCH issue status -> "review"                          │
└─────────────────────────────────────────────────────────────┘
        S3: pdfs/inbox/*, {brand}/{issue}/images/*
        Supabase (Postgres): issues, articles, article_images
```

Why not process on Vercel: 150-200MB PDFs exceed body limits and function
memory/time. The browser uploads straight to S3; only JSON moves through
the app.

## Supabase schema

```sql
create type issue_status as enum ('queued','processing','review','published','failed');

create table issues (
  id uuid primary key default gen_random_uuid(),
  brand text not null,                    -- 'mw' | 'ws' | 'ca'
  issue_id text not null,                 -- '2026-09'
  issue_label text not null,              -- 'September 2026'
  pdf_key text not null,                  -- s3 key in pdfs/inbox/
  toc_pages int[] default '{3,4}',
  status issue_status default 'queued',
  stats jsonb,                            -- extraction stats from worker
  error text,
  created_at timestamptz default now(),
  unique (brand, issue_id)
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  issue_uuid uuid references issues(id) on delete cascade,
  sort_order int not null,
  title text not null,
  section text,
  pdf_pages int[],
  html text not null,
  include boolean default true,           -- toggle off to drop from feed
  created_at timestamptz default now()
);

create table article_images (
  id uuid primary key default gen_random_uuid(),
  article_uuid uuid references articles(id) on delete cascade,
  s3_key text not null,
  width int, height int,
  sort_order int default 0,
  include boolean default true,           -- kill leaked ad images here
  is_lead boolean default false
);
```

RLS: admin routes use the service role key server-side; the feed endpoint
reads with the anon key (published issues only). No public writes.

## Environment variables (Vercel + GitHub Action secrets)

```
NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION
S3_BUCKET=mshanken-digital-editions
CDN_BASE_MW=https://editions.marketwatchmag.com     (CloudFront CNAMEs)
GITHUB_TOKEN (repo-scoped, workflow_dispatch permission)  -- Vercel only
ANTHROPIC_API_KEY                                          -- Action only
ADMIN_PASSWORD (or wire Vercel auth / Clerk later)
```

## Feed contract (must match BlueToad exactly)

RSS 2.0, namespaces: media, atom, dc, wfw. Per item: `title`, `link`, `guid`,
`dc:creator` (section), `pubDate`, `description` containing full escaped
article HTML with lead `<img>` inline, plus one `media:content` element per
included image (url/type/width/height). Reference sample: `sample-feed.xml`
in this repo. The migration tool parses `description` HTML; keep `<h2>`,
`<p>`, `<strong>`, `<em>`, `<hr>` vocabulary only.

## Worker (already written — lives in /worker in this repo)

`worker/extract.py`, `worker/segment.py`, `worker/publish_db.py` (port of
publish.py that writes to Supabase instead of static XML), plus
`.github/workflows/process-issue.yml`. The Action receives inputs:
`issue_uuid, brand, issue_id, pdf_key, toc_pages`.

---

# Build phases — paste these prompts into Cursor in order

### Phase 1 — Schema + upload flow
"Read PLATFORM_SPEC.md. Create the Supabase schema via a migration file.
Build /admin (password-gated via ADMIN_PASSWORD cookie): an issues table view
and a New Issue form (brand select, issue_id, issue_label, toc_pages, PDF
file). On submit: request a presigned PUT from /api/upload-url (key
pdfs/inbox/{brand}-{issue_id}.pdf), upload direct from the browser with a
progress bar, then POST /api/process which inserts the issues row (status
queued) and returns. Do not send the PDF through any Next.js route."

### Phase 2 — Worker trigger + GitHub Action
"Read PLATFORM_SPEC.md. In /api/process, after inserting the issue row, call
the GitHub REST API workflow_dispatch for .github/workflows/process-issue.yml
on mcapace/rss-project with the issue inputs, and set status to processing.
Create that workflow: ubuntu-latest, python 3.12, pip install pymupdf
anthropic boto3 supabase; download the PDF from S3 using the pdf_key input;
run worker/extract.py then worker/segment.py then worker/publish_db.py;
on any failure PATCH the issue row to status failed with the error text."

### Phase 3 — Review UI
"Read PLATFORM_SPEC.md. Build /admin/[issueUuid]: left rail lists articles
(drag to reorder -> sort_order, toggle include, inline-edit title/section);
main pane renders the article HTML in an editable rich area saved back to
articles.html; below it an image grid from article_images (toggle include,
set is_lead, reorder). Add a 'Re-segment article' button that calls
/api/resegment with the article uuid: server route re-runs the Claude
structuring prompt on that article's raw page text and updates html.
Add a Publish button that sets issue status to published."

### Phase 4 — Feed endpoint
"Read PLATFORM_SPEC.md. Build GET /api/feeds/[brand]/[issue]/feed.xml:
load the published issue + included articles (by sort_order) + included
images, emit RSS exactly per the Feed contract section, Content-Type
application/rss+xml, Cache-Control public s-maxage=300 stale-while-
revalidate. Return 404 for unpublished issues. Add a 'Copy feed URL'
button on the issue page."

### Phase 5 — Migration tool integration (later)
"Add /api/push/[issueUuid]: POSTs {title, section, html, images[]} per
included article to MIGRATION_TOOL_WEBHOOK with a shared-secret header,
recording per-article push status. This bypasses RSS parsing entirely for
the migration tool once it exposes an intake endpoint."

## Sequencing notes

- Phase 1+2 gets a Market Watch PDF fully processed with zero UI polish.
  Validate segment.py prompt quality there before investing in Phase 3.
- CloudFront CNAME can wait; feeds work fine on raw S3 URLs during testing.
- The GH Action is the v1 worker. If issue volume or runtime ever makes it
  annoying, port the worker to an AWS Lambda container image; nothing else
  changes.
