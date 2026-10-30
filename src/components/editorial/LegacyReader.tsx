"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, BookOpen, Check, Copy, ExternalLink, Plus, Radio, Rss, Search, X } from "lucide-react";
import { BRAND_NAMES, formatDate } from "@/lib/editorial/helpers";
import { useEditorial } from "./EditorialProvider";
import { useAsync } from "./hooks";
import { usePageTitle } from "./Shell";
import { Button, Card, Empty, IconButton, LinkButton, Notice, PageHeader, SectionHead, Skeleton } from "./ui";

interface MediaContentItem { $?: { url?: string; type?: string; width?: string | number; height?: string | number; medium?: string }; url?: string }
interface FeedItem {
  title?: string; link?: string; pubDate?: string; creator?: string; author?: string; description?: string; contentSnippet?: string;
  content?: string; contentEncoded?: string; guid?: string; categories?: string[]; mediaContent?: MediaContentItem | MediaContentItem[];
  enclosure?: { url?: string; type?: string; length?: number };
}
interface FeedData { title?: string; description?: string; link?: string; feedUrl?: string; items?: FeedItem[] }

function leadImage(item: FeedItem): string | null {
  const match = (item.description || item.contentEncoded || "").match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function imagesOf(item: FeedItem): string[] {
  const media = Array.isArray(item.mediaContent) ? item.mediaContent : item.mediaContent ? [item.mediaContent] : [];
  return media.map(entry => entry.$?.url || entry.url).filter((url): url is string => Boolean(url));
}

/** Published RSS editions from the earlier workflow, for inspection and QA. */
export function LegacyReader() {
  const { brand } = useEditorial();
  // Remount per publication so an earlier edition never lingers in the next workspace.
  return <Reader key={brand} />;
}

function Reader() {
  usePageTitle(null);
  const { brand, data, demo, href, mutationVersion } = useEditorial();
  const queryUrl = useSearchParams().get("url");
  const issues = useAsync(`issues:${brand}:${mutationVersion}`, signal => data.listIssues(brand, signal));
  const editions = (issues.data ?? []).filter(issue => issue.status === "published" && issue.feedUrl);
  const firstFeed = editions[0]?.feedUrl ?? null;

  const [urlInput, setUrlInput] = useState(queryUrl || "");
  const [activeFeed, setActiveFeed] = useState(queryUrl || "");
  const [feed, setFeed] = useState<FeedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lastQuery = useRef<string | null>(null);

  const load = useCallback(async (target: string) => {
    const url = target.trim();
    if (!url) return;
    setError(null); setSelected(null); setActiveFeed(url);
    try {
      const response = await fetch(`/api/feed?url=${encodeURIComponent(url)}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) throw new Error(result.error || "The feed could not be parsed.");
      setFeed(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The feed could not be fetched or parsed."); setFeed(null); }
  }, []);

  useEffect(() => {
    const changed = queryUrl && queryUrl !== lastQuery.current;
    lastQuery.current = queryUrl;
    const target = changed ? queryUrl : !activeFeed ? firstFeed : null;
    if (!target) return;
    setUrlInput(target);
    startTransition(async () => { await load(target); });
  }, [queryUrl, firstFeed, activeFeed, load]);

  const open = (url: string) => { setUrlInput(url); startTransition(async () => { await load(url); }); };
  const copy = (guid: string) => { void navigator.clipboard?.writeText(guid); setCopied(guid); setTimeout(() => setCopied(current => (current === guid ? null : current)), 2000); };

  const needle = filter.trim().toLowerCase();
  const items = (feed?.items ?? []).filter(item => !needle || [item.title, item.contentSnippet, item.creator, item.author].some(value => value?.toLowerCase().includes(needle)));
  const gallery = selected ? imagesOf(selected) : [];

  return <>
    <PageHeader icon={Rss} title="Legacy editions" lede={`Published RSS editions for ${BRAND_NAMES[brand]} from the earlier workflow. New PDFs become review candidates in the library instead.`}
      actions={!demo ? <LinkButton href={href("/admin/new")} icon={Plus}>Upload an issue</LinkButton> : undefined} />
    <div className="ed-stack">
      <Card>
        <form onSubmit={event => { event.preventDefault(); open(urlInput); }} className="ed-reader-form">
          <div className="ed-search" style={{ flex: 1 }}>
            <Radio size={15} aria-hidden style={{ position: "absolute", left: 10, color: "var(--muted-soft)" }} />
            <input className="ed-input" value={urlInput} onChange={event => setUrlInput(event.target.value)} placeholder="Edition feed URL, for example /api/feeds/mw/2026-09/feed.xml" aria-label="Edition feed URL" style={{ fontFamily: "var(--font-code)", fontSize: 12.5 }} />
          </div>
          <Button type="submit" variant="primary" disabled={pending || !urlInput.trim()}>{pending ? "Opening…" : "Open feed"}</Button>
        </form>
        <div className="ed-reader-editions">
          <span className="ed-label">Published editions</span>
          {issues.error
            ? <span style={{ fontSize: 12.5, color: "var(--negative)" }}>{issues.error} <button type="button" className="ed-link" onClick={issues.reload}>Retry</button></span>
            : issues.loading && !issues.data ? <Skeleton width={180} height={28} radius={99} />
            : !editions.length ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>No published editions among this publication’s latest issues.</span>
            : <div className="ed-chips" role="group" aria-label="Published editions">
              {editions.map(issue => <button key={issue.id} type="button" aria-pressed={activeFeed === issue.feedUrl} onClick={() => open(issue.feedUrl!)}>{issue.issue_label}</button>)}
            </div>}
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      {feed && <SectionHead title={feed.title || "Untitled feed"} detail={feed.description}
        action={<div className="ed-search" style={{ width: 240 }}>
          <Search size={14} aria-hidden style={{ position: "absolute", left: 10, color: "var(--muted-soft)" }} />
          <input className="ed-input" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter items" aria-label="Filter feed items" />
        </div>} />}

      <div className="ed-reader" data-open={selected ? "true" : undefined}>
        <div style={{ minWidth: 0 }}>
          {pending && !feed && <Card><div style={{ display: "grid", gap: 14 }}>{[0, 1, 2].map(index => <div key={index} style={{ display: "grid", gap: 6 }}><Skeleton width={`${60 + index * 10}%`} height={16} /><Skeleton width="90%" height={11} /></div>)}</div></Card>}
          {!feed && !pending && <Card><Empty icon={BookOpen} title="No edition open" text="Choose a published edition above, or paste an edition feed URL." action={!demo ? <LinkButton href={href("/admin/new")} icon={Plus}>Upload an issue</LinkButton> : undefined} /></Card>}
          {feed && !items.length && <Card><Empty icon={BookOpen} title="No items match" text="Try another word, or clear the filter." /></Card>}
          {feed && items.length > 0 && <Card pad={false} className="still">
            <div className="ed-list" style={{ padding: "4px 16px" }}>
              {items.map((item, index) => {
                const image = leadImage(item);
                const active = selected === item;
                return <button key={item.guid || item.link || index} type="button" className="ed-row ed-reader-item" aria-pressed={active} onClick={() => setSelected(item)}>
                  {image && /* eslint-disable-next-line @next/next/no-img-element -- remote feed image */
                    <img src={image} alt="" loading="lazy" className="ed-reader-thumb" />}
                  <div className="grow">
                    <span className="title">{item.title || "Untitled"}</span>
                    {item.contentSnippet && <span className="ed-reader-snippet">{item.contentSnippet}</span>}
                    <span className="meta">{[item.pubDate ? formatDate(item.pubDate, { month: "short", day: "numeric", year: "numeric" }) : null, item.creator || item.author, item.categories?.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
                  </div>
                </button>;
              })}
            </div>
          </Card>}
        </div>

        {selected && <aside className="ed-reader-pane">
          <Card still>
            <div className="ed-section-head" style={{ marginBottom: 12 }}>
              <span className="ed-eyebrow">Article preview</span>
              <IconButton label="Close preview" icon={X} small onClick={() => setSelected(null)} />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.25 }}>{selected.title}</h2>
            <p style={{ marginTop: 6, color: "var(--muted)", fontSize: 12.5 }}>{[selected.pubDate ? formatDate(selected.pubDate, { month: "short", day: "numeric", year: "numeric" }) : null, selected.creator || selected.author, selected.categories?.[0]].filter(Boolean).join(" · ")}</p>
            {selected.description || selected.contentEncoded || selected.content
              ? <div className="ed-prose ed-reader-body" dangerouslySetInnerHTML={{ __html: selected.description || selected.contentEncoded || selected.content || "" }} />
              : <p className="ed-reader-body">{selected.contentSnippet}</p>}
            {gallery.length > 1 && <div style={{ marginTop: 18 }}>
              <span className="ed-label">{gallery.length} images in this item</span>
              <div className="ed-reader-gallery">
                {gallery.map((url, index) => <a key={url + index} href={url} target="_blank" rel="noopener noreferrer" title={url.split("/").pop()}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote feed image */}
                  <img src={url} alt={`Image ${index + 1}`} loading="lazy" />
                </a>)}
              </div>
            </div>}
            <div className="ed-form-actions" style={{ marginTop: 18, justifyContent: "space-between" }}>
              {selected.guid ? <Button size="sm" icon={copied === selected.guid ? Check : Copy} onClick={() => copy(selected.guid!)}>{copied === selected.guid ? "Copied" : "Copy GUID"}</Button> : <span />}
              <div style={{ display: "flex", gap: 8 }}>
                {selected.link && <a className="ed-button sm" href={selected.link} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={14} aria-hidden />Open link</a>}
                {activeFeed && <a className="ed-button sm" href={activeFeed} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden />Feed XML</a>}
              </div>
            </div>
          </Card>
        </aside>}
      </div>
    </div>
  </>;
}
