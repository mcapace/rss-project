import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft, Search } from "lucide-react";
import { WA_PATH_HEADER } from "@/lib/wa/root-routing";
import { siteFor } from "@/lib/wa/site-host";
import "@/components/editorial/editorial.css";

/**
 * A Whisky Advocate address on a root host that no file or route answers (the proxy marks site requests with
 * WA_PATH_HEADER; the app's own paths are never marked): its origin and the path as received. Null for everything else,
 * which keeps the editorial workspace's 404.
 */
async function siteMiss(): Promise<{ origin: string; path: string } | null> {
  const list = await headers();
  const path = list.get(WA_PATH_HEADER);
  if (!path) return null;
  const site = siteFor(list.get("host") ?? "");
  if (!site.root) return null;
  let shown = path;
  try { shown = decodeURIComponent(path); } catch { /* keep as given */ }
  return { origin: site.origin, path: shown };
}

export async function generateMetadata(): Promise<Metadata> {
  if (!(await siteMiss())) return {};
  return { title: { absolute: "Page not found | Whisky Advocate" }, description: "This Whisky Advocate page could not be found." };
}

export default async function NotFound() {
  const miss = await siteMiss();
  if (miss) {
    // The same page as the story route's 404 (notFoundPage in src/lib/wa/seo.ts), in the root shape. Next adds noindex.
    return <>
      {/* The site's own stylesheet (public/wa/site.css at the root), not a bundled one: the page must look like the site. */}
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href="/site.css" precedence="wa" />
      <section className="band" style={{ paddingTop: 80 }}>
        <span className="mono">Not found</span>
        <h1 className="d2" style={{ marginTop: 12 }}>We could not find “{miss.path}”.</h1>
        <p className="lede" style={{ marginTop: 14 }}>It may have moved. <a href="/stories.html">Browse the stories</a>, <a href="/finder.html">search the ratings</a> or <a href={`${miss.origin}/`}>go to the home page</a>.</p>
      </section>
    </>;
  }
  return <main className="ed ed-access">
    <section className="ed-card pad ed-access-card still">
      <span className="ed-wordmark"><span className="ed-wordmark-mark">MS</span><span>Editorial</span></span>
      <h1>This page does not exist</h1>
      <p>The story, issue or page you followed may have moved. The content library and search can find it by title or keyword.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
        <Link className="ed-button primary" href="/cms"><ArrowLeft size={15} aria-hidden />Back to the workspace</Link>
        <Link className="ed-button" href="/cms/search"><Search size={15} aria-hidden />Search</Link>
      </div>
    </section>
  </main>;
}
