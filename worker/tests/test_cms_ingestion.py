"""Offline checks: no cloud credentials, model requests, or live database."""

import hashlib
import json
import random
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from publish_db import identity_for_article, prepare_documents, prepare_media, run
from segment import call, extract_author, folio_to_pdf_page, segment
from validate_inputs import parse_toc_pages, validate_environment, validate_pdf_key

ISSUE_UUID = "c400788c-3282-4077-a993-4f31b8251111"
UPLOAD_UUID = "b0484a85-c38c-4339-b867-c61572c4f8c5"
PDF_KEY = f"pdfs/inbox/wa/test-issue/{UPLOAD_UUID}.pdf"


def article(title="Test story", page=10):
    return {
        "title": title, "section": "Features", "author": "José García",
        "html": "<p>Source body.</p>", "raw_text": "Source body.",
        "source_anchor": {"type": "printed_folio", "start_page": page},
        "pdf_pages": [page, page + 1], "images": [], "warnings": [],
    }


def manifest():
    return {"brand": "wa", "issue_id": "test-issue", "source_pdf_sha256": "a" * 64,
            "stats": {"kept": 0}, "pages": [], "page_count": 20}


def data(articles=None):
    return {"brand": "wa", "issue_id": "test-issue", "articles": articles or [article()], "warnings": []}


class FakeStorage:
    def __init__(self):
        self.uploads = []

    def upload_file(self, path, bucket, key, ExtraArgs):
        self.uploads.append((path, bucket, key, ExtraArgs))


class FakeDatabase:
    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"issue_uuid": ISSUE_UUID}))

    def table(self, name):
        raise AssertionError("Worker must not mutate legacy issue/article tables directly")


class StableIdentityTests(unittest.TestCase):
    def test_title_and_order_changes_keep_source_identity(self):
        original = prepare_documents(data([article("First", 10), article("Second", 20)]), manifest(), ISSUE_UUID, {})
        changed = prepare_documents(data([article("Retitled second", 20), article("Retitled first", 10)]), manifest(), ISSUE_UUID, {})
        self.assertEqual({doc["source_key"] for doc in original}, {doc["source_key"] for doc in changed})
        self.assertNotEqual(original[0]["source_hash"], changed[1]["source_hash"])

    def test_repeat_input_is_deterministic(self):
        first = prepare_documents(data(), manifest(), ISSUE_UUID, {})
        second = prepare_documents(data(), manifest(), ISSUE_UUID, {})
        self.assertEqual(first, second)

    def test_new_pdf_version_is_candidate_under_same_identity(self):
        previous = prepare_documents(data(), manifest(), ISSUE_UUID, {})[0]
        new_manifest = {**manifest(), "source_pdf_sha256": "b" * 64}
        replacement = prepare_documents(data(), new_manifest, ISSUE_UUID, {})[0]
        self.assertEqual(previous["source_key"], replacement["source_key"])
        self.assertEqual(previous["identity_anchor"], replacement["identity_anchor"])
        self.assertNotEqual(previous["source_hash"], replacement["source_hash"])

    def test_shared_page_anchor_requires_manual_disambiguation(self):
        with self.assertRaisesRegex(ValueError, "share a source page"):
            prepare_documents(data([article("One", 10), article("Different story", 10)]), manifest(), ISSUE_UUID, {})

    def test_fallback_identity_is_not_silently_merged_with_folio_identity(self):
        original = article()
        fallback = {**original, "source_anchor": {"type": "pdf_page", "start_page": 10}}
        self.assertNotEqual(identity_for_article(original, ISSUE_UUID)[0], identity_for_article(fallback, ISSUE_UUID)[0])

    def test_source_text_and_warnings_survive_ingestion(self):
        candidate = article()
        candidate["warnings"] = ["Text was truncated during formatting."]
        candidate["raw_text"] = "Full source text." * 100
        result = prepare_documents(data([candidate]), manifest(), ISSUE_UUID, {}, PDF_KEY)[0]
        self.assertEqual(result["source_payload"]["article"]["raw_text"], candidate["raw_text"])
        self.assertIn(candidate["warnings"][0], result["metadata"]["warnings"])
        self.assertNotIn("published", result.values())

    def test_empty_issue_is_not_success(self):
        with self.assertRaisesRegex(ValueError, "No article candidates"):
            prepare_documents({**data(), "articles": []}, manifest(), ISSUE_UUID, {})


