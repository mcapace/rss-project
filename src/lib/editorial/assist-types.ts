import type { CmsBrand, CmsDocumentKind } from "@/lib/cms/types";

/** What the assistant is given about the document being edited. */
export type AssistDocument = {
  brand: CmsBrand;
  kind: CmsDocumentKind;
  title: string;
  byline: string;
  excerpt: string;
  section: string;
  tags: string[];
  slug: string | null;
  public_url: string | null;
  seo: { title: string; description: string };
  /** Plain text of the body; the server strips markup before sending. */
  body_text: string;
  media: { index: number; caption: string; alt: string; credit: string; file: string }[];
};

export type AssistIssue = { severity: "high" | "medium" | "low"; area: "seo" | "geo" | "readability" | "media" | "structure"; message: string; fix: string };

/** Structured SEO and GEO recommendations. Every field is directly applicable in the editor. */
export type SeoGeoAnalysis = {
  summary: string;
  scores: { seo: number; geo: number; readability: number };
  titles: { text: string; rationale: string }[];
  seo_title: string;
  meta_description: string;
  excerpt: string;
  slug: string;
  keywords: string[];
  captions: { index: number; caption: string; alt: string }[];
  geo: {
    /** A two-sentence answer an AI engine could quote directly; goes at the top of the story. */
    direct_answer: string;
    faq: { question: string; answer: string }[];
    entities: string[];
    notes: string[];
  };
  issues: AssistIssue[];
  source: "claude" | "heuristic";
  model?: string;
};

export type AssistChatMessage = { role: "user" | "assistant"; content: string };

export type AssistRequest =
  | { mode: "seo"; document: AssistDocument }
  | { mode: "chat"; document: AssistDocument | null; messages: AssistChatMessage[] }
  | { mode: "describe"; document_id: string; media_index: number };

export type AssistChatReply = { reply: string; source: "claude" | "heuristic"; model?: string };
