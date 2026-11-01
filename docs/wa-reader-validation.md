# Whisky Advocate reader experience

This branch builds on current main and keeps the sponsored-content, video, CMS,
and generated public export work. No production data import, maintenance job,
or schema migration is required for these changes.

| Audit finding | Change |
| --- | --- |
| 1. Mobile Ratings | Scoped phone layouts for the lead bottle, shelves and advertisement track. |
| 2. Mobile header | Visible home logo, Menu and Search; secondary navigation remains in the menu. |
| 3. Tools/newsletter | Single phone column and inputs that fit their grid tracks. |
| 4. Save/My Shelf | Local versioned storage for bottles, stories and recipes; retrieval, removal, undo, cross-tab refresh and storage errors. |
| 5. Voice input | Feature-detected speech recognition with recording and permission/error feedback; hidden when unsupported. |
| 6. Honest filters | Any price has no ceiling, All scores has no minimum, unknown prices are excluded from budget filters, and exact query budgets are retained. |
| 7. Persistent discovery state | URL-encoded filters, query, sort and comparison slugs; refresh/share and browser-history restoration. |
| 8. Unified search | Full results grouped by bottles, stories, recipes and producers; Enter retains the query. |
| 9. Accessibility | Dialog focus handling, skip link/main landmark, readable colors, named image links, text-link underlines, larger controls and manually advanced featured stories. |
| 10. Failure states | Checked data responses, visible retry, empty results, and genuine not-found outcomes for invalid identifiers. |
| 11. Durable content | Existing story/rating routes render public exports in disconnected previews; producers have `/wa/producers/{name}` and recipes have `/wa/recipes/{slug}` with initial content, canonical/share tags and Recipe data. Legacy hash links remain usable. |
| 12. Desktop bottles | Desktop columns retained; phone stacking restricted by media queries. |
| 13. Mobile comparison | Dedicated native dialog with readable cards and individual removal. |
| 14. Loading/performance | Deduplicated data requests, self-hosted fonts, responsive local-image candidates, lazy images and reduced background motion. Live production performance remains a deployment check. |
| 15. Visual consistency | Shared responsive, focus, card, control, form and advertisement rules appended to the existing stylesheet. |

The pantry persists on the current device. Recipe serving counts stay in the URL.
Story reading preferences persist locally. Browser narration is labeled when the
recorded-voice service is unavailable. Shelf-scan illustrations are labeled as
examples; AI and retailer results include verification guidance.

## Validation

From the repository root:

```sh
npm test -- --maxWorkers=3
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build
.venv/bin/python -m unittest discover -s worker/tests -v
npm run start -- --hostname 127.0.0.1
```

`scripts/wa-browser-check.py` uses Python Playwright and Chromium plus axe-core.
The prepared cloud environment has Playwright 1.62.0 and Chromium; axe-core 4.14.0
is installed outside the checkout at `/workspace/wa-tools`. On another machine,
install those browser tools separately from the PDF worker's locked environment.

```sh
WA_AXE_PATH=/workspace/wa-tools/node_modules/axe-core/axe.min.js \
WA_TEST_ARTIFACTS=/tmp/wa-browser-results \
python3 scripts/wa-browser-check.py
```

`WA_TEST_BASE_URL` and `WA_CHROMIUM_PATH` can override the local server and browser.
The runner verifies storage, undo, pantry, URL/history, comparison, unified search,
invalid identifiers and failed-data retry. It checks page width at 320, 360, 768,
1440 and 1920 pixels, and fails on overflow, browser errors or accessibility
violations in its checked journeys. It deliberately blocks third-party requests;
these are browser-emulation checks, not real-device or live-service certification.
Results are written to `report.json` in the artifact directory.

Validated in this cloud instance on November 1, 2026: 257 application tests,
29 worker tests, type checking and the production build passed. Chromium checks
passed 11 functional journeys, 130 page/width combinations, another five producer
width checks, eight desktop axe checks and nine mobile axe checks. Those runs
reported no page overflow, accessibility violations or JavaScript errors. Menu
and chat focus behavior, responsive image delivery and disconnected AI/voice/scan
responses were also checked. External media and service responses were excluded
from the browser regressions; no production score or deployment is claimed.

## Service and release requirements

My Shelf and pantry are device-local. Account sync needs a selected identity and
storage service plus a reviewed data model; this branch does not claim sync.
Connected CMS and print workflows need the selected Supabase/S3/worker settings
in `cms-development.md`. AI requires Anthropic configuration; recorded narration
requires ElevenLabs; newsletter delivery requires Braze. Existing server settings
must be verified on the actual deployment rather than copied into this repo.

The project owner supplied these deployment targets:

- Vercel team: `michael-capaces-projects-f6224d63` (`team_DL7N0OK4rKHGGoF8QOD352t1`).
- Project: `rss-project` (`prj_gD3QNIPhRXu8DEN7sET9XsDCpjft`), Next.js on Node 24.
- Production: `main`, target `production`, public domain `rss-project-ten.vercel.app`; the website is under `/wa`.
- Existing development branch: `claude/exciting-meitner-jhi9uc`, with generated preview URLs. New PR branch previews must be confirmed through deployment metadata.
- Preview URLs require Vercel SSO; the attached production domain is public.

Release this branch by opening a PR, confirming its preview deployment, smoke-testing
that preview with authenticated access, then merging to main and confirming the
production deployment and public smoke tests. The current cloud instance's network
policy has not yet applied the saved GitHub API/Vercel additions, so remote status,
PR creation, protected-preview checks and production performance remain pending.
No localhost timing is presented as a production performance score.
