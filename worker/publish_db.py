"""Stage 3: store source assets and ingest editorial candidates into the CMS.

The filename is retained for existing workflow commands. This stage does not
publish anything. A single database transaction creates review drafts or adds
immutable source candidates to existing documents; it never replaces edits.
"""

import argparse
import hashlib
import json
import mimetypes
import os
import re
from pathlib import Path

from validate_inputs import validate_issue, validate_pdf_key, validate_uuid


def source_hash(payload):
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"),
                         ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def identity_for_article(article, issue_uuid):
    """Use a source page anchor, never title or collection order, as identity.

    Multiple stories on one folio require manual segmentation; assigning an
    ordinal would silently change their identities when the TOC is reordered.
    """
    source_anchor = article.get("source_anchor")
    if not isinstance(source_anchor, dict):
        raise ValueError("Missing source anchor; rerun segmentation with the CMS worker")
    anchor_type = source_anchor.get("type")
    start = source_anchor.get("start_page")
    if anchor_type not in ("printed_folio", "pdf_page") or type(start) is not int or start < 1:
        raise ValueError("Invalid source page anchor")
    label = "folio" if anchor_type == "printed_folio" else "pdf-page"
    return (
        f"issue:{issue_uuid}:{label}:{start}",
        {"issue_uuid": issue_uuid, "anchor_type": anchor_type, "start_page": start},
    )


def prepare_documents(data, manifest, issue_uuid, uploaded_media, pdf_key=None):
    """Build a deterministic, complete issue batch for cms_ingest_print_issue."""
    issue_uuid = validate_uuid(issue_uuid)
    brand, issue_id = data.get("brand"), data.get("issue_id")
    validate_issue(brand, issue_id)
    if manifest.get("brand") != brand or manifest.get("issue_id") != issue_id:
        raise ValueError("Extraction and segmentation belong to different issues")
    pdf_sha = manifest.get("source_pdf_sha256", "")
    if not isinstance(pdf_sha, str) or not re.fullmatch(r"[a-f0-9]{64}", pdf_sha):
        raise ValueError("Missing PDF checksum; rerun extraction with the CMS worker")
    if pdf_key:
        validate_pdf_key(brand, issue_id, pdf_key)
    if not data.get("articles"):
        raise ValueError("No article candidates were produced; issue cannot enter review")

    documents, source_keys = [], set()
    for article in data["articles"]:
        key, anchor = identity_for_article(article, issue_uuid)
        if key in source_keys:
            raise ValueError("Multiple stories share a source page anchor; review segmentation before importing")
        source_keys.add(key)
        if not isinstance(article.get("title"), str) or not article["title"].strip():
            raise ValueError("Article candidate has no title")
        if not isinstance(article.get("html"), str) or not article["html"].strip():
            raise ValueError("Article candidate has no body")

        media, seen_media = [], set()
        for image in article.get("images", []):
            name = image["file"]
            if name not in uploaded_media:
                raise ValueError(f"Missing source image: {name}")
            entry = uploaded_media[name]
            if entry["sha256"] in seen_media:
                continue
            seen_media.add(entry["sha256"])
            media.append({**entry, "caption": "", "credit": "", "alt": "", "is_lead": False})

        warnings = list(dict.fromkeys([
            *data.get("warnings", []), *article.get("warnings", []),
            "Editorial review required: verify extracted text, page boundaries, byline, and image rights.",
        ]))
        provenance = {
            "issue_id": issue_id, "pdf_sha256": pdf_sha,
            "pdf_pages": article.get("pdf_pages", []),
            "source_pdf_key": pdf_key,
        }
        payload = {
            "brand": brand, "kind": "article", "source_system": "print",
            "source_key": key, "identity_anchor": anchor, "issue_uuid": issue_uuid,
            "title": article["title"].strip(), "body_html": article["html"],
            "byline": article.get("author") or "", "excerpt": "",
            "metadata": {
                "section": article.get("section", ""), "media": media,
                "warnings": warnings, "provenance": provenance,
            },
            "source_payload": {
                "article": article, "provenance": provenance,
                "extraction_stats": manifest.get("stats", {}),
            },
        }
        payload["source_hash"] = source_hash(payload)
        documents.append(payload)
    return documents


