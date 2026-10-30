import type { CmsBrand, CmsDocument, CmsDocumentKind, CmsDocumentRevision, CmsPublicationState, CmsSourceSystem } from "@/lib/cms/types";
import type { PrintIssue } from "./data";

/**
 * Synthetic demonstration content across the four publications. Nothing here
 * is real editorial work, and the demo store never touches a database.
 */

type Seed = {
  brand: CmsBrand;
  title: string;
  byline: string;
  kind: CmsDocumentKind;
  state: CmsPublicationState;
  source: CmsSourceSystem;
  section: string;
  excerpt: string;
  body: string;
  /** Hours before "now" the document was last edited. */
  agoHours: number;
  /** Hours relative to now for publish time: negative is past (published), positive is planned. */
  publishOffsetHours?: number;
  rating?: { score: number; price: number; brand: string; category: string; reviewer: string };
  media?: number;
  issue?: boolean;
  reviewReasons?: string[];
};

const PARAGRAPHS = [
  "This is sample editorial copy for exploring the workspace. Edit the headline, adjust the byline, set a publish time, and save a revision. Everything stays in this browser.",
  "Before publication an editor checks the story against its source, confirms names and figures, chooses the lead image, and writes the search description.",
  "Sections, topics and placements describe how a story is found. They never change where it lives, so a story can move between channels without changing its address.",
];

function body(lede: string, heading: string, quote?: string): string {
  return `<p>${lede}</p><h2>${heading}</h2><p>${PARAGRAPHS[0]}</p>${quote ? `<blockquote><p>${quote}</p></blockquote>` : ""}<p>${PARAGRAPHS[1]}</p><p>${PARAGRAPHS[2]}</p>`;
}

