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