def prepare_media(manifest, img_dir, brand, issue_uuid):
    """Hash referenced assets before uploads; object keys never overwrite edits."""
    media = {}
    root = Path(img_dir).resolve()
    for page in manifest["pages"]:
        for image in page.get("images", []):
            name = image["file"]
            if Path(name).name != name:
                raise ValueError("Source image filename must not contain path components")
            if name in media:
                pages = media[name]["page_numbers"]
                if page["page"] not in pages:
                    pages.append(page["page"])
                continue
            file_path = root / name
            if not file_path.is_file() or file_path.is_symlink():
                raise ValueError(f"Missing source image: {name}")
            digest = hashlib.sha256(file_path.read_bytes()).hexdigest()
            if image.get("sha256") and image["sha256"] != digest:
                raise ValueError(f"Source image checksum changed: {name}")
            suffix = file_path.suffix.lower()
            if not re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
                raise ValueError("Source image has an invalid extension")
            key = (f"cms/print/{brand}/{issue_uuid}/{manifest['source_pdf_sha256']}"
                   f"/images/{digest}{suffix}")
            media[name] = {
                "s3_key": key, "sha256": digest, "file": name,
                "width": image["w"], "height": image["h"],
                "page_numbers": [page["page"]],
            }
    return media


def run(brand, issue_id, issue_uuid, out_root="output", *, sb=None, s3=None, bucket=None, pdf_key=None, intake_token=None):
    validate_issue(brand, issue_id)
    issue_uuid = validate_uuid(issue_uuid)
    intake_token = intake_token or os.environ.get("PRINT_INTAKE_TOKEN")
    if intake_token:
        intake_token = validate_uuid(intake_token)
    out_dir = Path(out_root) / brand / issue_id
    with (out_dir / "articles.json").open(encoding="utf-8") as source:
        data = json.load(source)
    with (out_dir / "pages.json").open(encoding="utf-8") as source:
        manifest = json.load(source)
    if data.get("brand") != brand or data.get("issue_id") != issue_id:
        raise ValueError("Worker arguments do not match the extracted issue")
    media = prepare_media(manifest, out_dir / "images", brand, issue_uuid)
    pdf_key = pdf_key or os.environ.get("PRINT_PDF_KEY")
    # Validate the complete issue before making any external write.
    documents = prepare_documents(data, manifest, issue_uuid, media, pdf_key)
    if s3 is None:
        import boto3
        s3 = boto3.client("s3")
    if sb is None:
        from supabase import create_client
        sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    bucket = bucket or os.environ["S3_BUCKET"]
    for name, image in media.items():
        s3.upload_file(str(out_dir / "images" / name), bucket, image["s3_key"], ExtraArgs={
            "ContentType": mimetypes.guess_type(name)[0] or "application/octet-stream",
            "CacheControl": "private, max-age=31536000, immutable",
        })

    # The RPC locks this issue and atomically writes immutable candidates. It
    # rejects duplicate identities and published legacy issues. No table delete,
    # title matching, or editor-field update is performed by the worker.
    result = sb.rpc("cms_ingest_print_issue", {
        "p_issue_uuid": issue_uuid, "p_documents": documents, "p_actor": "print-worker",
        "p_intake_token": intake_token,
    }).execute().data
    print(f"Prepared {len(documents)} CMS review candidates and {len(media)} source images")
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("brand")
    ap.add_argument("issue")
    ap.add_argument("--issue-uuid", required=True)
    args = ap.parse_args()
    run(args.brand, args.issue, args.issue_uuid)
