# Whisky Advocate site: ad placement map

Every slot is a `div.ad` with a `data-slot` name in the page templates under `public/wa/`. The prototype shows the label and sizes; the ad server fills the div by slot name. Sizes follow IAB standards; the mobile size is the one served under 760px.

| Slot name | Page | Position | Desktop sizes | Mobile |
|---|---|---|---|---|
| `wa_home_billboard` | Home | After the opener, before the news front | 970×250 billboard, 728×90 fallback | 320×50 |
| `wa_home_leader_1` | Home | Between Tools and Stories | 728×90 | 320×50 |
| `wa_<page>_billboard` | Every channel and reading page | Under the masthead | 970×250, 728×90 | 320×50 |
| `wa_story_mrec_1` | Story | Sidebar, under "Bottles in this story" (sticky with the margin) | 300×250, 300×600 | 300×250 inline after the body |
| `wa_story_leader_1` | Story | Between the body and "The bottles in this story" | 728×90 | 300×250 |
| `wa_bottle_leader_1` | Bottle | Between the score context and "Try these next" | 728×90 | 300×250 |
| `wa_ratings_mrec_1` | Ratings | Under the facets column | 300×250, 300×600 | 300×250 |
| `wa_stories_leader_1`, `wa_guides_leader_1`, `wa_travel_leader_1`, `wa_cocktails_leader_1`, `wa_producers_leader_1`, `wa_top20_leader_1` | Channel pages | After the first band | 728×90 | 320×50 |

## Interstitials

Not placed in the templates on purpose. Recommended rule for launch: at most one full-screen interstitial per session, shown on the third story page view, never on the home, a ratings page or a tool, closable at once, and never while the shelf scan or the ask bar is in use. Slot name `wa_interstitial`. Implement in `site.js` `transitions()` once the ad server is chosen, so it rides the page-to-page fade.

## Rules that keep the design

- No ad above the masthead or inside the opener. The billboard is the first thing after it.
- No ad inside a reading column, a recipe card, or the ratings grid. Ads sit between bands or in a margin.
- One sticky unit per page at most (the story margin rectangle). No anchored mobile bars over the ask bar or the shelf scan.
- Ad containers reserve their height (`min-height`) so the page does not jump when a unit loads.
- Trade pages (Industry, sell sheets) carry no consumer advertising.
