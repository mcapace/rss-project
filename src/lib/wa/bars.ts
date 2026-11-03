import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { esc, metaDescription } from "./seo";
import type { WaSite } from "./site-host";

/* America's Top Whisky Bars: a page per bar and per state at /whisky-bars/<slug> (/wa/whisky-bars/<slug> on the development
   host), rendered here from public/wa/whisky-bars.json (scripts/wa-whisky-bars.mjs) into public/wa/whisky-bar.html. */

export type Bar = { id: number; slug: string; name: string; addr: string; city: string; st: string; state: string; lat: number | null; lng: number | null; x: number | null; y: number | null; web: string; desc: string; list: string };
export type BarState = { name: string; slug: string; d: string; box: number[]; bars: boolean };
export type BarsData = { title: string; edition: number; updated: string; box: [number, number]; states: BarState[]; bars: Bar[] };

let cache: Promise<BarsData> | null = null;
export function barsData(): Promise<BarsData> {
  if (!cache) cache = readFile(path.join(process.cwd(), "public/wa/whisky-bars.json"), "utf8").then(t => JSON.parse(t) as BarsData).catch(e => { cache = null; throw e; });
  return cache;
}

const PUBLISHER = "Whisky Advocate";
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const place = (b: Bar) => b.city + (b.st ? ", " + b.st : "");
export const barPath = (base: string, slug: string) => `${base}/whisky-bars/${encodeURIComponent(slug)}`;

function miles(a: Bar, b: Bar): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Infinity;
  const t = Math.PI / 180, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}
const byName = (a: Bar, b: Bar) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name);

/** The state and its neighbors drawn around the given bars, every bar a link, the current one lit. */
function mapSvg(d: BarsData, state: BarState, bars: Bar[], base: string, current?: Bar): string {
  const [x0, y0, x1, y1] = state.box;
  let w = Math.max(x1 - x0, 46), h = Math.max(y1 - y0, 30);
  w *= 1.16; h *= 1.16;
  if (w / h < 1.25) w = h * 1.25; else h = w / 1.25;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vx = cx - w / 2, vy = cy - h / 2;
  const near = d.states.filter(s => s.box[0] < vx + w && s.box[2] > vx && s.box[1] < vy + h && s.box[3] > vy);
  const r = w / 95;
  const dots = bars.filter(b => b.x != null && b.y != null).sort((a, b) => (a === current ? 1 : 0) - (b === current ? 1 : 0)).map(b => {
    const on = b === current;
    return `<a href="${barPath(base, b.slug)}"${on ? ' aria-current="page"' : ""}><title>${esc(b.name)}, ${esc(place(b))}</title><circle class="wbp-dot${on ? " is-on" : ""}" cx="${b.x}" cy="${b.y}" r="${(on ? r * 1.7 : r).toFixed(2)}"/></a>`;
  }).join("");
  /* One label per city, the busiest first; a label too close to one already placed is left out. */
  const cities = new Map<string, { n: number; x: number; y: number }>();
  for (const b of bars) { if (b.x == null || b.y == null) continue; const c = cities.get(b.city) || { n: 0, x: 0, y: 0 }; c.n++; c.x += b.x; c.y += b.y; cities.set(b.city, c); }
  const fs = w / 34, placed: { x: number; y: number }[] = [];
  const labels = [...cities.entries()].map(([name, c]) => ({ name, n: c.n, x: c.x / c.n, y: c.y / c.n })).sort((a, b) => b.n - a.n).filter(c => {
    if (placed.some(p => Math.abs(p.x - c.x) < fs * 6 && Math.abs(p.y - c.y) < fs * 1.6)) return false;
    placed.push(c); return true;
  }).map(c => {
    const right = c.x < vx + w * 0.7;
    return `<text class="wbp-city" x="${(c.x + (right ? 2.4 : -3.2) * r).toFixed(1)}" y="${(c.y + fs * 0.35).toFixed(1)}" font-size="${fs.toFixed(2)}" text-anchor="${right ? "start" : "end"}">${esc(c.name)}${c.n > 1 ? `<tspan> ${c.n}</tspan>` : ""}</text>`;
  }).join("");
  return `<svg viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="Map of ${esc(state.name)} with ${bars.length === 1 ? "its bar" : `its ${bars.length} bars`} on the list"><g class="wbp-states">${near.map(s => `<path d="${s.d}"${s.name === state.name ? ' class="is-here"' : ""}/>`).join("")}</g><g class="wbp-labels" aria-hidden="true">${labels}</g><g class="wbp-dots">${dots}</g></svg>`;
}

