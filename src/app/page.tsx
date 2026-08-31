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
} from "lucide-react";

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
    name: "BBC News - World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    category: "News",
  },
  {
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    category: "Tech",
  },
  {
    name: "Hacker News Top",
    url: "https://news.ycombinator.com/rss",
    category: "Tech",
  },
  {
    name: "NYT - Technology",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    category: "Tech",
  },
  {
    name: "NASA Breaking News",
    url: "https://www.nasa.gov/rss/dyn/breaking_news.rss",
    category: "Science",
  },
];

export default function Home() {
  const [urlInput, setUrlInput] = useState(PRESET_FEEDS[0].url);
  const [activeFeedUrl, setActiveFeedUrl] = useState(PRESET_FEEDS[0].url);
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
      loadFeed(PRESET_FEEDS[0].url);
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
              <Rss className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                RSS Feed Hub
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 font-medium">
                  Live
                </span>
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">
                Aggregator, Parser & Reader
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="https://github.com/mcapace/rss-project"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1.5 border border-slate-700"
            >
              <Globe className="w-3.5 h-3.5" />
              GitHub
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full flex flex-col gap-8">
        {/* URL Input Form */}
        <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 sm:p-6 shadow-xl backdrop-blur-sm">
          <form onSubmit={handleFetch} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Radio className="w-4 h-4 text-orange-400" />
              </div>
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Enter any RSS/Atom XML feed URL..."
                required
                className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition-all shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isPending ? "animate-spin" : ""}`} />
              {isPending ? "Fetching..." : "Fetch Feed"}
            </button>
          </form>

          {/* Quick Presets */}
          <div className="mt-4 flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/60">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">
              Presets:
            </span>
            {PRESET_FEEDS.map((preset) => (
              <button
                key={preset.url}
                onClick={() => handleSelectPreset(preset.url)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                  activeFeedUrl === preset.url
                    ? "bg-orange-500/10 border-orange-500/40 text-orange-400 font-medium"
                    : "bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </section>

        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <div className="text-sm">
              <strong className="font-semibold">Error loading feed:</strong>
              <p className="mt-1 text-red-300">{error}</p>
            </div>
          </div>
        )}

        {/* Feed Info Header */}
        {feedData && (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-white tracking-tight">
                  {feedData.title || "Untitled Feed"}
                </h2>
                {feedData.link && (
                  <a
                    href={feedData.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-orange-400 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
              {feedData.description && (
                <p className="text-sm text-slate-400 mt-1 max-w-3xl">
                  {feedData.description}
                </p>
              )}
            </div>

            {/* Filter Input */}
            <div className="relative w-full md:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter articles..."
                className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
          </div>
        )}

        {/* Feed Grid & Detail View */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* List of Articles */}
          <div
            className={`flex flex-col gap-4 ${
              selectedItem ? "lg:col-span-7" : "lg:col-span-12"
            }`}
          >
            {isPending && !feedData && (
              <div className="py-20 text-center text-slate-500">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-orange-400" />
                <p className="text-sm">Loading feed contents...</p>
              </div>
            )}

            {filteredItems.map((item, idx) => {
              const isSelected = selectedItem?.link === item.link;
              return (
                <article
                  key={item.guid || item.link || idx}
                  onClick={() => setSelectedItem(item)}
                  className={`p-5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-slate-900/90 border-orange-500/50 shadow-lg shadow-orange-500/5"
                      : "bg-slate-900/40 border-slate-800/80 hover:bg-slate-900/70 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-base font-semibold text-slate-100 hover:text-orange-400 transition-colors leading-snug">
                      {item.title || "No Title"}
                    </h3>
                    {item.link && (
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-slate-500 hover:text-orange-400 transition-colors shrink-0 p-1"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>

                  {item.contentSnippet && (
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                      {item.contentSnippet}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    {item.pubDate && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(item.pubDate).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}

                    {(item.creator || item.author) && (
                      <span>by {item.creator || item.author}</span>
                    )}

                    {item.categories && item.categories.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Tag className="w-3 h-3 text-slate-600" />
                        <span className="text-slate-400">
                          {item.categories.slice(0, 2).join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}

            {feedData && filteredItems.length === 0 && (
              <div className="py-16 text-center text-slate-500 bg-slate-900/20 rounded-xl border border-slate-800">
                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No articles match your filter.</p>
              </div>
            )}
          </div>

          {/* Reader Panel (if selected) */}
          {selectedItem && (
            <div className="lg:col-span-5 sticky top-24 h-fit max-h-[80vh] overflow-y-auto bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider">
                  Article Preview
                </span>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-slate-400 hover:text-slate-200 text-xs px-2 py-1 rounded bg-slate-800"
                >
                  Close
                </button>
              </div>

              <div className="mt-4">
                <h2 className="text-lg font-bold text-white leading-tight">
                  {selectedItem.title}
                </h2>

                <div className="mt-2 text-xs text-slate-400 flex flex-wrap gap-2 items-center">
                  {selectedItem.pubDate && <span>{selectedItem.pubDate}</span>}
                  {(selectedItem.creator || selectedItem.author) && (
                    <span>• by {selectedItem.creator || selectedItem.author}</span>
                  )}
                </div>

                <div className="mt-6 text-sm text-slate-300 leading-relaxed space-y-4">
                  {selectedItem.contentEncoded || selectedItem.content ? (
                    <div
                      className="prose prose-invert prose-sm max-w-none break-words"
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
                  <div className="mt-6 pt-4 border-t border-slate-800">
                    <a
                      href={selectedItem.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-xs font-medium transition-colors"
                    >
                      Read full article
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-slate-500">
          RSS Project • Built with Next.js & Tailwind CSS • Deployed on Vercel
        </div>
      </footer>
    </div>
  );
}
