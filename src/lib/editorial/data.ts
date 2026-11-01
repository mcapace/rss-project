import type {
  CmsBrand, CmsDocument, CmsDocumentKind, CmsDocumentPatch, CmsDocumentRevision,
  CmsJsonObject, CmsMigrationInventory, CmsPublicationState,
} from "@/lib/cms/types";
import { CMS_BRANDS, CMS_DOCUMENT_KINDS, CMS_PUBLICATION_STATES } from "@/lib/cms/types";
import type { CmsUser } from "@/lib/cms/access";
import { demoDocuments, demoIssues, demoRevision } from "./demo-data";
import type { AssistChatReply, AssistDocument, AssistRequest, SeoGeoAnalysis } from "./assist-types";
import type { AudienceReport, ConnectionStatus, PagePerformance } from "./analytics-types";
import { sampleAudience, samplePagePerformance } from "./analytics-sample";
import { heuristicAnalysis } from "./seo-heuristics";
import type { MediaVision, SearchDocumentHit, SearchKeywordHit, SearchMediaHit, SearchResponse, SearchScope } from "./search-types";
import type { MediaFile, MediaFilePage, MediaGallery, MediaLibraryOverview } from "./media-library-types";
import type { CatalogEntry, CatalogType, CollabState, NewsletterRequest, NewsletterSend, RatingFacets, RatingFilters, RatingHit, RatingSearchResponse, RealtimeGrant } from "./platform-types";
import { matchScore, stripHtml } from "./helpers";

/* ------------------------------------------------------------------ */
/* Shapes                                                             */
/* ------------------------------------------------------------------ */

export type DocumentRow = Pick<CmsDocument,
  "id" | "brand" | "kind" | "source_system" | "title" | "byline" | "excerpt" | "publication_state" | "published_at" | "issue_uuid" | "revision" | "created_at" | "updated_at"
>;

export type DocumentQuery = {
  brand?: CmsBrand | null;
  kind?: CmsDocumentKind | "" | null;
  state?: CmsPublicationState | "" | null;
  issue?: string | null;
  q?: string | null;
  page?: number;
};

export type DocumentPage = { documents: DocumentRow[]; total: number; page: number; pageSize: number };
export type Overview = { total: number; review: number; drafts: number; ratings: number };

export type SourceReview = {
  id: string; source_hash: string; created_at: string; is_candidate: boolean;
  title: string; byline: string; body_html: string; preview_html: string; metadata: CmsJsonObject;
};
export type HistoryData = { revisions: CmsDocumentRevision[]; sources: SourceReview[] };

export type MediaItem = {
  index: number; preview_url: string | null;
  s3_key?: string; sha256?: string; file?: string;
  caption?: string; credit?: string; alt?: string; is_lead?: boolean;
};

export type IssueStatus = "queued" | "processing" | "review" | "published" | "failed";
export type PrintIssue = {
  id: string; brand: CmsBrand; issue_id: string; issue_label: string; pdf_key: string;
  toc_pages: number[] | null; status: IssueStatus; stats: CmsJsonObject | null; error: string | null;
  created_at: string; articleCount: number | null; feedUrl: string | null;
};

export type SessionUser = CmsUser;

export class DataError extends Error {
  constructor(public status: number, message: string, public code = "request_failed") {
    super(message);
    this.name = "DataError";
  }
}

export interface EditorialData {
  readonly demo: boolean;
  listDocuments(query: DocumentQuery, signal?: AbortSignal): Promise<DocumentPage>;
  overview(brand: CmsBrand | null, signal?: AbortSignal): Promise<Overview>;
  getDocument(id: string, signal?: AbortSignal): Promise<{ document: CmsDocument; preview_html: string }>;
  saveDocument(id: string, expectedRevision: number, patch: CmsDocumentPatch): Promise<CmsDocument>;
  createDocument(input: { brand: CmsBrand; kind: CmsDocumentKind; title: string }): Promise<CmsDocument>;
  history(id: string, signal?: AbortSignal): Promise<HistoryData>;
  media(id: string, signal?: AbortSignal): Promise<MediaItem[]>;
  listIssues(brand: CmsBrand | "all" | null, signal?: AbortSignal): Promise<PrintIssue[]>;
  inventory(brand: CmsBrand, signal?: AbortSignal): Promise<CmsMigrationInventory>;
  /** The Morweb gallery library: galleries with counts, and pages of files with the stories that use them. */
  mediaLibrary(brand: CmsBrand, signal?: AbortSignal): Promise<MediaLibraryOverview>;
  mediaFiles(brand: CmsBrand, options: { gallery?: string | null; q?: string; status?: string; offset?: number; limit?: number }, signal?: AbortSignal): Promise<MediaFilePage>;
  signOut(): Promise<void>;
  /** Fires after any mutation so views can refresh. */
  subscribe(listener: () => void): () => void;
  /** Unified search over documents, attached images and keywords. */
  search(query: string, options?: { brand?: CmsBrand | null; scope?: SearchScope; kind?: string; state?: string; limit?: number }, signal?: AbortSignal): Promise<SearchResponse>;
  /** The editorial assistant. */
  analyze(document: AssistDocument, signal?: AbortSignal): Promise<SeoGeoAnalysis>;
  chat(request: Extract<AssistRequest, { mode: "chat" }>, signal?: AbortSignal): Promise<AssistChatReply>;
  describeMedia(documentId: string, index: number, signal?: AbortSignal): Promise<MediaVision>;
  /** Audience analytics. */
  audience(brand: CmsBrand, days: number, signal?: AbortSignal): Promise<AudienceReport>;
  pagePerformance(brand: CmsBrand, path: string, days: number, signal?: AbortSignal): Promise<PagePerformance>;
  analyticsConnection(brand: CmsBrand, withProperties: boolean, signal?: AbortSignal): Promise<ConnectionStatus>;
  setAnalyticsProperty(brand: CmsBrand, propertyId: string, propertyName: string | null): Promise<ConnectionStatus>;
  disconnectAnalytics(brand: CmsBrand): Promise<ConnectionStatus>;
  /** The relational review database. */
  catalogLookup(brand: CmsBrand, type: CatalogType, query: string, signal?: AbortSignal): Promise<CatalogEntry[]>;
  searchRatings(brand: CmsBrand | null, filters: RatingFilters, signal?: AbortSignal): Promise<RatingSearchResponse>;
  /** Newsletter sends through the ESP bridge. */
  newsletterSends(documentId: string, signal?: AbortSignal): Promise<{ sends: NewsletterSend[]; configured: boolean }>;
  sendNewsletter(documentId: string, input: NewsletterRequest): Promise<NewsletterSend>;
  /** Real-time collaboration: a Realtime grant and the durable Yjs state. */
  realtimeGrant(): Promise<RealtimeGrant>;
  collabState(documentId: string, signal?: AbortSignal): Promise<CollabState>;
  saveCollabState(documentId: string, stateBase64: string): Promise<void>;
}

