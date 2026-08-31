"""
Stage 1 - Extraction.
PDF in -> images/ folder + pages.json (per-page text blocks with coordinates
and per-page image manifest). Everything downstream works off pages.json.

Usage:
    python extract.py <brand_key> <issue_id> <path/to/issue.pdf>
    e.g. python extract.py mw 2026-09 MW0926_300RGB.pdf
"""
import sys, os, json, hashlib
import pymupdf
from config import BRANDS


def extract(brand_key: str, issue_id: str, pdf_path: str, out_root: str = "output"):
    brand_key = brand_key.lower()
    if brand_key not in BRANDS:
        raise ValueError(f"Unknown brand '{brand_key}'. Supported: {list(BRANDS.keys())}")
    cfg = BRANDS[brand_key]
    out_dir = os.path.join(out_root, brand_key, issue_id)
    img_dir = os.path.join(out_dir, "images")
    os.makedirs(img_dir, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    pages, seen_hashes = [], {}
    stats = {"total_xrefs": 0, "kept": 0, "skipped_small": 0, "skipped_dupe": 0}

    for pno in range(len(doc)):
        page = doc[pno]
        if (pno + 1) in cfg["exclude_pages"]:
            continue

        # --- text: blocks with coordinates, reading order ---
        blocks = []
        for b in page.get_text("blocks"):
            x0, y0, x1, y1, text, _, btype = b[:7]
            if btype == 0 and text.strip():
                blocks.append({"bbox": [round(v, 1) for v in (x0, y0, x1, y1)],
                               "text": text.strip()})

        # --- images: raw embedded streams, deduped by content hash ---
        page_images = []
        for img in page.get_images(full=True):
            xref = img[0]
            stats["total_xrefs"] += 1
            try:
                info = doc.extract_image(xref)
            except Exception:
                continue
            w, h, data = info["width"], info["height"], info["image"]
            if (w < cfg["min_image_px"] and h < cfg["min_image_px"]) \
               or len(data) < cfg["min_image_bytes"]:
                stats["skipped_small"] += 1
                continue
            digest = hashlib.md5(data).hexdigest()
            if digest in seen_hashes:               # same asset placed twice (spreads, TOC thumbs)
                stats["skipped_dupe"] += 1
                fname = seen_hashes[digest]
            else:
                fname = f"p{pno+1:03d}_x{xref}.{info['ext']}"
                with open(os.path.join(img_dir, fname), "wb") as f:
                    f.write(data)
                seen_hashes[digest] = fname
                stats["kept"] += 1
            # where the image sits on the page (for article association)
            rects = page.get_image_rects(xref)
            bbox = [round(v, 1) for v in rects[0]] if rects else None
            page_images.append({"file": fname, "w": w, "h": h, "bbox": bbox})

        pages.append({"page": pno + 1, "blocks": blocks, "images": page_images})

    manifest = {
        "brand": brand_key, "issue_id": issue_id,
        "page_count": len(doc), "stats": stats, "pages": pages,
    }
    with open(os.path.join(out_dir, "pages.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps(stats, indent=2))
    print(f"-> {out_dir}/pages.json, {stats['kept']} images in {img_dir}/")
    return manifest


if __name__ == "__main__":
    extract(sys.argv[1], sys.argv[2], sys.argv[3])