const SEEDS: Seed[] = [
  // Whisky Advocate
  { brand: "wa", title: "The art of the blend", byline: "Sample Editor", kind: "article", state: "review", source: "print", section: "Whisky Life", excerpt: "A print feature, ready for its first web edit.", body: body("A great blend begins with a clear idea of the experience it should create. Each component contributes something different: structure, texture, fruit, or spice.", "Finding the balance", "Every component should earn its place in the final blend."), agoHours: 1, media: 4, issue: true, reviewReasons: ["page_boundaries", "byline_unverified"] },
  { brand: "wa", title: "A guide to warehouse maturation", byline: "Sample Editor", kind: "article", state: "draft", source: "manual", section: "Whisky 101", excerpt: "An original digital story in progress.", body: body("This demonstration draft explores how warehouse location and seasonal changes influence a maturing spirit.", "Heat, humidity and height"), agoHours: 3, publishOffsetHours: 30 },
  { brand: "wa", title: "Autumn Reserve, 46%", byline: "Sample Reviewer", kind: "rating", state: "review", source: "print", section: "Ratings", excerpt: "An illustrative tasting note with structured rating fields.", body: "<p>Sample tasting note: orchard fruit and toasted grain on the nose, followed by vanilla and a gentle oak finish.</p>", agoHours: 5, rating: { score: 91, price: 55, brand: "Sample Distillery", category: "Bourbon", reviewer: "Sample Reviewer" }, issue: true },
  { brand: "wa", title: "Five ways to explore a tasting", byline: "Sample Contributor", kind: "article", state: "published", source: "morweb", section: "Whisky 101", excerpt: "Demonstrates an imported publication state.", body: body("This synthetic record represents an article imported with its existing publication history preserved.", "Start with the glass"), agoHours: 26, publishOffsetHours: -20 * 24 },
  { brand: "wa", title: "Contact the editorial team", byline: "", kind: "page", state: "draft", source: "manual", section: "", excerpt: "A standalone page with its own URL and metadata.", body: "<h2>Get in touch</h2><p>This sample page demonstrates editing a standalone site page.</p>", agoHours: 40 },
  { brand: "wa", title: "The season in new releases", byline: "Sample Editor", kind: "article", state: "review", source: "print", section: "News", excerpt: "A second feature from the sample issue.", body: body("Sample issue coverage for demonstrating the print-to-web review queue.", "What arrived this quarter"), agoHours: 7, media: 2, issue: true, publishOffsetHours: 50 },
  { brand: "wa", title: "Archive feature awaiting an update", byline: "Sample Contributor", kind: "article", state: "unpublished", source: "morweb", section: "Whisky Life", excerpt: "Imported content retains its unpublished state.", body: "<p>This synthetic archive record is intentionally unpublished.</p>", agoHours: 90 },
  { brand: "wa", title: "Highland Harvest 12 Year Old, 43%", byline: "Sample Reviewer", kind: "rating", state: "published", source: "morweb", section: "Ratings", excerpt: "A published rating with structured fields.", body: "<p>Sample tasting note: heather honey, soft smoke and a long, warming finish.</p>", agoHours: 120, publishOffsetHours: -9 * 24, rating: { score: 88, price: 62, brand: "Sample Highland", category: "Single Malt Scotch", reviewer: "Sample Reviewer" } },
  { brand: "wa", title: "Glossary: Angel's share", byline: "", kind: "glossary_entry", state: "published", source: "morweb", section: "Glossary", excerpt: "The portion lost to evaporation during maturation.", body: "<p>The share of spirit that evaporates from the cask during maturation, typically about two percent a year.</p>", agoHours: 300, publishOffsetHours: -60 * 24 },
  { brand: "wa", title: "How to host a comparative tasting at home", byline: "Sample Editor", kind: "article", state: "draft", source: "manual", section: "Whisky Life", excerpt: "A weekend service piece.", body: body("Line up four glasses, a pitcher of water and a notebook. The rest is attention.", "Set the order"), agoHours: 12, publishOffsetHours: 4 * 24 + 6 },
  // Wine Spectator
  { brand: "ws", title: "Napa's new guard rethinks Cabernet", byline: "Sample Senior Editor", kind: "article", state: "review", source: "print", section: "Features", excerpt: "A print feature on a changing valley.", body: body("A generation of winemakers is trading extraction for restraint, and the results are showing up in the glass.", "Lower, slower, earlier", "The vineyard tells you what it wants to be."), agoHours: 2, media: 6, issue: true, reviewReasons: ["image_rights"] },
  { brand: "ws", title: "Sample Estate Cabernet Sauvignon Napa Valley 2023", byline: "Sample Taster", kind: "rating", state: "published", source: "morweb", section: "Ratings", excerpt: "A published wine rating.", body: "<p>Cassis, graphite and violets, with polished tannins. Drink now through 2038.</p>", agoHours: 50, publishOffsetHours: -3 * 24, rating: { score: 94, price: 125, brand: "Sample Estate", category: "Cabernet Sauvignon", reviewer: "Sample Taster" } },
  { brand: "ws", title: "Ten restaurants with remarkable Burgundy lists", byline: "Sample Dining Editor", kind: "collection_entry", state: "draft", source: "manual", section: "Dining", excerpt: "A collection entry in progress.", body: body("Great lists are built over decades, and these ten show the patience it takes.", "The long game"), agoHours: 9, publishOffsetHours: 2 * 24 + 3 },
  { brand: "ws", title: "Harvest report: cool nights, patient picking", byline: "Sample Correspondent", kind: "article", state: "published", source: "manual", section: "News", excerpt: "A news story published this week.", body: body("Across the North Coast, growers waited for flavor rather than sugar.", "What growers are saying"), agoHours: 30, publishOffsetHours: -2 * 24 },
  { brand: "ws", title: "Weekend pairing: roast chicken, three ways", byline: "Sample Food Editor", kind: "article", state: "review", source: "manual", section: "Dining", excerpt: "A service piece awaiting a second read.", body: body("One bird, three bottles, and a case for versatility.", "Why Chardonnay works"), agoHours: 15 },
  { brand: "ws", title: "Sample Winery Chardonnay Sonoma Coast 2024", byline: "Sample Taster", kind: "rating", state: "review", source: "print", section: "Ratings", excerpt: "A rating extracted from the print issue.", body: "<p>Lemon curd, crushed shell and a saline finish.</p>", agoHours: 4, rating: { score: 92, price: 48, brand: "Sample Winery", category: "Chardonnay", reviewer: "Sample Taster" }, issue: true },
  // Cigar Aficionado
  { brand: "ca", title: "Inside a Nicaraguan rolling room", byline: "Sample Executive Editor", kind: "article", state: "review", source: "print", section: "Features", excerpt: "A photo-led print feature.", body: body("The rhythm of the room is set by the torcedores, and the lector keeps time.", "Bunching, then wrapping", "A good roll is felt before it is seen."), agoHours: 6, media: 8, issue: true },
  { brand: "ca", title: "Sample Reserva Toro", byline: "Sample Reviewer", kind: "product_review", state: "published", source: "morweb", section: "Ratings", excerpt: "A published cigar review.", body: "<p>Earthy and rich with notes of cocoa and cedar, finishing with a hint of espresso.</p>", agoHours: 80, publishOffsetHours: -5 * 24, rating: { score: 93, price: 16, brand: "Sample Reserva", category: "Toro", reviewer: "Sample Reviewer" } },
  { brand: "ca", title: "The lounge guide: what to look for", byline: "Sample Editor", kind: "article", state: "draft", source: "manual", section: "Lifestyle", excerpt: "A guide in early draft.", body: body("Ventilation, seating and a humidor that is cared for daily separate the good from the great.", "Ask about the humidor"), agoHours: 20, publishOffsetHours: 6 * 24 },
  { brand: "ca", title: "Pairing notes: aged rum and a mild Connecticut", byline: "Sample Contributor", kind: "article", state: "published", source: "manual", section: "Drinks", excerpt: "A published pairing piece.", body: body("Sweetness meets cream in a pairing that flatters both.", "Why it works"), agoHours: 60, publishOffsetHours: -1 * 24 - 4 },
  // Market Watch
  { brand: "mw", title: "Retail spirits sales steady through the quarter", byline: "Sample Trade Editor", kind: "article", state: "review", source: "print", section: "Spirits Report", excerpt: "A trade feature from the sample issue.", body: body("Premium and super-premium tiers continued to outpace the category, while value brands held share.", "Where the growth is"), agoHours: 8, media: 3, issue: true, publishOffsetHours: 24 + 10 },
  { brand: "mw", title: "Leaders 2026: the retailers to watch", byline: "Sample Editor", kind: "article", state: "draft", source: "manual", section: "Leaders", excerpt: "An annual feature in planning.", body: body("Each year we recognize operators who moved the trade forward.", "This year's list"), agoHours: 48 },
  { brand: "mw", title: "Ready-to-drink cocktails find their shelf", byline: "Sample Correspondent", kind: "article", state: "published", source: "manual", section: "Trends", excerpt: "A published trend story.", body: body("Cold boxes are the new battleground for canned cocktails.", "Merchandising matters"), agoHours: 100, publishOffsetHours: -12 * 24 },
  { brand: "mw", title: "Directory: sample distributor profile", byline: "", kind: "directory_entry", state: "unpublished", source: "morweb", section: "Directory", excerpt: "An imported directory record.", body: "<p>Sample distributor serving three states, founded 1962.</p>", agoHours: 200 },
];

