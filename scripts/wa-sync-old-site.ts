/**
 * Brings over what whiskyadvocate.com (Morweb) has published since the archive import, for as long as it stays the live
 * site. A post counts as live when the old site links to it from its RSS feed, its news sitemap, a listing page or the
 * ratings directory; every Morweb page answers 200, including drafts and tests, so a page that merely exists proves nothing.
 *
 * For each live post:
 *   - no CMS document: the post page is read and ingested as a published Morweb record (identity Posts:<id>, the same one
 *     the archive importer uses), with its lead photograph, caption, tags and SEO description, plus a redirect row;
 *   - a document under another address (an embargo slug renamed at publication): the slug and public URL follow the live page;
 *   - an unpublished document: published under the live page's headline, dated from the old site.
 * Posts that only the full sitemap lists, and older unpublished documents, are reported for an editor.
 *
 * Dry run by default. After --apply, run scripts/rehost-media.ts (body, then --heroes) for the new images and re-export
 * the static stories (scripts/wa-export-stories.py).
 *
 *   node --import tsx scripts/wa-sync-old-site.ts [--sitemap] [--ratings 300] [--report /tmp/wa-sync.json]
 *   node --import tsx scripts/wa-sync-old-site.ts --apply --development-target <supabase host>
 */
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlToDocument } from "../src/lib/cms/blocks";
import { hashMorwebInput } from "../src/lib/cms/morweb";
import { OLD_SITE, listingLinks, parseFeed, parsePost, parseSitemap, sitePath, type OldPost } from "../src/lib/cms/old-site";
import type { CmsIngestInput, CmsIngestResult } from "../src/lib/cms/types";
import { connectReader, connectTarget } from "./lib/target";

const ACTOR = "old-site-sync";
const UA = "mshanken-cms-migration/1.0 (+https://whiskyadvocate.com)";
const LISTINGS = ["/", "/whiskey-life", "/News", "/tag/news", "/Tag/New-Releases", "/tag/auctions", "/tag/cocktails", "/tag/whisky-watch", "/tag/bourbon", "/tag/scotch", "/tag/insights", "/tag/reviews", "/tag/whisky-and-food", "/tag/travel"];
const STORY_KINDS = new Set(["article", "legacy_record"]);
const TEMPLATE = /^\/(?:Home-|Top-20-|Post-|Template|Test)/i;

