# Whisky Advocate house ads

HTML5 bundles for Google Ad Manager (order "Whisky Advocate House ads", line item "LIVE WAO Ads"), seven campaigns in the seven sizes the site serves. The gallery at `/wa/house-ads/` plays every ad, compares them with what is running, and downloads the zips Ad Manager takes.

- `assets.json`: the Runway prompts, one scene per campaign, three frame shapes (wide, portrait, rect).
- `runway.mjs`: makes a `gen4_image` still and a 5 second `gen4_turbo` loop per campaign and shape (`RUNWAYML_API_SECRET` from the environment). Unchanged prompts are skipped.
- `source/`: the Runway output kept in the repo, so copy changes never need new generations.
- `build.mjs`: crops each loop to the frame around the lit subject, crossfades the last second into the first so it loops without a seam, grades it, and writes `public/wa/house-ads/<campaign>/<size>/` (index.html with `clickTag`, loop.mp4, poster.jpg, three subset fonts) plus `manifest.json`. Copy, links and the live widgets are in its `campaigns` table. The newest ratings, stories and cocktails are read from the site's data at build time, so rebuild to refresh them.
- `backups.cjs`: static end-frame JPGs at the exact pixel size (serve `public/` on :8765 first).

Rules the bundles follow: under 950 KB and 10 files (Ad Manager allows 1 MB and 50); the film loads after the page has, plays muted and inline, pauses off screen, and all motion stops by 30 seconds on the first line; reduced motion shows the end frame; the whole ad is one link that opens `clickTag`.

The Aeonik fonts are subset into each bundle. Confirm the Aeonik licence covers ad use before trafficking; the fallback is Helvetica Neue.