/** Sample image descriptions so the demo can be searched by subject, style and color. */
const LOOKS = [
  { description: "Oak barrels stacked in a dim rickhouse, warm light raking across the staves and a figure in silhouette at the far end.", style: "moody low-key documentary photograph", mood: "quiet, warm", tags: ["barrels", "warehouse", "rickhouse", "oak", "silhouette", "low light"], subjects: ["barrels", "warehouse interior"], colors: ["amber", "dark brown", "charcoal"], palette: ["#5a3b1e", "#b67a3a", "#1f1a17", "#d9b27c"] },
  { description: "A close product shot of a bottle and tulip glass on slate, with a soft gradient background and a single highlight on the glass.", style: "clean studio product photograph", mood: "calm, premium", tags: ["bottle", "glass", "slate", "studio", "product shot"], subjects: ["bottle", "glass"], colors: ["gold", "slate gray", "black"], palette: ["#2b2b2e", "#c9a24a", "#6b6f78", "#f1e7cf"] },
  { description: "Rows of vines on a hillside under a bright blue sky, with a stone winery building in the distance and dry golden grass in the foreground.", style: "bright wide landscape photograph", mood: "open, sunny", tags: ["vineyard", "hillside", "landscape", "sky", "winery"], subjects: ["vineyard", "landscape"], colors: ["sky blue", "green", "golden"], palette: ["#3a78c2", "#4f7a3a", "#c9a84a", "#e8e2d0"] },
  { description: "Hands rolling a cigar at a wooden workbench, tobacco leaves spread around, lit by a window to the left.", style: "intimate reportage photograph", mood: "focused, textured", tags: ["hands", "craft", "tobacco", "workshop", "window light"], subjects: ["hands", "cigar rolling"], colors: ["tobacco brown", "cream", "olive"], palette: ["#6d4a2c", "#e4d7bd", "#6e6a3a", "#2a2320"] },
  { description: "A retail shelf lined with spirits bottles and price tags, shot straight on under cool fluorescent light.", style: "flat documentary photograph", mood: "neutral, busy", tags: ["retail", "shelf", "bottles", "store", "price tags"], subjects: ["store shelf", "bottles"], colors: ["cool white", "red", "green"], palette: ["#e9edf0", "#b02a2a", "#2f7a43", "#3b3b40"] },
  { description: "An overhead flat lay of a tasting mat, four glasses in a row, a notebook and a pen, on pale linen.", style: "airy overhead flat lay", mood: "orderly, light", tags: ["flat lay", "tasting", "glasses", "notebook", "linen"], subjects: ["tasting glasses", "notebook"], colors: ["cream", "amber", "white"], palette: ["#f4efe6", "#c58f3b", "#ffffff", "#8a8577"] },
];

const ISSUE_IDS: Record<CmsBrand, string> = {
  wa: "10000000-0000-4000-8000-000000000001",
  ws: "10000000-0000-4000-8000-000000000002",
  ca: "10000000-0000-4000-8000-000000000003",
  mw: "10000000-0000-4000-8000-000000000004",
};
const ISSUE_LABELS: Record<CmsBrand, string> = { wa: "Winter 2026", ws: "Nov. 15, 2026", ca: "Dec. 2026", mw: "November 2026" };

