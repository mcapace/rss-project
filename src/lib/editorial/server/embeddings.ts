// No "server-only" marker: the migration scripts load this under plain Node. It is never imported by client code.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CmsError } from "@/lib/cms/access";
import type { CmsBrand, CmsJsonObject } from "@/lib/cms/types";

/**
 * Embeddings for semantic search, stored in pgvector. Voyage AI's voyage-3
 * (1024 dimensions) is the provider: set VOYAGE_API_KEY. Without it, search
 * stays lexical and says so.
 */
export const EMBEDDING_MODEL = process.env.VOYAGE_EMBEDDING_MODEL || "voyage-3";
export const EMBEDDING_DIMENSIONS = 1024;

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

export async function embedTexts(texts: string[], inputType: "query" | "document", signal?: AbortSignal): Promise<number[][]> {
  if (!embeddingsConfigured()) throw new CmsError(503, "Semantic search needs VOYAGE_API_KEY on the server.", "setup_required");
  if (!texts.length) return [];
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: texts.map(text => text.slice(0, 16_000)), model: EMBEDDING_MODEL, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS }),
  });
  const data = await response.json().catch(() => ({})) as { data?: { embedding: number[]; index: number }[]; detail?: string };
  if (!response.ok || !data.data) throw new CmsError(502, `The embeddings provider refused the request: ${data.detail || response.status}`, "provider_error");
  return data.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
}

/** Matches cms_embedding_backlog's content hash so changed documents are re-embedded. */
export function documentContentHash(doc: { title: string; excerpt: string; body_html: string }): string {
  return createHash("sha256").update(`${doc.title ?? ""}\n${doc.excerpt ?? ""}\n${(doc.body_html ?? "").replace(/<[^>]+>/g, " ")}`).digest("hex");
}

