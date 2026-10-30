# CMS development setup

This repository is the shared foundation for the future in-house CMS across
M. Shanken publications, starting with Whisky Advocate. It separates editorial
content from the earlier RSS pipeline. Morweb
records import into `cms_documents`; future print issues extract into the same
workspace as review drafts. BlueToad is not a dependency of either path.

This guide describes development setup. The workspace does not publish a new
public website. A migrated record may retain its historical `published` status,
but its CMS record and source history remain private. The editor cannot newly
promote a document to `published` in this milestone.

## 1. Run the application

Use Node.js 22 or 24 and npm. The print worker uses Python 3.12.

```sh
npm ci
npm run dev
```

| Route | Purpose |
| --- | --- |
| `/` | Redirects to `/cms` |
| `/cms/demo` | Interactive workspace with synthetic examples; edits and example revision history stay in this browser's local storage |
| `/login` | Named Supabase Auth account sign-in |
| `/cms` | Connected editorial workspace, requiring a verified account and publication access |
| `/admin` | Print issue list |
| `/admin/new` | Upload a PDF and queue extraction into CMS drafts |
| `/admin/{issueUuid}` | Issue status and link to its CMS articles |
| `/reader` | Optional legacy RSS reader; separate from the CMS ingestion path |

The demo does not import the archive, query the editorial database, upload PDFs,
or call a model. Its sample counts are not migration totals. Use the connected
workspace when verifying persistence, permissions, and extraction.

Vercel preview deployments disable connected CMS access by default, including
sign-in, private pages/APIs, and background Supabase session refresh. The demo
remains available at `/cms/demo`. To enable a connected development preview,
first verify the explicitly authorized Supabase target, then set
`CMS_ENABLE_CONNECTED_PREVIEW=true` for the specific CMS branch. The selected
`rss-project` project is the shared future CMS target for this rollout; do not
create a second project solely because the repository originally began as RSS.
This flag does not verify or replace credentials. It must not be enabled against
an unintended production database. Print intake separately requires verification
of its S3 bucket, worker branch, and worker secrets before a PDF job is started.
Local and production runtimes retain the normal configuration and
authorization checks. The existing public published RSS output is unchanged.

The editor uses explicit saves. Workspace navigation links and the browser's
`beforeunload` event are guarded when there are unsaved edits, but full browser
Back/Forward draft recovery is not implemented in this first slice. Save before
using browser history or leaving the editor; neither the demo nor the connected
workspace should be treated as an autosave system.

The optional reader requires CMS sign-in. Internal feeds must use the exact
`/api/feeds/{brand}/{issueId}/feed.xml` path and an authorized publication.
External feeds require an exact hostname in `LEGACY_RSS_HOSTS`; only HTTPS on
the standard port is accepted. The reader rejects local/private DNS answers,
redirects, compressed responses, XML entity declarations, responses over 8 MiB,
and requests exceeding 10 seconds. Rich HTML and link/media URLs are sanitized
before they reach the reader. This adapter does not change the existing
published RSS output endpoint.

## 2. Connect the selected Supabase project

Inspect the selected project's migration history and tables first. For a fresh
development environment, apply these SQL files in order using its migration
runner. For an existing project, apply only unapplied migrations:

1. `supabase/migrations/20260831000000_init_schema.sql`
2. `supabase/migrations/20260901000000_add_article_author.sql`
3. `supabase/migrations/20261030152039_cms_foundation.sql`
4. `supabase/migrations/20261030153019_cms_service_role_privileges.sql`

If the first two migrations are already recorded as applied in the development
project, apply only the new foundation migration. The foundation migration is
additive and is intended to run once; it is not a reset script. It retains the
legacy `issues`, `articles`, and `article_images` tables while adding the CMS
records, immutable source snapshots, editorial revisions, and atomic intake/save
functions. The privilege migration explicitly removes Supabase's inherited
service-role defaults before granting only the operations the CMS needs. History
tables permit reading and appending. The application role cannot update, delete,
or truncate history. Migration filenames match the applied remote
history so a future migration runner does not attempt to apply them twice.

CMS tables have row-level security enabled with no direct access granted to
browser `anon` or `authenticated` roles. Private API routes verify the current
Supabase Auth user, enforce publication access, then use server credentials to
read or write. Do not add public table policies to make the editor work.

