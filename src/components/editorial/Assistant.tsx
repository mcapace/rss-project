"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, FileText, ImageIcon, Search as SearchIcon, Send, Sparkles, Wand2 } from "lucide-react";
import type { AssistChatMessage, AssistDocument, SeoGeoAnalysis } from "@/lib/editorial/assist-types";
import type { SearchResponse } from "@/lib/editorial/search-types";
import { heuristicAnalysis } from "@/lib/editorial/seo-heuristics";
import { relativeTime } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { Marked, MediaThumb } from "./SearchPage";
import { Button, Notice, Pill, Segmented, Skeleton } from "./ui";

/** What a document page exposes so the assistant can read and change it. */
export type ApplyAction =
  | { type: "title"; value: string }
  | { type: "seo_title"; value: string }
  | { type: "meta_description"; value: string }
  | { type: "excerpt"; value: string }
  | { type: "slug"; value: string }
  | { type: "keywords"; value: string[] }
  | { type: "caption"; index: number; caption: string; alt: string }
  | { type: "direct_answer"; value: string }
  | { type: "faq"; value: { question: string; answer: string }[] };

export type AssistantContext = {
  documentId: string;
  getDocument: () => AssistDocument;
  apply: (action: ApplyAction) => void;
};

type Turn = AssistChatMessage & { id: number; results?: SearchResponse; pending?: boolean; error?: boolean };

const SEARCH_INTENT = /^(?:find|search(?: for)?|show(?: me)?|look(?: up| for)?|where (?:is|are)|get me|pull up)\s+(.+)$/i;
export function searchIntent(text: string): { query: string; scope: "all" | "media" | "documents" } | null {
  const match = SEARCH_INTENT.exec(text.trim());
  if (!match) return null;
  let query = match[1].replace(/[?.!]+$/, "").trim();
  let scope: "all" | "media" | "documents" = "all";
  const images = /^(?:(?:an?|the|some|all)\s+)?(?:images?|photos?|pictures?|pics|art)\s+(?:of|with|showing|that show|like)\s+/i;
  const stories = /^(?:(?:an?|the|some|all)\s+)?(?:stories|articles|posts|documents|content|ratings?|pages?)\s+(?:about|on|mentioning|with|that mention)\s+/i;
  if (images.test(query)) { scope = "media"; query = query.replace(images, ""); }
  else if (stories.test(query)) { scope = "documents"; query = query.replace(stories, ""); }
  return query.length >= 2 ? { query, scope } : null;
}

function Suggestion({ label, text, detail, onApply, applied }: { label: string; text: string; detail?: string; onApply?: () => void; applied?: boolean }) {
  return <div className="ed-suggestion">
    <h4>{label}{detail && <small>{detail}</small>}</h4>
    <p>{text}</p>
    {onApply && <Button size="sm" variant={applied ? "default" : "primary"} icon={applied ? Check : undefined} onClick={onApply} disabled={applied}>{applied ? "Applied" : "Apply"}</Button>}
  </div>;
}

