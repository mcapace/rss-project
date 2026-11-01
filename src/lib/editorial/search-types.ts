import type { CmsBrand, CmsDocumentKind, CmsJsonObject, CmsPublicationState, CmsSourceSystem } from "@/lib/cms/types";
import type { MediaFile } from "./media-library-types";

export type SearchDocumentHit = {
  id: string; brand: CmsBrand; kind: CmsDocumentKind; source_system: CmsSourceSystem; title: string; byline: string; excerpt: string;
  publication_state: CmsPublicationState; issue_uuid: string | null; published_at: string | null; updated_at: string;
  rank: number;
  /** Plain text with <mark> around matches; render through a marker, never as raw HTML. */
  headline: string;
};

/** What AI vision stored about an image so it can be found by its look. */
export type MediaVision = {
  description: string;
  style: string;
  mood: string;
  tags: string[];
  subjects: string[];
  colors: string[];
  described_at: string;
  model: string;
};

export type MediaCrop = { x: number; y: number; w: number; h: number };

export type SearchMediaHit = {
  document_id: string; brand: CmsBrand; issue_uuid: string | null; document_title: string; media_index: number;
  file: string | null; s3_key: string | null; caption: string | null; credit: string | null; alt: string | null; is_lead: boolean;
  vision: MediaVision | CmsJsonObject | null; palette: string[] | CmsJsonObject | null; crops: Record<string, MediaCrop> | CmsJsonObject | null;
  rank: number; preview_url: string | null;
};

export type SearchKeywordHit = { keyword: string; kind: "tag" | "category" | "section"; document_count: number };

/** A file from the gallery library (Morweb's galleries, kept in S3), matched by its web name, alt text, keywords or original file name. */
export type SearchLibraryHit = MediaFile & { brand: CmsBrand; rank: number };

export type SearchResponse = { query: string; documents: SearchDocumentHit[]; media: SearchMediaHit[]; keywords: SearchKeywordHit[]; library?: SearchLibraryHit[]; /** True when pgvector matches were blended in. */ semantic?: boolean };
export type SearchScope = "all" | "documents" | "media" | "keywords" | "ratings";
