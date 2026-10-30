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

The old demo link `/cms/demo` redirects to `/cms?demo=1`.

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
