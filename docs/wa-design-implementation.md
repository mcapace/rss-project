# Whisky Advocate design implementation

This branch applies the November 2026 desktop, tablet and phone audit to the reader site. It also improves the page flow after an article or bottle review: relevant recommendations, a buying-guide section, then the newsletter and footer.

## Reader-facing changes

- **Discovery:** shared bottle matching keeps ages and batch numbers, understands category and conversational searches, and preserves price/score/type constraints. Search presents separate result groups with counts and pagination. Incomplete cocktail imports stay out of discovery without rewriting the generated exports.
- **Ratings:** usable filter dialogs outside the scrolling rail, 12 initial results instead of 60, compact phone cards, and a comparison sheet with aligned columns and a persistent Close control.
- **Page hierarchy:** a shorter home carousel, reader navigation at tablet widths, bottle identity and actions near the top, and producer portfolios ahead of the expandable score history. Portfolios have sorting, budgets, pagination, and an accessible score table.
- **Recommended content and buying guides:** related stories use consistent image, headline, context and date cards. Five reading templates have buying paths by budget/use and relevant guide stories loaded as that section approaches the viewport. The component excludes the current story, paid stories and already-recommended stories; sponsored story pages do not receive it. Guide images have a branded unavailable-image state.
- **My Shelf:** collections for owned bottles and bottles to try, searchable notes, sorting, pagination, JSON export and validated import. Import merges new items without replacing existing notes or preferences. Saves remain local to the browser; removal/undo and storage errors remain supported.
- **Cocktails:** a collapsible pantry, distinct All / Can make now / Missing one views, correct juice matching, checkable recipe ingredients and retained serving quantities.
- **Forms and tools:** the newsletter email field comes first, optional fields are labelled, validation is announced, and duplicate signup prompts are removed. Tools are grouped by reader task.
- **Accessibility:** scoped contrast corrections, keyboard radio controls, background isolation for modal dialogs, focus restoration and accessible producer-history data. The amber brand color, phone motion, speech recognition and carousel pause/hover/focus behavior remain supported.

CSS changes are appended in labelled blocks. The branch includes current main's SEO/media changes; it does not restore older generated data.

## Validation

Run a local Next server with `VERCEL_ENV=preview` to avoid connected CMS work, then:

```sh
npm test -- --maxWorkers=3
npm run typecheck
npm run build
WA_TEST_BASE_URL=http://127.0.0.1:3030 python scripts/wa-browser-check.py
WA_TEST_BASE_URL=http://127.0.0.1:3030 python scripts/wa-design-check.py
```

Browser scripts require Python Playwright, Chromium and axe-core. Set `WA_CHROMIUM_PATH`, `WA_AXE_PATH`, and `WA_TEST_ARTIFACTS` for the environment. They do not contact third-party services.

Completed local verification:

- The full browser regression covers 130 page/width combinations at 320, 390, 834, 1440 and 1920 px, with no horizontal overflow or script errors.
- Sixteen accessibility scans cover eight page types at phone and desktop sizes; six additional scans cover the final bottle and Shelf layouts at phone, tablet and desktop sizes. No automated violations were found.
- The design journey suite checks actual filter clicks, comparison scrolling/Close, exact-age and category search, pantry requirements, recipe scaling/checklists, Shelf persistence/export/import, producer history, keyboard settings, modal background behavior and newsletter validation.
- Production-build and standalone-artifact browser checks cover direct loads, refresh, contextual links, relative assets and self-hosted fonts at 390, 834 and 1440 px.
- A phone browser with motion enabled verifies carousel rotation, the independent keyboard-focus hold after pointer exit, explicit pause, and presence of the nav animation and WebGL canvas. Reduced-motion behavior is checked separately.

## Release checks still required

The current cloud network policy blocks `api.github.com`, Vercel APIs and the public production host. Local checks are not a substitute for checking the deployed preview and production site.

Before merging, inspect the Vercel preview built from this branch's exact head. Verify the clean producer/recipe routes, responsive images and all new recommendation/buying-guide links. Preview CMS image restrictions can produce missing story photos; validate those on production after an approved release. Connected chat, shelf scanning and newsletter delivery require their service integration checks; these were not submitted during local testing.

Real-device performance/field metrics, complete CMS media and recipe remediation, account sync, saved-search alerts and cloud taste profiles remain separate work. Export/import provides portable local collections without implying account sync.
