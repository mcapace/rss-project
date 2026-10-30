# Morweb migration importer

The importer converts preserved Morweb records into the in-house CMS model. It
does not contact Morweb, BlueToad, an RSS feed, or a model. Dry-run is the default.
The original preservation archive remains the source of historical raw versions,
Page editor contexts, menus, gallery membership, and the separate media copies.

## Run a local dry-run

Keep archives and reports outside this public repository. With dependencies
installed, run:

```sh
node --import tsx scripts/import-morweb.ts \
  --input /private/migration/content_archive.json.gz \
  --report /private/migration/import-report.json
```

For the preservation ZIP, extract only its `content_archive.json.gz` member into
your private working directory first. The CLI accepts JSON and JSON.gz; it does
not extract ZIPs. No database credentials are needed for dry-run. It does not
download or rewrite media.

Supported inputs:

- `whisky_advocate_migration_archive` JSON: use each identity's explicitly declared
  `latest_record_sha256`; keep the hashes of all archived versions as provenance.
- Browser cache exports containing `records: [{source_cache_key, record}]` and a
  `source_collection` value of `mwData.Posts` or `mwData.Pages`.
- `{Posts: {id: record}, Pages: {id: record}}` maps.
- An array of `{source_collection: "Posts" | "Pages", record, body_html?}` envelopes.

The importer never selects a version by array order. Conflicting raw duplicate
identities without an explicit latest selection are held. Earlier archive
versions are **not yet converted into editorial revision history**; the archive
retains them and their hashes remain attached to the imported source snapshot.

## What is mapped

| Source | CMS field or behavior |
| --- | --- |
| Posts/Pages ID | Stable `Posts:{id}` or `Pages:{id}` source key |
| Ratings category ID `50` | `rating`, with validated score and original price text |
| Known editorial categories | `article` |
| Clubs, Glossary, Top20, TopShelf, test/custom or unidentified types | Held for an explicit model decision |
| HTML content | Preserved unchanged in the import; editor rendering must sanitize HTML |
| Rating reviewer / editorial custom author fields | Byline, independent of the CMS account |
| `author` / `user_id` | Legacy account metadata, never an inferred writer |
| Alias/path | Existing public URL; no generated replacement slug |
| Post publication controls | Complete observed control combinations determine published/unpublished; unknown combinations become review with a warning |
| Page `publish` control | Visibility; Page `published` is a date, not a status code |
| Original date strings | Preserved as source metadata, with timezone unresolved and `published_at: null` |
| Categories/tags, SEO, media/gallery IDs | Preserved in structured metadata and original source snapshot |
| Existing source identity on reimport | Immutable source candidate; editorial content/state/URL remains unchanged |

The presence of a `custom_rating_score` key is insufficient to identify a rating:
some ordinary editorial Posts contain blank rating fields. A Ratings record with
an invalid or missing score is held for review.

Plain numeric prices populate `metadata.rating.price`. Ranges, currency-prefixed
values, and other formats retain `price_raw` with a null numeric price and a
warning. Taxonomy names are resolved from the archived definition maps where
available; original category/tag IDs remain alongside those labels.

Pages require template-aware assembly of their Blocks and Widgets. Metadata-only
Pages are held; captured block contexts and a shared HTTP404 shell are not a
finished Page body. An explicitly assembled Page can be supplied in an envelope's
`body_html` field. The raw Page metadata is still retained.

Empty body fields are held too. This makes an incomplete capture or intentional
placeholder visible for a separate decision instead of counting it as a ready
article.

## Read the report before applying

The report gives eligible counts by kind and publication state, every held
identity and reason, duplicate observations, route collisions, and warning
counts. Warnings include unresolved local times, missing bylines, media/gallery
relationships that still need a crosswalk, and legacy scheduling behavior.

Every owner of a conflicting public URL is held. The importer does not overwrite
one owner or silently add a suffix. Distinct source kinds are not merged simply
because they share a title. Restricted source content is held until the target
has an equivalent access policy.

Media references are `unverified` unless a reconciliation is supplied. This means
that this importer has not checked the asset's target storage; it does **not**
mean an earlier preservation copy failed or that an image was downloaded here.
An optional mappings JSON accepts:

```json
{
  "kindOverrides": { "Posts:123": "article" },
  "publicationOverrides": {
    "Posts:123": {
      "state": "published",
      "evidence": "Reviewed against the preserved source publication control."
    }
  },
  "assetStatus": {
    "https://example.test/files/image.jpg": "captured"
  }
}
```

Pass it with `--mappings /private/migration/mappings.json`. A kind override is a
reviewed mapping decision, not a way to remap an identity already imported under
a different CMS kind. Retain those decisions with the migration evidence.

## Apply to a development database

Apply the CMS migration to the selected development database first. Configure
dedicated `CMS_IMPORT_SUPABASE_URL` and `CMS_IMPORT_SERVICE_ROLE_KEY` environment
variables in the invoking process. The CLI deliberately does not load `.env`
files or fall back to the application's database variables. Keep keys out of
command-line arguments and version control.

```sh
node --import tsx scripts/import-morweb.ts \
  --input /private/migration/content_archive.json.gz \
  --report /private/migration/development-import-report.json \
  --apply \
  --development-target YOUR-DEVELOPMENT-PROJECT.supabase.co
```

The target hostname must match the dedicated URL exactly. These flags make the
operator choose a development target; they cannot independently prove that a
remote Supabase project is non-production. No production credentials should be
provided to this command.

An import with held records stops before writes unless `--allow-held` is given.
That flag explicitly imports only the eligible subset; the held identities stay
in the report. The CLI invokes `cms_ingest_document` sequentially and stops on
the first database failure. Each successful record is atomic, and unchanged
replays are idempotent. A report records created/unchanged/candidate counts and
the failing source key without printing private article bodies or credentials.
`--report` is required for an apply, and the CLI refuses to overwrite an input
file with that report. If a request fails with an uncertain commit outcome, the
report records that uncertainty; a source-key/hash replay resolves it safely.

Reprocessing preserves existing editorial edits. A new source version is stored
as a candidate for review rather than being automatically promoted. Historical
published state is retained on the first Morweb import; new print extraction
starts in review. No step here publishes a public website.

## Remaining migration work

This adapter does not finish Page template assembly, media copying/rewriting,
gallery relations, menu activation, taxonomy/author entity reconciliation,
timezone decisions, old URL redirects, alias collision resolution, or separate
legacy draft version import. Those remain explicit migration tasks. A successful
dry-run is a content mapping result, not proof of complete website migration.
