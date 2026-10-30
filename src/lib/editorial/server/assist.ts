import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CmsError } from "@/lib/cms/access";
import type { AssistChatMessage, AssistChatReply, AssistDocument, SeoGeoAnalysis } from "../assist-types";
import type { MediaVision } from "../search-types";
import { heuristicAnalysis } from "../seo-heuristics";

export const ASSIST_MODEL = "claude-opus-5-5";

export function assistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function client(): Anthropic {
  if (!assistantConfigured()) throw new CmsError(503, "The editorial assistant needs an Anthropic API key on the server.", "setup_required");
  return new Anthropic();
}

const BRAND_VOICE: Record<string, string> = {
  wa: "Whisky Advocate: authoritative, warm, specific about distilleries, styles, ages and prices.",
  ws: "Wine Spectator: precise, confident, specific about producers, appellations, vintages and scores.",
  ca: "Cigar Aficionado: cultured, relaxed, specific about makers, wrappers, sizes and ratings.",
  mw: "Market Watch: trade-focused, data-driven, specific about retailers, distributors, brands and categories.",
};

const SEO_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["summary", "scores", "titles", "seo_title", "meta_description", "excerpt", "slug", "keywords", "captions", "geo", "issues"],
  properties: {
    summary: { type: "string" },
    scores: { type: "object", additionalProperties: false, required: ["seo", "geo", "readability"], properties: { seo: { type: "integer" }, geo: { type: "integer" }, readability: { type: "integer" } } },
    titles: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "rationale"], properties: { text: { type: "string" }, rationale: { type: "string" } } } },
    seo_title: { type: "string" },
    meta_description: { type: "string" },
    excerpt: { type: "string" },
    slug: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    captions: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "caption", "alt"], properties: { index: { type: "integer" }, caption: { type: "string" }, alt: { type: "string" } } } },
    geo: { type: "object", additionalProperties: false, required: ["direct_answer", "faq", "entities", "notes"], properties: {
      direct_answer: { type: "string" },
      faq: { type: "array", items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } },
      entities: { type: "array", items: { type: "string" } },
      notes: { type: "array", items: { type: "string" } },
    } },
    issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["severity", "area", "message", "fix"], properties: {
      severity: { type: "string", enum: ["high", "medium", "low"] }, area: { type: "string", enum: ["seo", "geo", "readability", "media", "structure"] }, message: { type: "string" }, fix: { type: "string" },
    } } },
  },
} as const;

const VISION_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["description", "style", "mood", "tags", "subjects", "colors"],
  properties: {
    description: { type: "string" }, style: { type: "string" }, mood: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    subjects: { type: "array", items: { type: "string" } },
    colors: { type: "array", items: { type: "string" } },
  },
} as const;

function textOf(message: Anthropic.Message): string {
  return message.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map(block => block.text).join("").trim();
}

function guardStop(message: Anthropic.Message) {
  if (message.stop_reason === "refusal") throw new CmsError(422, "The assistant declined this request.", "assistant_refused");
  if (message.stop_reason === "max_tokens") throw new CmsError(502, "The assistant's reply was cut off. Try a shorter story or ask again.", "assistant_truncated");
}

function documentPrompt(doc: AssistDocument): string {
  const media = doc.media.length ? doc.media.map(item => `- image ${item.index}: file ${item.file || "n/a"}; caption "${item.caption}"; alt "${item.alt}"; credit "${item.credit}"`).join("\n") : "- none";
  return [
    `Publication: ${BRAND_VOICE[doc.brand] ?? doc.brand}`,
    `Content type: ${doc.kind}`, `Section: ${doc.section || "none"}`, `Byline: ${doc.byline || "none"}`,
    `Headline: ${doc.title || "(empty)"}`, `Summary: ${doc.excerpt || "(empty)"}`,
    `Search title: ${doc.seo.title || "(empty)"}`, `Search description: ${doc.seo.description || "(empty)"}`,
    `Slug: ${doc.slug || "(none)"}`, `Public URL: ${doc.public_url || "(none)"}`, `Tags: ${doc.tags.join(", ") || "(none)"}`,
    `Images:\n${media}`,
    `Body text:\n${doc.body_text.slice(0, 60_000)}`,
  ].join("\n");
}

