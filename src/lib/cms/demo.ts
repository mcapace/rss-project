import type { CmsDocument, CmsDocumentRevision, CmsSourceSnapshot } from "./types";

/** Synthetic demonstration content. Never seed the archive or connect this store to production. */
export function demoDocuments(): CmsDocument[] {
  const rows = [
    { title: "The art of the blend", byline: "Sample Editor", kind: "article", state: "review", source: "print", excerpt: "A print feature, ready for its first web edit.", body: "<p>A great blend begins with a clear idea of the experience it should create. Each component contributes something different: structure, texture, fruit, or spice.</p><h2>Finding the balance</h2><p>This is sample editorial copy for exploring the new workspace. Edit the headline, adjust the byline, and save a revision. Your changes stay in this browser.</p><blockquote><p>Every component should earn its place in the final blend.</p></blockquote><p>Before publication, an editor checks the story against the source issue, confirms names and figures, and selects the images.</p>" },
    { title: "A guide to warehouse maturation", byline: "Sample Editor", kind: "article", state: "draft", source: "manual", excerpt: "An original digital story in progress.", body: "<p>This demonstration draft explores how warehouse location and seasonal changes influence a maturing spirit.</p><p>Add your reporting, links, and subheadings here.</p>" },
    { title: "Autumn Reserve, 46%", byline: "Sample Reviewer", kind: "rating", state: "review", source: "print", excerpt: "An illustrative tasting note with structured rating fields.", body: "<p>Sample tasting note: orchard fruit and toasted grain on the nose, followed by vanilla and a gentle oak finish.</p>" },
    { title: "Five ways to explore a tasting", byline: "Sample Contributor", kind: "article", state: "published", source: "morweb", excerpt: "Demonstrates an imported publication state.", body: "<p>This synthetic record represents an article imported with its existing publication history preserved.</p>" },
    { title: "Contact the editorial team", byline: "", kind: "page", state: "draft", source: "manual", excerpt: "A standalone page with its own URL and metadata.", body: "<h2>Get in touch</h2><p>This sample page demonstrates editing a standalone site page.</p>" },
    { title: "The season in new releases", byline: "Sample Editor", kind: "article", state: "review", source: "print", excerpt: "A second feature from the sample issue.", body: "<p>Sample issue coverage for demonstrating the print-to-web review queue.</p>" },
    { title: "Archive feature awaiting an update", byline: "Sample Contributor", kind: "article", state: "unpublished", source: "morweb", excerpt: "Imported content retains its unpublished state.", body: "<p>This synthetic archive record is intentionally unpublished.</p>" },
  ];
  return rows.map((row, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    brand: "wa", kind: row.kind, source_system: row.source, source_key: `demo:${index + 1}`, body_json: null,
    source_hash: String(index + 1).repeat(64), identity_anchor: {}, title: row.title,
    byline: row.byline, body_html: row.body, excerpt: row.excerpt, slug: null, public_url: null,
    publication_state: row.state, published_at: row.state === "published" ? "2026-10-01T14:00:00Z" : null,
    issue_uuid: row.source === "print" ? "00000000-0000-4000-8000-000000000100" : null,
    metadata: {
      categories: row.kind === "rating" ? ["Bourbon"] : ["Whisky Life"],
      tags: [], issue_label: row.source === "print" ? "Sample autumn issue" : "",
      ...(row.kind === "rating" ? { rating: { score: 90, price: 55, brand: "Sample Distillery", category: "Bourbon", issue: "Sample autumn issue", reviewer: "Sample Reviewer" } } : {}),
    },
    revision: 1, created_at: "2026-10-30T12:00:00Z", updated_at: `2026-10-30T${String(14 - index).padStart(2, "0")}:00:00Z`,
  } as CmsDocument));
}

export function demoRevision(document: CmsDocument): CmsDocumentRevision {
  return { id: `${document.id}:${document.revision}`, document_id: document.id, revision: document.revision, snapshot: structuredClone(document), actor: "Demo editor", reason: document.revision === 1 ? "ingest" : "edit", created_at: document.updated_at };
}

export function demoSources(document: CmsDocument): CmsSourceSnapshot[] {
  return [{
    id: `${document.id}:source`, document_id: document.id, source_hash: document.source_hash,
    actor: "Demo import", created_at: document.created_at,
    payload: { brand: document.brand, kind: document.kind, source_system: document.source_system, source_key: document.source_key, title: document.title, body_html: document.body_html, byline: document.byline, metadata: document.metadata },
  }];
}
