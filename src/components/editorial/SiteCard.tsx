"use client";

import { useEffect, useState } from "react";
import { Globe, LayoutTemplate, Sparkles } from "lucide-react";
import type { CmsDocument } from "@/lib/cms/types";
import { useEditorial } from "./EditorialProvider";
import { Button, Card, Field, Pill } from "./ui";

type Slot = { position: number; pinned: { id: string; label: string; ends_at: string | null } | null; fallback: { id: string } | null };
type Front = { labels: Record<string, string>; slots: Slot[] };

/**
 * What the public site makes of this story, in one card on the document page:
 * the AI tags, summary and search phrases the tags job wrote, where it sits on
 * the home page's rotator, and a pin control, so editors never need the route
 * names.
 */
export function SiteCard({ document }: { document: CmsDocument }) {
  const { brand, demo, toast } = useEditorial();
  const meta = document.metadata as Record<string, unknown>;
  const aiTags = Array.isArray(meta.ai_tags) ? (meta.ai_tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const aiSummary = typeof meta.ai_summary === "string" ? meta.ai_summary : "";
  const aiSearch = Array.isArray(meta.ai_search) ? (meta.ai_search as unknown[]).filter((t): t is string => typeof t === "string") : [];
  const [front, setFront] = useState<Front | null>(null);
  const [position, setPosition] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const live = brand === "wa" && document.kind === "article" && !demo;

  useEffect(() => {
    if (!live) return;
    let on = true;
    fetch(`/api/cms/front?brand=${brand}`, { headers: { Accept: "application/json" } }).then(r => (r.ok ? r.json() : null)).then(j => { if (on && j && j.slots) setFront(j); }).catch(() => undefined);
    return () => { on = false; };
  }, [brand, live, document.revision]);

  if (document.kind !== "article" || brand !== "wa") return null;
  const mine = front?.slots.find(s => s.pinned?.id === document.id) || null;
  const shownAt = front?.slots.find(s => !s.pinned && s.fallback?.id === document.id) || null;
  const siteHref = document.slug ? `/wa/story.html#${encodeURIComponent(document.slug)}` : null;

  const save = async (pos: number | null) => {
    setBusy(true);
    try {
      const r = await fetch("/api/cms/front", { method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ brand, position: pos ?? mine?.position, document_id: pos ? document.id : null, label, ends_at: null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error || "Could not update the front page.");
      setFront(j as Front); toast(pos ? `Pinned at position ${pos}.` : "Unpinned from the front page.", "success");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not update the front page.", "error"); }
    finally { setBusy(false); }
  };

  return <Card pad={false} className="ed-rail-card still">
    <h3>On the site <Globe size={14} aria-hidden /></h3>
    <div className="ed-site-block">
      <div className="ed-site-head"><Sparkles size={13} aria-hidden /><span>AI tags and search</span>{aiTags.length ? <Pill tone="published">Tagged</Pill> : <Pill plain>Not yet</Pill>}</div>
      {aiTags.length ? <>
        <div className="ed-site-tags">{aiTags.map(t => <span key={t} className="ed-site-tag">{t}</span>)}</div>
        {aiSummary && <p className="ed-site-summary">{aiSummary}</p>}
        {aiSearch.length > 0 && <p className="ed-site-search">Found by: {aiSearch.join(" · ")}</p>}
      </> : <p className="ed-site-summary">The tags job has not read this story yet. It runs from the maintenance workflow (task &quot;tags&quot;) and fills tags, a summary and the phrases readers search.</p>}
    </div>
    <div className="ed-site-block">
      <div className="ed-site-head"><LayoutTemplate size={13} aria-hidden /><span>Home page rotator</span>{mine ? <Pill tone="published">Pinned at {mine.position}</Pill> : shownAt ? <Pill plain>Showing at {shownAt.position} as newest</Pill> : <Pill plain>Not on it</Pill>}</div>
      {live && front ? <>
        {mine && mine.pinned ? <div className="ed-site-row"><span>{front.labels[mine.pinned.label] || "No label"}{mine.pinned.ends_at ? ` · until ${mine.pinned.ends_at.slice(0, 10)}` : ""}</span><Button size="sm" variant="subtle" disabled={busy} onClick={() => void save(null)}>Unpin</Button></div>
          : document.publication_state === "published" ? <div className="ed-site-pin">
            <Field label="Position" htmlFor="site-pos"><select id="site-pos" className="ed-select" value={position} onChange={e => setPosition(e.target.value)}><option value="">Choose</option>{front.slots.map(s => <option key={s.position} value={s.position}>{s.position}{s.pinned ? " (replaces a pin)" : ""}</option>)}</select></Field>
            <Field label="Label" htmlFor="site-label"><select id="site-label" className="ed-select" value={label} onChange={e => setLabel(e.target.value)}>{Object.entries(front.labels).map(([k, v]) => <option key={k || "none"} value={k}>{v}</option>)}</select></Field>
            <Button size="sm" disabled={!position || busy} onClick={() => void save(Number(position))}>Pin to the front page</Button>
          </div> : <p className="ed-site-summary">Publish the story to pin it.</p>}
      </> : <p className="ed-site-summary">{demo ? "The demo has no front page." : "Reading the front page…"}</p>}
    </div>
    {siteHref && <div className="ed-site-block"><a className="ed-link" href={siteHref} target="_blank" rel="noopener">Open on the site</a></div>}
  </Card>;
}
