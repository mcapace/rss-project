import "server-only";
import { assertBrand, CmsError, type CmsUser } from "./access";
import { cmsDb, databaseError } from "./db";
import { getCmsDocument } from "./documents-server";
import { isUuid } from "./validation";
import {
  CMS_DOCUMENT_KINDS, CMS_MIGRATION_SOURCE_KINDS, CMS_PUBLICATION_STATES,
  type CmsBrand, type CmsDocument, type CmsMigrationInventory,
  type CmsMigrationSource, type CmsMigrationSourceKind, type CmsMigrationSourceSummary,
} from "./types";

const SUMMARY_FIELDS = "id,brand,archive_sha256,source_kind,source_key,payload_sha256,source_sha256,captured_at,actor,created_at";
const PAGE_SIZE = 50;
const POST_SOURCE_KINDS: CmsMigrationSourceKind[] = ["post_version", "source_part"];
const PAGE_SOURCE_KINDS: CmsMigrationSourceKind[] = ["page_version", "page_context", "page_editor_capture", "rendered_page_snapshot", "source_part"];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CmsError(500, "The migration inventory could not be read.");
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new CmsError(500, "The migration inventory could not be read.");
  return value;
}

function countMap<T extends string>(value: unknown, keys: readonly T[]): Record<T, number> {
  const source = record(value);
  return Object.fromEntries(keys.map(key => [key, count(source[key])])) as Record<T, number>;
}

/** Aggregate-only RPC: no document bodies, captured HTML, or source payloads leave the database. */
export async function getCmsMigrationInventory(brand: CmsBrand, user: CmsUser): Promise<CmsMigrationInventory> {
  assertBrand(user, brand);
  const { data, error } = await cmsDb().rpc("cms_migration_inventory", { p_brand: brand });
  if (error) databaseError(error);
  const inventory = record(data);
  if (inventory.brand !== brand) throw new CmsError(500, "The migration inventory could not be read.");
  const documents = record(inventory.documents);
  const sources = record(inventory.sources);
  // Explicit fields prevent an accidental RPC change from exposing raw evidence.
  return {
    brand,
    documents: {
      total: count(documents.total),
      by_kind: countMap(documents.by_kind, CMS_DOCUMENT_KINDS),
      by_publication_state: countMap(documents.by_publication_state, CMS_PUBLICATION_STATES),
      by_source_system: countMap(documents.by_source_system, ["morweb", "print", "manual"] as const),
      review_required: count(documents.review_required),
      pages_awaiting_assembly: count(documents.pages_awaiting_assembly),
    },
    sources: {
      total: count(sources.total), archive_count: count(sources.archive_count),
      by_source_kind: countMap(sources.by_source_kind, CMS_MIGRATION_SOURCE_KINDS),
    },
  };
}

function linkedIdentity(document: CmsDocument): { identity: string; kinds: CmsMigrationSourceKind[] } | null {
  // Only fixed numeric legacy identities can become query prefixes. In particular,
  // Posts:1: never matches Posts:10:, and editable titles/paths cannot broaden reads.
  if (document.source_system !== "morweb" || !/^(Posts|Pages):\d+$/.test(document.source_key)) return null;
  return { identity: document.source_key, kinds: document.source_key.startsWith("Pages:") ? PAGE_SOURCE_KINDS : POST_SOURCE_KINDS };
}

function assertLinked(source: CmsMigrationSourceSummary, document: CmsDocument, link: NonNullable<ReturnType<typeof linkedIdentity>>) {
  if (source.brand !== document.brand || !source.source_key.startsWith(`${link.identity}:`) || !link.kinds.includes(source.source_kind)) {
    throw new CmsError(404, "Migration source not found.");
  }
}

function summary(source: CmsMigrationSourceSummary): CmsMigrationSourceSummary {
  return {
    id: source.id, brand: source.brand, archive_sha256: source.archive_sha256,
    source_kind: source.source_kind, source_key: source.source_key,
    payload_sha256: source.payload_sha256, source_sha256: source.source_sha256,
    captured_at: source.captured_at, actor: source.actor, created_at: source.created_at,
  };
}

/** Valid JSON text with markup characters escaped. Consumers must display it as text. */
export function escapedMigrationJson(value: unknown): string {
  if (!value || typeof value !== "object") throw new CmsError(500, "The migration source could not be read.");
  const escapes: Record<string, string> = { "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" };
  return JSON.stringify(value, null, 2).replace(/[<>&\u2028\u2029]/g, character => escapes[character]);
}

/** Lists lightweight source metadata; raw evidence requires an explicit, linked source UUID. */
export async function getDocumentMigrationSources(
  documentId: string,
  user: CmsUser,
  options: { page?: number; sourceId?: string | null } = {},
) {
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new CmsError(422, "Invalid page number.");
  if (options.sourceId !== undefined && options.sourceId !== null && !isUuid(options.sourceId)) throw new CmsError(404, "Migration source not found.");
  const document = await getCmsDocument(documentId, user);
  assertBrand(user, document.brand);
  const link = linkedIdentity(document);
  if (!link) {
    if (options.sourceId) throw new CmsError(404, "Migration source not found.");
    return { document_id: document.id, source_identity: null, sources: [], total: 0, page, pageSize: PAGE_SIZE };
  }

  if (options.sourceId) {
    const { data, error } = await cmsDb().from("cms_migration_sources")
      .select(`${SUMMARY_FIELDS},payload`).eq("id", options.sourceId)
      .eq("brand", document.brand).like("source_key", `${link.identity}:%`)
      .in("source_kind", link.kinds).maybeSingle();
    if (error) databaseError(error);
    if (!data) throw new CmsError(404, "Migration source not found.");
    const source = data as CmsMigrationSource;
    assertLinked(source, document, link);
    return {
      document_id: document.id, source_identity: link.identity, source: summary(source),
      payload_json: escapedMigrationJson(source.payload), payload_format: "escaped-json" as const,
      read_only: true as const,
    };
  }

  const { data, error, count: total } = await cmsDb().from("cms_migration_sources")
    .select(SUMMARY_FIELDS, { count: "exact" }).eq("brand", document.brand)
    .like("source_key", `${link.identity}:%`).in("source_kind", link.kinds)
    .order("created_at", { ascending: false }).order("id", { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) databaseError(error);
  const sources = ((data || []) as CmsMigrationSourceSummary[]).map(source => {
    assertLinked(source, document, link);
    return summary(source);
  });
  return { document_id: document.id, source_identity: link.identity, sources, total: total ?? 0, page, pageSize: PAGE_SIZE };
}