Configure the web application through a local `.env.local` or your development
host's secret settings. Environment files are ignored by Git.

| Variable | Use |
| --- | --- |
| `CMS_ENABLE_CONNECTED_PREVIEW` | Optional Vercel preview opt-in; only the exact value `true` enables connected CMS access. Scope it to the approved CMS branch after verifying the selected database. Unnecessary locally or in production. |
| `SUPABASE_URL` | Explicitly selected project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Project publishable/anon credential used for authentication |
| `SUPABASE_SECRET_KEY` **or** `SUPABASE_SERVICE_ROLE_KEY` | Privileged server database client; use a development project credential |
| `AWS_REGION` | Region of the development asset bucket |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Server credentials for the configured development bucket |
| `S3_BUCKET` | Explicit development bucket name; required for print verification and private image previews |
| `GITHUB_TOKEN` | Server credential permitted to dispatch the worker in the selected repository |
| `GITHUB_REPO` | Exact `owner/repository`, such as your development fork |
| `GITHUB_WORKFLOW_REF` | Branch or tag containing the new direct-to-CMS worker; see below |
| `LEGACY_RSS_HOSTS` | Optional comma-separated exact HTTPS hostnames allowed in the legacy reader; leave unset to disable external RSS fetches |

For authentication, the code also accepts `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` as fallback
names. Privileged Supabase, AWS, GitHub, and model credentials must never use a
`NEXT_PUBLIC_` name, appear in a client component, or be committed to the repo.
Print-only settings are unnecessary for trying the demo or editing existing CMS
records; they are necessary before starting a PDF extraction.

## 3. Provision named editors

Use trusted Supabase Auth administration to create a named email/password account
for each editor. Set the following **administrator-managed `app_metadata`** on
that user:

```json
{
  "cms_role": "editor",
  "cms_brands": ["wa"]
}
```

Supported publication keys are `wa` (Whisky Advocate), `ws` (Wine Spectator), `ca`
(Cigar Aficionado), and `mw` (Market Watch). An editor receives only assigned,
recognized publications. An administrator uses `"cms_role": "admin"` and receives
all configured publications. Missing roles, unsupported roles, and editors with
no assigned publications are rejected.

Publication selection uses the `brand` query parameter across `/cms`, `/admin`,
`/admin/new`, issue detail, and the optional reader. Unknown or unassigned values
resolve to an authorized publication in the UI; API requests for an unauthorized
publication are rejected. Whisky Advocate is the default when assigned. The issue
inbox alone supports an explicit `brand=all` view across the user's publications.
Its publication filter runs before the latest-100 limit. All links into create or
upload flows resolve to one specific authorized publication.

The demo exposes all four configured publications without querying the database.
Whisky Advocate has the synthetic seed content; other publications begin empty.
Changing the demo publication never copies records across publications. Adding a
future publication requires an explicit shared configuration and schema update;
the selector does not grant access or provision a publication by itself.

Do not put these permissions in user-editable `user_metadata`; the application
does not use it for authorization. The former shared administrator password is
not the CMS access model. Sign in at `/login` with the named account and confirm
`/api/cms/session` reports the intended role and publications.

## 4. Configure private print storage

Use an explicitly selected development S3 bucket. Keep input PDFs and
`cms/print/` assets private. The web server needs object upload/read permissions
for the intake prefix and read access for CMS image previews; the worker needs
read access to intake PDFs and write access to CMS print images. Preview URLs
are short-lived signed reads generated only after document authorization.

A new upload uses this unique object key:

```text
pdfs/inbox/{brand}/{issueId}/{randomUUID}.pdf
```

The upload endpoint returns `uploadHeaders` with both `Content-Type:
application/pdf` and `If-None-Match: *`. The browser forwards every returned
header. The overwrite condition belongs to the signed upload contract; do not
remove it to work around a CORS error.

A development bucket CORS rule for a local app can be:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Add the exact HTTPS development deployment origin when needed. This rule permits
browser requests; it does not grant public object access. The server checks the
uploaded object's size and `%PDF-` signature before queuing it. The current UI
accepts PDFs up to 500 MB.