function card(b: Bar, base: string, i?: number): string {
  return `<li class="wbp-card"><a class="wbp-card-link" href="${barPath(base, b.slug)}">${i != null ? `<span class="wbp-n">${String(i + 1).padStart(2, "0")}</span>` : ""}<span class="mono">${esc(place(b))}</span><h3>${esc(b.name)}</h3>${b.desc ? `<p>${esc(b.desc)}</p>` : ""}<span class="wbp-go">The bar <i aria-hidden="true">&rarr;</i></span></a></li>`;
}

function actions(b: Bar): string {
  const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(b.name + ", " + b.addr);
  return `<div class="wbp-act">${b.list ? `<a class="pill amber" href="${esc(b.list)}" target="_blank" rel="noopener" data-out="list">See the whisky list</a>` : ""}${b.web ? `<a class="pill${b.list ? "" : " amber"}" href="${esc(b.web)}" target="_blank" rel="noopener" data-out="web">Visit the website</a>` : ""}<a class="pill" href="${maps}" target="_blank" rel="noopener" data-out="maps">Directions</a><button type="button" class="pill" data-share>Share</button></div>`;
}

function crumbs(base: string, items: [string, string | null][]): string {
  return `<nav class="wbp-crumbs mono" aria-label="Breadcrumb"><a href="${base}/whisky-bars.html">America&rsquo;s Top Whisky Bars</a>${items.map(([t, href]) => ` <span aria-hidden="true">/</span> ${href ? `<a href="${href}">${esc(t)}</a>` : `<span aria-current="page">${esc(t)}</span>`}`).join("")}</nav>`;
}

function breadcrumbLd(origin: string, base: string, items: [string, string][]) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [["America's Top Whisky Bars", `${origin}${base}/whisky-bars.html`], ...items].map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) };
}

function barLd(b: Bar, url: string) {
  return {
    "@context": "https://schema.org", "@type": "BarOrPub", name: b.name, url, description: b.desc || undefined,
    address: { "@type": "PostalAddress", streetAddress: b.addr.split(",")[0], addressLocality: b.city, addressRegion: b.st || b.state, addressCountry: "US" },
    geo: b.lat != null && b.lng != null ? { "@type": "GeoCoordinates", latitude: b.lat, longitude: b.lng } : undefined,
    sameAs: b.web || undefined, hasMenu: b.list || undefined,
  };
}

async function shell(site: WaSite, head: { title: string; description: string; canonical: string; ld: unknown[] }, main: string): Promise<string> {
  const { base, origin } = site;
  let html = await readFile(path.join(process.cwd(), "public/wa/whisky-bar.html"), "utf8");
  const image = `${origin}${base}/img/bars/film.webp`;
  html = html.replace("<head>", `<head><base href="${base}/">`)
    .replace(/<title>.*?<\/title>/, `<title>${esc(head.title)}</title>`)
    .replace("</head>", `<link rel="canonical" href="${esc(head.canonical)}"><meta name="description" content="${esc(head.description)}"><meta property="og:title" content="${esc(head.title)}"><meta property="og:description" content="${esc(head.description)}"><meta property="og:url" content="${esc(head.canonical)}"><meta property="og:type" content="website"><meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">${head.ld.map(x => `<script type="application/ld+json">${json(x)}</script>`).join("")}<script>window.WA_BASE=${JSON.stringify(base)};window.WA_PATHS=true;</script></head>`)
    .replace(/(<main id="wbPage"[^>]*>)[\s\S]*?(<\/main>)/, (_m, open, close) => open + main + close);
  return html;
}