type Doc = { id: string; source_key: string; kind: string; publication_state: string; slug: string | null; public_url: string | null; revision: number; title: string; review: { required?: boolean } | null };
type Action =
  | { do: "create"; path: string; via: string[]; post: OldPost }
  | { do: "move"; path: string; via: string[]; doc: Doc; publish: boolean; post: OldPost }
  | { do: "publish"; path: string; via: string[]; doc: Doc; post: OldPost | null }
  | { do: "report"; path: string; via: string[]; reason: string; doc?: Pick<Doc, "source_key" | "kind" | "publication_state" | "title"> };

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { ...init, headers: { "user-agent": UA, ...init?.headers }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error instanceof Error ? error.message : error}`);
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
  }
}

/** The newest ratings in the old site's ratings directory, newest first. */
async function newestRatings(count: number): Promise<string[]> {
  const page = await fetchText(`${OLD_SITE}/ratings-reviews`);
  const options = /\boptions\s*:\s*'([^']+)'/.exec(page)?.[1];
  const xtoken = /\bxtoken\s*:\s*'([^']+)'/.exec(page)?.[1];
  if (!options || !xtoken) throw new Error("The ratings directory page no longer carries its options token.");
  const paths: string[] = [];
  for (let pageNo = 1; paths.length < count && pageNo <= Math.ceil(count / 50) + 1; pageNo++) {
    const body = new URLSearchParams({ options, xtoken, page: String(pageNo), "subFilters[filters][default][order_by]": "published_desc", "subFilters[filters][default][min_score]": "1" });
    const parts = (await fetchText(`${OLD_SITE}/ajax/directory/update`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" } })).split("-=-CUT-=-");
    const found = listingLinks(parts[3] ?? "").filter(path => !paths.includes(path));
    if (!found.length) break;
    paths.push(...found);
  }
  return paths.slice(0, count);
}

async function discover(flags: { sitemap: boolean; ratings: number }): Promise<Map<string, Set<string>>> {
  const seen = new Map<string, Set<string>>();
  const add = (via: string, paths: Iterable<string>) => { for (const path of paths) if (path !== "/" && !TEMPLATE.test(path)) (seen.get(path) ?? seen.set(path, new Set()).get(path)!).add(via); };
  add("rss", parseFeed(await fetchText(`${OLD_SITE}/call/blogs/rss/`)).map(item => item.path));
  add("news-sitemap", parseSitemap(await fetchText(`${OLD_SITE}/sitemap_news.xml`)));
  for (const listing of LISTINGS) {
    try { add("listing", listingLinks(await fetchText(OLD_SITE + listing))); } catch (error) { console.warn(`listing ${listing} skipped: ${error instanceof Error ? error.message : error}`); }
  }
  if (flags.ratings > 0) add("ratings-directory", await newestRatings(flags.ratings));
  if (flags.sitemap) add("sitemap", parseSitemap(await fetchText(`${OLD_SITE}/sitemap01.xml`)));
  return seen;
}

async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await query(from, from + 999);
    const data = page as T[] | null;
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function loadIndex(db: SupabaseClient) {
  const docs = await pages<Doc>((from, to) => db.from("cms_documents").select("id,source_key,kind,publication_state,slug,public_url,revision,title,review:metadata->review").eq("brand", "wa").order("id").range(from, to));
  const redirects = await pages<{ legacy_path: string; document_id: string | null }>((from, to) => db.from("cms_redirects").select("legacy_path,document_id").eq("brand", "wa").order("legacy_path").range(from, to));
  const byId = new Map(docs.map(doc => [doc.id, doc]));
  const byKey = new Map(docs.filter(doc => doc.source_key.startsWith("Posts:")).map(doc => [doc.source_key, doc]));
  const byPath = new Map<string, Doc>();
  const rank = (doc: Doc) => (doc.source_key.startsWith("Posts:") ? 2 : 0) + (doc.publication_state === "published" ? 1 : 0);
  const put = (path: string | null | undefined, doc: Doc | undefined) => {
    if (!path || !doc) return;
    const key = path.toLowerCase();
    const held = byPath.get(key);
    if (!held || rank(doc) > rank(held)) byPath.set(key, doc);
  };
  for (const doc of docs) { put(doc.slug ? `/${doc.slug}` : null, doc); put(doc.public_url ? sitePath(doc.public_url) : null, doc); }
  for (const row of redirects) put(row.legacy_path, row.document_id ? byId.get(row.document_id) : undefined);
  return { byKey, byPath, redirectPaths: new Set(redirects.map(row => row.legacy_path.toLowerCase())), docs: docs.length };
}

async function plan(seen: Map<string, Set<string>>, index: Awaited<ReturnType<typeof loadIndex>>): Promise<Action[]> {
  const actions: Action[] = [];
  for (const [path, sources] of seen) {
    const via = [...sources].sort();
    const live = via.some(source => source !== "sitemap");
    const doc = index.byPath.get(path.toLowerCase());
    if (doc) {
      if (doc.publication_state === "published" || doc.kind === "page") continue;
      if (!live) { actions.push({ do: "report", path, via, reason: "unpublished in the CMS; only the full sitemap lists it", doc }); continue; }
      if (doc.review?.required) { actions.push({ do: "report", path, via, reason: "live on the old site but held for review in the CMS", doc }); continue; }
      let post: OldPost | null = null;
      try { post = parsePost(path, await fetchText(OLD_SITE + path)); } catch { /* publish what the CMS holds */ }
      actions.push({ do: "publish", path, via, doc, post });
      continue;
    }
    let post: OldPost | null;
    try { post = parsePost(path, await fetchText(OLD_SITE + path)); } catch (error) { actions.push({ do: "report", path, via, reason: `old page unreadable: ${error instanceof Error ? error.message : error}` }); continue; }
    if (!post) { actions.push({ do: "report", path, via, reason: "not a post page (no post id)" }); continue; }
    const known = index.byKey.get(`Posts:${post.postId}`);
    if (known) {
      if (!live) { actions.push({ do: "report", path, via, reason: `only the full sitemap lists this address; the CMS has the post at /${known.slug}`, doc: known }); continue; }
      actions.push({ do: "move", path, via, doc: known, publish: known.publication_state !== "published" && !known.review?.required, post });
      continue;
    }
    if (!live) { actions.push({ do: "report", path, via, reason: "only the full sitemap lists it (possibly a draft)" }); continue; }
    if (!post.title || !post.body) { actions.push({ do: "report", path, via, reason: "the old page has no headline or body to import" }); continue; }
    actions.push({ do: "create", path, via, post });
  }
  return actions;
}

function document(post: OldPost, capturedAt: string): CmsIngestInput {
  const slug = post.path.replace(/^\//, "");
  const publicUrl = `${OLD_SITE}/${slug}`;
  const internal = (tag: string) => /^[a-z]+$/.test(tag);
  const tags = post.tags.filter(tag => !internal(tag));
  const categories = post.kind === "rating" ? ["Ratings"] : post.keywords.slice(0, Math.max(0, post.keywords.length - post.tags.length));
  const metadata = {
    legacy_source_collection: "Posts", legacy_source_id: post.postId,
    legacy_dates: post.date ? { published_date: post.date } : {},
    source_timezone: null, publication_state_resolved: true,
    taxonomy: { tag: post.tags.join(", "), category: categories.join(", ") },
    categories, tags,
    review: { required: false, reasons: [] },
    migration: { source_public_url: publicUrl, source_route: slug, source_publication_state: "published", body_status: "captured", captured_from: "live page", captured_at: capturedAt },
    seo: { title: post.title, description: post.description, canonical_url: publicUrl, no_index: false },
    legacy_seo: { meta_description: post.description, meta_keywords: post.keywords.join(", "), canonical_url: slug },
    legacy_media: post.hero ? { thumb_file: post.hero, header_select: "none" } : {},
    ...(post.heroCaption ? { lead_image: { caption: post.heroCaption } } : {}),
    ...(post.rating ? { rating: { ...post.rating, price_raw: post.rating.priceRaw, brand: "" } } : {}),
    issue_label: post.rating?.issue ?? "",
  };
  const input: Omit<CmsIngestInput, "source_hash"> = {
    brand: "wa", kind: post.kind, source_system: "morweb", source_key: `Posts:${post.postId}`,
    title: post.title, body_html: post.body, byline: post.rating?.reviewer || post.authors.join(" and "), excerpt: post.dek,
    slug, public_url: publicUrl, publication_state: "published", published_at: null, issue_uuid: null,
    identity_anchor: { source_collection: "Posts", source_record_id: post.postId },
    metadata: metadata as CmsIngestInput["metadata"],
    source_payload: { source_collection: "Posts", capture: "live page", source_url: publicUrl, post: { ...post, rating: post.rating ?? null } } as CmsIngestInput["source_payload"],
  };
  return { ...input, source_hash: hashMorwebInput(input) };
}

async function addRedirect(db: SupabaseClient, path: string, documentId: string, known: Set<string>) {
  if (known.has(path.toLowerCase())) return;
  const { error } = await db.from("cms_redirects").insert({ brand: "wa", legacy_host: "whiskyadvocate.com", legacy_path: path, document_id: documentId, status: 301, source: "import" });
  if (error && !/duplicate/i.test(error.message)) throw new Error(`redirect ${path}: ${error.message}`);
  known.add(path.toLowerCase());
}

/** What a document needs from the live page before it can be published: its live headline, and the text, date, dek and
 *  lead photograph when the CMS copy (often a draft saved before publication) lacks them. Metadata keys are whole objects. */
async function completion(db: SupabaseClient, id: string, post: OldPost | null): Promise<Record<string, unknown>> {
  if (!post) return {};
  const { data: row, error } = await db.from("cms_documents").select("title,body_html,excerpt,metadata").eq("id", id).single();
  if (error) throw new Error(error.message);
  const metadata = (row.metadata ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const patch: Record<string, unknown> = {};
  const meta: Record<string, unknown> = {};
  if (post.title && post.title !== row.title) patch.title = post.title;
  if (!String(row.body_html ?? "").replace(/<[^>]+>|&nbsp;|\s/g, "") && post.body) Object.assign(patch, { body_html: post.body, body_json: htmlToDocument(post.body) });
  if (!row.excerpt && post.dek) patch.excerpt = post.dek;
  const published = String(metadata.legacy_dates?.published_date ?? "");
  if (post.date && !/^[12]\d{3}-\d\d-\d\d/.test(published)) meta.legacy_dates = { ...metadata.legacy_dates, published_date: post.date };
  if (post.hero && !metadata.legacy_media?.thumb_file) meta.legacy_media = { ...metadata.legacy_media, thumb_file: post.hero };
  if (post.heroCaption && !(metadata.lead_image as { caption?: string } | undefined)?.caption) meta.lead_image = { ...metadata.lead_image, caption: post.heroCaption };
  if (Object.keys(meta).length) patch.metadata = meta;
  patch.migration = { ...metadata.migration };
  return patch;
}

async function publish(db: SupabaseClient, id: string) {
  const { data: row, error } = await db.from("cms_documents").select("revision").eq("id", id).single();
  if (error) throw new Error(error.message);
  const { error: publishError } = await db.rpc("cms_publish_document", { p_document_id: id, p_expected_revision: row.revision, p_publish_at: null, p_actor: ACTOR });
  if (publishError) throw new Error(`publish ${id}: ${publishError.message}`);
}

async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    apply: { type: "boolean", default: false }, "development-target": { type: "string" },
    sitemap: { type: "boolean", default: false }, ratings: { type: "string", default: "300" }, report: { type: "string" },
  } });
  const writer = connectTarget(values);
  const reader = connectReader();
  const capturedAt = new Date().toISOString();
  const seen = await discover({ sitemap: values.sitemap, ratings: Number(values.ratings) || 0 });
  const index = await loadIndex(reader);
  const actions = await plan(seen, index);
  console.log(`${seen.size} old-site addresses checked against ${index.docs} CMS documents.`);
  const results: Array<Record<string, unknown>> = [];
  for (const action of actions) {
    const line = { do: action.do, path: action.path, via: action.via.join("+") };
    try {
      if (action.do === "create") {
        const doc = document(action.post, capturedAt);
        Object.assign(line, { kind: doc.kind, title: doc.title, date: action.post.date, by: doc.byline, hero: action.post.hero || "(none)", images: (doc.body_html.match(/<img\b/g) ?? []).length });
        if (writer) {
          const { data, error } = await writer.rpc("cms_ingest_document", { p_document: doc, p_actor: ACTOR });
          if (error) throw new Error(error.message);
          const result = data as CmsIngestResult;
          if (!result?.document_id) throw new Error(`ingest returned no document id: ${JSON.stringify(data)}`);
          if (result.action === "created") {
            const { error: blockError } = await writer.rpc("cms_set_body_json", { p_document_id: result.document_id, p_body_json: htmlToDocument(doc.body_html) });
            if (blockError) console.warn(`body_json not written for ${doc.source_key}: ${blockError.message}`);
          }
          await addRedirect(writer, action.path, result.document_id, index.redirectPaths);
          Object.assign(line, { id: result.document_id, result: result.action });
        }
      } else if (action.do === "move" || action.do === "publish") {
        const slug = action.do === "move" ? action.path.replace(/^\//, "") : null;
        const toPublish = action.do === "publish" || action.publish;
        Object.assign(line, { source_key: action.doc.source_key, kind: action.doc.kind, title: action.post?.title || action.doc.title, ...(slug ? { from: `/${action.doc.slug}` } : {}), publish: toPublish });
        if (writer) {
          const patch = await completion(writer, action.doc.id, action.post);
          if (slug) Object.assign(patch, { slug, public_url: `${OLD_SITE}/${slug}`, metadata: { ...(patch.metadata as object), migration: { ...(patch.migration as object), source_public_url: `${OLD_SITE}/${slug}`, source_route: slug, previous_slug: action.doc.slug } } });
          delete patch.migration;
          if (Object.keys(patch).length) {
            const { data: row } = await writer.from("cms_documents").select("revision").eq("id", action.doc.id).single();
            const { error } = await writer.rpc("cms_save_document", { p_document_id: action.doc.id, p_expected_revision: row?.revision, p_patch: patch, p_actor: ACTOR });
            if (error) throw new Error(`save: ${error.message}`);
            Object.assign(line, { filled: Object.keys(patch).concat(Object.keys((patch.metadata as object) ?? {}).map(key => `metadata.${key}`)).filter(key => key !== "metadata") });
          }
          await addRedirect(writer, action.path, action.doc.id, index.redirectPaths);
          if (toPublish) await publish(writer, action.doc.id);
        }
      } else {
        Object.assign(line, { reason: action.reason, ...(action.doc ? { source_key: action.doc.source_key, kind: action.doc.kind, state: action.doc.publication_state, title: action.doc.title } : {}) });
      }
      Object.assign(line, { ok: true });
    } catch (error) {
      Object.assign(line, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    results.push(line);
    console.log(JSON.stringify(line));
  }
  const count = (kind: string) => results.filter(row => row.do === kind).length;
  console.log(`${writer ? "Applied" : "Dry run"}: ${count("create")} to import, ${count("move")} to readdress, ${count("publish")} to publish, ${count("report")} for an editor, ${results.filter(row => row.ok === false).length} errors.`);
  if (values.report) await writeFile(values.report, JSON.stringify({ captured_at: capturedAt, applied: Boolean(writer), results }, null, 2));
  if (results.some(row => row.ok === false)) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
