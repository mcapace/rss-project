"use client";

import { useState, useTransition, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import {
  Search,
  ExternalLink,
  BookOpen,
  Clock,
  Tag,
  Radio,
  Layers,
  RefreshCw,
  AlertCircle,
  ArrowUpRight,
  Plus,
  ImageIcon,
  Images,
  Check,
  Copy,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { ArticleCardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { BrandKey } from "@/lib/brands";

interface MediaContentItem {
  $?: {
    url?: string;
    type?: string;
    width?: string | number;
    height?: string | number;
    medium?: string;
  };
  url?: string;
}

interface FeedItem {
  title?: string;
  link?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  description?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  guid?: string;
  categories?: string[];
  mediaContent?: MediaContentItem | MediaContentItem[];
  enclosure?: {
    url?: string;
    type?: string;
    length?: number;
  };
}

interface FeedData {
  title?: string;
  description?: string;
  link?: string;
  feedUrl?: string;
  items?: FeedItem[];
}

interface PublishedIssue {
  id: string;
  brand: BrandKey;
  issue_id: string;
  issue_label: string;
  status: string;
  feedUrl: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function FeedReaderContent() {
  const searchParams = useSearchParams();
  const queryUrl = searchParams.get("url");

  // Fetch only published digital editions from our database
  const { data: issuesData, isLoading: issuesLoading } = useSWR<{
    issues: PublishedIssue[];
  }>("/api/issues", fetcher);

  const publishedIssues = (issuesData?.issues || []).filter(
    (i) => i.status === "published"
  );

  const [urlInput, setUrlInput] = useState(queryUrl || "");
  const [activeFeedUrl, setActiveFeedUrl] = useState(queryUrl || "");
  const [feedData, setFeedData] = useState<FeedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [copiedGuid, setCopiedGuid] = useState(false);
  const [selectedPreviewImg, setSelectedPreviewImg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCopyGuid = (guid: string) => {
    navigator.clipboard.writeText(guid);
    setCopiedGuid(true);
    setTimeout(() => setCopiedGuid(false), 2000);
  };

  const loadFeed = async (targetUrl: string) => {
    if (!targetUrl.trim()) return;
    setError(null);
    setSelectedItem(null);
    setActiveFeedUrl(targetUrl);

    try {
      const endpoint = `/api/feed?url=${encodeURIComponent(targetUrl.trim())}`;
      const res = await fetch(endpoint);
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to parse feed");
      }

      setFeedData(data);
    } catch (err: any) {
      setError(err.message || "Could not fetch or parse RSS feed.");
      setFeedData(null);
    }
  };

  useEffect(() => {
    if (queryUrl) {
      setUrlInput(queryUrl);
      startTransition(() => {
        loadFeed(queryUrl);
      });
    } else if (publishedIssues.length > 0 && !activeFeedUrl) {
      const defaultFeed = publishedIssues[0].feedUrl;
      setUrlInput(defaultFeed);
      startTransition(() => {
        loadFeed(defaultFeed);
      });
    }
  }, [queryUrl, publishedIssues.length]);

  const handleFetch = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(() => {
      loadFeed(urlInput);
    });
  };

  const handleSelectPreset = (url: string) => {
    setUrlInput(url);
    startTransition(() => {
      loadFeed(url);
    });
  };

  const filteredItems = (feedData?.items || []).filter((item) => {
    if (!searchFilter.trim()) return true;
    const query = searchFilter.toLowerCase();
    const title = item.title?.toLowerCase() || "";
    const snippet = item.contentSnippet?.toLowerCase() || "";
    const creator = (item.creator || item.author || "").toLowerCase();
    return (
      title.includes(query) ||
      snippet.includes(query) ||
      creator.includes(query)
    );
  });

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-10 space-y-8">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2 border-b border-gray-200">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-500">
            Feed Inspector & QA
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl text-gray-900 font-normal tracking-tight mt-1">
            Edition Reader
          </h1>
        </div>
        <p className="text-xs text-gray-500 max-w-sm">
          Inspect, validate, and preview generated digital edition RSS feeds directly from our publishing pipeline.
        </p>
      </div>

      {/* URL Fetcher Card */}
      <Card padding="md" className="space-y-4">
        <form onSubmit={handleFetch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
              <Radio className="w-4 h-4 text-[#C9A227]" />
            </div>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter digital edition feed URL e.g. /api/feeds/mw/2026-09/feed.xml"
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-xs font-mono text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isPending}
            disabled={isPending || !urlInput.trim()}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${isPending ? "animate-spin" : ""}`}
            />
            {isPending ? "Inspecting..." : "Inspect Feed"}
          </Button>
        </form>

        {/* Our Published Editions Only */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mr-1 flex items-center gap-1">
            <Layers className="w-3 h-3 text-[#C9A227]" />
            <span>Published Editions:</span>
          </span>

          {issuesLoading && publishedIssues.length === 0 ? (
            <span className="text-xs font-mono text-gray-400 italic">
              Loading published catalog...
            </span>
          ) : publishedIssues.length === 0 ? (
            <span className="text-xs text-gray-500 flex items-center gap-2">
              <span>No published editions yet.</span>
              <Link
                href="/admin/new"
                className="text-amber-700 hover:underline inline-flex items-center gap-1 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Upload New Issue
              </Link>
            </span>
          ) : (
            publishedIssues.map((issue) => (
              <button
                key={issue.id}
                onClick={() => handleSelectPreset(issue.feedUrl)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-all flex items-center gap-1.5 ${
                  activeFeedUrl === issue.feedUrl
                    ? "bg-amber-50 border-amber-300 text-amber-950 font-medium shadow-xs"
                    : "bg-white border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <BrandMark brand={issue.brand} size="sm" />
                <span>{issue.issue_label}</span>
              </button>
            ))
          )}
        </div>
      </Card>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs">
            <span className="font-semibold">Failed to load feed:</span>
            <p className="mt-0.5 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Active Feed Overview */}
      {feedData && (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-3 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-2xl text-gray-900 font-normal tracking-tight">
                {feedData.title || "Untitled Feed"}
              </h2>
              {feedData.link && (
                <a
                  href={feedData.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-[#C9A227] transition-colors p-1"
                >
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              )}
            </div>
            {feedData.description && (
              <p className="text-xs text-gray-600 mt-1 max-w-2xl font-sans">
                {feedData.description}
              </p>
            )}
          </div>

          <div className="relative w-full md:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Search className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter feed items..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#C9A227]"
            />
          </div>
        </div>
      )}

      {/* Main Grid: Articles + Reader Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Articles List */}
        <div
          className={`space-y-3 ${
            selectedItem ? "lg:col-span-7" : "lg:col-span-12"
          }`}
        >
          {isPending && !feedData && (
            <div className="space-y-3">
              <ArticleCardSkeleton />
              <ArticleCardSkeleton />
              <ArticleCardSkeleton />
            </div>
          )}

          {filteredItems.map((item, idx) => {
            const isSelected = selectedItem?.title === item.title;
            // Extract first img src from description or content if present
            const imgMatch = (item.description || item.contentEncoded || "").match(/<img[^>]+src=["']([^"']+)["']/i);
            const leadImg = imgMatch ? imgMatch[1] : null;

            return (
              <Card
                key={item.guid || item.link || idx}
                padding="md"
                onClick={() => setSelectedItem(item)}
                className={`cursor-pointer transition-all ${
                  isSelected
                    ? "bg-amber-50/40 border-amber-400/80 ring-1 ring-amber-400/40 shadow-xs"
                    : "hover:bg-gray-50/80"
                }`}
              >
                <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-serif text-lg text-gray-900 font-normal leading-snug hover:text-[#C9A227]">
                        {item.title || "No Title"}
                      </h3>
                      {item.link && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-gray-400 hover:text-[#C9A227] transition-colors p-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {item.contentSnippet && (
                      <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed font-sans">
                        {item.contentSnippet}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-gray-500 pt-1">
                      {item.pubDate && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(item.pubDate).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      )}

                      {(item.creator || item.author) && (
                        <span>• {item.creator || item.author}</span>
                      )}

                      {item.categories && item.categories.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Tag className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-500">
                            {item.categories.slice(0, 2).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {leadImg && (
                    <div className="w-full sm:w-28 h-24 rounded-lg overflow-hidden shrink-0 border border-gray-200 bg-gray-100">
                      <img
                        src={leadImg}
                        alt={item.title || "Article Image"}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  )}
                </div>
              </Card>
            );
          })}

          {!feedData && !isPending && (
            <Card padding="lg" className="text-center py-20 text-gray-500 space-y-3">
              <BookOpen className="w-8 h-8 mx-auto opacity-30 text-[#C9A227]" />
              <div className="space-y-1">
                <h3 className="font-serif text-xl text-gray-900 font-normal">
                  No Edition Selected
                </h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Select a published edition from our catalog above, or enter an edition feed URL.
                </p>
              </div>
              <div className="pt-2">
                <Link href="/admin/new">
                  <Button variant="primary" size="sm">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Upload an Issue
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          {feedData && filteredItems.length === 0 && (
            <Card padding="lg" className="text-center text-gray-500">
              <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs">No articles matched filter criteria.</p>
            </Card>
          )}
        </div>

        {/* Article Preview Pane */}
        {selectedItem && (
          <div className="lg:col-span-5 sticky top-20 h-fit max-h-[80vh] overflow-y-auto">
            <Card elevated padding="lg" className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A227]">
                  Article Preview
                </span>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-xs text-gray-500 hover:text-gray-900 px-2 py-0.5 rounded bg-gray-100 border border-gray-200"
                >
                  Close
                </button>
              </div>

              <div>
                <h2 className="font-serif text-xl text-gray-900 font-normal leading-tight">
                  {selectedItem.title}
                </h2>

                <div className="mt-2 text-xs font-mono text-gray-500 flex flex-wrap gap-2 items-center">
                  {selectedItem.pubDate && <span>{selectedItem.pubDate}</span>}
                  {(selectedItem.creator || selectedItem.author) && (
                    <span>• {selectedItem.creator || selectedItem.author}</span>
                  )}
                </div>

                <div className="mt-6 text-xs text-gray-800 leading-relaxed space-y-3 font-sans">
                  {selectedItem.description || selectedItem.contentEncoded || selectedItem.content ? (
                    <div
                      className="prose prose-xs max-w-none break-words [&_img]:rounded-lg [&_img]:w-full [&_img]:max-h-96 [&_img]:object-cover [&_img]:mb-4"
                      dangerouslySetInnerHTML={{
                        __html:
                          selectedItem.description ||
                          selectedItem.contentEncoded ||
                          selectedItem.content ||
                          "",
                      }}
                    />
                  ) : (
                    <p>{selectedItem.contentSnippet}</p>
                  )}
                </div>

                {/* Article Media Gallery (All extracted & included images) */}
                {(() => {
                  const mediaItems: MediaContentItem[] = Array.isArray(selectedItem.mediaContent)
                    ? selectedItem.mediaContent
                    : selectedItem.mediaContent
                    ? [selectedItem.mediaContent]
                    : [];

                  const imageUrls = mediaItems
                    .map((m) => m.$?.url || m.url)
                    .filter((u): u is string => Boolean(u));

                  if (imageUrls.length <= 1) return null;

                  return (
                    <div className="mt-8 pt-6 border-t border-gray-100 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-700">
                          <Images className="w-3.5 h-3.5 text-[#C9A227]" />
                          <span>Extracted Media ({imageUrls.length} images)</span>
                        </div>
                        <span className="text-[10px] font-mono text-gray-400">Click to preview full-res</span>
                      </div>

                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {imageUrls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-50 hover:border-[#C9A227] hover:shadow-sm transition-all"
                            title={`Open photo ${i + 1} (${url.split("/").pop()})`}
                          >
                            <img
                              src={url}
                              alt={`Article image ${i + 1}`}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                              loading="lazy"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                              <ExternalLink className="w-3.5 h-3.5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
                            </div>
                            <span className="absolute bottom-1 right-1 text-[9px] font-mono px-1 py-0.2 rounded bg-black/60 text-white leading-tight">
                              #{i + 1}
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between gap-3">
                  {selectedItem.guid ? (
                    <button
                      onClick={() => handleCopyGuid(selectedItem.guid!)}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-500 hover:text-gray-900 transition-colors"
                      title="Copy BlueToad Article GUID"
                    >
                      {copiedGuid ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700 font-medium">GUID Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy GUID</span>
                        </>
                      )}
                    </button>
                  ) : <div />}

                  {activeFeedUrl && (
                    <a
                      href={activeFeedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#C9A227] hover:bg-[#D8B138] text-gray-950 rounded-lg text-xs font-semibold tracking-tight transition-colors shadow-xs"
                    >
                      <span>View Feed XML</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

export default function FeedReaderPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-6xl mx-auto px-4 py-20 space-y-4">
          <Skeleton className="w-48 h-8 rounded" />
          <Skeleton className="w-full h-32 rounded-xl" />
        </div>
      }
    >
      <FeedReaderContent />
    </Suspense>
  );
}
