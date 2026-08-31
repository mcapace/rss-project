"use client";

import { useState, useEffect, useTransition } from "react";
import {
  Rss,
  Search,
  ExternalLink,
  RefreshCw,
  Clock,
  Globe,
  Tag,
  AlertCircle,
  Radio,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";

interface FeedItem {
  title?: string;
  link?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  contentSnippet?: string;
  content?: string;
  contentEncoded?: string;
  categories?: string[];
  guid?: string;
}

interface FeedData {
  title?: string;
  description?: string;
  link?: string;
  feedUrl?: string;
  lastBuildDate?: string;
  items?: FeedItem[];
}

const PRESET_FEEDS = [
  {
    name: "Market Watch Preview",
    brand: "mw",
    url: "/api/feeds/mw/2026-09/feed.xml",
    category: "Internal",
  },
  {
    name: "BBC News — World",
    brand: null,
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    category: "News",
  },
  {
    name: "The Verge",
    brand: null,
    url: "https://www.theverge.com/rss/index.xml",
    category: "Tech",
  },
  {
    name: "NYT — Technology",
    brand: null,
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    category: "Tech",
  },
  {
    name: "NASA Breaking News",
    brand: null,
    url: "https://www.nasa.gov/rss/dyn/breaking_news.rss",
    category: "Science",
  },
];

export default function FeedReaderPage() {
  const [urlInput, setUrlInput] = useState(PRESET_FEEDS[1].url);
  const [activeFeedUrl, setActiveFeedUrl] = useState(PRESET_FEEDS[1].url);
  const [feedData, setFeedData] = useState<FeedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedItem, setSelectedItem] = useState<FeedItem | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadFeed = async (url: string) => {
    setError(null);
    setSelectedItem(null);
    try {
      const res = await fetch(`/api/feed?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load RSS feed");
      }
      setFeedData(data);
      setActiveFeedUrl(url);
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred loading the feed.");
      setFeedData(null);
    }
  };

  useEffect(() => {
    startTransition(() => {
      loadFeed(PRESET_FEEDS[1].url);
    });
  }, []);

  const handleFetch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    startTransition(() => {
      loadFeed(urlInput.trim());
    });
  };

  const handleSelectPreset = (presetUrl: string) => {
    setUrlInput(presetUrl);
    startTransition(() => {
      loadFeed(presetUrl);
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
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-2 border-b border-[rgba(255,255,255,0.06)]">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9A9AA0]">
            Feed Inspector & QA
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl text-[#EDEDED] font-normal tracking-tight mt-1">
            RSS Reader
          </h1>
        </div>
        <p className="text-xs text-[#9A9AA0] max-w-sm">
          Inspect, validate, and preview generated edition RSS feeds and external feeds in real time.
        </p>
      </div>

      {/* URL Fetcher Card */}
      <Card padding="md" className="space-y-4">
        <form onSubmit={handleFetch} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#9A9AA0]">
              <Radio className="w-4 h-4 text-[#C9A227]" />
            </div>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter RSS/Atom XML feed URL..."
              required
              className="w-full pl-10 pr-4 py-2.5 bg-[#0A0A0B] border border-[rgba(255,255,255,0.08)] rounded-lg text-xs font-mono text-[#EDEDED] placeholder-[#6B6B72] focus:outline-none focus:border-[#C9A227] focus:ring-1 focus:ring-[#C9A227]"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={isPending}
            disabled={isPending}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isPending ? "animate-spin" : ""}`} />
            {isPending ? "Fetching..." : "Fetch Feed"}
          </Button>
        </form>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[rgba(255,255,255,0.06)]">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9AA0] mr-1">
            Presets:
          </span>
          {PRESET_FEEDS.map((preset) => (
            <button
              key={preset.url}
              onClick={() => handleSelectPreset(preset.url)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-all flex items-center gap-1.5 ${
                activeFeedUrl === preset.url
                  ? "bg-[#1B1B1E] border-[rgba(255,255,255,0.24)] text-[#EDEDED] font-medium"
                  : "bg-transparent border-[rgba(255,255,255,0.06)] text-[#9A9AA0] hover:text-[#EDEDED] hover:bg-[#141416]"
              }`}
            >
              {preset.brand && <BrandMark brand={preset.brand} size="sm" />}
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.25)] text-[#F87171] flex items-start gap-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-xs">
            <span className="font-semibold">Failed to load feed:</span>
            <p className="mt-0.5 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {/* Active Feed Overview */}
      {feedData && (
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-3 border-b border-[rgba(255,255,255,0.08)]">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-2xl text-[#EDEDED] font-normal tracking-tight">
                {feedData.title || "Untitled Feed"}
              </h2>
              {feedData.link && (
                <a
                  href={feedData.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#9A9AA0] hover:text-[#C9A227] transition-colors p-1"
                >
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              )}
            </div>
            {feedData.description && (
              <p className="text-xs text-[#9A9AA0] mt-1 max-w-2xl">
                {feedData.description}
              </p>
            )}
          </div>

          <div className="relative w-full md:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#9A9AA0]">
              <Search className="w-3.5 h-3.5" />
            </div>
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter feed items..."
              className="w-full pl-8 pr-3 py-1.5 bg-[#141416] border border-[rgba(255,255,255,0.08)] rounded-lg text-xs text-[#EDEDED] placeholder-[#6B6B72] focus:outline-none focus:border-[#C9A227]"
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
            <div className="py-20 text-center text-[#9A9AA0]">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 text-[#C9A227]" />
              <p className="text-xs font-mono">Parsing feed payload...</p>
            </div>
          )}

          {filteredItems.map((item, idx) => {
            const isSelected = selectedItem?.link === item.link;
            return (
              <Card
                key={item.guid || item.link || idx}
                padding="md"
                onClick={() => setSelectedItem(item)}
                className={`cursor-pointer transition-all ${
                  isSelected
                    ? "bg-[#1B1B1E] border-[#C9A227]/40 ring-1 ring-[#C9A227]/30"
                    : "hover:bg-[#1B1B1E]/70"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-serif text-lg text-[#EDEDED] font-normal leading-snug hover:text-white">
                    {item.title || "No Title"}
                  </h3>
                  {item.link && (
                    <a
                      href={item.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[#9A9AA0] hover:text-[#C9A227] transition-colors p-1"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {item.contentSnippet && (
                  <p className="text-xs text-[#9A9AA0] mt-2 line-clamp-2 leading-relaxed font-sans">
                    {item.contentSnippet}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#9A9AA0]">
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
                      <Tag className="w-3 h-3 text-[#6B6B72]" />
                      <span className="text-[#9A9AA0]">
                        {item.categories.slice(0, 2).join(", ")}
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}

          {feedData && filteredItems.length === 0 && (
            <Card padding="lg" className="text-center text-[#9A9AA0]">
              <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-xs">No articles matched filter criteria.</p>
            </Card>
          )}
        </div>

        {/* Article Preview Pane */}
        {selectedItem && (
          <div className="lg:col-span-5 sticky top-20 h-fit max-h-[80vh] overflow-y-auto">
            <Card elevated padding="lg" className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[rgba(255,255,255,0.08)]">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#C9A227]">
                  Article Preview
                </span>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-xs text-[#9A9AA0] hover:text-[#EDEDED] px-2 py-0.5 rounded bg-[#141416] border border-[rgba(255,255,255,0.06)]"
                >
                  Close
                </button>
              </div>

              <div>
                <h2 className="font-serif text-xl text-[#EDEDED] font-normal leading-tight">
                  {selectedItem.title}
                </h2>

                <div className="mt-2 text-xs font-mono text-[#9A9AA0] flex flex-wrap gap-2 items-center">
                  {selectedItem.pubDate && <span>{selectedItem.pubDate}</span>}
                  {(selectedItem.creator || selectedItem.author) && (
                    <span>• {selectedItem.creator || selectedItem.author}</span>
                  )}
                </div>

                <div className="mt-6 text-xs text-[#EDEDED] leading-relaxed space-y-3 font-sans">
                  {selectedItem.contentEncoded || selectedItem.content ? (
                    <div
                      className="prose prose-invert prose-xs max-w-none break-words"
                      dangerouslySetInnerHTML={{
                        __html:
                          selectedItem.contentEncoded ||
                          selectedItem.content ||
                          "",
                      }}
                    />
                  ) : (
                    <p>{selectedItem.contentSnippet}</p>
                  )}
                </div>

                {selectedItem.link && (
                  <div className="mt-6 pt-4 border-t border-[rgba(255,255,255,0.08)] flex justify-end">
                    <a
                      href={selectedItem.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#C9A227] hover:bg-[#D8B138] text-[#0A0A0B] rounded-lg text-xs font-semibold tracking-tight transition-colors"
                    >
                      <span>Read Original</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
