"""Lease/status boundary checks with mocked HTTP; no cloud requests or secrets."""

import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_status import FAILURE_MESSAGE, JobStatusError, NoRedirects, main, transition

ISSUE_UUID = "c400788c-3282-4077-a993-4f31b8251111"
TOKEN = "b0484a85-c38c-4339-b867-c61572c4f8c5"
OTHER_UUID = "6132a564-017c-48f5-9e1b-3b3c78c28038"
PDF_KEY = f"pdfs/inbox/wa/test-issue/{TOKEN}.pdf"
ENV = {
    "PRINT_ISSUE_UUID": ISSUE_UUID, "PRINT_INTAKE_TOKEN": TOKEN,
    "PRINT_BRAND": "wa", "PRINT_ISSUE_ID": "test-issue",
    "PRINT_PDF_KEY": PDF_KEY, "PRINT_TOC_PAGES": "3,4",
    "SUPABASE_URL": "https://database.example.test",
    "SUPABASE_SERVICE_ROLE_KEY": "synthetic-test-credential",
}


class Response(io.BytesIO):
    status = 200


class IssueEndpoint:
    """Small PostgREST contract fake that applies all supplied equality filters."""

    def __init__(self, **changes):
        self.row = {
            "id": ISSUE_UUID, "cms_intake_token": TOKEN, "brand": "wa",
            "issue_id": "test-issue", "pdf_key": PDF_KEY,
            "status": "queued", "error": "previous failure", **changes,
        }
        self.requests = []

    def __call__(self, request, *, timeout):
        self.requests.append((request, timeout))
        query = {key: value[0] for key, value in parse_qs(urlsplit(request.full_url).query).items()}
        matches = all(query.get(field) == f"eq.{self.row[field]}" for field in
                      ["id", "cms_intake_token", "brand", "issue_id", "pdf_key"])
        status_filter = query["status"]
        allowed = status_filter[4:-1].split(",") if status_filter.startswith("in.(") else [status_filter[3:]]
        if not matches or self.row["status"] not in allowed:
            return Response(b"[]")
        self.row.update(json.loads(request.data))
        return Response(json.dumps([{field: self.row[field] for field in ("id", "status")}]).encode())


