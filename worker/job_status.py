"""Claim and finish a print job using its lease, without third-party packages.

The conditional PATCH is the claim: a preceding read would leave a race between
checking the lease and changing the issue. Only the matching queued attempt may
start work. Responses and credentials are deliberately excluded from logs.
"""

import argparse
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from validate_inputs import validate_environment, validate_uuid

TIMEOUT_SECONDS = 20
MAX_RESPONSE_BYTES = 4096
FAILURE_MESSAGE = "Worker failed; see the processing run logs."


class JobStatusError(RuntimeError):
    """A safe, fixed message that may be written to the workflow log."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a service credential to a redirected endpoint.
        return None


def transition(status, environ=None, *, open_url=None):
    """Return whether this exact attempt changed state in one atomic request.

    ``processing`` accepts only queued issues. ``failed`` accepts queued or
    processing issues, but callers must own the attempt before failing it.
    A missing, completed, mismatched, or superseded attempt returns False.
    """
    if status not in {"processing", "failed"}:
        raise JobStatusError("Unsupported worker status transition.")
    env = os.environ if environ is None else environ
    try:
        validate_environment(env)
    except (ValueError, TypeError, KeyError):
        raise JobStatusError("Worker input validation failed.") from None

    base_url = env.get("SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    try:
        parsed = urlsplit(base_url)
        valid_url = (parsed.scheme == "https" and parsed.hostname
                     and not parsed.username and not parsed.password
                     and parsed.path in {"", "/"}
                     and not parsed.query and not parsed.fragment)
    except (TypeError, ValueError):
        valid_url = False
    if not valid_url or not isinstance(key, str) or not key or any(char.isspace() for char in key):
        raise JobStatusError("Worker database connection is not configured correctly.")

    issue_uuid = validate_uuid(env["PRINT_ISSUE_UUID"])
    filters = {
        "id": f"eq.{issue_uuid}",
        "cms_intake_token": f"eq.{validate_uuid(env['PRINT_INTAKE_TOKEN'])}",
        "brand": f"eq.{env['PRINT_BRAND']}",
        "issue_id": f"eq.{env['PRINT_ISSUE_ID']}",
        "pdf_key": f"eq.{env['PRINT_PDF_KEY']}",
        "status": "eq.queued" if status == "processing" else "in.(queued,processing)",
        "select": "id,status",
    }
    request = Request(
        f"{base_url.rstrip('/')}/rest/v1/issues?{urlencode(filters)}",
        method="PATCH",
        data=json.dumps({"status": status, "error": FAILURE_MESSAGE if status == "failed" else None}).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation",
            "Content-Profile": "public",
            "Accept-Profile": "public",
        },
    )
    if open_url is None:
        open_url = build_opener(NoRedirects()).open
    try:
        with open_url(request, timeout=TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise JobStatusError("Database did not confirm the worker status update.")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        error.close()
        raise JobStatusError("Database rejected the worker status update.") from None
    except (URLError, OSError):
        raise JobStatusError("Database could not confirm the worker status update.") from None

    if len(raw) > MAX_RESPONSE_BYTES:
        raise JobStatusError("Database returned an invalid worker status response.")
    try:
        rows = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise JobStatusError("Database returned an invalid worker status response.") from None
    if rows == []:
        return False
    if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict)
            or rows[0].get("id") != issue_uuid or rows[0].get("status") != status):
        raise JobStatusError("Database returned an invalid worker status response.")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description="Update only the current print-job attempt.")
    parser.add_argument("status", choices=("processing", "failed"))
    args = parser.parse_args(argv)
    try:
        changed = transition(args.status)
    except JobStatusError as error:
        print(str(error), file=sys.stderr)
        return 1
    if args.status == "processing":
        if not changed:
            print("Print job is no longer queued for this attempt; work was not started.", file=sys.stderr)
            return 1
        print("Print job claimed for processing.")
    elif changed:
        print("Current print-job attempt marked failed.")
    else:
        print("Failure status skipped because this attempt is no longer active.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