export const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/* Live: the Codex CMS routes                                          */
/* ------------------------------------------------------------------ */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers || {}) } });
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const error = body && typeof body === "object" ? (body as { error?: string; code?: string }) : {};
    throw new DataError(response.status, error.error || `The request failed (${response.status}).`, error.code);
  }
  return body as T;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

class Emitter {
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit() { for (const listener of this.listeners) listener(); }
}

export function createLiveData(): EditorialData {
  const emitter = new Emitter();
  return {
    demo: false,
    async listDocuments(query, signal) {
      const params = new URLSearchParams();
      if (query.brand) params.set("brand", query.brand);
      if (query.kind) params.set("kind", query.kind);
      if (query.state) params.set("state", query.state);
      if (query.issue) params.set("issue", query.issue);
      if (query.q?.trim()) params.set("q", query.q.trim().slice(0, 200));
      if (query.page && query.page > 1) params.set("page", String(query.page));
      return request<DocumentPage>(`/api/cms/documents${params.size ? `?${params}` : ""}`, { signal });
    },
    overview(brand, signal) {
      return request<Overview>(`/api/cms/overview${brand ? `?brand=${brand}` : ""}`, { signal });
    },
    getDocument(id, signal) {
      return request<{ document: CmsDocument; preview_html: string }>(`/api/cms/documents/${encodeURIComponent(id)}`, { signal });
    },
    async saveDocument(id, expectedRevision, patch) {
      const result = await request<{ document: CmsDocument }>(`/api/cms/documents/${encodeURIComponent(id)}`, jsonInit("PATCH", { expected_revision: expectedRevision, patch }));
      emitter.emit();
      return result.document;
    },
    async createDocument(input) {
      const created = await request<{ document_id: string }>("/api/cms/documents", jsonInit("POST", input));
      const loaded = await request<{ document: CmsDocument }>(`/api/cms/documents/${encodeURIComponent(created.document_id)}`);
      emitter.emit();
      return loaded.document;
    },
    history(id, signal) {
      return request<HistoryData>(`/api/cms/documents/${encodeURIComponent(id)}/history`, { signal });
    },
    async media(id, signal) {
      const result = await request<{ media: MediaItem[] }>(`/api/cms/documents/${encodeURIComponent(id)}/media`, { signal });
      return result.media;
    },
    async listIssues(brand, signal) {
      const result = await request<{ issues: PrintIssue[] }>(`/api/issues${brand ? `?brand=${brand}` : ""}`, { signal });
      return result.issues;
    },
    async inventory(brand, signal) {
      const result = await request<{ inventory: CmsMigrationInventory }>(`/api/cms/migration/inventory?brand=${brand}`, { signal });
      return result.inventory;
    },
    async signOut() {
      await request("/api/logout", { method: "POST" });
    },
    subscribe: listener => emitter.subscribe(listener),
    search(query, options = {}, signal) {
      const params = new URLSearchParams({ q: query, scope: options.scope ?? "all" });
      if (options.brand) params.set("brand", options.brand);
      if (options.kind) params.set("kind", options.kind);
      if (options.state) params.set("state", options.state);
      if (options.limit) params.set("limit", String(options.limit));
      return request<SearchResponse>(`/api/cms/search?${params}`, { signal });
    },
    async analyze(document, signal) {
      const result = await request<{ analysis: SeoGeoAnalysis }>("/api/cms/assist", { ...jsonInit("POST", { mode: "seo", document }), signal });
      return result.analysis;
    },
    chat(requestBody, signal) {
      return request<AssistChatReply>("/api/cms/assist", { ...jsonInit("POST", requestBody), signal });
    },
    async describeMedia(documentId, index, signal) {
      const result = await request<{ vision: MediaVision }>("/api/cms/assist", { ...jsonInit("POST", { mode: "describe", document_id: documentId, media_index: index }), signal });
      return result.vision;
    },
    async audience(brand, days, signal) {
      const result = await request<{ report: AudienceReport }>(`/api/cms/analytics?brand=${brand}&days=${days}`, { signal });
      return result.report;
    },
    async pagePerformance(brand, path, days, signal) {
      const result = await request<{ page: PagePerformance }>(`/api/cms/analytics?brand=${brand}&days=${days}&path=${encodeURIComponent(path)}`, { signal });
      return result.page;
    },
    analyticsConnection(brand, withProperties, signal) {
      return request<ConnectionStatus>(`/api/cms/analytics/connection?brand=${brand}${withProperties ? "&properties=1" : ""}`, { signal });
    },
    setAnalyticsProperty(brand, propertyId, propertyName) {
      return request<ConnectionStatus>("/api/cms/analytics/connection", jsonInit("POST", { brand, property_id: propertyId, property_name: propertyName }));
    },
    disconnectAnalytics(brand) {
      return request<ConnectionStatus>(`/api/cms/analytics/connection?brand=${brand}`, { method: "DELETE" });
    },
    async catalogLookup(brand, type, query, signal) {
      const result = await request<{ entries: CatalogEntry[] }>(`/api/cms/catalog?${new URLSearchParams({ brand, type, q: query })}`, { signal });
      return result.entries;
    },
    mediaLibrary(brand, signal) {
      return request<MediaLibraryOverview>(`/api/cms/media/library?brand=${brand}`, { signal });
    },
    mediaFiles(brand, options, signal) {
      const params = new URLSearchParams({ brand });
      for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
      return request<MediaFilePage>(`/api/cms/media/library/files?${params}`, { signal });
    },
    searchRatings(brand, filters, signal) {
      const params = new URLSearchParams();
      if (brand) params.set("brand", brand);
      for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
      return request<RatingSearchResponse>(`/api/cms/ratings?${params}`, { signal });
    },
    newsletterSends(documentId, signal) {
      return request<{ sends: NewsletterSend[]; configured: boolean }>(`/api/cms/documents/${encodeURIComponent(documentId)}/newsletter`, { signal });
    },
    async sendNewsletter(documentId, input) {
      const result = await request<{ send: NewsletterSend }>(`/api/cms/documents/${encodeURIComponent(documentId)}/newsletter`, jsonInit("POST", input));
      return result.send;
    },
    realtimeGrant() { return request<RealtimeGrant>("/api/cms/realtime"); },
    async collabState(documentId, signal) {
      const result = await request<{ state: CollabState }>(`/api/cms/documents/${encodeURIComponent(documentId)}/collab`, { signal });
      return result.state;
    },
    async saveCollabState(documentId, stateBase64) {
      await request(`/api/cms/documents/${encodeURIComponent(documentId)}/collab`, jsonInit("PUT", { state_base64: stateBase64 }));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Demo: synthetic content kept in this browser                        */
/* ------------------------------------------------------------------ */

export const DEMO_STORAGE_KEY = "editorial-demo-store-v1";
export const DEMO_USER: CmsUser = { id: "demo", email: "demo.editor@mshanken.com", role: "admin", brands: [...CMS_BRANDS] };

type DemoStore = { documents: CmsDocument[]; histories: Record<string, CmsDocumentRevision[]>; newsletters?: NewsletterSend[] };

function isDocument(value: unknown): value is CmsDocument {
  const doc = value as CmsDocument;
  return !!doc && typeof doc === "object" && typeof doc.id === "string" && typeof doc.title === "string"
    && !!doc.metadata && CMS_BRANDS.includes(doc.brand) && CMS_DOCUMENT_KINDS.includes(doc.kind) && CMS_PUBLICATION_STATES.includes(doc.publication_state);
}

function readStore(storage: Storage | null): DemoStore | null {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DEMO_STORAGE_KEY) || "null");
    const store = parsed as DemoStore;
    if (!store || !Array.isArray(store.documents) || !store.documents.every(isDocument) || !store.histories || typeof store.histories !== "object") return null;
    return store;
  } catch {
    return null;
  }
}

