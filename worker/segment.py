"""
Stage 2 - Segmentation.
pages.json -> articles.json. Uses the Claude API to (a) parse the TOC into an
article map with page ranges, then (b) convert each article's raw page text
into clean HTML matching the BlueToad description format (<h2>, <p>, <strong>,
<em>, <hr>). Images are attached to articles by page-range membership.

Requires: pip install anthropic ; ANTHROPIC_API_KEY in env.

Usage:
    python segment.py <brand_key> <issue_id> [--toc-pages 3,4]
"""
import sys, os, json, argparse
import anthropic

MODEL = "claude-sonnet-4-6"   # cheap + fast is fine for this; swap up if needed

TOC_PROMPT = """You are parsing a magazine table of contents. From the text below,
return ONLY a JSON array of the issue's editorial articles (ignore ads, mastheads,
subscription promos). Each entry: {"title": str, "start_page": int, "section": str}.
Page numbers in the text are the printed folios.

TOC TEXT:
{toc_text}"""

ARTICLE_PROMPT = """Convert this raw magazine article text (extracted from a PDF,
so column breaks and hyphenation may be messy) into clean article HTML.

Rules:
- Use <h2> for section headers inside the piece, <p> for paragraphs,
  <strong>/<em> for emphasis, <hr> between major sections.
- Rejoin hyphenated line breaks. Fix obvious column-order jumbles.
- Do NOT summarize, omit, or add anything. Full text, faithfully.
- Drop page furniture: folios, running heads, photo credits, pull quote
  duplicates, continued-on notices.
- Return ONLY the HTML, no markdown fences, no commentary.

TITLE: {title}

RAW TEXT:
{raw_text}"""


def call(client, prompt, max_tokens=8000):
    msg = client.messages.create(
        model=MODEL, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}])
    return "".join(b.text for b in msg.content if b.type == "text")


def folio_to_pdf_page(manifest, folio):
    """Printed page numbers rarely equal PDF page index (covers, inserts).
    Find the PDF page whose text contains the folio as a standalone block."""
    for p in manifest["pages"]:
        for b in p["blocks"]:
            if b["text"].strip() == str(folio):
                return p["page"]
    return folio  # fall back to 1:1


def segment(brand_key, issue_id, toc_pages, out_root="../output"):
    out_dir = os.path.join(out_root, brand_key, issue_id)
    manifest = json.load(open(os.path.join(out_dir, "pages.json")))
    client = anthropic.Anthropic()

    # ---- 1. TOC -> article map ----
    toc_text = "\n".join(
        b["text"] for p in manifest["pages"] if p["page"] in toc_pages
        for b in p["blocks"])
    toc = json.loads(call(client, TOC_PROMPT.replace("{toc_text}", toc_text)))
    toc.sort(key=lambda a: a["start_page"])

    # ---- 2. resolve page ranges (each article runs to the next one's start) ----
    for i, art in enumerate(toc):
        start = folio_to_pdf_page(manifest, art["start_page"])
        end = folio_to_pdf_page(manifest, toc[i + 1]["start_page"]) - 1 \
            if i + 1 < len(toc) else manifest["page_count"]
        art["pdf_pages"] = list(range(start, max(start, end) + 1))

    # ---- 3. per-article: raw text -> HTML, attach images ----
    articles = []
    for art in toc:
        page_objs = [p for p in manifest["pages"] if p["page"] in art["pdf_pages"]]
        raw = "\n\n".join(b["text"] for p in page_objs for b in p["blocks"])
        if len(raw) < 400:          # image-only spread or ad slipped through
            continue
        html = call(client, ARTICLE_PROMPT
                    .replace("{title}", art["title"])
                    .replace("{raw_text}", raw[:150_000]))
        images = [img for p in page_objs for img in p["images"]]
        articles.append({
            "title": art["title"], "section": art.get("section", ""),
            "pdf_pages": art["pdf_pages"], "html": html,
            "images": images,
        })
        print(f"  ✓ {art['title']} ({len(art['pdf_pages'])} pp, {len(images)} imgs)")

    json.dump({"brand": brand_key, "issue_id": issue_id, "articles": articles},
              open(os.path.join(out_dir, "articles.json"), "w"), indent=1)
    print(f"-> {out_dir}/articles.json ({len(articles)} articles)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("brand"); ap.add_argument("issue")
    ap.add_argument("--toc-pages", default="3,4")
    a = ap.parse_args()
    segment(a.brand, a.issue, [int(x) for x in a.toc_pages.split(",")])
