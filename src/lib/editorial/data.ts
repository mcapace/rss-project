import type {
  CmsBrand, CmsDocument, CmsDocumentKind, CmsDocumentPatch, CmsDocumentRevision,
  CmsJsonObject, CmsMigrationInventory, CmsPublicationState,
} from "@/lib/cms/types";
import { CMS_BRANDS, CMS_DOCUMENT_KINDS, CMS_PUBLICATION_STATES } from "@/lib/cms/types";
import type { CmsUser } from "@/lib/cms/access";
import { demoDocuments, demoIssues, demoRevision } from "./demo-data";

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
  signOut(): Promise<void>;
  /** Fires after any mutation so views can refresh. */
  subscribe(listener: () => void): () => void;
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
  };
}

/* ------------------------------------------------------------------ */
/* Demo: synthetic content kept in this browser                        */
/* ------------------------------------------------------------------ */

export const DEMO_STORAGE_KEY = "editorial-demo-store-v1";
export const DEMO_USER: CmsUser = { id: "demo", email: "demo.editor@mshanken.com", role: "admin", brands: [...CMS_BRANDS] };

type DemoStore = { documents: CmsDocument[]; histories: Record<string, CmsDocumentRevision[]> };

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
        source_hash: "0".repeat(64), identity_anchor: {}, title, byline: "", body_html: "<p></p>", excerpt: "",
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
  };
}
