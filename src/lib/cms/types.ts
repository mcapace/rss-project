/** Canonical CMS records, independent of the print extractor and Morweb UI. */
export type CmsBrand = "wa" | "ws" | "ca" | "mw";
export type CmsDocumentKind = "article" | "rating" | "page";
export type CmsPublicationState = "draft" | "review" | "published" | "unpublished";
export type CmsSourceSystem = "morweb" | "print" | "manual";
export type CmsJson = string | number | boolean | null | CmsJson[] | { [key: string]: CmsJson };
export type CmsJsonObject = { [key: string]: CmsJson };

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
export const CMS_DOCUMENT_KINDS: readonly CmsDocumentKind[] = ["article", "rating", "page"];
export const CMS_PUBLICATION_STATES: readonly CmsPublicationState[] = ["draft", "review", "published", "unpublished"];