class StatusTransitionTests(unittest.TestCase):
    def test_claim_is_one_conditional_patch_before_processing(self):
        endpoint = IssueEndpoint()
        self.assertTrue(transition("processing", ENV, open_url=endpoint))
        self.assertEqual(endpoint.row["status"], "processing")
        self.assertIsNone(endpoint.row["error"])
        self.assertEqual(len(endpoint.requests), 1)
        request, timeout = endpoint.requests[0]
        self.assertEqual(request.get_method(), "PATCH")
        self.assertEqual(timeout, 20)
        self.assertEqual(urlsplit(request.full_url).path, "/rest/v1/issues")
        self.assertEqual(parse_qs(urlsplit(request.full_url).query), {
            "id": [f"eq.{ISSUE_UUID}"], "cms_intake_token": [f"eq.{TOKEN}"],
            "brand": ["eq.wa"], "issue_id": ["eq.test-issue"], "pdf_key": [f"eq.{PDF_KEY}"],
            "status": ["eq.queued"], "select": ["id,status"],
        })
        self.assertEqual(request.get_header("Prefer"), "return=representation")
        self.assertEqual(request.get_header("Authorization"), f"Bearer {ENV['SUPABASE_SERVICE_ROLE_KEY']}")
        self.assertNotIn(ENV["SUPABASE_SERVICE_ROLE_KEY"], request.full_url)

    def test_every_identity_component_must_match_for_claim_and_failure(self):
        mismatches = {
            "id": OTHER_UUID, "cms_intake_token": OTHER_UUID, "brand": "ws",
            "issue_id": "different-issue", "pdf_key": "pdfs/inbox/wa/other.pdf",
        }
        for target in ("processing", "failed"):
            for field, value in mismatches.items():
                with self.subTest(target=target, field=field):
                    endpoint = IssueEndpoint(**{field: value})
                    original = endpoint.row.copy()
                    self.assertFalse(transition(target, ENV, open_url=endpoint))
                    self.assertEqual(endpoint.row, original)

    def test_duplicate_claim_and_completed_or_failed_issues_do_not_restart(self):
        endpoint = IssueEndpoint()
        self.assertTrue(transition("processing", ENV, open_url=endpoint))
        self.assertFalse(transition("processing", ENV, open_url=endpoint))
        for status in ("processing", "review", "published", "failed"):
            with self.subTest(status=status):
                endpoint = IssueEndpoint(status=status)
                self.assertFalse(transition("processing", ENV, open_url=endpoint))
                self.assertEqual(endpoint.row["status"], status)

    def test_failure_only_marks_active_matching_attempt_with_fixed_error(self):
        for status in ("queued", "processing"):
            with self.subTest(status=status):
                endpoint = IssueEndpoint(status=status)
                self.assertTrue(transition("failed", ENV, open_url=endpoint))
                self.assertEqual(endpoint.row["status"], "failed")
                self.assertEqual(endpoint.row["error"], FAILURE_MESSAGE)
        for status in ("review", "published", "failed"):
            with self.subTest(status=status):
                endpoint = IssueEndpoint(status=status)
                self.assertFalse(transition("failed", ENV, open_url=endpoint))
                self.assertEqual(endpoint.row["status"], status)

    def test_invalid_inputs_or_connection_config_stop_before_http(self):
        for key, value in [("PRINT_INTAKE_TOKEN", "bad-token"), ("PRINT_BRAND", "other"),
                           ("PRINT_PDF_KEY", "pdfs/inbox/ws-other.pdf"),
                           ("SUPABASE_URL", "http://database.example.test"),
                           ("SUPABASE_URL", "https://user:password@database.example.test"),
                           ("SUPABASE_URL", "https://database.example.test/?key=sensitive"),
                           ("SUPABASE_SERVICE_ROLE_KEY", "")]:
            with self.subTest(key=key, value=value):
                opener = Mock()
                with self.assertRaises(JobStatusError):
                    transition("processing", {**ENV, key: value}, open_url=opener)
                opener.assert_not_called()

    def test_http_and_network_errors_have_safe_messages(self):
        marker = "SENSITIVE_RESPONSE_OR_CREDENTIAL"
        errors = [HTTPError(f"https://example.test/{marker}", 401, marker, {}, io.BytesIO(marker.encode())),
                  URLError(marker), TimeoutError(marker)]
        for error in errors:
            with self.subTest(error=type(error).__name__):
                with self.assertRaises(JobStatusError) as raised:
                    transition("processing", ENV, open_url=Mock(side_effect=error))
                self.assertNotIn(marker, str(raised.exception))
                self.assertNotIn(TOKEN, str(raised.exception))

    def test_invalid_or_unconfirmed_response_cannot_start_work(self):
        responses = [b"not json", b"null", b"{}", b"x" * 4097,
                     json.dumps([{"id": OTHER_UUID, "status": "processing"}]).encode(),
                     json.dumps([{"id": ISSUE_UUID, "status": "review"}]).encode(),
                     json.dumps([{"id": ISSUE_UUID, "status": "processing"}] * 2).encode()]
        for raw in responses:
            with self.subTest(raw=raw[:60]), self.assertRaises(JobStatusError):
                transition("processing", ENV, open_url=Mock(return_value=Response(raw)))
        unconfirmed = Response(b"")
        unconfirmed.status = 204
        with self.assertRaises(JobStatusError):
            transition("processing", ENV, open_url=Mock(return_value=unconfirmed))

    def test_redirects_are_not_followed(self):
        self.assertIsNone(NoRedirects().redirect_request(None, None, 307, "redirect", {}, "https://other.test"))


class WorkflowBoundaryTests(unittest.TestCase):
    def test_cli_stale_claim_fails_but_stale_cleanup_is_a_noop(self):
        with patch("job_status.transition", return_value=False), patch("sys.stderr", new_callable=io.StringIO) as output:
            self.assertEqual(main(["processing"]), 1)
            self.assertIn("work was not started", output.getvalue())
        with patch("job_status.transition", return_value=False), patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(main(["failed"]), 0)
            self.assertIn("no longer active", output.getvalue())

    def test_helper_loads_without_site_packages(self):
        helper = Path(__file__).resolve().parents[1] / "job_status.py"
        result = subprocess.run([sys.executable, "-S", str(helper), "--help"], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_workflow_claim_precedes_installs_and_paid_work(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/process-issue.yml").read_text()
        validate = workflow.index("run: python worker/validate_inputs.py")
        claim = workflow.index("run: python worker/job_status.py processing")
        install = workflow.index("pip install")
        download = workflow.index("- name: Download PDF")
        extract = workflow.index("- name: Extract")
        self.assertLess(validate, claim)
        self.assertLess(claim, install)
        self.assertLess(install, download)
        self.assertLess(download, extract)
        self.assertIn("if: failure() && steps.claim.outcome == 'success'", workflow)
        self.assertIn("run: python worker/job_status.py failed", workflow)
        self.assertNotIn("from supabase import", workflow)


if __name__ == "__main__":
    unittest.main()
