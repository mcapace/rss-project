"""
Stage 2 - Segmentation.
pages.json -> articles.json. Uses the Claude API to (a) parse the TOC into an
article map with page ranges, then (b) convert each article's raw page text
into candidate article HTML for the in-house CMS. Source text, page anchors,
and extraction warnings are retained for editorial review. Images are candidate
associations by page range, not an editorial selection.

Requires: pip install anthropic ; ANTHROPIC_API_KEY in env.

Usage:
    python segment.py <brand_key> <issue_id> [--toc-pages 3,4]
"""
import sys, os, json, argparse, re
from html.parser import HTMLParser

from validate_inputs import parse_toc_pages, validate_issue

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
- Preserve photo credits and captions for editorial review.
- Drop page furniture: folios, running heads, pull quote
  duplicates, continued-on notices.
- Return ONLY the HTML, no markdown fences, no commentary.

TITLE: {title}

RAW TEXT:
{raw_text}"""


class _BylineText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "div", "h1", "h2", "h3", "br"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("p", "div", "h1", "h2", "h3"):
            self.parts.append("\n")


def extract_author(html: str) -> str:
    """Pull a magazine byline from structured article HTML."""
    if not html:
        return ""
    parser = _BylineText()
    parser.feed(html[:5000])
    for line in "".join(parser.parts).splitlines():
        match = re.fullmatch(r"\s*by\s+(.{3,120})\s*", line, flags=re.IGNORECASE)
        if not match:
            continue
        name = re.sub(r"\s+", " ", match.group(1)).strip()
        # Unicode letters and curly apostrophes are part of real names. Keep
        # the printed spelling; a section name is never an author fallback.
        if not any(char.isdigit() or char in "<>:!?=" for char in name):
            return name
    return ""


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
            if getattr(msg, "stop_reason", None) != "end_turn":
                raise RuntimeError("Model response was incomplete; no partial article will be imported")
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


def folio_to_pdf_page(manifest, folio, warnings=None):
    """Printed page numbers rarely equal PDF page index (covers, inserts).
    Find the PDF page whose text contains the folio as a standalone block."""
    try:
        folio_num = int(folio)
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid printed folio") from exc

    matches = sorted({p["page"] for p in manifest["pages"]
                      if any(b["text"].strip() == str(folio_num) for b in p["blocks"])})
    if len(matches) == 1:
        return matches[0]
    if warnings is not None:
        if len(matches) > 1:
            warnings.append(f"Ambiguous printed folio {folio_num}: found on PDF pages {matches}; verify page boundaries.")
        else:
            warnings.append(f"Printed folio {folio_num} could not be located; PDF page {folio_num} was assumed.")
    if matches:
        return matches[0]
    return min(max(1, folio_num), manifest.get("page_count", 100))


def segment(brand_key, issue_id, toc_pages, out_root="output"):
    import anthropic
    validate_issue(brand_key, issue_id)
    out_dir = os.path.join(out_root, brand_key, issue_id)
    pages_path = os.path.join(out_dir, "pages.json")
    if not os.path.exists(pages_path):
        raise FileNotFoundError(f"Missing {pages_path}. Run extract.py first.")

    with open(pages_path, encoding="utf-8") as source:
        manifest = json.load(source)
    client = anthropic.Anthropic()
    warnings = []

    # ---- 1. TOC -> article map ----
    toc_blocks = [
        b["text"] for p in manifest["pages"] if p["page"] in toc_pages
        for b in p["blocks"]
    ]
    toc_text = "\n".join(toc_blocks).strip()

    # If requested TOC pages are blank (e.g. ad on page 3), scan the first 8 pages
    if len(toc_text) < 50:
        warnings.append("Requested TOC pages contained little text; the first eight pages were searched. Verify the article list.")
        print(f"Warning: Low text content ({len(toc_text)} chars) on TOC pages {toc_pages}. Scanning first 8 pages.")
        candidate_blocks = [
            b["text"] for p in manifest["pages"] if 2 <= p["page"] <= 8
            for b in p["blocks"]
        ]
        toc_text = "\n".join(candidate_blocks).strip()

    print(f"Submitting TOC text ({len(toc_text)} characters) to Claude...")
    if len(toc_text) > 30_000:
        warnings.append("TOC input exceeded 30,000 characters and was truncated for extraction; verify issue completeness.")
    raw_toc_resp = call(client, TOC_PROMPT.replace("{toc_text}", toc_text[:30_000]))

    toc = []
    try:
        toc = extract_json_array(raw_toc_resp)
    except Exception as e:
        print(f"JSON parse error on TOC response: {e}")

    fallback = not toc or not isinstance(toc, list)
    if fallback:
        warnings.append("TOC extraction failed: these are provisional four-page chunks, not verified article boundaries.")
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
            start_p = entry.get("start_page")
            try:
                start_p = int(start_p)
            except (ValueError, TypeError) as exc:
                raise ValueError("TOC entry is missing a valid start page; review segmentation") from exc
            if start_p < 1:
                raise ValueError("TOC start page must be positive")
            valid_toc.append({
                "title": str(entry["title"]),
                "start_page": start_p,
                "section": str(entry.get("section", "Features"))
            })

    anchors = [art["start_page"] for art in valid_toc]
    if len(set(anchors)) != len(anchors):
        raise ValueError("Multiple TOC stories share a starting folio; manual segmentation is required before importing")
    if not valid_toc:
        raise ValueError("No valid articles were identified in the TOC")

    valid_toc.sort(key=lambda a: a["start_page"])
    print(f"Identified {len(valid_toc)} articles to segment:")
    for a in valid_toc:
        print(f"  • p.{a['start_page']} | {a['title']} [{a['section']}]")

    # ---- 2. resolve page ranges (each article runs to the next one's start) ----
    for art in valid_toc:
        art["warnings"] = []
        art["source_anchor"] = {"type": "pdf_page" if fallback else "printed_folio",
                                "start_page": art["start_page"]}
        art["resolved_start"] = art["start_page"] if fallback else folio_to_pdf_page(manifest, art["start_page"], art["warnings"])
    for i, art in enumerate(valid_toc):
        start = art["resolved_start"]
        end = valid_toc[i + 1]["resolved_start"] - 1 if i + 1 < len(valid_toc) else manifest["page_count"]
        if end < start:
            raise ValueError("TOC maps to overlapping or reversed PDF page ranges; manual review is required")
        art["pdf_pages"] = list(range(start, max(start, end) + 1))

    # ---- 3. per-article: raw text -> HTML, attach images ----
    articles = []
    for art in valid_toc:
        page_objs = [p for p in manifest["pages"] if p["page"] in art["pdf_pages"]]
        raw = "\n\n".join(b["text"] for p in page_objs for b in p["blocks"])
        if len(raw) < 100:
            warnings.append(f"Skipped candidate beginning on PDF page {art['pdf_pages'][0]}: fewer than 100 text characters; verify it is not a missing story.")
            print(f"  Skipping image-only spread or ad: {art['title']} ({len(raw)} chars)")
            continue

        print(f"  Formatting article with Claude: '{art['title']}' ({len(art['pdf_pages'])} pages, {len(raw)} chars)...")
        if len(raw) > 120_000:
            art["warnings"].append("Article input exceeded 120,000 characters; formatted text is incomplete. Full raw text is retained in the source snapshot.")
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
            "source_anchor": art["source_anchor"],
            "raw_text": raw,
            "warnings": art["warnings"],
        })
        print(f"  ✓ {art['title']} ({len(art['pdf_pages'])} pp, {len(images)} imgs, author={author or 'n/a'})")

    output_payload = {
        "brand": brand_key,
        "issue_id": issue_id,
        "articles": articles,
        "warnings": warnings,
        "toc": valid_toc,
    }
    with open(os.path.join(out_dir, "articles.json"), "w", encoding="utf-8") as f:
        json.dump(output_payload, f, indent=1)

    print(f"-> Saved {out_dir}/articles.json ({len(articles)} articles generated)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("brand")
    ap.add_argument("issue")
    ap.add_argument("--toc-pages", default="3,4")
    a = ap.parse_args()
    toc_pages = parse_toc_pages(a.toc_pages)
    segment(a.brand, a.issue, toc_pages)