Extracted images use content-addressed keys under
`cms/print/{brand}/{issueUuid}/{pdfSha256}/images/`. Re-extraction does not delete
prior article records or images. The original PDF hash, page anchors, raw source
text, and extraction warnings are retained with the source candidate.

## 5. Connect the development worker

The server dispatches `.github/workflows/process-issue.yml` using
`GITHUB_REPO`, `GITHUB_TOKEN`, and **`GITHUB_WORKFLOW_REF`**. All three are required;
the application does not silently default to `main`.

For this development branch, set the reference to
`codex/inhouse-cms-foundation` only after that branch and its reviewed workflow
exist in the configured GitHub repository. Pointing at an older branch could
run the earlier feed-publishing implementation. Use a repository token with the
permissions needed to dispatch Actions in that repository, stored only on the
server.

Configure these Actions secrets with **the same development project and bucket**
used by the web application:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
S3_BUCKET
ANTHROPIC_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The Python worker reads the privileged Supabase credential specifically from
`SUPABASE_SERVICE_ROLE_KEY`; the web application's `SUPABASE_SECRET_KEY` alias is
not used by the worker. Do not mix production worker secrets with a development
web application.

The workflow receives `issue_uuid`, `intake_token`, `brand`, `issue_id`,
`pdf_key`, and `toc_pages` from the queue API. Inputs become environment variables
and are validated before path or cloud use. The token is generated by the atomic
`cms_queue_issue` function, not a secret that an editor supplies. It identifies
one intake attempt; stale workers cannot commit or mark a later attempt failed.
Let the application queue the issue instead of inventing a token for a manual
workflow dispatch.

Immediately after input validation, `worker/job_status.py processing` atomically
claims the current queued attempt and records `processing`. The claim matches
the issue, publication, PDF key, and intake token; a stale or already claimed
attempt stops before package installation, PDF downloads, or model calls.

The claimed job installs the hashed Python dependency lock, extracts text and images,
segments articles, then calls `cms_ingest_print_issue` once. That call commits the
whole issue's document candidates and its `review` state together. The worker
never automatically publishes new articles. A repeated source hash is unchanged;
a changed source becomes an immutable candidate, leaving saved editorial content
and status intact.

If a later step fails after a successful claim, the workflow runs
`worker/job_status.py failed`. This handler uses only the Python standard
library, so it also works when dependency installation fails. Its conditional
update affects only that matching intake attempt while it remains active;
completed or superseded attempts are left unchanged.

The UI reports aggregate issue status, not per-stage worker telemetry. **Drafts
ready** links directly to the corresponding articles in the CMS. Failed attempts
can be retried; active attempts and previously published legacy issues are not
accepted as new queue jobs.

## 6. Import the preserved archive separately

Follow [migration-import.md](migration-import.md). The default CLI run is a local
dry-run that produces a mapping report without database writes. Applying imports
requires explicit development-target flags and dedicated import credentials.

Keep preserved source archives, copied media, and migration reports outside this
repository. Do not assume a successful article import also assembles every Page,
rewrites media, resolves navigation, or completes old-URL routing. Those are
separate reconciliation tasks described in the importer guide.

## 7. Verify before a real issue run

Local checks:

```sh
npm test
npx tsc --noEmit
npm run build
```

Worker checks with the locked Python dependencies:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r worker/requirements.txt
.venv/bin/python -m unittest discover -s worker/tests -v
```

The test suite exercises authorization, publication boundaries, stale revision
rejection, atomic SQL ingestion in PGlite, importer mapping, and the worker with
synthetic data and mocked cloud/model clients. The worker suite includes a small
PDF created locally for the test. These checks do not establish production PDF
quality, live S3 CORS, GitHub dispatch permissions, or real model output.

A connected development trial is still required. Use one approved issue and a
development bucket/database. Compare every extracted story with the source PDF:
article boundaries, folios, bylines, tables, captions, image assignments, and
missing or duplicated material. Review visible fallback/truncation warnings;
ambiguous segmentation needs an editorial decision. Save an edit, re-extract the
same issue, and verify that the edit survives while source changes appear as
candidates. Also verify a second editor cannot silently overwrite a newer saved
revision.

Passing these checks prepares this foundation for further development. Public
website delivery, production migration reconciliation, and production cutover
remain separate work.
