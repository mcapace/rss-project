# Retained migration source readers

These read-only CMS APIs make retained archive evidence discoverable. They do not
assemble page bodies, execute captured scripts, activate menus, assign routes,
rewrite media, or clear publication review requirements. Document counts and
auxiliary source counts describe separate records and must not be added together
as a count of articles.

Both endpoints require the existing verified CMS session and administrator-managed
publication permissions. Responses use `Cache-Control: private, no-store` and
`Vary: Cookie`. Unauthenticated users receive no data. The service database client
is initialized only after authorization. There are no public-source payload URLs.

## Private import transport

Archive preservation uses `cms_ingest_migration_source(p_source, p_actor)` or its
service-only `cms_ingest_migration_sources_batch(p_sources, p_actor)` wrapper.
The batch accepts 1–100 source records and at most 4 MiB of serialized JSONB, all
from the same publication and archive. It calls the existing immutable source
function for each item and returns results in input order. Any invalid item or
conflicting reused hash rolls back the entire batch. There is no public import
route, and the batch does not bypass per-source size, shape, or history checks.

Importers retain the frozen source plan, append per-record receipts only after
validating the entire ordered batch response, and verify aggregate source
identities against the database after import. A transport failure requires an
explicit reconciliation/resume; the source data is never replaced to force a
successful import.

## Publication inventory

`GET /api/cms/migration/inventory?brand=wa`

The `brand` parameter is required and must be a publication assigned to the user.
The endpoint invokes the service-only `cms_migration_inventory(p_brand)` database
function. It does not fetch article bodies or captured source payloads.

The response is `{ inventory: CmsMigrationInventory }`:

```ts
{
  brand,
  documents: {
    total,
    by_kind,
    by_publication_state,
    by_source_system,
    review_required,
    pages_awaiting_assembly
  },
  sources: {
    total,
    archive_count,
    by_source_kind
  }
}
```

Known kinds, publication states, and source systems are zero-filled maps.
`documents.by_publication_state` describes current editorial state. It does not
claim that the public website was republished. `pages_awaiting_assembly` tracks
retained page metadata still requiring body assembly; the presence of page
contexts in the auxiliary source inventory does not mean assembly is complete.
`sources` counts append-only archive evidence, such as prior versions, page
contexts, menus, categories, tags, galleries, manifests, and explicit source
parts. These are not additional editable CMS documents.

An unapplied database upgrade returns a setup-required error instead of an
empty success report. The endpoint does not fall back to downloading raw rows.

## Document source summaries

`GET /api/cms/documents/{document_uuid}/migration-sources?page=1`

The document must belong to an allowed publication. The source linkage comes
from its stable Morweb source identity, never an editable title or public URL:

- Post evidence uses `Posts:{numeric_id}:...`.
- Page evidence uses `Pages:{numeric_id}:...`.
- The delimiter is part of the prefix, so `Pages:12:` cannot match `Pages:120:`.
- Manual and print documents return an empty source list; they are not linked to
  Morweb captures merely because a string happens to resemble a legacy key.

The response is:

```ts
{
  document_id,
  source_identity, // stable Posts:/Pages: key, or null when not applicable
  sources: CmsMigrationSourceSummary[],
  total,
  page,
  pageSize: 50
}
```

Pages are one-based. Results are sorted by creation time descending, then UUID
ascending for stable pagination. Summaries select only IDs, source kind/key,
archive/payload/source hashes, capture/import timestamps, and actor. They never
select the `payload` column.

Document-linked kinds are prior post/page versions, qualified page contexts,
page editor captures, rendered page snapshots, and explicit source parts. Global
catalogs and batch captures are counted in the inventory but are not exposed
through an unrelated document. The endpoint does not infer relationships from
matching page block IDs or private page tokens.

## Explicit source inspection

`GET /api/cms/documents/{document_uuid}/migration-sources?source_id={source_uuid}`

This is the only supported raw-evidence read. It checks the document's publication
permission and requires the selected source's publication, source kind, and
stable identity prefix to match that document. An unrelated or malformed source
UUID returns not found. The database query applies those constraints before
loading the payload, and the server checks the returned linkage again.

The response is:

```ts
{
  document_id,
  source_identity,
  source: CmsMigrationSourceSummary,
  payload_json: string,
  payload_format: "escaped-json",
  read_only: true
}
```

`payload_json` is formatted, valid JSON text. Markup characters `<`, `>`, `&`, and
Unicode line separators are escaped as JSON Unicode sequences. Parsing the text
recovers the retained JSON values; the endpoint does not sanitize or rewrite the
original evidence. The response is `application/json` with
`X-Content-Type-Options: nosniff`.

A client should display the string in an ordinary text node, for example
`<pre>{payload_json}</pre>`. Never pass it or a parsed HTML field to
`dangerouslySetInnerHTML`, `eval`, a script loader, or an unsandboxed frame.
Inspecting a source does not promote it into the editorial body or resolve its
review gate. Page assembly and explicit editorial resolution remain separate
workflows.