class WorkerBoundaryTests(unittest.TestCase):
    def test_complete_issue_uses_one_rpc_and_never_legacy_tables(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / "wa" / "test-issue"
            folder.mkdir(parents=True)
            (folder / "images").mkdir()
            (folder / "articles.json").write_text(json.dumps(data()), encoding="utf-8")
            (folder / "pages.json").write_text(json.dumps(manifest()), encoding="utf-8")
            db, storage = FakeDatabase(), FakeStorage()
            run("wa", "test-issue", ISSUE_UUID, temp, sb=db, s3=storage, bucket="test", pdf_key=PDF_KEY, intake_token=UPLOAD_UUID)
            self.assertEqual(len(db.calls), 1)
            self.assertEqual(db.calls[0][0], "cms_ingest_print_issue")
            self.assertEqual(len(db.calls[0][1]["p_documents"]), 1)
            self.assertEqual(db.calls[0][1]["p_intake_token"], UPLOAD_UUID)

    def test_ambiguous_issue_does_not_upload_or_write_anything(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / "wa" / "test-issue"
            folder.mkdir(parents=True)
            (folder / "images").mkdir()
            (folder / "articles.json").write_text(json.dumps(data([article(), article("Other")])) )
            (folder / "pages.json").write_text(json.dumps(manifest()))
            db, storage = FakeDatabase(), FakeStorage()
            with self.assertRaises(ValueError):
                run("wa", "test-issue", ISSUE_UUID, temp, sb=db, s3=storage, bucket="test", pdf_key=PDF_KEY)
            self.assertEqual(db.calls, [])
            self.assertEqual(storage.uploads, [])

    def test_media_is_content_addressed_and_repeated_placements_are_retained(self):
        with tempfile.TemporaryDirectory() as temp:
            content = b"synthetic fixture image"
            (Path(temp) / "test.png").write_bytes(content)
            image = {"file": "test.png", "w": 500, "h": 400, "sha256": hashlib.sha256(content).hexdigest()}
            source = {**manifest(), "pages": [{"page": 10, "images": [image]}, {"page": 11, "images": [image]}]}
            media = prepare_media(source, temp, "wa", ISSUE_UUID)["test.png"]
            self.assertIn(image["sha256"], media["s3_key"])
            self.assertEqual(media["page_numbers"], [10, 11])
            image["sha256"] = "b" * 64
            with self.assertRaisesRegex(ValueError, "checksum changed"):
                prepare_media(source, temp, "wa", ISSUE_UUID)


class ExtractionQualityTests(unittest.TestCase):
    def test_unicode_and_nested_byline_is_preserved(self):
        examples = {
            "<p><em>By José García</em></p>": "José García",
            "<p>By John O’Connor</p>": "John O’Connor",
            "<p>By Jane Doe &amp; John Smith</p>": "Jane Doe & John Smith",
            "<p><em>By <strong>Julia Higgins</strong></em></p>": "Julia Higgins",
        }
        for html, expected in examples.items():
            with self.subTest(html=html):
                self.assertEqual(extract_author(html), expected)
        self.assertEqual(extract_author("<h2>Departments</h2><p>A story without a byline.</p>"), "")

    def test_ambiguous_or_missing_folio_is_reported(self):
        source = {"page_count": 30, "pages": [{"page": 2, "blocks": [{"text": "10"}]}, {"page": 12, "blocks": [{"text": "10"}]}]}
        warnings = []
        self.assertEqual(folio_to_pdf_page(source, 10, warnings), 2)
        self.assertIn("Ambiguous", warnings[0])
        warnings = []
        self.assertEqual(folio_to_pdf_page(source, 20, warnings), 20)
        self.assertIn("could not be located", warnings[0])

    def test_truncated_model_output_is_rejected(self):
        response = SimpleNamespace(stop_reason="max_tokens", content=[SimpleNamespace(type="text", text="<p>Incomplete")])
        client = SimpleNamespace(messages=SimpleNamespace(create=lambda **kwargs: response))
        with self.assertRaisesRegex(RuntimeError, "All Anthropic models failed"):
            call(client, "synthetic prompt")

    def test_fallback_chunks_have_visible_warning_and_raw_source(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / "wa" / "test-issue"
            folder.mkdir(parents=True)
            raw = "Synthetic article source text for offline testing. " * 10
            source = {**manifest(), "page_count": 1, "pages": [{"page": 1, "blocks": [{"text": raw}], "images": []}]}
            (folder / "pages.json").write_text(json.dumps(source))
            outputs = iter(["[]", "<p>By José García</p><p>Synthetic story.</p>"])
            fake = SimpleNamespace(Anthropic=lambda: object())
            with patch.dict(sys.modules, {"anthropic": fake}), patch("segment.call", side_effect=lambda *args: next(outputs)):
                segment("wa", "test-issue", [1], temp)
            result = json.loads((folder / "articles.json").read_text())
            self.assertTrue(any("provisional four-page chunks" in warning for warning in result["warnings"]))
            self.assertEqual(result["articles"][0]["source_anchor"]["type"], "pdf_page")
            self.assertEqual(result["articles"][0]["raw_text"], raw)


class JobValidationTests(unittest.TestCase):
    def test_valid_new_and_historical_keys(self):
        self.assertEqual(validate_pdf_key("wa", "test-issue", PDF_KEY), PDF_KEY)
        validate_pdf_key("wa", "test-issue", "pdfs/inbox/wa-test-issue.pdf")

    def test_wrong_issue_and_shell_text_are_rejected(self):
        env = {"PRINT_BRAND": "wa", "PRINT_ISSUE_ID": "test-issue", "PRINT_ISSUE_UUID": ISSUE_UUID,
               "PRINT_PDF_KEY": PDF_KEY, "PRINT_TOC_PAGES": "3,4", "PRINT_INTAKE_TOKEN": UPLOAD_UUID}
        validate_environment(env)
        for field, malicious in [("PRINT_ISSUE_ID", "../../other"), ("PRINT_BRAND", 'wa"; echo bad'),
                                 ("PRINT_ISSUE_UUID", "not-a-uuid"), ("PRINT_PDF_KEY", "pdfs/inbox/ca-other.pdf"),
                                 ("PRINT_INTAKE_TOKEN", "stale-invalid-token"),
                                 ("PRINT_TOC_PAGES", "3; echo bad")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_environment({**env, field: malicious})

    def test_toc_pages_are_bounded_and_deduplicated(self):
        self.assertEqual(parse_toc_pages("4, 3,4"), [3, 4])
        for value in ["0", "-1", "5001", "3,,4", ""]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_toc_pages(value)


class WholeIssueOfflineTests(unittest.TestCase):
    def test_pdf_extraction_to_review_batch_with_mocked_model_and_cloud(self):
        try:
            import pymupdf
            from extract import extract
        except ImportError:
            self.skipTest("Install worker/requirements.txt to run the PDF extraction fixture")
        with tempfile.TemporaryDirectory() as temp:
            pdf = Path(temp) / "synthetic-issue.pdf"
            source = pymupdf.open()
            samples = random.Random(1).randbytes(400 * 300 * 3)
            image = pymupdf.Pixmap(pymupdf.csRGB, 400, 300, samples, False).tobytes("png")
            for number in (1, 2):
                page = source.new_page()
                page.insert_text((40, 30), str(number))
                page.insert_textbox(pymupdf.Rect(40, 60, 500, 250),
                                    "Synthetic issue story. " * 20, fontsize=12)
                page.insert_image(pymupdf.Rect(40, 300, 440, 600), stream=image)
            source.save(pdf)
            source.close()
            extracted = extract("wa", "test-issue", str(pdf), temp)
            self.assertEqual(extracted["source_pdf_sha256"], hashlib.sha256(pdf.read_bytes()).hexdigest())
            outputs = iter(['[{"title":"Synthetic story","start_page":1,"section":"Features"}]',
                            "<p><em>By José García</em></p><p>Synthetic issue story.</p>"])
            fake = SimpleNamespace(Anthropic=lambda: object())
            with patch.dict(sys.modules, {"anthropic": fake}), patch("segment.call", side_effect=lambda *args: next(outputs)):
                segment("wa", "test-issue", [1], temp)
            db, storage = FakeDatabase(), FakeStorage()
            run("wa", "test-issue", ISSUE_UUID, temp, sb=db, s3=storage, bucket="test",
                pdf_key=PDF_KEY, intake_token=UPLOAD_UUID)
            prepared = db.calls[0][1]["p_documents"][0]
            self.assertEqual(prepared["byline"], "José García")
            self.assertEqual(prepared["metadata"]["provenance"]["pdf_pages"], [1, 2])
            self.assertEqual(len(prepared["metadata"]["media"]), 1)
            self.assertEqual(len(storage.uploads), 1)
            self.assertNotIn("publication_state", prepared)


if __name__ == "__main__":
    unittest.main()