export function Assistant({ context, initialPrompt, onConsumedPrompt }: { context: AssistantContext | null; initialPrompt?: string; onConsumedPrompt: () => void }) {
  const { data, demo, brand, href, toast } = useEditorial();
  const [tab, setTab] = useState<"review" | "chat">(context ? "review" : "chat");
  const [analysis, setAnalysis] = useState<SeoGeoAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [lastDocumentId, setLastDocumentId] = useState(context?.documentId ?? null);
  if ((context?.documentId ?? null) !== lastDocumentId) { setLastDocumentId(context?.documentId ?? null); setAnalysis(null); setApplied(new Set()); setAnalysisError(""); if (!context) setTab("chat"); }

  const analyze = useCallback(async () => {
    if (!context) return;
    setAnalyzing(true); setAnalysisError("");
    const doc = context.getDocument();
    try {
      setAnalysis(await data.analyze(doc));
    } catch (error) {
      const fallback = heuristicAnalysis(doc);
      setAnalysis(fallback);
      setAnalysisError(error instanceof Error ? `${error.message} Showing rule-based checks instead.` : "Showing rule-based checks instead.");
    } finally { setAnalyzing(false); }
  }, [context, data]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const id = Date.now();
    setTurns(current => [...current, { id, role: "user", content }]);
    setInput("");
    const intent = searchIntent(content);
    setBusy(true);
    try {
      if (intent) {
        const results = await data.search(intent.query, { brand, scope: intent.scope, limit: 8 });
        const total = results.documents.length + results.media.length;
        setTurns(current => [...current, { id: id + 1, role: "assistant", content: total ? `Here is what matches “${intent.query}” in this publication.` : `Nothing in this publication matches “${intent.query}”. Try other words, or describe the image's subject, style or colors.`, results }]);
      } else {
        const history: AssistChatMessage[] = [...turns.filter(turn => !turn.results && !turn.error).map(({ role, content }) => ({ role, content })), { role: "user", content }];
        const reply = await data.chat({ mode: "chat", document: context?.getDocument() ?? null, messages: history });
        setTurns(current => [...current, { id: id + 1, role: "assistant", content: reply.reply }]);
      }
    } catch (error) {
      setTurns(current => [...current, { id: id + 1, role: "assistant", content: error instanceof Error ? error.message : "The assistant is unavailable right now.", error: true }]);
    } finally { setBusy(false); }
  }, [busy, data, brand, turns, context]);

  useEffect(() => {
    if (initialPrompt) { setTab("chat"); onConsumedPrompt(); void send(initialPrompt); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per prompt
  }, [initialPrompt]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [turns, analysis]);

  const apply = (key: string, action: ApplyAction) => { context?.apply(action); setApplied(current => new Set(current).add(key)); toast("Applied to the draft. Save to keep it.", "success"); };
  const starters = context
    ? ["Give me three sharper headlines", "Write a 150-character meta description", "What would an AI assistant quote from this story?", "find images of barrels"]
    : ["find images of a vineyard", "show me stories about harvest", "What should every rating include for search?", "How do I schedule a story?"];

  return <div className="ed-assistant">
    <div className="ed-assistant-tabs"><Segmented label="Assistant mode" value={tab} onChange={setTab} options={[{ id: "review", label: "SEO & GEO review" }, { id: "chat", label: "Ask" }]} /></div>
    <div ref={bodyRef} className="ed-assistant-body">
      {tab === "review" && (!context ? <Notice>Open a story to review it for search and AI discovery.</Notice> : <>
        {!analysis && !analyzing && <div className="ed-suggestion">
          <h4>Review this story</h4>
          <p>Checks headline, search title and description, slug, keywords, image captions and alt text, readability, and how well an AI engine could quote and attribute the story. Every suggestion can be applied with one click.</p>
          <Button variant="primary" icon={Wand2} ai onClick={analyze}>Review for SEO and GEO</Button>
          {demo && <small>The demo runs rule-based checks; the connected workspace uses Claude.</small>}
        </div>}
        {analyzing && <div style={{ display: "grid", gap: 10 }}><Skeleton height={60} radius={10} /><Skeleton height={44} radius={10} /><Skeleton height={120} radius={10} /></div>}
        {analysisError && <Notice tone="warning">{analysisError}</Notice>}
        {analysis && !analyzing && <>
          <div className="ed-score-row">
            {([["Search", analysis.scores.seo], ["AI discovery", analysis.scores.geo], ["Readability", analysis.scores.readability]] as const).map(([label, score]) => <div key={label} className="ed-score"><span>{label}</span><strong>{score}</strong></div>)}
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.5 }}>{analysis.summary} <span style={{ color: "var(--muted-soft)" }}>· {analysis.source === "claude" ? analysis.model ?? "Claude" : "rule-based"}</span></p>
          {analysis.issues.length > 0 && <div className="ed-suggestion"><h4>Issues</h4>{analysis.issues.map((issue, index) => <div key={index} className="ed-issue" data-severity={issue.severity}><i aria-hidden /><div>{issue.message}<small>{issue.fix}</small></div></div>)}</div>}
          <div className="ed-suggestion"><h4>Headlines</h4>{analysis.titles.map((title, index) => <div key={index} style={{ display: "grid", gap: 4, paddingTop: index ? 8 : 0 }}><p>{title.text}</p><small>{title.rationale}</small><Button size="sm" variant={applied.has(`title:${index}`) ? "default" : "primary"} icon={applied.has(`title:${index}`) ? Check : undefined} disabled={applied.has(`title:${index}`)} onClick={() => apply(`title:${index}`, { type: "title", value: title.text })} style={{ justifySelf: "start" }}>{applied.has(`title:${index}`) ? "Applied" : "Use as headline"}</Button></div>)}</div>
          <Suggestion label="Search title" text={analysis.seo_title} detail={`${analysis.seo_title.length}/60`} applied={applied.has("seo_title")} onApply={() => apply("seo_title", { type: "seo_title", value: analysis.seo_title })} />
          <Suggestion label="Meta description" text={analysis.meta_description} detail={`${analysis.meta_description.length}/160`} applied={applied.has("meta")} onApply={() => apply("meta", { type: "meta_description", value: analysis.meta_description })} />
          <Suggestion label="Summary" text={analysis.excerpt} applied={applied.has("excerpt")} onApply={() => apply("excerpt", { type: "excerpt", value: analysis.excerpt })} />
          <Suggestion label="Slug" text={analysis.slug} applied={applied.has("slug")} onApply={() => apply("slug", { type: "slug", value: analysis.slug })} />
          <Suggestion label="Keywords and tags" text={analysis.keywords.join(", ")} applied={applied.has("keywords")} onApply={() => apply("keywords", { type: "keywords", value: analysis.keywords })} />
          {analysis.captions.map(caption => <Suggestion key={caption.index} label={`Image ${caption.index + 1} caption and alt text`} text={`${caption.caption} — alt: ${caption.alt}`} applied={applied.has(`caption:${caption.index}`)} onApply={() => apply(`caption:${caption.index}`, { type: "caption", index: caption.index, caption: caption.caption, alt: caption.alt })} />)}
          <Suggestion label="Direct answer for AI engines" detail="Goes at the top of the story" text={analysis.geo.direct_answer} applied={applied.has("direct")} onApply={() => apply("direct", { type: "direct_answer", value: analysis.geo.direct_answer })} />
          {analysis.geo.faq.length > 0 && <Suggestion label="FAQ block" detail={`${analysis.geo.faq.length} questions`} text={analysis.geo.faq.map(item => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n")} applied={applied.has("faq")} onApply={() => apply("faq", { type: "faq", value: analysis.geo.faq })} />}
          <div className="ed-suggestion"><h4>Entities to name explicitly</h4><p>{analysis.geo.entities.join(" · ") || "None found"}</p>{analysis.geo.notes.map((note, index) => <small key={index}>{note}</small>)}</div>
          <Button size="sm" variant="subtle" icon={Wand2} onClick={analyze}>Review again</Button>
        </>}
      </>)}

      {tab === "chat" && <>
        {!turns.length && <>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{context ? "Ask about the open story, or search by typing “find …”." : "Ask anything about the workspace, or search by typing “find …” or “show me …”."}</p>
          {starters.map(starter => <button key={starter} type="button" className="ed-starter" onClick={() => send(starter)}>{searchIntent(starter) ? <SearchIcon size={14} aria-hidden /> : <Sparkles size={14} aria-hidden />}{starter}</button>)}
        </>}
        {turns.map(turn => turn.role === "user" ? <div key={turn.id} className="ed-turn-user">{turn.content}</div> : <div key={turn.id} className="ed-turn-assistant">
          {turn.error ? <Notice tone="error">{turn.content}</Notice> : turn.content}
          {turn.results && <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {turn.results.media.length > 0 && <div className="ed-image-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}>
              {turn.results.media.slice(0, 6).map(hit => <Link key={`${hit.document_id}:${hit.media_index}`} href={href(`/cms/doc/${hit.document_id}`, { tab: "media" })} className="ed-image-card"><MediaThumb hit={hit} /><span className="title">{hit.caption || hit.file || "Image"}</span><span className="meta">{hit.document_title}</span></Link>)}
            </div>}
            {turn.results.documents.slice(0, 5).map(hit => <div key={hit.id} className="ed-hit" style={{ padding: "8px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><FileText size={13} aria-hidden style={{ color: "var(--muted)" }} /><Link className="title" href={href(`/cms/doc/${hit.id}`)}>{hit.title}</Link><Pill tone={hit.publication_state} /></div>
              <span className="meta">{relativeTime(hit.updated_at)}</span>
              {hit.headline && <p className="snippet"><Marked text={hit.headline} /></p>}
            </div>)}
            <Link className="ed-link" href={href("/cms/search", { q: turn.results.query })} style={{ fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}>All results<ArrowRight size={12} aria-hidden /></Link>
          </div>}
        </div>)}
        {busy && <div className="ed-turn-assistant" style={{ color: "var(--muted)", fontSize: 13 }}>Thinking…</div>}
      </>}
    </div>
    {tab === "chat" && <form className="ed-assistant-composer" onSubmit={event => { event.preventDefault(); void send(input); }}>
      <textarea value={input} onChange={event => setInput(event.target.value)} placeholder={context ? "Ask about this story, or “find …”" : "Ask, or “find images of …”"} aria-label="Message the assistant" rows={1}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(input); } }} />
      <button type="submit" className="ed-send" aria-label="Send" disabled={busy || !input.trim()}><Send size={15} aria-hidden /></button>
    </form>}
    {tab === "review" && context && <div style={{ padding: "0 20px 16px", display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--muted)" }}><ImageIcon size={13} aria-hidden />Describe images for search from the story&rsquo;s Media tab.</div>}
  </div>;
}