/** Full SEO and GEO review. Hard checks run locally; the model adds judgement and copy. */
export async function analyzeSeoGeo(doc: AssistDocument): Promise<SeoGeoAnalysis> {
  const baseline = heuristicAnalysis(doc);
  const anthropic = client();
  const message = await anthropic.messages.create({
    model: ASSIST_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SEO_SCHEMA as unknown as Record<string, unknown> } },
    system: [
      "You are the search and discovery editor for M. Shanken Communications. You review a story before it publishes and return structured recommendations an editor can apply with one click.",
      "SEO: headlines of 40 to 60 characters that name the subject readers search for; a search title under 60 characters; a meta description of 120 to 160 characters that states the story's answer or promise; a short lowercase hyphenated slug; six to ten keywords and entities (producers, regions, styles, people) actually present in the text.",
      "GEO (generative engine optimization): a direct answer of two sentences that an AI assistant could quote verbatim; two to four FAQ pairs phrased as readers ask them, answered from the text only; the named entities an AI engine would match; notes on freshness signals, specificity and structure.",
      "Captions and alt text: plain, factual, one sentence; alt text describes what is visible, captions add who, what, where. Only propose captions for images whose caption or alt is empty or weak; keep the image index.",
      "Issues: concrete, ranked by severity, each with a fix. Never invent facts, names, dates, scores or prices that are not in the text. Keep the publication's voice. Scores are 0 to 100.",
      `Baseline checks already computed (keep or sharpen them): ${JSON.stringify(baseline.issues)}`,
    ].join("\n\n"),
    messages: [{ role: "user", content: documentPrompt(doc) }],
  });
  guardStop(message);
  const text = textOf(message);
  try {
    const parsed = JSON.parse(text) as Omit<SeoGeoAnalysis, "source" | "model">;
    return { ...parsed, source: "claude", model: message.model };
  } catch {
    throw new CmsError(502, "The assistant returned something that could not be read. Try again.", "assistant_failed");
  }
}

/** Free-form help about the story being edited. */
export async function chatAboutDocument(messages: AssistChatMessage[], doc: AssistDocument | null): Promise<AssistChatReply> {
  const anthropic = client();
  const history: Anthropic.MessageParam[] = messages.slice(-16).map(message => ({ role: message.role, content: message.content.slice(0, 8000) }));
  if (!history.length || history[0].role !== "user") throw new CmsError(422, "Start the conversation with a question.", "validation_failed");
  const message = await anthropic.messages.create({
    model: ASSIST_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: [
      "You are the editorial assistant inside M. Shanken's CMS. Help editors with headlines, structure, captions, search and AI discoverability, fact-checking questions to ask, and house style. Be brief and concrete: lead with the answer, use short paragraphs, offer copy they can paste. Never invent facts that are not in the story; say what you would need to confirm.",
      "You cannot change the document yourself; suggest text and tell the editor where to put it. If asked to find content or images, explain that the search box in this panel searches titles, body text, captions and image descriptions.",
      doc ? `The story being edited:\n${documentPrompt(doc)}` : "No story is open.",
    ].join("\n\n"),
    messages: history,
  });
  guardStop(message);
  return { reply: textOf(message), source: "claude", model: message.model };
}

/** Describe an image so it can be searched by what it shows and how it looks. */
export async function describeImage(imageUrl: string, context: { brand: string; document_title: string; caption: string }): Promise<MediaVision> {
  const anthropic = client();
  const message = await anthropic.messages.create({
    model: ASSIST_MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: VISION_SCHEMA as unknown as Record<string, unknown> } },
    system: "Describe magazine images for an editorial asset search. Be literal about what is visible and precise about the look: composition, lighting, color palette, texture, setting, era, photographic or illustrative style. Return a one-paragraph description, a short style phrase (for example 'moody low-key product shot'), a mood word or two, searchable tags, the main subjects, and the dominant colors as plain color names. Do not guess names of people or brands unless legible in the image.",
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: imageUrl } },
      { type: "text", text: `Publication: ${context.brand}. Story: ${context.document_title}. Existing caption: ${context.caption || "none"}.` },
    ] }],
  });
  guardStop(message);
  try {
    const parsed = JSON.parse(textOf(message)) as Omit<MediaVision, "described_at" | "model">;
    return { ...parsed, described_at: new Date().toISOString(), model: message.model };
  } catch {
    throw new CmsError(502, "The image description could not be read. Try again.", "assistant_failed");
  }
}
