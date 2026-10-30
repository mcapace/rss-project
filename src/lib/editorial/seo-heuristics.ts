import type { AssistDocument, AssistIssue, SeoGeoAnalysis } from "./assist-types";
import { slugify, truncate } from "./helpers";

/**
 * Deterministic SEO and GEO checks. They power the demo, stand in when the
 * model is unavailable, and run before every model call so hard rules
 * (lengths, missing alt text) never depend on the model noticing them.
 */

const STOPWORDS = new Set("a an and are as at be but by for from has have he her his how i if in into is it its of on or our she so than that the their them then there these they this to was we were what when where which who why will with you your about after also among around because been before being between both can could did do does each few more most much new not now only other over same some such too under until up very via while within without".split(" "));

export function keywordCandidates(text: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter(word => word.length > 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
  for (let i = 0; i < words.length; i++) {
    counts.set(words[i], (counts.get(words[i]) ?? 0) + 1);
    if (i + 1 < words.length) { const pair = `${words[i]} ${words[i + 1]}`; counts.set(pair, (counts.get(pair) ?? 0) + 1.6); }
  }
  return [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(sentence => sentence.split(/\s+/).length >= 4);
}

/** Flesch-style reading ease mapped to 0..100 where higher is easier. */
export function readabilityScore(text: string): number {
  const all = sentences(text);
  const words = text.split(/\s+/).filter(Boolean);
  if (!all.length || words.length < 20) return 70;
  const syllables = words.reduce((sum, word) => sum + Math.max(1, (word.toLowerCase().match(/[aeiouy]+/g) ?? []).length), 0);
  const score = 206.835 - 1.015 * (words.length / all.length) - 84.6 * (syllables / words.length);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function clampScore(value: number): number { return Math.max(0, Math.min(100, Math.round(value))); }

export function heuristicAnalysis(doc: AssistDocument): SeoGeoAnalysis {
  const issues: AssistIssue[] = [];
  const body = doc.body_text.trim();
  const words = body.split(/\s+/).filter(Boolean).length;
  const firstParagraph = body.split(/\n+/).find(part => part.trim().split(/\s+/).length >= 12)?.trim() ?? body.slice(0, 300);
  const keywords = keywordCandidates(`${doc.title} ${doc.title} ${doc.excerpt} ${body}`);
  const primary = keywords[0] ?? "";
  const titleLength = doc.title.trim().length;

  if (!doc.title.trim()) issues.push({ severity: "high", area: "seo", message: "The story has no headline.", fix: "Write a headline of 40 to 60 characters that names the subject." });
  else if (titleLength > 65) issues.push({ severity: "medium", area: "seo", message: `The headline is ${titleLength} characters; search results cut off around 60.`, fix: "Shorten the headline or set a separate search title." });
  else if (titleLength < 25) issues.push({ severity: "low", area: "seo", message: "The headline is short enough that search snippets may lack context.", fix: "Add the subject or a qualifier to reach 40 to 60 characters." });
  const description = doc.seo.description || doc.excerpt;
  if (!description.trim()) issues.push({ severity: "high", area: "seo", message: "No search description or summary.", fix: "Add a 120 to 160 character description that states the answer or promise of the story." });
  else if (description.length < 80) issues.push({ severity: "medium", area: "seo", message: `The search description is ${description.length} characters.`, fix: "Expand it to 120 to 160 characters and include the primary topic." });
  else if (description.length > 170) issues.push({ severity: "low", area: "seo", message: `The search description is ${description.length} characters and will be truncated.`, fix: "Trim it to about 155 characters." });
  if (primary && !doc.title.toLowerCase().includes(primary.split(" ")[0])) issues.push({ severity: "low", area: "seo", message: `The most frequent topic, “${primary}”, is not in the headline.`, fix: "Consider naming the topic in the headline or search title." });
  if (!doc.slug && doc.kind !== "rating") issues.push({ severity: "low", area: "seo", message: "No URL slug yet.", fix: `Use “${slugify(doc.title) || "story-slug"}”.` });
  if (words < 300 && doc.kind === "article") issues.push({ severity: "medium", area: "readability", message: `${words} words is thin for an article.`, fix: "Add reporting, context or a short FAQ so the page answers the reader's follow-up questions." });
  const readability = readabilityScore(body);
  if (readability < 40 && words >= 100) issues.push({ severity: "medium", area: "readability", message: "Sentences run long; the reading level is demanding.", fix: "Split the longest sentences and lead paragraphs with the point." });
  const noAlt = doc.media.filter(item => !item.alt.trim());
  if (noAlt.length) issues.push({ severity: "medium", area: "media", message: `${noAlt.length} of ${doc.media.length} images have no alt text.`, fix: "Describe what each image shows in one plain sentence." });
  if (doc.media.length && !doc.media.some(item => item.caption.trim())) issues.push({ severity: "low", area: "media", message: "No image has a caption.", fix: "Caption the lead image with who, what and where." });
  if (!doc.tags.length) issues.push({ severity: "low", area: "structure", message: "No tags.", fix: `Tag the topics: ${keywords.slice(0, 3).join(", ") || "the subject, region and style"}.` });
  const hasQuestion = /\?/.test(body);
  if (!hasQuestion && words > 400) issues.push({ severity: "low", area: "geo", message: "No question the story answers directly.", fix: "Add a short FAQ with the two questions a reader would ask an AI assistant about this." });
  if (!/\b(19|20)\d{2}\b/.test(body) && doc.kind === "article") issues.push({ severity: "low", area: "geo", message: "No dates or vintages in the text.", fix: "Anchor claims in time so AI engines can judge freshness." });

  const subject = doc.section ? doc.section.replace(/s$/, "") : "guide";
  const titles = [
    { text: doc.title, rationale: "Your current headline." },
    ...(primary ? [{ text: `${capitalize(primary)}: ${truncate(doc.title, 48)}`, rationale: "Leads with the topic readers search for." }] : []),
    { text: truncate(`${doc.title} ${doc.section ? `(${subject})` : ""}`.trim(), 60), rationale: "Adds the department as a qualifier." },
  ].filter((item, index, list) => item.text && list.findIndex(other => other.text === item.text) === index).slice(0, 3);

  const metaDescription = truncate((doc.seo.description || doc.excerpt || firstParagraph).replace(/\s+/g, " "), 156);
  const directAnswer = truncate(sentences(firstParagraph).slice(0, 2).join(" ") || firstParagraph, 320);
  const entities = [...new Set([doc.byline, doc.section, ...keywords.slice(0, 4).map(capitalize)].filter(Boolean))].slice(0, 6);
  const seoScore = clampScore(100 - issues.filter(issue => issue.area === "seo").reduce((sum, issue) => sum + (issue.severity === "high" ? 30 : issue.severity === "medium" ? 15 : 7), 0));
  const geoScore = clampScore(72 - issues.filter(issue => issue.area === "geo" || issue.area === "structure").length * 10 + (hasQuestion ? 10 : 0) + (entities.length >= 4 ? 8 : 0));
  return {
    summary: issues.length ? `${issues.filter(issue => issue.severity === "high").length} urgent and ${issues.filter(issue => issue.severity !== "high").length} smaller things would help this ${doc.kind.replace("_", " ")} be found.` : "This story covers the basics for search and AI discovery.",
    scores: { seo: seoScore, geo: geoScore, readability },
    titles, seo_title: truncate(titles[1]?.text ?? doc.title, 60), meta_description: metaDescription,
    excerpt: truncate(doc.excerpt || firstParagraph, 220), slug: doc.slug || slugify(doc.title),
    keywords: keywords.slice(0, 8),
    captions: doc.media.filter(item => !item.alt.trim() || !item.caption.trim()).slice(0, 6).map(item => ({ index: item.index, caption: item.caption || `${doc.title}${doc.section ? ` · ${doc.section}` : ""}`, alt: item.alt || truncate(`${doc.title}: ${primary || "image from the story"}`, 120) })),
    geo: {
      direct_answer: directAnswer,
      faq: [
        { question: `What is ${primary ? `the story on ${primary}` : "this story"} about?`, answer: truncate(doc.excerpt || firstParagraph, 240) },
        ...(doc.byline ? [{ question: `Who reported it?`, answer: `${doc.byline} for ${brandName(doc.brand)}.` }] : []),
      ],
      entities,
      notes: ["State the main point in the first two sentences so it can be quoted.", "Name people, places, producers and dates explicitly.", "Keep headings as questions a reader would ask."],
    },
    issues: issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    source: "heuristic",
  };
}

const severityRank = (severity: AssistIssue["severity"]) => ({ high: 0, medium: 1, low: 2 }[severity]);
const capitalize = (value: string) => value.replace(/^\w/, c => c.toUpperCase());
const brandName = (brand: string) => ({ wa: "Whisky Advocate", ws: "Wine Spectator", ca: "Cigar Aficionado", mw: "Market Watch" } as Record<string, string>)[brand] ?? brand;