export function documentEmbeddingText(doc: { title: string; excerpt: string; body_html: string; metadata?: CmsJsonObject | null }): string {
  const section = typeof doc.metadata?.section === "string" ? doc.metadata.section : "";
  const tags = Array.isArray(doc.metadata?.tags) ? doc.metadata.tags.filter((tag): tag is string => typeof tag === "string").join(", ") : "";
  const body = (doc.body_html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return [doc.title, doc.excerpt, section, tags, body].filter(Boolean).join("\n").slice(0, 12_000);
}

export function mediaEmbeddingText(item: CmsJsonObject): string {
  const vision = item.vision && typeof item.vision === "object" && !Array.isArray(item.vision) ? item.vision as CmsJsonObject : {};
  const list = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").join(", ") : "";
  return [item.caption, item.alt, item.credit, vision.description, vision.style, vision.mood, list(vision.tags), list(vision.subjects), list(vision.colors), item.palette_names].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n");
}

const vectorLiteral = (embedding: number[]) => `[${embedding.map(value => Number(value.toFixed(7))).join(",")}]`;

export async function upsertDocumentEmbedding(db: SupabaseClient, doc: { id: string; title: string; excerpt: string; body_html: string; metadata?: CmsJsonObject | null }, signal?: AbortSignal): Promise<boolean> {
  if (!embeddingsConfigured()) return false;
  const [embedding] = await embedTexts([documentEmbeddingText(doc)], "document", signal);
  const { error } = await db.rpc("cms_upsert_embedding", { p_document_id: doc.id, p_kind: "document", p_media_index: null, p_content_hash: documentContentHash(doc), p_model: EMBEDDING_MODEL, p_embedding: vectorLiteral(embedding) });
  if (error) throw new CmsError(500, `The embedding could not be stored: ${error.message}`);
  return true;
}

export async function upsertMediaEmbedding(db: SupabaseClient, documentId: string, index: number, item: CmsJsonObject, signal?: AbortSignal): Promise<boolean> {
  if (!embeddingsConfigured()) return false;
  const text = mediaEmbeddingText(item);
  if (!text) return false;
  const [embedding] = await embedTexts([text], "document", signal);
  const { error } = await db.rpc("cms_upsert_embedding", { p_document_id: documentId, p_kind: "media", p_media_index: index, p_content_hash: createHash("sha256").update(text).digest("hex"), p_model: EMBEDDING_MODEL, p_embedding: vectorLiteral(embedding) });
  if (error) throw new CmsError(500, `The image embedding could not be stored: ${error.message}`);
  return true;
}

export type EmbeddableDocument = { id: string; title: string; excerpt: string; body_html: string; metadata?: CmsJsonObject | null };
export type EmbeddingRefresh = { document: boolean; images: number; removed: number };

const mediaHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Splits texts into Voyage requests that stay well under its per-request token limit. */
function batches<T extends { text: string }>(items: T[], maxItems = 32, maxChars = 240_000): T[][] {
  const out: T[][] = [];
  let current: T[] = [], chars = 0;
  for (const item of items) {
    const size = Math.min(item.text.length, 16_000);
    if (current.length && (current.length >= maxItems || chars + size > maxChars)) { out.push(current); current = []; chars = 0; }
    current.push(item); chars += size;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Brings one document's semantic index up to date: its text and each described
 * image, embedding only what changed since the stored hash (one Voyage request
 * for the lot in the usual case), and removing image vectors for images that
 * are gone or no longer described. Safe to call after every save.
 */
export async function refreshDocumentEmbeddings(db: SupabaseClient, doc: EmbeddableDocument, signal?: AbortSignal): Promise<EmbeddingRefresh> {
  const result: EmbeddingRefresh = { document: false, images: 0, removed: 0 };
  if (!embeddingsConfigured()) return result;
  const { data: stored, error } = await db.from("cms_embeddings").select("kind,media_index,content_hash,model").eq("document_id", doc.id);
  if (error) throw new CmsError(500, `The stored embeddings could not be read: ${error.message}`);
  const have = new Map<string, string>();
  for (const row of (stored ?? []) as { kind: string; media_index: number | null; content_hash: string; model: string }[]) {
    if (row.model === EMBEDDING_MODEL) have.set(row.kind === "media" ? `media:${row.media_index}` : "document", row.content_hash);
  }
  const jobs: { kind: "document" | "media"; index: number | null; hash: string; text: string }[] = [];
  const docHash = documentContentHash(doc);
  if (have.get("document") !== docHash) jobs.push({ kind: "document", index: null, hash: docHash, text: documentEmbeddingText(doc) });
  const rawMedia = doc.metadata?.media;
  const media = Array.isArray(rawMedia) ? (rawMedia as CmsJsonObject[]) : [];
  const described = new Set<number>();
  media.forEach((item, index) => {
    const text = item && typeof item === "object" && !Array.isArray(item) ? mediaEmbeddingText(item) : "";
    if (!text) return;
    described.add(index);
    const hash = mediaHash(text);
    if (have.get(`media:${index}`) !== hash) jobs.push({ kind: "media", index, hash, text });
  });
  for (const group of batches(jobs)) {
    const vectors = await embedTexts(group.map(job => job.text), "document", signal);
    for (const [i, job] of group.entries()) {
      const { error: upsertError } = await db.rpc("cms_upsert_embedding", { p_document_id: doc.id, p_kind: job.kind, p_media_index: job.index, p_content_hash: job.hash, p_model: EMBEDDING_MODEL, p_embedding: vectorLiteral(vectors[i]) });
      if (upsertError) throw new CmsError(500, `The embedding could not be stored: ${upsertError.message}`);
      if (job.kind === "document") result.document = true; else result.images += 1;
    }
  }
  const stale = ((stored ?? []) as { kind: string; media_index: number | null }[]).filter(row => row.kind === "media" && row.media_index !== null && !described.has(row.media_index)).map(row => row.media_index as number);
  if (stale.length) {
    const { error: deleteError } = await db.from("cms_embeddings").delete().eq("document_id", doc.id).eq("kind", "media").in("media_index", stale);
    if (deleteError) throw new CmsError(500, `Old image embeddings could not be removed: ${deleteError.message}`);
    result.removed = stale.length;
  }
  return result;
}

/** Refreshes the oldest-changed documents in the backlog until the time budget runs out; the save hook's safety net. */
export async function embedBacklog(db: SupabaseClient, brands: CmsBrand[], options: { limit?: number; budgetMs?: number } = {}): Promise<{ backlog: number; documents: number; images: number; removed: number; failures: string[]; stopped_early: boolean }> {
  const started = Date.now();
  const summary = { backlog: 0, documents: 0, images: 0, removed: 0, failures: [] as string[], stopped_early: false };
  if (!embeddingsConfigured() || !brands.length) return summary;
  const { data, error } = await db.rpc("cms_embedding_backlog", { p_brands: brands, p_limit: Math.min(500, Math.max(1, options.limit ?? 200)) });
  if (error) throw new CmsError(500, `Could not read the embedding backlog: ${error.message}`);
  const backlog = (data ?? []) as { document_id: string }[];
  summary.backlog = backlog.length;
  for (const item of backlog) {
    if (options.budgetMs && Date.now() - started > options.budgetMs) { summary.stopped_early = true; break; }
    const { data: row, error: readError } = await db.from("cms_documents").select("id,title,excerpt,body_html,metadata").eq("id", item.document_id).maybeSingle();
    if (readError || !row) { summary.failures.push(`${item.document_id}: ${readError?.message ?? "missing"}`); continue; }
    try {
      const done = await refreshDocumentEmbeddings(db, row as EmbeddableDocument);
      if (done.document) summary.documents += 1;
      summary.images += done.images; summary.removed += done.removed;
    } catch (failure) { summary.failures.push(`${item.document_id}: ${failure instanceof Error ? failure.message : "failed"}`); }
  }
  return summary;
}

export type SemanticMatch = { document_id: string; brand: CmsBrand; kind: "document" | "media"; media_index: number | null; similarity: number; title: string; publication_state: string };

export async function semanticMatches(db: SupabaseClient, brands: CmsBrand[], query: string, kind: "document" | "media" | null, limit: number, signal?: AbortSignal): Promise<SemanticMatch[]> {
  const [embedding] = await embedTexts([query], "query", signal);
  const { data, error } = await db.rpc("cms_match_embeddings", { p_brands: brands, p_query: vectorLiteral(embedding), p_kind: kind, p_limit: limit });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") return [];
    throw new CmsError(500, `Semantic search failed: ${error.message}`);
  }
  return ((data ?? []) as SemanticMatch[]).map(row => ({ ...row, similarity: Number(row.similarity) }));
}