function freshStore(now: Date): DemoStore {
  const documents = demoDocuments(now);
  return { documents, histories: Object.fromEntries(documents.map(doc => [doc.id, [demoRevision(doc, doc.source_system === "manual" ? "Demo editor" : "Demo import")]])) };
}

const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`);

const placeholderImage = (brand: CmsBrand, index: number) => {
  const palette: Record<CmsBrand, string> = { wa: "#3d5a80", ws: "#6f1d2b", ca: "#b45309", mw: "#1b4332" };
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><rect width='320' height='320' fill='${palette[brand]}'/><circle cx='${80 + index * 37 % 160}' cy='${120 + index * 53 % 120}' r='70' fill='white' fill-opacity='0.14'/><text x='20' y='296' font-family='sans-serif' font-size='18' fill='white' fill-opacity='0.8'>Sample image ${index + 1}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export function createDemoData(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null, now: () => Date = () => new Date()): EditorialData {
  const emitter = new Emitter();
  let store = readStore(storage) ?? freshStore(now());
  const persist = () => { try { storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(store)); } catch { /* The demo keeps working for this visit without storage. */ } };
  const find = (id: string) => {
    const doc = store.documents.find(item => item.id === id);
    if (!doc) throw new DataError(404, "Document not found.", "not_found");
    return doc;
  };
  const latency = () => new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 180));

  return {
    demo: true,
    async listDocuments(query) {
      await latency();
      const q = query.q?.trim().toLowerCase() || "";
      const rows = store.documents
        .filter(doc => (!query.brand || doc.brand === query.brand)
          && (!query.kind || doc.kind === query.kind)
          && (!query.state || doc.publication_state === query.state)
          && (!query.issue || doc.issue_uuid === query.issue)
          && (!q || doc.title.toLowerCase().includes(q) || doc.byline.toLowerCase().includes(q)))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
      const page = Math.max(1, query.page || 1);
      const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const documents: DocumentRow[] = slice.map(({ id, brand, kind, source_system, title, byline, excerpt, publication_state, published_at, issue_uuid, revision, created_at, updated_at }) =>
        ({ id, brand, kind, source_system, title, byline, excerpt, publication_state, published_at, issue_uuid, revision, created_at, updated_at }));
      return { documents, total: rows.length, page, pageSize: PAGE_SIZE };
    },
    async overview(brand) {
      await latency();
      const docs = store.documents.filter(doc => !brand || doc.brand === brand);
      return {
        total: docs.length,
        review: docs.filter(doc => doc.publication_state === "review").length,
        drafts: docs.filter(doc => doc.publication_state === "draft").length,
        ratings: docs.filter(doc => doc.kind === "rating").length,
      };
    },
    async getDocument(id) {
      await latency();
      const document = structuredClone(find(id));
      return { document, preview_html: document.body_html };
    },
    async saveDocument(id, expectedRevision, patch) {
      await latency();
      const current = find(id);
      if (current.revision !== expectedRevision) throw new DataError(409, "Another editor saved a newer version. Reload before saving your changes.", "revision_conflict");
      if (patch.publication_state === "published" && current.publication_state !== "published") {
        throw new DataError(422, "New content cannot be published from this workspace yet. It can be scheduled and prepared for review.", "validation_failed");
      }
      if (patch.title !== undefined && !patch.title.trim()) throw new DataError(422, "A title is required.", "validation_failed");
      const next: CmsDocument = { ...current, ...patch, metadata: patch.metadata ?? current.metadata, revision: current.revision + 1, updated_at: now().toISOString() };
      if (patch.slug !== undefined) next.slug = patch.slug || null;
      if (patch.public_url !== undefined) next.public_url = patch.public_url || null;
      store = { ...store, documents: store.documents.map(doc => doc.id === id ? next : doc), histories: { ...store.histories, [id]: [demoRevision(next), ...(store.histories[id] || [])].slice(0, 30) } };
      persist();
      emitter.emit();
      return structuredClone(next);
    },
    async createDocument(input) {
      await latency();
      const title = input.title.trim();
      if (!title) throw new DataError(422, "A title is required.", "validation_failed");
      const stamp = now().toISOString();
      const document: CmsDocument = {
        id: uuid(), brand: input.brand, kind: input.kind, source_system: "manual", source_key: `manual:${stamp}`,
        source_hash: "0".repeat(64), identity_anchor: {}, title, byline: "", body_html: "<p></p>", body_json: null, excerpt: "",
        slug: null, public_url: null, publication_state: "draft", published_at: null, issue_uuid: null,
        metadata: { section: "", categories: [], tags: [], seo: { title: "", description: "", no_index: false } },
        revision: 1, created_at: stamp, updated_at: stamp,
      };
      store = { ...store, documents: [document, ...store.documents], histories: { ...store.histories, [document.id]: [demoRevision(document)] } };
      persist();
      emitter.emit();
      return structuredClone(document);
    },
    async history(id) {
      await latency();
      const document = find(id);
      const revisions = structuredClone(store.histories[id] || [demoRevision(document)]);
      const original = revisions[revisions.length - 1]?.snapshot ?? document;
      const sources: SourceReview[] = [{
        id: `${id}:source`, source_hash: document.source_hash, created_at: document.created_at, is_candidate: false,
        title: original.title, byline: original.byline, body_html: original.body_html, preview_html: original.body_html, metadata: original.metadata,
      }];
      if (document.source_system === "print") {
        sources.unshift({
          id: `${id}:candidate`, source_hash: "f".repeat(64), created_at: now().toISOString(), is_candidate: true,
          title: original.title, byline: original.byline || "Sample Editor",
          body_html: `${original.body_html}<p>A later extraction found this additional paragraph at the end of the layout.</p>`,
          preview_html: original.body_html, metadata: original.metadata,
        });
      }
      return { revisions, sources };
    },
    async media(id) {
      await latency();
      const document = find(id);
      const media = Array.isArray(document.metadata.media) ? document.metadata.media : [];
      return media.map((item, index) => {
        const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        return {
          index, preview_url: placeholderImage(document.brand, index),
          s3_key: typeof entry.s3_key === "string" ? entry.s3_key : undefined,
          sha256: typeof entry.sha256 === "string" ? entry.sha256 : undefined,
          file: typeof entry.file === "string" ? entry.file : undefined,
          caption: typeof entry.caption === "string" ? entry.caption : "",
          credit: typeof entry.credit === "string" ? entry.credit : "",
          alt: typeof entry.alt === "string" ? entry.alt : "",
          is_lead: entry.is_lead === true,
        };
      });
    },
    async listIssues(brand) {
      await latency();
      return demoIssues(now()).filter(issue => !brand || brand === "all" || issue.brand === brand);
    },
    async inventory(brand) {
      await latency();
      const docs = store.documents.filter(doc => doc.brand === brand);
      const count = <T extends string>(keys: readonly T[], pick: (doc: CmsDocument) => string) =>
        Object.fromEntries(keys.map(key => [key, docs.filter(doc => pick(doc) === key).length])) as Record<T, number>;
      return {
        brand,
        documents: {
          total: docs.length,
          by_kind: count(CMS_DOCUMENT_KINDS, doc => doc.kind),
          by_publication_state: count(CMS_PUBLICATION_STATES, doc => doc.publication_state),
          by_source_system: count(["morweb", "print", "manual", "web_archive"] as const, doc => doc.source_system),
          review_required: docs.filter(doc => (doc.metadata.review as CmsJsonObject | undefined)?.required === true).length,
          pages_awaiting_assembly: docs.filter(doc => doc.kind === "page" && doc.source_system === "morweb").length,
        },
        sources: { total: docs.length * 3, archive_count: 1, by_source_kind: { post_version: docs.length * 2, page_version: docs.filter(doc => doc.kind === "page").length, page_context: 0, category: 41, tag: 915, page_group: 0, gallery_definition: 0, gallery_version: 0, media_file: docs.length, gallery_membership: 0, menu_definition: 2, menu_item: 28, menu_payload: 0, media_response_context: 0, menu_response_context: 0, capture_manifest: 1, source_context: 0, page_editor_capture: 0, rendered_page_snapshot: 0, editor_diagnostic: 0, cms_index_document: 0, cms_inventory_document: 0, menu_embedded_page_snapshot: 0, source_part: 0 } },
      } satisfies CmsMigrationInventory;
    },
    async signOut() { /* The demo has no session. */ },
    subscribe: listener => emitter.subscribe(listener),
    async search(query, options = {}) {
      await latency();
      return demoSearch(store.documents, query, options);
    },
    async analyze(document) {
      await new Promise(resolve => setTimeout(resolve, 700));
      return heuristicAnalysis(document);
    },
    async chat(requestBody) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const last = requestBody.messages[requestBody.messages.length - 1]?.content ?? "";
      const doc = requestBody.document;
      const reply = doc
        ? `In the demo I can run the structured review (the “Review for SEO and GEO” button) and search. For “${last.slice(0, 80)}”: the connected workspace answers with Claude using the open story, “${doc.title}”, as context, and suggests copy you can paste straight into the editor.`
        : `In the demo the assistant runs rule-based checks and search only. In the connected workspace this question goes to Claude. Try “find images of barrels” or open a story and ask for a sharper headline.`;
      return { reply, source: "heuristic" };
    },
    async describeMedia(id, index) {
      await new Promise(resolve => setTimeout(resolve, 900));
      const document = find(id);
      const media = Array.isArray(document.metadata.media) ? document.metadata.media : [];
      const item = (media[index] && typeof media[index] === "object" ? media[index] : {}) as Record<string, unknown>;
      const subject = typeof item.caption === "string" && item.caption ? item.caption.replace(/\.$/, "") : document.title;
      return {
        description: `Sample description: an editorial photograph for “${document.title}”, ${subject.toLowerCase()}, with soft directional light and a shallow depth of field.`,
        style: "editorial photograph, shallow depth of field", mood: "warm, considered",
        tags: ["sample", "editorial", document.brand, ...(typeof document.metadata.section === "string" ? [document.metadata.section.toLowerCase()] : [])],
        subjects: [subject.split(" ").slice(0, 3).join(" ")], colors: ["amber", "charcoal", "cream"],
        described_at: now().toISOString(), model: "sample",
      };
    },
    async audience(brand, days) {
      await latency();
      return sampleAudience(brand, days, now());
    },
    async pagePerformance(brand, path, days) {
      await latency();
      return samplePagePerformance(brand, path, days, now());
    },
    async analyticsConnection(brand) {
      return { brand, oauth_available: false, connected: false, google_email: null, property_id: null, property_name: null, connected_by: null, connected_at: null, service_account_property: null, properties: [], properties_error: null };
    },
    async setAnalyticsProperty() { throw new DataError(503, "The demo has no Google connection.", "setup_required"); },
    async disconnectAnalytics() { throw new DataError(503, "The demo has no Google connection.", "setup_required"); },
    async catalogLookup(brand, type, query) {
      await latency();
      return demoCatalog(store.documents, brand, type, query);
    },
    async mediaLibrary() {
      await latency();
      return demoMediaLibrary();
    },
    async mediaFiles(_brand, options) {
      await latency();
      return demoMediaFiles(options);
    },
    async searchRatings(brand, filters) {
      await latency();
      return demoRatings(store.documents, brand, filters);
    },
    async newsletterSends(documentId) {
      await latency();
      return { sends: (store.newsletters ?? []).filter(send => send.document_id === documentId).sort((a, b) => b.created_at.localeCompare(a.created_at)), configured: false };
    },
    async sendNewsletter(documentId, input) {
      await latency();
      const document = find(documentId);
      const stamp = now().toISOString();
      const send: NewsletterSend = { id: uuid(), document_id: documentId, brand: document.brand, kind: input.kind, esp: "braze", status: "simulated", subject: input.subject, preheader: input.preheader ?? null, send_at: input.send_at ?? null, campaign_id: null, dispatch_id: null, error: "Demo: the email was rendered and logged, not sent.", requested_by: DEMO_USER.id, created_at: stamp, updated_at: stamp };
      store = { ...store, newsletters: [send, ...(store.newsletters ?? [])] };
      persist();
      return send;
    },
    async realtimeGrant() { throw new DataError(503, "The demo has no Realtime connection.", "setup_required"); },
    async collabState() { return null; },
    async saveCollabState() { /* The demo has no shared document. */ },
  };
}

/* ------------------------------------------------------------------ */
/* Demo review database                                                  */
/* ------------------------------------------------------------------ */

const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function demoRatingRows(documents: CmsDocument[], brand: CmsBrand | null): RatingHit[] {
  return documents.filter(doc => (doc.kind === "rating" || doc.kind === "product_review") && (!brand || doc.brand === brand)).map(doc => {
    const rating = (doc.metadata.rating && typeof doc.metadata.rating === "object" && !Array.isArray(doc.metadata.rating) ? doc.metadata.rating : {}) as Record<string, unknown>;
    const text = (key: string) => typeof rating[key] === "string" && (rating[key] as string).trim() ? (rating[key] as string).trim() : null;
    const producer = text("producer") ?? text("brand"), region = text("region"), variety = text("variety") ?? text("category"), taster = text("taster") ?? text("reviewer");
    const vintageMatch = doc.title.match(/\b(19|20)\d{2}\b/);
    return {
      document_id: doc.id, brand: doc.brand, title: doc.title, slug: doc.slug, publication_state: doc.publication_state,
      score: typeof rating.score === "number" ? rating.score : null, price: typeof rating.price === "number" ? rating.price : null,
      vintage: typeof rating.vintage === "number" ? rating.vintage : vintageMatch ? Number(vintageMatch[0]) : null,
      product_name: text("product_name") ?? doc.title, category: text("category"),
      producer, producer_slug: producer ? slugOf(producer) : null, region, region_slug: region ? slugOf(region) : null,
      variety, variety_slug: variety ? slugOf(variety) : null, taster, taster_slug: taster ? slugOf(taster) : null,
      drink_window: text("drink_window"), published_at: doc.published_at, updated_at: doc.updated_at, total: 0,
    };
  });
}

export function demoCatalog(documents: CmsDocument[], brand: CmsBrand, type: CatalogType, query: string): CatalogEntry[] {
  const counts = new Map<string, number>();
  for (const row of demoRatingRows(documents, brand)) {
    const name = type === "producer" ? row.producer : type === "region" ? row.region : type === "variety" ? row.variety : row.taster;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const q = query.trim().toLowerCase();
  return [...counts.entries()].filter(([name]) => !q || name.toLowerCase().includes(q)).sort((a, b) => Number(b[0].toLowerCase().startsWith(q)) - Number(a[0].toLowerCase().startsWith(q)) || b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
    .map(([name, count]) => ({ id: `${type}:${slugOf(name)}`, name, slug: slugOf(name), detail: "", document_count: count }));
}

export function demoRatings(documents: CmsDocument[], brand: CmsBrand | null, filters: RatingFilters): RatingSearchResponse {
  const q = filters.q?.trim().toLowerCase() ?? "";
  const all = demoRatingRows(documents, brand).filter(row => !filters.state || row.publication_state === filters.state);
  const rows = all.filter(row =>
    (filters.min_score === undefined || (row.score ?? -1) >= filters.min_score) && (filters.max_score === undefined || (row.score ?? 101) <= filters.max_score)
    && (filters.min_price === undefined || (row.price ?? -1) >= filters.min_price) && (filters.max_price === undefined || (row.price ?? Infinity) <= filters.max_price)
    && (filters.vintage_from === undefined || (row.vintage ?? 0) >= filters.vintage_from) && (filters.vintage_to === undefined || (row.vintage ?? 9999) <= filters.vintage_to)
    && (!filters.region || row.region_slug === filters.region) && (!filters.variety || row.variety_slug === filters.variety)
    && (!filters.producer || row.producer_slug === filters.producer) && (!filters.taster || row.taster_slug === filters.taster)
    && (!q || row.title.toLowerCase().includes(q) || (row.producer ?? "").toLowerCase().includes(q)));
  const sort = filters.sort ?? "score";
  rows.sort((a, b) => sort === "price" ? (a.price ?? Infinity) - (b.price ?? Infinity) : sort === "price_desc" ? (b.price ?? -1) - (a.price ?? -1) : sort === "vintage" ? (b.vintage ?? 0) - (a.vintage ?? 0) : sort === "recent" ? b.updated_at.localeCompare(a.updated_at) : (b.score ?? -1) - (a.score ?? -1));
  const facets: RatingFacets = { region: [], variety: [], producer: [], taster: [], score: [], price: [] };
  const bump = (list: RatingFacets[keyof RatingFacets], value: string | null, label: string | null) => { if (!value || !label) return; const hit = list.find(item => item.value === value); if (hit) hit.count += 1; else list.push({ value, label, count: 1 }); };
  for (const row of all) {
    bump(facets.region, row.region_slug, row.region); bump(facets.variety, row.variety_slug, row.variety); bump(facets.producer, row.producer_slug, row.producer); bump(facets.taster, row.taster_slug, row.taster);
    if (row.score !== null) bump(facets.score, row.score >= 95 ? "95" : row.score >= 90 ? "90" : row.score >= 85 ? "85" : row.score >= 80 ? "80" : "0", row.score >= 95 ? "95 and above" : row.score >= 90 ? "90 to 94" : row.score >= 85 ? "85 to 89" : row.score >= 80 ? "80 to 84" : "Below 80");
    if (row.price !== null) bump(facets.price, row.price < 20 ? "0" : row.price < 50 ? "20" : row.price < 100 ? "50" : row.price < 250 ? "100" : "250", row.price < 20 ? "Under $20" : row.price < 50 ? "$20 to $49" : row.price < 100 ? "$50 to $99" : row.price < 250 ? "$100 to $249" : "$250 and up");
  }
  for (const key of Object.keys(facets) as (keyof RatingFacets)[]) facets[key].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const offset = filters.offset ?? 0, limit = filters.limit ?? 50;
  return { ratings: rows.slice(offset, offset + limit).map(row => ({ ...row, total: rows.length })), facets, total: rows.length };
}

/* ------------------------------------------------------------------ */
/* Demo search over the local store                                     */
/* ------------------------------------------------------------------ */

function markText(text: string, terms: string[]): string {
  if (!terms.length) return text;
  const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.replace(pattern, "<mark>$1</mark>");
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const hit = terms.map(term => lower.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? -1;
  const start = Math.max(0, hit - 70);
  const slice = text.slice(start, start + 180).trim();
  return markText(`${start > 0 ? "…" : ""}${slice}${start + 180 < text.length ? "…" : ""}`, terms);
}

export function demoSearch(documents: CmsDocument[], query: string, options: { brand?: CmsBrand | null; scope?: SearchScope; kind?: string; state?: string; limit?: number } = {}): SearchResponse {
  const q = query.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const scope = options.scope ?? "all";
  const limit = options.limit ?? 20;
  const scoped = documents.filter(doc => !options.brand || doc.brand === options.brand);
  const textOf = (doc: CmsDocument) => stripHtml(doc.body_html);
  const hits = (field: string) => terms.filter(term => field.toLowerCase().includes(term)).length;

  const docs: SearchDocumentHit[] = (scope === "all" || scope === "documents") && q ? scoped
    .filter(doc => (!options.kind || doc.kind === options.kind) && (!options.state || doc.publication_state === options.state))
    .map(doc => {
      const body = textOf(doc);
      const tags = [...(Array.isArray(doc.metadata.tags) ? doc.metadata.tags : []), ...(Array.isArray(doc.metadata.categories) ? doc.metadata.categories : [])].join(" ");
      const rank = matchScore(q, doc.title) / 20 + hits(doc.title) * 2 + hits(doc.byline) + hits(doc.excerpt) + hits(tags) * 1.5 + hits(body) * 0.8;
      return { doc, body, rank };
    })
    .filter(entry => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ doc, body, rank }) => ({
      id: doc.id, brand: doc.brand, kind: doc.kind, source_system: doc.source_system, title: doc.title, byline: doc.byline, excerpt: doc.excerpt,
      publication_state: doc.publication_state, issue_uuid: doc.issue_uuid, published_at: doc.published_at, updated_at: doc.updated_at, rank,
      headline: snippet(body || doc.excerpt, terms),
    })) : [];

  const media: SearchMediaHit[] = (scope === "all" || scope === "media") && q ? scoped.flatMap(doc => {
    const items = Array.isArray(doc.metadata.media) ? doc.metadata.media : [];
    return items.map((raw, index): SearchMediaHit | null => {
      const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const vision = (item.vision && typeof item.vision === "object" ? item.vision : null) as MediaVision | null;
      const haystack = [item.caption, item.alt, item.credit, item.file, item.palette_names, vision?.description, vision?.style, vision?.mood, ...(vision?.tags ?? []), ...(vision?.subjects ?? []), ...(vision?.colors ?? [])].filter((value): value is string => typeof value === "string").join(" ");
      const rank = hits(haystack);
      return rank > 0 ? {
        document_id: doc.id, brand: doc.brand, issue_uuid: doc.issue_uuid, document_title: doc.title, media_index: index,
        file: typeof item.file === "string" ? item.file : null, s3_key: typeof item.s3_key === "string" ? item.s3_key : null,
        caption: typeof item.caption === "string" ? item.caption : null, credit: typeof item.credit === "string" ? item.credit : null, alt: typeof item.alt === "string" ? item.alt : null,
        is_lead: item.is_lead === true, vision: vision as SearchMediaHit["vision"], palette: Array.isArray(item.palette) ? item.palette as string[] : null, crops: (item.crops && typeof item.crops === "object" ? item.crops : null) as SearchMediaHit["crops"],
        rank, preview_url: null,
      } : null;
    }).filter((hit): hit is SearchMediaHit => hit !== null);
  }).sort((a, b) => b.rank - a.rank).slice(0, Math.min(60, limit * 2)) : [];

  const counts = new Map<string, SearchKeywordHit>();
  if (scope === "all" || scope === "keywords") {
    for (const doc of scoped) {
      const add = (keyword: unknown, kind: SearchKeywordHit["kind"]) => {
        if (typeof keyword !== "string" || !keyword.trim()) return;
        const key = `${kind}:${keyword.trim().toLowerCase()}`;
        if (q && !key.includes(q)) return;
        const existing = counts.get(key);
        if (existing) existing.document_count += 1; else counts.set(key, { keyword: keyword.trim().toLowerCase(), kind, document_count: 1 });
      };
      (Array.isArray(doc.metadata.tags) ? doc.metadata.tags : []).forEach(tag => add(tag, "tag"));
      (Array.isArray(doc.metadata.categories) ? doc.metadata.categories : []).forEach(category => add(category, "category"));
      add(doc.metadata.section, "section");
    }
  }
  const keywords = [...counts.values()].sort((a, b) => b.document_count - a.document_count || a.keyword.localeCompare(b.keyword)).slice(0, 30);
  return { query: query.trim(), documents: docs, media, keywords };
}

/* The demo gallery library: a few galleries and files drawn with the public site's own bottle photographs. */
const DEMO_GALLERIES: MediaGallery[] = [
  { id: "18986", name: "Bottle-Shots", title: "Bottle Shots", description: "", created_at: "2022-11-28 12:01:01", files: 6, stored: 5, pending: 1, failed: 0, bytes: 4_200_000, cover: "/wa/img/bottle-scotch.jpg" },
  { id: "18980", name: "Hero-Images", title: "Hero Images", description: "", created_at: "2022-11-28 11:40:00", files: 3, stored: 3, pending: 0, failed: 0, bytes: 2_900_000, cover: "/wa/img/rickhouse.jpg" },
  { id: "20104", name: "Cocktails", title: "Cocktails", description: "", created_at: "2024-03-06 09:12:00", files: 2, stored: 1, pending: 0, failed: 1, bytes: 610_000, cover: "/wa/img/shelf.jpg" },
];
const DEMO_FILES: MediaFile[] = [
  ...["scotch", "bourbon", "rye", "irish", "japanese", "blended"].map((kind, i) => ({ gallery_id: "18986", gallery: "Bottle Shots", id: String(1700 + i), file_name: `Sample-${kind}-bottle_300.jpg`, title: "", alt: `A ${kind} bottle`, mime: "image/jpeg", width: 300, height: 300, bytes: 48_000 + i * 900, uploaded_at: `2023-0${(i % 9) + 1}-14 10:02:25`, source_url: `https://whiskyadvocate.com/get/files/image/galleries/Sample-${kind}-bottle_300.jpg`, status: (i === 5 ? "pending" : "stored") as MediaFile["status"], error: null, sha256: null, thumb: i === 5 ? null : `/wa/img/bottle-${kind}.jpg`, original: i === 5 ? null : `/wa/img/bottle-${kind}.jpg`, public_url: i === 5 ? null : `/wa/img/bottle-${kind}.jpg`, used_in: i < 2 ? [{ id: "demo-article-1", title: "Sample story that uses this bottle", state: "published" }] : [] })),
  ...["rickhouse", "dusk", "sheet"].map((name, i) => ({ gallery_id: "18980", gallery: "Hero Images", id: String(1800 + i), file_name: `${name}-hero.jpg`, title: "", alt: "", mime: "image/jpeg", width: 1600, height: 900, bytes: 900_000 + i * 50_000, uploaded_at: "2022-12-01 08:00:00", source_url: `https://whiskyadvocate.com/get/files/image/galleries/${name}-hero.jpg`, status: "stored" as const, error: null, sha256: null, thumb: `/wa/img/${name}.jpg`, original: `/wa/img/${name}.jpg`, public_url: `/wa/img/${name}.jpg`, used_in: [] })),
  { gallery_id: "20104", gallery: "Cocktails", id: "1900", file_name: "shelf-cocktail.jpg", title: "", alt: "", mime: "image/jpeg", width: 1200, height: 800, bytes: 300_000, uploaded_at: "2024-03-06 09:20:00", source_url: "https://whiskyadvocate.com/get/files/image/galleries/shelf-cocktail.jpg", status: "stored", error: null, sha256: null, thumb: "/wa/img/shelf.jpg", original: "/wa/img/shelf.jpg", public_url: "/wa/img/shelf.jpg", used_in: [] },
  { gallery_id: "20104", gallery: "Cocktails", id: "1901", file_name: "missing-cocktail.mov", title: "", alt: "", mime: "video/quicktime", width: null, height: null, bytes: 310_000, uploaded_at: "2024-03-06 09:21:00", source_url: "https://whiskyadvocate.com/get/files/image/galleries/missing-cocktail.mov", status: "failed", error: "HTTP 404", sha256: null, thumb: null, original: null, public_url: null, used_in: [] },
];
export function demoMediaLibrary(): MediaLibraryOverview {
  const totals = DEMO_GALLERIES.reduce((t, g) => ({ galleries: t.galleries + 1, files: t.files + g.files, stored: t.stored + g.stored, pending: t.pending + g.pending, failed: t.failed + g.failed, bytes: t.bytes + g.bytes }), { galleries: 0, files: 0, stored: 0, pending: 0, failed: 0, bytes: 0 });
  return { galleries: DEMO_GALLERIES, totals };
}
export function demoMediaFiles(options: { gallery?: string | null; q?: string; status?: string; offset?: number; limit?: number }): MediaFilePage {
  const q = (options.q ?? "").toLowerCase();
  const all = DEMO_FILES.filter(f => (!options.gallery || f.gallery_id === options.gallery) && (!q || f.file_name.toLowerCase().includes(q)) && (!options.status || f.status === options.status));
  const offset = options.offset ?? 0, limit = options.limit ?? 60;
  return { files: all.slice(offset, offset + limit), total: all.length, offset, limit };
}