export async function barPage(slug: string, site: WaSite): Promise<string | null> {
  const d = await barsData(), { base, origin } = site;
  const key = slug.toLowerCase();
  const state = d.states.find(s => s.slug === key && s.bars);
  if (state) return statePage(d, state, site);
  const b = d.bars.find(x => x.slug === key);
  if (!b) return null;
  const st = d.states.find(s => s.name === b.state);
  const url = `${origin}${barPath(base, b.slug)}`;
  const same = d.bars.filter(x => x.state === b.state).sort(byName);
  const others = same.filter(x => x !== b);
  const nearby = d.bars.filter(x => x.state !== b.state).map(x => ({ x, mi: miles(b, x) })).filter(o => o.mi < 260).sort((p, q) => p.mi - q.mi).slice(0, 4);
  const title = `${b.name}, ${place(b)}: America's Top Whisky Bars ${d.edition} | ${PUBLISHER}`;
  const description = metaDescription(b.desc ? `${b.name} in ${place(b)}, one of America's Top Whisky Bars ${d.edition}. ${b.desc}` : `${b.name} in ${place(b)}, one of America's Top Whisky Bars ${d.edition}, chosen by the editors of Whisky Advocate.`);
  const stHref = st ? barPath(base, st.slug) : null;
  const main = `<section class="band wbp-hero">
  ${crumbs(base, [[b.state, stHref], [b.name, null]])}
  <div class="wbp-grid">
    <div class="wbp-copy">
      <span class="mono wbp-kicker">${esc(place(b))} &middot; ${d.edition} edition</span>
      <h1 class="d1">${esc(b.name)}</h1>
      ${b.desc ? `<p class="wbp-lede">${esc(b.desc)}</p>` : ""}
      ${actions(b)}
      <dl class="wbp-facts"><div><dt>Address</dt><dd>${esc(b.addr)}</dd></div>${b.web ? `<div><dt>Website</dt><dd><a href="${esc(b.web)}" target="_blank" rel="noopener">${esc(hostOf(b.web))}</a></dd></div>` : ""}<div><dt>On the list</dt><dd>${same.length === 1 ? `The only bar in ${esc(b.state)}` : `One of ${same.length} in ${esc(b.state)}`}</dd></div></dl>
    </div>
    ${st ? `<figure class="wbp-map">${mapSvg(d, st, same, base, b)}<figcaption class="mono"><a href="${base}/whisky-bars.html?bar=${encodeURIComponent(b.slug)}">Open the full map</a></figcaption></figure>` : ""}
  </div>
</section>
${others.length ? `<section class="band wbp-list"><div class="wbp-head"><span class="mono">${esc(b.state)}</span><h2 class="d2">More whisky bars in ${esc(b.state)}</h2>${stHref ? `<a class="pill" href="${stHref}">All ${same.length} in ${esc(b.state)}</a>` : ""}</div><ul class="wbp-cards">${others.slice(0, 6).map(x => card(x, base)).join("")}</ul></section>` : ""}
${nearby.length ? `<section class="band wbp-list"><div class="wbp-head"><span class="mono">Within a drive</span><h2 class="d2">Nearby, across state lines</h2></div><ul class="wbp-cards">${nearby.map(o => card(o.x, base).replace('<span class="wbp-go">', `<span class="wbp-go"><b>${Math.round(o.mi)} mi</b> `)).join("")}</ul></section>` : ""}
${cta(d, base)}`;
  return shell(site, { title, description, canonical: url, ld: [barLd(b, url), breadcrumbLd(origin, base, [...(st ? [[b.state, `${origin}${barPath(base, st.slug)}`] as [string, string]] : []), [b.name, url]])] }, main);
}