const hoursAgo = (now: Date, hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

export function demoDocuments(now: Date = new Date()): CmsDocument[] {
  return SEEDS.map((seed, index) => {
    const n = index + 1;
    const published = seed.state === "published";
    const publishAt = seed.publishOffsetHours != null ? hoursAgo(now, -seed.publishOffsetHours) : null;
    const media = seed.media ? Array.from({ length: seed.media }, (_, i) => {
      const look = LOOKS[(n + i / 2) % LOOKS.length];
      return {
        s3_key: `cms/print/${seed.brand}/${ISSUE_IDS[seed.brand]}/${"0".repeat(64)}/images/${n}${i}.jpg`,
        sha256: `${n}${i}`.padEnd(64, "a"), file: `p0${n}${i}_x${i + 1}.jpg`, caption: i === 0 ? "Lead image from the print layout." : "", credit: "Sample photographer", alt: "", is_lead: i === 0,
        // Described images are what make "search by the look" work in the demo.
        ...(i % 2 === 0 ? { vision: { ...look, described_at: hoursAgo(now, seed.agoHours + 1), model: "sample" }, palette: look.palette, palette_names: look.colors.join(", ") } : {}),
      };
    }) : [];
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      brand: seed.brand, kind: seed.kind, source_system: seed.source, source_key: `demo:${n}`,
      source_hash: String(n % 10).repeat(64), identity_anchor: {},
      title: seed.title, byline: seed.byline, body_html: seed.body, excerpt: seed.excerpt,
      slug: published ? seed.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : null,
      public_url: null,
      publication_state: seed.state,
      published_at: published ? publishAt : null,
      issue_uuid: seed.issue ? ISSUE_IDS[seed.brand] : null,
      metadata: {
        section: seed.section,
        categories: seed.section ? [seed.section] : [],
        tags: [],
        issue_label: seed.issue ? ISSUE_LABELS[seed.brand] : "",
        ...(seed.rating ? { rating: { ...seed.rating, issue: seed.issue ? ISSUE_LABELS[seed.brand] : "" } } : {}),
        ...(media.length ? { media } : {}),
        ...(!published && publishAt ? { schedule: { publish_at: publishAt } } : {}),
        ...(seed.reviewReasons ? { review: { required: true, reasons: seed.reviewReasons } } : {}),
        ...(seed.source === "print" ? { warnings: ["Editorial review required: verify extracted text, page boundaries, byline, and image rights."] } : {}),
        seo: { title: "", description: seed.excerpt, no_index: false },
      },
      revision: 1,
      created_at: hoursAgo(now, seed.agoHours + 24),
      updated_at: hoursAgo(now, seed.agoHours),
    } as CmsDocument;
  });
}

export function demoRevision(document: CmsDocument, actor = "Demo editor"): CmsDocumentRevision {
  return { id: `${document.id}:${document.revision}`, document_id: document.id, revision: document.revision, snapshot: structuredClone(document), actor, reason: document.revision === 1 ? "ingest" : "edit", created_at: document.updated_at };
}

export function demoIssues(now: Date = new Date()): PrintIssue[] {
  const rows: Array<Pick<PrintIssue, "brand" | "status" | "error"> & { hours: number; count: number | null }> = [
    { brand: "wa", status: "review", error: null, hours: 30, count: 3 },
    { brand: "ws", status: "review", error: null, hours: 52, count: 2 },
    { brand: "ca", status: "processing", error: null, hours: 0.4, count: null },
    { brand: "mw", status: "review", error: null, hours: 80, count: 1 },
    { brand: "ws", status: "failed", error: "Worker failed; see the processing run logs.", hours: 120, count: null },
  ];
  return rows.map((row, index) => ({
    id: index < 4 ? ISSUE_IDS[row.brand] : `10000000-0000-4000-8000-00000000001${index}`,
    brand: row.brand,
    issue_id: index < 4 ? ISSUE_LABELS[row.brand].replace(/[^A-Za-z0-9]+/g, "-").toLowerCase() : "2026-10",
    issue_label: index < 4 ? ISSUE_LABELS[row.brand] : "October 2026",
    pdf_key: `pdfs/inbox/${row.brand}/sample/${"0".repeat(8)}-0000-4000-8000-000000000000.pdf`,
    toc_pages: [3, 4],
    status: row.status,
    stats: row.count != null ? { cms_document_count: row.count, kept: row.count * 6, total_xrefs: row.count * 40 } : null,
    error: row.error,
    created_at: hoursAgo(now, row.hours),
    articleCount: row.count,
    feedUrl: null,
  }));
}
