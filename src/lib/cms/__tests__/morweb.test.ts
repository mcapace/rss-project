import { describe, expect, it } from "vitest";
import { hashMorwebInput, planMorwebImport, prepareMorwebRecord, readMorwebInput, type MorwebEnvelope } from "../morweb";

// Synthetic examples only. Never copy private archives or live editorial content into fixtures.
const post = (id = "101", changes: Record<string, unknown> = {}): MorwebEnvelope => ({
  source_collection: "Posts",
  record: {
    id, title: "A synthetic editorial story", content: "<p>An original paragraph.</p>",
    alias: `synthetic-story-${id}`, category_selected: ["18"], category: "News",
    published: "2", published_flag: "2", published_class: "checked", published_switch: 0,
    publish_dateStamp: "20261010134500", date: "2026-10-10 13:45:00",
    author: "CMS_Operator", user_id: "99",
    custom_fields: { custom_author: "Custom Author", custom_author_title_1: "Fictional Writer" },
    ...changes,
  },
});

describe("Morweb migration adapter", () => {
  it("retains identity, publication state, untouched HTML and unresolved local time", () => {
    const input = post("101", { content: "<p>A &amp; B</p>\n", alias: "Mixed-Case-Archive-URL" });
    const result = prepareMorwebRecord(input);
    expect(result.document).toMatchObject({
      source_key: "Posts:101", source_system: "morweb", kind: "article",
      body_html: "<p>A &amp; B</p>\n", public_url: "https://whiskyadvocate.com/Mixed-Case-Archive-URL",
      byline: "Fictional Writer", publication_state: "published", published_at: null,
    });
    expect(result.document?.metadata?.source_timezone).toBeNull();
    expect(result.document?.source_payload?.record).toEqual(input.record);
    expect(result.findings.some(f => f.code === "source_timezone_unresolved")).toBe(true);
  });

  it("does not use a CMS login as a writer or infer a rating from an empty custom field", () => {
    const result = prepareMorwebRecord(post("102", { custom_fields: { custom_rating_score: "" } }));
    expect(result.document?.kind).toBe("article");
    expect(result.document?.byline).toBe("");
    expect(result.document?.metadata?.legacy_cms_account).toEqual({ author: "CMS_Operator", user_id: "99" });
  });

  it("uses Ratings category membership and the actual reviewer, preserving nonnumeric prices", () => {
    const result = prepareMorwebRecord(post("103", {
      category_selected: ["50"], category: "Ratings", custom_fields: {
        custom_rating_score: "92", custom_rating_price: "£65 / 700 ml", custom_rating_reviewer: "Fictional Reviewer", custom_rating_brand: "Example Brand", custom_rating_issue: "Fall 2026",
      },
    }));
    expect(result.document).toMatchObject({ kind: "rating", byline: "Fictional Reviewer" });
    expect(result.document?.metadata?.rating).toMatchObject({ score: 92, price: null, price_raw: "£65 / 700 ml" });
    expect(result.document?.source_payload?.record).toHaveProperty("custom_fields");
  });

  it("retains missing scores and distinct legacy post types with their own models", () => {
    const result = planMorwebImport([
      post("103", { category_selected: ["50"], custom_fields: { custom_rating_score: "" } }),
      post("104", { category_selected: ["33"], category: "Clubs" }),
      post("105", { category_selected: ["62"], category: "Glossary" }),
    ]);
    expect(result.documents.map(document => document.kind)).toEqual(["rating", "directory_entry", "glossary_entry"]);
    expect(result.report.held_records).toBe(0);
    expect(result.report.review_required_records).toBe(1);
    expect(result.documents[0]).toMatchObject({ publication_state: "review", metadata: { rating: { score: null }, review: { required: true, reasons: ["invalid_rating_score"] } } });
  });

  it("requires a complete observed publication combination; unknown flags go to review", () => {
    const result = prepareMorwebRecord(post("106", { published_flag: "9", published_switch: null }));
    expect(result.document?.publication_state).toBe("review");
    expect(result.findings.some(f => f.code === "unresolved_publication_state")).toBe(true);
    const unpublished = prepareMorwebRecord(post("107", { published: "0", published_flag: "0", published_class: "", published_switch: 1 }));
    expect(unpublished.document?.publication_state).toBe("unpublished");
  });

  it("retains every conflicting URL owner with the original route and no invented replacement", () => {
    const first = post("108", { alias: "collision" });
    const second = post("109", { alias: "collision" });
    const result = planMorwebImport([first, second]);
    expect(result.documents).toHaveLength(2);
    expect(result.report.url_collisions).toEqual([{ public_url: "https://whiskyadvocate.com/collision", source_keys: ["Posts:108", "Posts:109"] }]);
    expect(result.report.held_records).toBe(0);
    for (const document of result.documents) {
      expect(document).toMatchObject({ public_url: null, slug: null, publication_state: "review", metadata: {
        review: { required: true, reasons: ["public_url_collision"] },
        migration: { source_public_url: "https://whiskyadvocate.com/collision", source_route: "collision" },
      } });
      const { source_hash, ...payload } = document;
      expect(source_hash).toBe(hashMorwebInput(payload));
    }
    expect(first.record.alias).toBe("collision");
  });

  it("deduplicates identical observations but rejects an ambiguous source version", () => {
    const a = post("110");
    const duplicate = planMorwebImport([a, a]);
    expect(duplicate.report.duplicate_identical_records).toBe(1);
    expect(duplicate.documents).toHaveLength(1);
    const conflict = planMorwebImport([a, post("110", { content: "<p>Another version.</p>" })]);
    expect(conflict.documents).toHaveLength(0);
    expect(conflict.report.fatal_records).toBe(1);
    expect(conflict.report.held[0].reasons).toContain("conflicting_source_versions");
  });

  it("selects the archive-declared latest version rather than array order", () => {
    const a = post("111");
    const b = post("111", { title: "Older source title" });
    const source = { format: "whisky_advocate_migration_archive", records: [{
      source_collection: "Posts", source_record_id: "111", latest_record_sha256: "latest-hash",
      versions: [{ record_sha256: "latest-hash", raw_record: a.record }, { record_sha256: "older-hash", raw_record: b.record }],
    }] };
    const result = planMorwebImport(source);
    expect(result.documents[0].title).toBe(a.record.title);
    expect(result.documents[0].source_payload?.archive_version_hashes).toEqual(["latest-hash", "older-hash"]);
    expect(() => readMorwebInput({ ...source, records: [{ ...source.records[0], latest_record_sha256: "missing" }] })).toThrow(/no unique declared latest/);
  });

  it("retains Page metadata as review records and excludes a 404 shared shell as body evidence", () => {
    const page = { id: "501", title: "Synthetic contact", path: "contact", publish: "1", published: "0000-00-00" };
    const result = planMorwebImport({ format: "whisky_advocate_migration_archive", records: [{
      source_collection: "Pages", source_record_id: "501", latest_record_sha256: "page-hash", versions: [{ record_sha256: "page-hash", raw_record: page }],
    }], page_block_context_captures: [{ linked_source_identity: { source_collection: "Pages", source_record_id: "501" }, qualified_http200_editor_dataset: false, response_http_status: 404 }] });
    expect(result.documents[0]).toMatchObject({ kind: "page", body_html: "", publication_state: "review", metadata: {
      captured_page_context_count: 0,
      review: { required: true, reasons: ["page_body_assembly_required"] },
      migration: { body_status: "metadata_only", source_publication_state: "published" },
    } });
    expect(result.documents[0].source_payload?.record).toEqual(page);
    expect(result.report.held_records).toBe(0);
    const assembled = prepareMorwebRecord({ source_collection: "Pages", record: page, body_html: "<p>Assembled body.</p>" });
    expect(assembled.document).toMatchObject({ source_key: "Pages:501", kind: "page", publication_state: "published" });
    expect(assembled.document?.source_payload?.record).toEqual(page);
  });

  it("keeps source IDs stable through title edits and hashes deterministically", () => {
    const original = prepareMorwebRecord(post("112")).document!;
    const changed = prepareMorwebRecord(post("112", { title: "Edited source headline" })).document!;
    expect(original.source_key).toBe(changed.source_key);
    expect(original.source_hash).not.toBe(changed.source_hash);
    const { source_hash, ...payload } = original;
    expect(hashMorwebInput(Object.fromEntries(Object.entries(payload).reverse()) as typeof payload)).toBe(source_hash);
  });

  it("reports missing and unverified media without dropping HTML or claiming it copied binaries", () => {
    const result = planMorwebImport([post("113", { content: '<p>Body</p><img src="/files/a.jpg"><img src="https://cdn.example.test/b.png">', thumb: "19" })], {
      assetStatus: { "https://whiskyadvocate.com/files/a.jpg": "missing" },
    });
    expect(result.report.media).toEqual({ unique_references: 2, captured: 0, missing: 1, unverified: 1 });
    expect(result.report.finding_counts.missing_media).toBe(1);
    expect(result.report.target_write_performed).toBe(false);
    expect(result.documents[0].body_html).toContain("/files/a.jpg");
  });

  it("retains restricted content in review pending an equivalent target access policy", () => {
    const result = prepareMorwebRecord(post("114", { private: "1" }));
    expect(result.document).toMatchObject({ publication_state: "review", metadata: { review: { required: true, reasons: ["access_policy_mapping_required"] } } });
    expect(result.document?.source_payload?.record).toHaveProperty("private", "1");
    expect(result.findings.some(f => f.code === "access_policy_mapping_required")).toBe(true);
  });

  it("resolves prefixed taxonomy definitions without relying on truncated display labels", () => {
    const row = post("115", { category: "News, Whisk&hellip;", category_selected: ["18", "37"], tag: "An incorrect display", tag_selected: ["10"] });
    const result = planMorwebImport({
      records: [row],
      source_contexts: [{ raw_context: { Data: {
        Categories: { id18: { id: "id18", title: "News" }, id37: { id: "id37", title: "Whisky 101" } },
        Tags: { id10: { id: "id10", title: "Synthetic Topic" } },
      } } }],
    });
    expect(result.documents[0].metadata?.categories).toEqual(["News", "Whisky 101"]);
    expect(result.documents[0].metadata?.tags).toEqual(["Synthetic Topic"]);
    expect(result.report.finding_counts.taxonomy_relationships_pending).toBeUndefined();
  });

  it("does not treat an empty preserved content field as a ready article", () => {
    const result = prepareMorwebRecord(post("116", { content: "" }));
    expect(result.document).toMatchObject({ body_html: "", publication_state: "review", metadata: { review: { required: true, reasons: ["empty_body"] } } });
    expect(result.findings.some(finding => finding.code === "empty_body" && finding.severity === "warning")).toBe(true);
  });

  it("maps captured structured types and retains ambiguous/test records without loss", () => {
    const result = planMorwebImport([
      post("201", { category_selected: ["32"], category: "Top20" }),
      post("202", { category_selected: ["74"], category: "TopShelf" }),
      post("203", { category_selected: [""], category: "" }),
      post("204", { category_selected: ["53"], category: "Uncategorized" }),
      post("205", { category_selected: ["84"], category: "RatingsTest", custom_fields: { custom_rating_score: "95" } }),
      post("206", { category_selected: ["18"], custom_fields: { custom_post_type: "unknown-widget" } }),
    ]);
    expect(result.documents.map(document => document.kind)).toEqual(["collection_entry", "product_review", "legacy_record", "legacy_record", "legacy_record", "legacy_record"]);
    expect(result.report).toMatchObject({ eligible_records: 6, held_records: 0, fatal_records: 0, review_required_records: 4 });
    for (const document of result.documents.slice(2)) expect(document.metadata?.review).toEqual({ required: true, reasons: ["ambiguous_content_type"] });
  });

  it("separates homepage placements from permanent channels and unknown scheduling", () => {
    const result = planMorwebImport([
      post("207", { category_selected: ["id28", "id65"], category: "Homepage Slider, Homepage News Slider", tag_selected: ["12"], tag: "Synthetic tag" }),
      post("208", { category_selected: ["79"], category: "90Plus" }),
    ]);
    expect(result.documents.every(document => document.kind === "article")).toBe(true);
    expect(result.documents[0].metadata?.organization).toEqual({
      primary_channel: null, topics: [], source_categories: ["Homepage Slider", "Homepage News Slider"],
      placements: [
        { slot: "homepage_slider", label: "Homepage Slider", starts_at: null, ends_at: null, status: "needs_review", source_category_id: "28" },
        { slot: "homepage_news_slider", label: "Homepage News Slider", starts_at: null, ends_at: null, status: "needs_review", source_category_id: "65" },
      ],
    });
    expect(result.documents[1].metadata?.organization).toMatchObject({ primary_channel: null, placements: [] });
    expect(result.documents[0].metadata?.tags).toEqual(["Synthetic tag"]);
  });

  it("keeps strict review holds optional while structural errors remain fatal in either policy", () => {
    const rows = [post("209", { content: "" }), post("210", { category_selected: [], category: "" }), post("211")];
    const preserve = planMorwebImport(rows);
    const strict = planMorwebImport(rows, { policy: "strict" });
    expect(preserve.report).toMatchObject({ policy: "preserve", eligible_records: 3, held_records: 0, fatal_records: 0 });
    expect(strict.report).toMatchObject({ policy: "strict", eligible_records: 1, held_records: 2, fatal_records: 0 });
    for (const policy of ["preserve", "strict"] as const) {
      const invalid = planMorwebImport([post("not-an-id"), { ...post("212"), source_cache_key: "999" }], { policy });
      expect(invalid.report.fatal_records).toBe(2);
      expect(invalid.documents).toHaveLength(0);
    }
    expect(prepareMorwebRecord(post("0")).document?.source_key).toBe("Posts:0");
  });

  it("retains missing titles, bodies, and invalid public URLs without inventing content", () => {
    const source = post("213", { title: "", content: null, alias: "javascript:alert(1)" });
    const result = prepareMorwebRecord(source);
    expect(result.document).toMatchObject({ title: "", body_html: "", public_url: null, publication_state: "review" });
    expect(result.review_reasons).toEqual(["missing_body", "missing_title", "unresolved_public_url"]);
    expect(result.document?.source_payload?.record).toEqual(source.record);
  });

  it("stores invalid numeric scores as null and gates conflicting custom fields", () => {
    const result = prepareMorwebRecord(post("214", { category_selected: ["50"], custom_rating_score: "91", custom_fields: { custom_rating_score: "101" } }));
    expect(result.document).toMatchObject({ publication_state: "review", metadata: { rating: { score: null }, review: { required: true, reasons: ["conflicting_custom_fields", "invalid_rating_score"] } } });
    expect(result.document?.source_payload?.record).toHaveProperty("custom_rating_score", "91");
  });

  it("does not let a source publication override bypass a content review gate", () => {
    const result = prepareMorwebRecord(post("215", { content: "" }), { publicationOverrides: { "Posts:215": { state: "published", evidence: "Synthetic reviewed source state" } } });
    expect(result.document?.publication_state).toBe("review");
    expect(result.document?.metadata?.migration).toMatchObject({ source_publication_state: "published" });
  });
});
