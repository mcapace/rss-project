# Morweb migration importer

The importer converts preserved Morweb records into the in-house CMS model. It
does not contact Morweb, BlueToad, an RSS feed, or a model. Dry-run is the default.
The original preservation archive remains the source of historical raw versions,
Page editor contexts, menus, gallery membership, and the separate media copies.

**Preservation is the default policy.** Every structurally valid source identity
gets a CMS record, including incomplete pages, missing-score ratings, test
content, and content whose final model is undecided. Problems that prevent
publication create a review gate. They do not remove an identity from the plan.
The importer does not decide which historical content should be deleted.

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
identities without an explicit latest selection are fatal structural errors.
An invalid ID, a cache-key/record-ID mismatch, or an ambiguous declared latest
version is also fatal. `--allow-held` cannot bypass structural errors. Earlier archive
versions are **not yet converted into editorial revision history**; the archive
retains them and their hashes remain attached to the imported source snapshot.

## What is mapped

| Source | CMS field or behavior |
| --- | --- |
| Posts/Pages ID | Stable `Posts:{id}` or `Pages:{id}` source key |
| Ratings category ID `50` | `rating`, with validated score or null when missing/invalid |
| Known editorial categories, Homepage Slider `28`, Homepage News Slider `65`, and sponsored `90Plus` `79` | `article` |
| Top20 `32` | `collection_entry` |
| Clubs `33` | `directory_entry` |
| Glossary `62` | `glossary_entry` |
| TopShelf `74` | `product_review` |
| Uncategorized-only, ambiguous, test/custom or unidentified types | `legacy_record` with a required review gate |
| Pages collection | `page`; metadata-only captures remain present with an empty body and required review |
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
an invalid or missing score is retained with `metadata.rating.score: null`, a
required review gate, and its untouched original fields in `source_payload`.
Invalid numeric scores are not copied into the normalized score field.

Plain numeric prices populate `metadata.rating.price`. Ranges, currency-prefixed
values, and other formats retain `price_raw` with a null numeric price and a
warning. Taxonomy names are resolved from the archived definition maps where
available; original category/tag IDs remain alongside those labels.

Pages require template-aware assembly of their Blocks and Widgets. Metadata-only
Pages are imported as records with `body_html: ""`,
`metadata.migration.body_status: "metadata_only"`, and a
`page_body_assembly_required` review reason. Captured block contexts and a shared
HTTP404 shell are not a finished Page body. An explicitly assembled Page can be
supplied in an envelope's `body_html` field. The raw Page metadata is retained.

Missing/empty bodies and missing titles are retained without invented content.
An empty normalized title is permitted only while the record has a required
review gate. Source HTML remains unchanged, including legacy markup that a
future rich-text editor might not support.

## Organization and publication readiness

Legacy categories remain in `metadata.categories`, `metadata.taxonomy`, and the
original source payload. Legacy tags remain in `metadata.tags`. New organization
metadata separates permanent editorial organization from temporary placements:

```json
{
  "primary_channel": null,
  "topics": [],
  "source_categories": ["News", "Homepage Slider"],
  "placements": [{
    "slot": "homepage_slider",
    "label": "Homepage Slider",
    "starts_at": null,
    "ends_at": null,
    "status": "needs_review",
    "source_category_id": "28"
  }]
}
```

The importer maps verified placement IDs `28` and `65` only. It does not infer
permanent channels, convert tags automatically to topics, invent placement
dates, or activate a homepage slot. Other slider/carousel labels remain in the
source categories for a later organization decision.

The review gate is `metadata.review = { required: boolean, reasons: string[] }`.
Missing body/title/score, ambiguous types, unresolved status/URL, conflicting
custom fields, restricted access policy, and route collisions require review.
These new records enter `publication_state: "review"`; original source state and
route remain under `metadata.migration` and in the raw source payload. A source
publication override cannot bypass a content review gate. Ordinary editor saves
cannot remove that gate or publish a gated record. Resolution is a separate
future workflow.

## Read the report before applying

The report gives retained/eligible counts by all eight kinds and publication
state, counts requiring review, fatal structural errors, every held identity and
reason, duplicate observations, route collisions, and warning counts. Here,
**eligible means eligible to persist in the CMS, not ready for publication**.
Warnings include unresolved local times, missing bylines, media/gallery
relationships that still need a crosswalk, and legacy scheduling behavior.

Every owner of a conflicting public URL is retained. The target's
`cms_documents_public_url_unique` index permits one normalized route owner per
publication. Collision records therefore receive `public_url: null` and
`slug: null` with a required review gate. Their exact original alias/path remains
in `source_payload.record`; the resolved source URL and raw route also remain in
`metadata.migration.source_public_url` and `source_route`. The report lists all
owners. No source URL is discarded, overwritten, or silently suffixed; route
ownership is unresolved until a later decision. Restricted source content is
retained in review pending an equivalent publication access policy.

For an audit that omits review-gated records from persistence, use
`--policy strict`. Those identities appear as holds in its report. This is an
explicit optional policy; the default `--policy preserve` retains them. Strict
mode is not a way to delete source content or suppress structural errors.

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
In strict mode, that flag explicitly imports only records without review gates;
the held identities stay in the report. Structural errors always stop before
writes, regardless of that flag. The CLI invokes `cms_ingest_document` sequentially and stops on
the first database failure. Each successful record is atomic, and unchanged
replays are idempotent. A report records created/unchanged/candidate counts and
the failing source key without printing private article bodies or credentials.
`--report` is required for an apply, and the CLI refuses to overwrite an input
file with that report. If a request fails with an uncertain commit outcome, the
report records that uncertainty; a source-key/hash replay resolves it safely.

Reprocessing preserves existing editorial edits. A new source version is stored
as a candidate for review rather than being automatically promoted. Historical
published state is retained on the first Morweb import only when no required
review gate exists; new print extraction starts in review. No step here publishes
a public website.

### Expand an earlier import without changing existing records

Changing normalization policy changes source hashes even when raw records have
not changed. Do not apply a regenerated whole-archive plan automatically to an
existing migration. Prepare the full plan first so cross-record collisions and
structural checks are global. Then derive the new-only delta by comparing
`brand + source_system + source_key` against the immutable manifest of already
imported identities. Do not compare titles, aliases, or kinds to establish
identity. Freeze the full-plan inventory, the excluded existing identities, the
new normalized payloads, their hashes, and the selection summary before applying
the delta. Existing documents, source snapshots, and editorial revisions remain
untouched by this expansion. Any proposed kind change for an existing identity
is reported for a later explicit migration, never silently reimported.

## Remaining migration work

This adapter does not finish Page template assembly, media copying/rewriting,
gallery relations, menu activation, taxonomy/author entity reconciliation,
timezone decisions, old URL redirects, alias collision resolution, or separate
legacy draft version import. Those remain explicit migration tasks. A successful
dry-run is a content mapping result, not proof of complete website migration.
