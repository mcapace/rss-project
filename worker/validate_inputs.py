"""Validate print-job identifiers before using them in paths or cloud requests."""

import os
import re
import uuid

from config import BRANDS

ISSUE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,99}\Z")


def validate_issue(brand, issue_id):
    if brand not in BRANDS:
        raise ValueError("Unsupported publication")
    if not isinstance(issue_id, str) or not ISSUE_ID.fullmatch(issue_id):
        raise ValueError("Issue ID must use 1–100 letters, numbers, underscores or hyphens")


def validate_uuid(value):
    try:
        parsed = uuid.UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Invalid issue UUID") from exc
    if str(parsed) != value.lower():
        raise ValueError("Issue UUID must use its canonical form")
    return str(parsed)


def validate_pdf_key(brand, issue_id, key):
    """Accept new immutable upload keys and the exact historical upload path."""
    validate_issue(brand, issue_id)
    if not isinstance(key, str):
        raise ValueError("Missing PDF object key")
    if key == f"pdfs/inbox/{brand}-{issue_id}.pdf":
        return key
    prefix = f"pdfs/inbox/{brand}/{issue_id}/"
    if not key.startswith(prefix) or not key.endswith(".pdf"):
        raise ValueError("PDF key must belong to this publication and issue")
    validate_uuid(key[len(prefix):-4])
    return key


def parse_toc_pages(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d+(?:,\s*\d+)*", value):
        raise ValueError("TOC pages must be comma-separated positive integers")
    pages = [int(item.strip()) for item in value.split(",")]
    if len(pages) > 32 or any(page < 1 or page > 5000 for page in pages):
        raise ValueError("TOC pages must contain at most 32 page numbers between 1 and 5000")
    return sorted(set(pages))


def validate_environment(environ=None):
    env = os.environ if environ is None else environ
    validate_issue(env.get("PRINT_BRAND"), env.get("PRINT_ISSUE_ID"))
    validate_uuid(env.get("PRINT_ISSUE_UUID"))
    validate_uuid(env.get("PRINT_INTAKE_TOKEN"))
    validate_pdf_key(env["PRINT_BRAND"], env["PRINT_ISSUE_ID"], env.get("PRINT_PDF_KEY"))
    parse_toc_pages(env.get("PRINT_TOC_PAGES"))


if __name__ == "__main__":
    validate_environment()
    print("Print job inputs validated")
