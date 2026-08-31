# mag-rss: BlueToad replacement pipeline

Takes the production PDF you already receive per issue and produces the same
full-content RSS (with images) that BlueToad's assisted package delivers, with
images hosted on your own S3/CloudFront instead of mydigitalpublication.com.
The migration tool consumes the new feed URL with no code changes.

## Pipeline

```
issue PDF (300RGB press file)
   |
   |  1. extract.py        deterministic, no API cost
   v
pages.json + images/       per-page text blocks w/ coordinates,
   |                       deduped full-res JPEGs (orig streams, no re-encode)
   |  2. segment.py        Claude API: TOC parse + article HTML structuring
   v
articles.json              title, section, page range, clean HTML, image list
   |
   |  3. publish.py        no API cost
   v
feed.xml + S3 upload       BlueToad-schema RSS 2.0 + MRSS image refs
```

Run per issue (Market Watch example):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python extract.py mw 2026-09 MW0926_300RGB.pdf
python segment.py mw 2026-09 --toc-pages 3,4
python publish.py mw 2026-09 --issue-label "September 2026" --upload
```

Feed lands at `{cdn_base}/{issue_id}/feed.xml`. Point the migration tool desk
at that URL instead of the contents-rss.php URL.

## What you need to provision

1. **S3 bucket** (or reuse an existing one) + a CloudFront distribution with a
   friendly CNAME per brand (`editions.marketwatchmag.com` etc). Set these in
   `config.py`. Supabase Storage also works if you'd rather stay in that stack;
   swap the boto3 block in publish.py for the supabase-py equivalent.
2. **Anthropic API key** for segment.py. Cost per issue is small: TOC parse +
   one call per article. A Market Watch issue is roughly 15-25 calls.
3. **AWS credentials** in the environment for `--upload` (standard boto3 chain).

## Validated so far (WS Aug. 31, 2026 issue, 158 pp / 188 MB)

- extract.py: 1,012 embedded images -> 502 kept after fragment/size filtering,
  ~158 MB, full-resolution DeviceRGB JPEGs extracted as original streams.
  Full text layer present with per-block coordinates.
- publish.py: emits schema-identical XML (verified against the live BlueToad
  feed structure: item/title/link/guid/dc:creator/pubDate/description with
  escaped HTML, media namespace declared, media:content per image).

## Known work items before production

- **segment.py is untested against a real issue** (needs API key + a run).
  The two prompts will need one or two iterations per brand, especially
  WS buying guide pages. Market Watch first is the right call: simpler layouts.
- **Ad filtering**: the TOC-driven page ranges naturally exclude most ads, but
  full-page ads inside an article's range will leak their image into that
  article's image list. Options: maintain a per-issue ad page list (you have
  the insertion orders), or add a cheap Claude vision call per suspect page.
- **Folio mapping**: printed page numbers vs PDF page index can drift when
  covers/inserts aren't counted. folio_to_pdf_page() handles the common case;
  verify on the first MW issue.
- **Spreads**: images crossing a spread are stored per-page halves in some
  layouts (saw two 3040px halves on p60-61 of the WS file). If MW does this,
  add a stitch step keyed on matching heights + adjacent pages.
- **Automation**: once stable, wrap in a GitHub Action triggered by dropping
  the PDF into an S3 inbox prefix, or run from the WhiskyFest-contracts-style
  admin you already operate. Per-issue runtime is a few minutes.

## Why this replaces the assisted tier

BlueToad's assisted package = article segmentation labor + image hosting.
Stage 2 automates the segmentation; Stage 3 replaces the hosting. The flipbook
is the only thing left, and you don't need it.
