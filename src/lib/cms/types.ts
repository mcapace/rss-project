/** Canonical CMS records, independent of the print extractor and Morweb UI. */
export type CmsBrand = "wa" | "ws" | "ca" | "mw";
export type CmsDocumentKind = "article" | "rating" | "page" | "glossary_entry" | "directory_entry" | "collection_entry" | "product_review" | "legacy_record";
export type CmsPublicationState = "draft" | "review" | "published" | "unpublished";
export type CmsSourceSystem = "morweb" | "print" | "manual";
export type CmsJson = string | number | boolean | null | CmsJson[] | { [key: string]: CmsJson };
export type CmsJsonObject = { [key: string]: CmsJson };

/** Import findings that require a separate editorial resolution step. */
export type CmsReviewGate = {
  required: boolean;
  /** Stable finding codes, for example missing_body or page_body_assembly_required. */
  reasons: string[];
};

/** Raw content evidence only; account and credential collections are excluded. */
export const CMS_MIGRATION_SOURCE_KINDS = [
  "post_version", "page_version", "page_context", "category", "tag", "page_group",
  "gallery_definition", "gallery_version", "media_file", "gallery_membership",
  "menu_definition", "menu_item", "menu_payload", "media_response_context",
  "menu_response_context", "capture_manifest", "source_context",
  "page_editor_capture", "rendered_page_snapshot", "editor_diagnostic",
  "cms_index_document", "cms_inventory_document", "menu_embedded_page_snapshot",
  "source_part",
] as const;
export type CmsMigrationSourceKind = typeof CMS_MIGRATION_SOURCE_KINDS[number];

export interface CmsMigrationSourceInput {
  brand: CmsBrand;
  archive_sha256: string;
  source_kind: CmsMigrationSourceKind;
  /** Capture identity; block/base IDs alone are not unique across page contexts. */
  source_key: string;
  /** SHA-256 of this row's canonical JSON payload. */
  payload_sha256: string;
  /** Original serialized source digest; required for source_part rows. */
  source_sha256?: string | null;
  payload: CmsJsonObject | CmsJson[];
  /** An explicit known capture instant, never an inferred publication timestamp. */
  captured_at?: string | null;
}

export interface CmsMigrationSource extends CmsMigrationSourceInput {
  id: string;
  source_sha256: string | null;
  captured_at: string | null;
  actor: string;
  created_at: string;
}

export type CmsMigrationSourceSummary = Omit<CmsMigrationSource, "payload">;

export interface CmsMigrationInventory {
  brand: CmsBrand;
  documents: {
    total: number;
    by_kind: Record<CmsDocumentKind, number>;
    by_publication_state: Record<CmsPublicationState, number>;
    by_source_system: Record<CmsSourceSystem, number>;
    review_required: number;
    pages_awaiting_assembly: number;
  };
  sources: {
    total: number;
    archive_count: number;
    by_source_kind: Record<CmsMigrationSourceKind, number>;
  };
}

export interface CmsMigrationSourceResult {
  id: string;
  action: "created" | "unchanged";
  brand: CmsBrand;
  archive_sha256: string;
  source_kind: CmsMigrationSourceKind;
  source_key: string;
  payload_sha256: string;
}

export interface CmsDocument {
  id: string;
  brand: CmsBrand;
  kind: CmsDocumentKind;
  source_system: CmsSourceSystem;
  /** Stable identity from the source; never derived from an editable title or list position. */
  source_key: string;
  /** Hash of the source that originally created this editorial record. */
  source_hash: string;
  identity_anchor: CmsJsonObject;
  title: string;
  byline: string;
  body_html: string;
  excerpt: string;
  slug: string | null;
  public_url: string | null;
  publication_state: CmsPublicationState;
  published_at: string | null;
  issue_uuid: string | null;
  metadata: CmsJsonObject;
  /** Required for every editor save to prevent lost updates. */
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface CmsIngestInput {
  brand: CmsBrand;
  kind: CmsDocumentKind;
  source_system: CmsSourceSystem;
  source_key: string;
  /** SHA-256 of the stable input before adding this field. */
  source_hash: string;
  title: string;
  body_html: string;
  byline?: string;
  excerpt?: string;
  slug?: string | null;
  public_url?: string | null;
  /** Only Morweb migration may retain a historical published state. Print always starts in review. */
  publication_state?: CmsPublicationState;
  published_at?: string | null;
  issue_uuid?: string | null;
  identity_anchor?: CmsJsonObject;
  metadata?: CmsJsonObject;
  /** Original source record or extraction, preserved without changing editorial content. */
  source_payload?: CmsJsonObject;
}

export interface CmsIngestResult {
  document_id: string;
  action: "created" | "unchanged" | "candidate";
  revision: number;
  source_snapshot_id: string;
}

export interface CmsPrintIngestResult {
  issue_uuid: string;
  documents: CmsIngestResult[];
}

export type CmsDocumentPatch = Partial<Pick<CmsDocument,
  "title" | "byline" | "body_html" | "excerpt" | "slug" | "public_url" | "metadata" | "publication_state"
>>;

export interface CmsDocumentRevision {
  id: string;
  document_id: string;
  revision: number;
  snapshot: CmsDocument;
  actor: string;
  reason: "ingest" | "edit";
  created_at: string;
}

export interface CmsSourceSnapshot {
  id: string;
  document_id: string;
  source_hash: string;
  /** Full normalized ingestion input without source_hash, including the untouched source_payload. */
  payload: Omit<CmsIngestInput, "source_hash">;
  actor: string;
  created_at: string;
}

export const CMS_BRANDS: readonly CmsBrand[] = ["wa", "ws", "ca", "mw"];
export const CMS_DOCUMENT_KINDS: readonly CmsDocumentKind[] = [
  "article", "rating", "page", "glossary_entry", "directory_entry",
  "collection_entry", "product_review", "legacy_record",
];
export const CMS_PUBLICATION_STATES: readonly CmsPublicationState[] = ["draft", "review", "published", "unpublished"];
