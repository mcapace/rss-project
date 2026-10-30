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

  it("holds missing scores and distinct legacy post types instead of coercing them", () => {
    const result = planMorwebImport([
      post("103", { category_selected: ["50"], custom_fields: { custom_rating_score: "" } }),
      post("104", { category_selected: ["33"], category: "Clubs" }),
      post("105", { category_selected: ["62"], category: "Glossary" }),
    ]);
    expect(result.documents).toHaveLength(0);
    expect(result.report.held_records).toBe(3);
    expect(result.report.finding_counts).toMatchObject({ invalid_rating_score: 1, unmapped_post_type: 2 });
  });

  it("requires a complete observed publication combination; unknown flags go to review", () => {
    const result = prepareMorwebRecord(post("106", { published_flag: "9", published_switch: null }));
    expect(result.document?.publication_state).toBe("review");
    expect(result.findings.some(f => f.code === "unresolved_publication_state")).toBe(true);
    const unpublished = prepareMorwebRecord(post("107", { published: "0", published_flag: "0", published_class: "", published_switch: 1 }));
    expect(unpublished.document?.publication_state).toBe("unpublished");
  });

  it("holds every conflicting URL owner, including across content kinds", () => {
    const first = post("108", { alias: "collision" });
    const second = post("109", { alias: "collision" });
    const result = planMorwebImport([first, second]);
    expect(result.documents).toHaveLength(0);
    expect(result.report.url_collisions).toEqual([{ public_url: "https://whiskyadvocate.com/collision", source_keys: ["Posts:108", "Posts:109"] }]);
    expect(result.report.held.every(record => record.reasons.includes("public_url_collision"))).toBe(true);
    expect(first.record.alias).toBe("collision");
  });

  it("deduplicates identical observations but rejects an ambiguous source version", () => {
    const a = post("110");
    const duplicate = planMorwebImport([a, a]);
    expect(duplicate.report.duplicate_identical_records).toBe(1);
    expect(duplicate.documents).toHaveLength(1);
    const conflict = planMorwebImport([a, post("110", { content: "<p>Another version.</p>" })]);
    expect(conflict.documents).toHaveLength(0);
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

  it("holds Page metadata until its body is assembled and excludes a 404 shared shell as evidence", () => {
    const page = { id: "501", title: "Synthetic contact", path: "contact", publish: "1", published: "0000-00-00" };
    const result = planMorwebImport({ format: "whisky_advocate_migration_archive", records: [{
      source_collection: "Pages", source_record_id: "501", latest_record_sha256: "page-hash", versions: [{ record_sha256: "page-hash", raw_record: page }],
    }], page_block_context_captures: [{ linked_source_identity: { source_collection: "Pages", source_record_id: "501" }, qualified_http200_editor_dataset: false, response_http_status: 404 }] });
    expect(result.report.held[0].reasons).toContain("page_body_assembly_required");
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

  it("holds restricted content until an equivalent target access policy exists", () => {
    const result = prepareMorwebRecord(post("114", { private: "1" }));
    expect(result.document).toBeNull();
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
    expect(result.document).toBeNull();
    expect(result.findings.some(finding => finding.code === "empty_body" && finding.severity === "error")).toBe(true);
  });
});
