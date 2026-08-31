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
import sys, os, json, argparse, re
import anthropic

# Default to Sonnet 3.5; fallback models supported
MODELS = ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-latest", "claude-3-5-haiku-20241022"]

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
    last_err = None
    for model in MODELS:
        try:
            msg = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}]
            )
            return "".join(b.text for b in msg.content if b.type == "text")
        except Exception as e:
            last_err = e
            print(f"Warning: model {model} call failed: {e}. Trying fallback...")
            continue
    raise RuntimeError(f"All Anthropic models failed. Last error: {last_err}")


def extract_json_array(text: str):
    """Cleanly parse JSON array from model output, stripping markdown code fences."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    
    return json.loads(text)


def clean_html(text: str) -> str:
    """Strip any markdown code fences Claude might wrap around the HTML output."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def folio_to_pdf_page(manifest, folio):
    """Printed page numbers rarely equal PDF page index (covers, inserts).
    Find the PDF page whose text contains the folio as a standalone block."""
    for p in manifest["pages"]:
        for b in p["blocks"]:
            if b["text"].strip() == str(folio):
                return p["page"]
    return folio  # fall back to 1:1


def segment(brand_key, issue_id, toc_pages, out_root="output"):
    out_dir = os.path.join(out_root, brand_key, issue_id)
    pages_path = os.path.join(out_dir, "pages.json")
    if not os.path.exists(pages_path):
        raise FileNotFoundError(f"Missing {pages_path}. Run extract.py first.")

    manifest = json.load(open(pages_path))
    client = anthropic.Anthropic()

    # ---- 1. TOC -> article map ----
    toc_blocks = [
        b["text"] for p in manifest["pages"] if p["page"] in toc_pages
        for b in p["blocks"]
    ]
    toc_text = "\n".join(toc_blocks)
    if not toc_text.strip():
        print(f"Warning: No text found on TOC pages {toc_pages}. Scanning first 10 pages for TOC.")
        toc_blocks = [
            b["text"] for p in manifest["pages"] if p["page"] <= 10
            for b in p["blocks"]
        ]
        toc_text = "\n".join(toc_blocks)

    raw_toc_resp = call(client, TOC_PROMPT.replace("{toc_text}", toc_text))
    try:
        toc = extract_json_array(raw_toc_resp)
    except Exception as e:
        print(f"Failed to parse TOC JSON from model response:\n{raw_toc_resp}")
        raise e

    if not toc:
        raise ValueError("TOC parsing returned an empty article list.")

    toc.sort(key=lambda a: a.get("start_page", 1))
    print(f"Found {len(toc)} articles in TOC:")
    for a in toc:
        print(f"  - p.{a.get('start_page')} | {a.get('title')} ({a.get('section', '')})")

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
        if len(raw) < 150:          # image-only spread or ad slipped through
            print(f"  Skipping short section/ad: {art['title']} ({len(raw)} chars)")
            continue

        raw_html = call(client, ARTICLE_PROMPT
                    .replace("{title}", art["title"])
                    .replace("{raw_text}", raw[:150_000]))
        html = clean_html(raw_html)
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
    ap.add_argument("brand")
    ap.add_argument("issue")
    ap.add_argument("--toc-pages", default="3,4")
    a = ap.parse_args()
    toc_pages = [int(x.strip()) for x in a.toc_pages.split(",") if x.strip().isdigit()]
    segment(a.brand, a.issue, toc_pages)
