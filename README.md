# In-house editorial CMS foundation

An editorial workspace for Whisky Advocate and the other configured M. Shanken
publications. Existing Morweb content imports directly into CMS records. Future
print PDFs become editable review drafts in the same system.

**BlueToad RSS is not a dependency.** The repository retains optional legacy RSS
helpers and previously published feed output for compatibility, but the new
print worker writes directly to the CMS and does not auto-publish.

## What is included

- A content workspace for articles, ratings, and Pages, with a rich text editor,
  structured properties, source history, editorial revisions, and article preview.
- Named Supabase Auth accounts, publication-scoped editor access, server-side
  authorization, and revision checks to prevent lost edits.
- A Morweb importer with a local dry-run report, explicit development apply mode,
  stable source identity, and held records for unresolved mapping decisions.
- PDF intake with a queued worker, immutable source candidates, private image
  previews, and visible extraction warnings. Re-extraction preserves editor changes.
- A synthetic demo at `/cms/demo`, separate from the connected workspace at `/cms`.

This milestone prepares and edits content. It does **not** publish a replacement
public website. Historical publication states can be retained during import;
new print content requires review, and new website publishing is not connected.

## Start locally

Use Node.js 22 or 24:

```sh
npm ci
npm run dev
```

Open `http://localhost:3000/cms/demo` to try synthetic content without a database
or model credential. Demo edits are stored only in that browser. For a connected
workspace, follow the [CMS development setup](docs/cms-development.md): apply the
migrations to a development Supabase project, provision named accounts, and set
the server environment. PDF intake also needs a private development S3 bucket
and the matching GitHub worker branch and secrets.

## Documentation

- [Development setup, accounts, storage, and worker configuration](docs/cms-development.md)
- [Morweb migration mapping, dry-run reports, and development import](docs/migration-import.md)

Preserved archive files, media copies, private issue PDFs, and import reports do
not belong in this repository.

## Checks

```sh
npm test
npx tsc --noEmit
npm run build
```

For the Python worker:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r worker/requirements.txt
.venv/bin/python -m unittest discover -s worker/tests -v
```

Tests use synthetic content, a local PGlite database, and mocked external
services. A full development run using an approved real PDF still needs to
verify model extraction quality, image selection, folio mapping, S3 uploads, and
worker dispatch. An archive dry-run is a mapping check, not proof that the whole
website has been migrated.