function cta(d: BarsData, base: string): string {
  const states = d.states.filter(s => s.bars).sort((a, b) => a.name.localeCompare(b.name));
  return `<section class="band wbp-states-band"><div class="wbp-head"><span class="mono">Browse by state</span><h2 class="d2">${d.bars.length} bars, coast to coast</h2><a class="pill solid" href="${base}/whisky-bars.html#explore">See them all on the map</a></div><ul class="wbp-chips">${states.map(s => `<li><a href="${barPath(base, s.slug)}">${esc(s.name)} <span>${d.bars.filter(b => b.state === s.name).length}</span></a></li>`).join("")}</ul></section>`;
}

function statePage(d: BarsData, st: BarState, site: WaSite): Promise<string> {
  const { base, origin } = site;
  const bars = d.bars.filter(b => b.state === st.name).sort(byName);
  const url = `${origin}${barPath(base, st.slug)}`;
  const n = bars.length;
  const title = `The Best Whisky Bars in ${st.name} (${d.edition}) | ${PUBLISHER}`;
  const lede = n === 1 ? `One bar in ${st.name} made America's Top Whisky Bars ${d.edition}, chosen by the editors of Whisky Advocate for its whisky, its hospitality and its sense of place.` : `${n} bars in ${st.name} made America's Top Whisky Bars ${d.edition}, chosen by the editors of Whisky Advocate for their whisky, their hospitality and their sense of place.`;
  const cities = Array.from(new Set(bars.map(b => b.city))).filter(Boolean);
  const main = `<section class="band wbp-hero">
  ${crumbs(base, [[st.name, null]])}
  <div class="wbp-grid">
    <div class="wbp-copy">
      <span class="mono wbp-kicker">America&rsquo;s Top Whisky Bars &middot; ${d.edition}</span>
      <h1 class="d1">The best whisky bars in ${esc(st.name)}</h1>
      <p class="wbp-lede">${esc(lede)}</p>
      <dl class="wbp-facts"><div><dt>Bars</dt><dd>${n}</dd></div><div><dt>${cities.length === 1 ? "City" : "Cities"}</dt><dd>${esc(cities.slice(0, 6).join(", "))}${cities.length > 6 ? ` and ${cities.length - 6} more` : ""}</dd></div></dl>
    </div>
    <figure class="wbp-map">${mapSvg(d, st, bars, base)}<figcaption class="mono"><a href="${base}/whisky-bars.html?state=${encodeURIComponent(st.name)}">Open the full map</a></figcaption></figure>
  </div>
</section>
<section class="band wbp-list"><ol class="wbp-cards wbp-cards-state">${bars.map((b, i) => card(b, base, n > 1 ? i : undefined)).join("")}</ol></section>
${cta(d, base)}`;
  const ld = [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: `The best whisky bars in ${st.name}`, description: lede, url, isPartOf: { "@type": "WebPage", name: "America's Top Whisky Bars", url: `${origin}${base}/whisky-bars.html` },
      mainEntity: { "@type": "ItemList", numberOfItems: n, itemListElement: bars.map((b, i) => ({ "@type": "ListItem", position: i + 1, url: `${origin}${barPath(base, b.slug)}`, name: b.name })) } },
    breadcrumbLd(origin, base, [[st.name, url]]),
  ];
  return shell(site, { title, description: metaDescription(lede), canonical: url, ld }, main);
}

/** Every bar and state page, for the sitemap. */
export async function barUrls(site: WaSite): Promise<string[]> {
  const d = await barsData();
  return [`${site.origin}${site.base}/whisky-bars.html`, ...d.states.filter(s => s.bars).map(s => site.origin + barPath(site.base, s.slug)), ...d.bars.map(b => site.origin + barPath(site.base, b.slug))];
}
