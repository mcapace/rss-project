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

# 2026 Anthropic Model identifiers
MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-6"]

TOC_PROMPT = """You are parsing a magazine table of contents. From the text below,
return ONLY a JSON array of the issue's editorial articles (ignore ads, mastheads,
subscription promos). Each entry must be: {"title": str, "start_page": int, "section": str}.
Page numbers in the text are the printed folios.

TOC TEXT:
{toc_text}

JSON ARRAY ONLY:"""

ARTICLE_PROMPT = """Convert this raw magazine article text (extracted from a PDF,
so column breaks and hyphenation may be messy) into clean article HTML.

Rules:
- Use <h2> for section headers inside the piece, <p> for paragraphs,
  <strong>/<em> for emphasis, <hr> between major sections.
- Rejoin hyphenated line breaks. Fix obvious column-order jumbles.
- Do NOT summarize, omit, or add anything. Full text, faithfully.
- Preserve the author byline when present. Prefer a dedicated line near the
  top as: <p><em>By Author Name</em></p> (or multiple authors).
- Drop page furniture: folios, running heads, photo credits, pull quote
  duplicates, continued-on notices.
- Return ONLY the HTML, no markdown fences, no commentary.

TITLE: {title}

RAW TEXT:
{raw_text}"""


BYLINE_RE_CAPS = re.compile(r"\bBY\s+([A-Z][A-Z .,'&-]{1,70}[A-Z])\b")
BYLINE_RE_TITLE = re.compile(
    r"\bBy\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)*(?:\s+and\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)*)*)"
)


def extract_author(html: str) -> str:
    """Pull a magazine byline from structured article HTML."""
    if not html:
        return ""
    head = html[:2500]
    m = BYLINE_RE_CAPS.search(head) or BYLINE_RE_TITLE.search(head)
    if not m:
        return ""
    name = m.group(1)
    name = name.replace("&amp;", "&").replace("&#39;", "'").replace("&apos;", "'")
    name = re.sub(r"\s+", " ", name).strip(" .|,-")
    if len(name) < 3 or len(name) > 80 or re.search(r"\d", name):
        return ""
    if name.isupper() and " " in name:
        name = name.title()
    return name


def call(client, prompt, max_tokens=8000):
    last_err = None
    for model in MODELS:
        try:
            msg = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=[{"role": "user", "content": prompt}]
            )
            out = "".join(b.text for b in msg.content if b.type == "text").strip()
            if out:
                return out
        except Exception as e:
            last_err = e
            print(f"Warning: model '{model}' call failed: {e}. Trying fallback...")
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
    if start != -1 and end != -1 and end > start:
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
    try:
        folio_num = int(folio)
    except (ValueError, TypeError):
        return 1

    for p in manifest["pages"]:
        for b in p["blocks"]:
            if b["text"].strip() == str(folio_num):
                return p["page"]
    return min(max(1, folio_num), manifest.get("page_count", 100))


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
    toc_text = "\n".join(toc_blocks).strip()

    # If requested TOC pages are blank (e.g. ad on page 3), scan the first 8 pages
    if len(toc_text) < 50:
        print(f"Warning: Low text content ({len(toc_text)} chars) on TOC pages {toc_pages}. Scanning first 8 pages.")
        candidate_blocks = [
            b["text"] for p in manifest["pages"] if 2 <= p["page"] <= 8
            for b in p["blocks"]
        ]
        toc_text = "\n".join(candidate_blocks).strip()

    print(f"Submitting TOC text ({len(toc_text)} characters) to Claude...")
    raw_toc_resp = call(client, TOC_PROMPT.replace("{toc_text}", toc_text[:30_000]))
    print(f"Claude raw response:\n{raw_toc_resp[:400]}...")

    toc = []
    try:
        toc = extract_json_array(raw_toc_resp)
    except Exception as e:
        print(f"JSON parse error on TOC response: {e}")

    if not toc or not isinstance(toc, list):
        print("TOC JSON was empty or unparseable. Falling back to page-chunk segmentation.")
        page_count = manifest.get("page_count", len(manifest["pages"]))
        # Generate 4-page article chunks as robust fallback
        toc = []
        for p in range(1, page_count + 1, 4):
            toc.append({
                "title": f"Feature Section (pp. {p}–{min(p+3, page_count)})",
                "start_page": p,
                "section": "Editorial"
            })

    # Sanitize TOC entries
    valid_toc = []
    for entry in toc:
        if isinstance(entry, dict) and "title" in entry:
            start_p = entry.get("start_page", 1)
            try:
                start_p = int(start_p)
            except Exception:
                start_p = 1
            valid_toc.append({
                "title": str(entry["title"]),
                "start_page": start_p,
                "section": str(entry.get("section", "Features"))
            })

    valid_toc.sort(key=lambda a: a["start_page"])
    print(f"Identified {len(valid_toc)} articles to segment:")
    for a in valid_toc:
        print(f"  • p.{a['start_page']} | {a['title']} [{a['section']}]")

    # ---- 2. resolve page ranges (each article runs to the next one's start) ----
    for i, art in enumerate(valid_toc):
        start = folio_to_pdf_page(manifest, art["start_page"])
        end = folio_to_pdf_page(manifest, valid_toc[i + 1]["start_page"]) - 1 \
            if i + 1 < len(valid_toc) else manifest["page_count"]
        art["pdf_pages"] = list(range(start, max(start, end) + 1))

    # ---- 3. per-article: raw text -> HTML, attach images ----
    articles = []
    for art in valid_toc:
        page_objs = [p for p in manifest["pages"] if p["page"] in art["pdf_pages"]]
        raw = "\n\n".join(b["text"] for p in page_objs for b in p["blocks"])
        if len(raw) < 100:
            print(f"  Skipping image-only spread or ad: {art['title']} ({len(raw)} chars)")
            continue

        print(f"  Formatting article with Claude: '{art['title']}' ({len(art['pdf_pages'])} pages, {len(raw)} chars)...")
        raw_html = call(client, ARTICLE_PROMPT
                    .replace("{title}", art["title"])
                    .replace("{raw_text}", raw[:120_000]))
        html = clean_html(raw_html)
        author = extract_author(html)
        images = [img for p in page_objs for img in p["images"]]
        articles.append({
            "title": art["title"],
            "section": art.get("section", ""),
            "author": author,
            "pdf_pages": art["pdf_pages"],
            "html": html,
            "images": images,
        })
        print(f"  ✓ {art['title']} ({len(art['pdf_pages'])} pp, {len(images)} imgs, author={author or 'n/a'})")

    output_payload = {
        "brand": brand_key,
        "issue_id": issue_id,
        "articles": articles
    }
    with open(os.path.join(out_dir, "articles.json"), "w") as f:
        json.dump(output_payload, f, indent=1)

    print(f"-> Saved {out_dir}/articles.json ({len(articles)} articles generated)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("brand")
    ap.add_argument("issue")
    ap.add_argument("--toc-pages", default="3,4")
    a = ap.parse_args()
    toc_pages = [int(x.strip()) for x in a.toc_pages.split(",") if x.strip().isdigit()]
    segment(a.brand, a.issue, toc_pages)
