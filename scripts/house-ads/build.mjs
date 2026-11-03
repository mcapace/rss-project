// Builds the Whisky Advocate house ads as Google Ad Manager HTML5 bundles.
//
//   node scripts/house-ads/build.mjs [--src <runway output dir>] [--only whiskyfest] [--size 300x250]
//
// --src defaults to scripts/house-ads/source, the Runway clips and stills kept in the repo (re-encoded at crf 26).
//
// For every campaign and size it writes public/wa/house-ads/<campaign>/<size>/ with
// index.html (clickTag, inline CSS and JS), loop.mp4 (the Runway loop cropped to the frame,
// crossfaded so it loops without a seam), poster.jpg (its first frame) and three subset fonts,
// and public/wa/house-ads/manifest.json for the gallery. Each bundle stays under 950 KB and
// 10 files (Ad Manager allows 1 MB and 50). Fresh lines (the newest ratings, stories and
// cocktails) are read from the site's own data files at build time; rebuild to refresh them.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const wa = join(root, 'public/wa');
const outRoot = join(wa, 'house-ads');
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const src = opt('--src') ?? join(here, 'source');
const only = opt('--only')?.split(',');
const onlySize = opt('--size')?.split(',');
const BUDGET = 950 * 1024;

/* ------------------------------ fresh lines ------------------------------ */

const clean = (s) => String(s).replace(/\s+/g, ' ').replace(/—/g, ',').trim();
function freshRatings() {
  const { cols, rows } = JSON.parse(readFileSync(join(wa, 'ratings.json'), 'utf8'));
  const at = Object.fromEntries(cols.map((c, i) => [c, i]));
  const newest = rows.map((r) => r[at.d]).sort().at(-1);
  const since = new Date(new Date(newest).getTime() - 45 * 864e5).toISOString().slice(0, 10);
  const seen = new Set();
  return rows
    .filter((r) => r[at.d] >= since && r[at.s] >= 90)
    .sort((a, b) => b[at.s] - a[at.s] || (b[at.d] > a[at.d] ? 1 : -1))
    .filter((r) => !seen.has(r[at.pr]) && seen.add(r[at.pr]))
    .slice(0, 6)
    .map((r) => ({ score: r[at.s], name: clean(r[at.n]).replace(/,\s*[\d.]+%$/, '') }));
}
function freshStories() {
  const stories = JSON.parse(readFileSync(join(wa, 'stories.json'), 'utf8'));
  return stories.filter((s) => s.title && s.title.length < 90).sort((a, b) => (b.d > a.d ? 1 : -1)).slice(0, 4).map((s) => clean(s.title));
}
function freshCocktails() {
  const list = JSON.parse(readFileSync(join(wa, 'cocktails.json'), 'utf8'));
  return list.filter((c) => c.name && c.name.length < 26).slice(0, 6).map((c) => clean(c.name));
}

/* ------------------------------ campaigns ------------------------------ */

const WA_URL = 'https://www.winespectator.com/newsletter/whiskyadvocate';
const campaigns = {
  whiskyfest: {
    title: 'WhiskyFest New York', brand: 'wa', url: 'https://www.whiskyfest.com/',
    eyebrow: 'Whisky Advocate presents', short: 'WhiskyFest NY · Nov 20',
    lines: ['WhiskyFest New York', 'Whisky, tequila and beyond', 'Seminars by day. The Grand Tasting by night.', 'Friday, Nov 20 · New York Marriott Marquis'],
    mini: ['WhiskyFest New York', 'Whisky, tequila and beyond', 'Fri, Nov 20 · Marriott Marquis'],
    ctaShort: 'Tickets',
    cta: 'Get tickets', widget: 'countdown',
    data: { doors: '2026-11-20T18:30:00-05:00', day: '2026-11-20' },
  },
  subscribe: {
    title: 'Subscribe', brand: 'wa', url: 'https://sub.whiskyadvocate.com/pubs/M5/MAV/WAcom_subscribe_4for22_PC.jsp?cds_page_id=27430',
    eyebrow: 'Subscribe', short: 'Subscribe',
    lines: ['A year of Whisky Advocate for $22', 'Plus 2 free gifts: our tote and the Whisky Dictionary', 'Every rating. Every review. Every issue.'],
    mini: ['1 year for $22', 'Plus 2 free gifts', 'Every rating, every issue'],
    ctaShort: 'Subscribe',
    cta: 'Subscribe', widget: 'cover',
  },
  notes: {
    title: 'Whisky Notes', brand: 'wa', url: WA_URL,
    eyebrow: 'Whisky Notes · free newsletter', short: 'Whisky Notes',
    lines: ['Whisky news, in your inbox', 'New releases, ratings and events', "Free, from Whisky Advocate's editors"],
    mini: ['Whisky news, in your inbox', 'New releases, ratings, events', 'Free from our editors'],
    ctaShort: 'Sign up',
    cta: 'Sign up free', widget: 'stories', data: { stories: freshStories() },
  },
  weekend: {
    title: 'Whisky Weekend', brand: 'wa', url: WA_URL,
    eyebrow: 'Whisky Weekend newsletter', short: 'Whisky Weekend',
    lines: ['Your weekend whisky list', 'New releases, rated by our editors', 'Free, just in time for the weekend'],
    mini: ['Your weekend whisky list', 'New releases, rated', 'Free, in time for the weekend'],
    ctaShort: 'Sign up',
    cta: 'Sign up free', widget: 'ratings', data: { ratings: freshRatings() },
  },
  cocktails: {
    title: 'Cocktail Club', brand: 'wa', url: 'https://newsletters.whiskyadvocate.com/',
    eyebrow: "Whisky Advocate's Cocktail Club", short: 'Cocktail Club',
    lines: ['Better whisky cocktails at home', 'Recipes from great bars, step by step', 'Free from Whisky Advocate'],
    mini: ['Better whisky cocktails at home', 'Recipes from great bars', 'Free from Whisky Advocate'],
    ctaShort: 'Join',
    cta: 'Join free', widget: 'cocktails', data: { cocktails: freshCocktails() },
  },
  podcast: {
    title: 'The Cigar Aficionado Podcast', brand: 'ca', url: 'https://podcasts.apple.com/us/podcast/cigar-aficionado-podcast/id1896344403',
    eyebrow: 'The Cigar Aficionado Podcast', short: 'Cigar Aficionado Podcast',
    lines: ['Pull up a chair', 'The people, places and rituals of cigar culture', 'Listen on Apple Podcasts'],
    mini: ['Pull up a chair', 'The rituals of cigar culture', 'Listen on Apple Podcasts'],
    ctaShort: 'Listen',
    cta: 'Listen now', widget: 'wave',
  },
  ratingsflash: {
    title: 'Ratings Flash', brand: 'ca', url: 'https://www.winespectator.com/newsletter/cigaraficionado',
    eyebrow: "Cigar Aficionado's Ratings Flash", short: 'Ratings Flash',
    lines: ['The newest cigar ratings, first', 'Straight from our tasting room to your inbox', 'Free newsletter from Cigar Aficionado'],
    mini: ['Newest cigar ratings, first', 'From our tasting room', 'Free newsletter'],
    ctaShort: 'Sign up',
    cta: 'Sign up free', widget: 'flash',
  },
};

/* Each size: the layout, which Runway shape feeds it, the video's box inside the frame, and
   where the subject should sit inside that box (fractions), so text lands on clear ground. */
const sizes = {
  '970x250': { kind: 'billboard', shape: 'wide', box: [0, 0, 970, 250], at: [0.74, 0.5], scale: 1.5 },
  '300x600': { kind: 'halfpage', shape: 'portrait', box: [0, 0, 300, 600], at: [0.5, 0.64], scale: 1.6 },
  '300x250': { kind: 'rect', shape: 'rect', box: [0, 0, 300, 250], at: [0.7, 0.45], scale: 1.7 },
  '970x90': { kind: 'strip', shape: 'wide', box: [430, 0, 540, 90], at: [0.6, 0.5], scale: 1.6 },
  '728x90': { kind: 'strip', shape: 'wide', box: [358, 0, 370, 90], at: [0.6, 0.5], scale: 1.8 },
  '468x60': { kind: 'mini', shape: 'wide', box: [248, 0, 220, 60], at: [0.55, 0.5], scale: 2 },
  '320x50': { kind: 'mini', shape: 'wide', box: [170, 0, 150, 50], at: [0.55, 0.5], scale: 2 },
};

/* ------------------------------ assets ------------------------------ */

const sh = (cmd, a) => execFileSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const fontCache = join(root, 'node_modules/.cache/house-ads-fonts');
function fonts() {
  mkdirSync(fontCache, { recursive: true });
  const text = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]_abcdefghijklmnopqrstuvwxyz{|}’‘“”·×→–é';
  const make = (from, to, chars) => {
    if (!existsSync(join(fontCache, to))) sh('pyftsubset', [join(wa, 'fonts', from), `--text=${chars}`, '--flavor=woff2', `--output-file=${join(fontCache, to)}`, '--layout-features=kern,liga']);
  };
  make('Aeonik-Medium.ttf', 'aeonik-500.woff2', text);
  make('Aeonik-Regular.ttf', 'aeonik-400.woff2', text);
  make('jetbrains-mono.woff2', 'mono.woff2', ' #$%&\'()+,-./0123456789:;?@ABCDEFGHIJKLMNOPQRSTUVWXYZ·×→');
  return ['aeonik-500.woff2', 'aeonik-400.woff2', 'mono.woff2'];
}

/** Where the lit subject is in a still: the centroid of brightness squared, as fractions. */
async function focusOf(still) {
  const { data, info } = await sharp(still).greyscale().resize(96, 96, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const v = data[y * info.width + x] / 255, w = v * v * v;
    sx += x * w; sy += y * w; sw += w;
  }
  return sw ? [sx / sw / info.width, sy / sw / info.height] : [0.5, 0.5];
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
function encode(input, output, [W0, H0], focus, size, crf) {
  const [, , bw, bh] = size.box;
  const a = bw / bh;
  let cw = W0, ch = W0 / a;
  if (ch > H0) { ch = H0; cw = H0 * a; }
  const cx = Math.min(Math.max(focus[0] * W0 - size.at[0] * cw, 0), W0 - cw);
  const cy = Math.min(Math.max(focus[1] * H0 - size.at[1] * ch, 0), H0 - ch);
  const ow = even(bw * size.scale), oh = even(bh * size.scale);
  const frame = `crop=${even(cw)}:${even(ch)}:${Math.round(cx)}:${Math.round(cy)},scale=${ow}:${oh}:flags=lanczos,setsar=1,fps=24,eq=contrast=1.07:brightness=-0.035:saturation=1.06,curves=all='0/0 0.5/0.47 0.85/0.78 1/0.9'`;
  // The last second crossfades into the first, so the 4 second clip loops without a seam.
  const filter = `[0:v]${frame},split[a][b];[a]trim=1:5.04,setpts=PTS-STARTPTS[main];[b]trim=0:1,setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration=1:offset=3.0[v]`;
  sh('ffmpeg', ['-v', 'error', '-y', '-i', input, '-filter_complex', filter, '-map', '[v]', '-an', '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output]);
}

/* ------------------------------ page ------------------------------ */

const logo = readFileSync(join(wa, 'logo.svg'), 'utf8').replace(/<\?xml[^>]*>/, '').replace('role="img"', 'role="img" class="mark"');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(id, c, sizeName, size) {
  const [w, h] = sizeName.split('x').map(Number);
  const [bx, by, bw, bh] = size.box;
  const small = size.kind === 'mini' || size.kind === 'strip';
  const lines = small && c.mini ? c.mini : c.lines;
  const brand = c.brand === 'wa' ? logo : '<span class="mark ca">Cigar<br>Aficionado</span>';
  const ad = { id, size: sizeName, kind: size.kind, widget: c.widget, data: c.data ?? {}, lines: lines.length };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="ad.size" content="width=${w},height=${h}">
<meta name="viewport" content="width=${w},height=${h}">
<title>${esc(c.title)} ${sizeName}</title>
<script>var clickTag = "${c.url}";</script>
<style>
@font-face{font-family:A;src:url(aeonik-400.woff2) format("woff2");font-weight:400;font-display:block}
@font-face{font-family:A;src:url(aeonik-500.woff2) format("woff2");font-weight:500;font-display:block}
@font-face{font-family:M;src:url(mono.woff2) format("woff2");font-display:block}
:root{--ink:#161412;--ink2:#221d18;--cream:#f7f3ec;--muted:rgba(247,243,236,.72);--gold:#e3a443;--amber:#c9731d;--rule:rgba(247,243,236,.14)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:var(--ink)}
body{font-family:A,"Helvetica Neue",Arial,sans-serif;color:var(--cream);-webkit-font-smoothing:antialiased}
#ad{position:relative;display:block;width:${w}px;height:${h}px;overflow:hidden;color:inherit;text-decoration:none;cursor:pointer;background:var(--ink)}
#ad:after{content:"";position:absolute;inset:0;border:1px solid var(--rule);pointer-events:none;z-index:9}
.film{position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;overflow:hidden;background:#000 url(poster.jpg) center/cover}
.film video{width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .8s}
.film.on video{opacity:1}
.film:before{content:"";position:absolute;inset:0;z-index:1;pointer-events:none}
.grain{position:absolute;inset:0;z-index:2;pointer-events:none;opacity:.10;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")}
.mark{display:block;color:var(--cream);width:100%;height:auto}
.mark.ca{font:500 11px/1 M,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--cream)}
.brand{position:absolute;z-index:5}
.eyebrow{font:400 10px/1.2 M,ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lines{position:relative;z-index:5}
.lines p{position:absolute;left:0;right:0;top:0;font-weight:500;letter-spacing:-.015em;opacity:0;transform:translateY(.45em);filter:blur(3px);transition:opacity .55s ease,transform .7s cubic-bezier(.2,.7,.1,1),filter .6s}
.lines p.on{opacity:1;transform:none;filter:none}
.lines p.off{opacity:0;transform:translateY(-.3em);filter:blur(2px)}
.lines p em{font-style:normal;color:var(--gold)}
.cta{position:absolute;z-index:6;display:inline-flex;align-items:center;gap:.5em;background:var(--gold);color:var(--ink);font-weight:500;border-radius:999px;white-space:nowrap;overflow:hidden;transition:background .2s}
.cta i{font-style:normal;display:inline-block;transition:transform .25s}
#ad:hover .cta{background:#f0b65a}#ad:hover .cta i{transform:translateX(3px)}
.cta:after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg)}
.cta.shine:after{animation:shine 1.1s ease}
@keyframes shine{to{left:130%}}
.chip{position:absolute;z-index:6;background:rgba(22,20,18,.55);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid var(--rule);border-radius:12px;color:var(--cream)}
.k{font:400 9px/1 M,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.n{font:400 22px/1 M,monospace;color:var(--cream);font-variant-numeric:tabular-nums}
.count{display:flex;gap:12px;padding:10px 14px}.count div{display:grid;gap:5px;justify-items:start}
.tick{padding:10px 14px;display:grid;gap:6px}.tick b{font-weight:500;font-size:13px;line-height:1.2;display:block;transition:opacity .4s,transform .5s;max-height:2.4em;overflow:hidden}
.tick b.swap{opacity:0;transform:translateY(4px)}
.score{display:flex;align-items:center;gap:10px}.score .n{color:var(--gold)}
.wave{display:flex;align-items:center;gap:3px;height:28px;padding:0 14px}
.wave span{width:3px;border-radius:2px;background:var(--gold);height:30%;animation:wv 1.1s ease-in-out infinite alternate}
@keyframes wv{to{height:100%}}
.cover{position:absolute;z-index:6;perspective:700px}
.cover .sheet{width:100%;height:100%;background:var(--cream);border-radius:3px;box-shadow:0 18px 40px rgba(0,0,0,.55),0 2px 6px rgba(0,0,0,.4);transform:rotateY(-14deg) rotateX(4deg);transform-origin:left center;transition:transform .9s cubic-bezier(.2,.7,.1,1);overflow:hidden;display:flex;flex-direction:column}
.cover .sheet .mark{color:#17120d;padding:7% 8% 4%}
.cover .sheet .ph{flex:1;background:url(poster.jpg) 70% center/cover;margin:0 8% 8%}
.cover .sheet .k{color:#4b3f33;padding:0 8% 6%;font-size:7px}
#ad:hover .cover .sheet{transform:rotateY(-4deg) rotateX(1deg)}
.flash{position:absolute;inset:0;z-index:3;pointer-events:none;background:linear-gradient(105deg,transparent 35%,rgba(227,164,67,.22) 50%,transparent 65%);background-size:300% 100%;background-position:120% 0}
.flash.go{animation:fl 2.4s ease}
@keyframes fl{to{background-position:-60% 0}}
.price{font:500 64px/0.9 A,sans-serif;letter-spacing:-.04em;color:var(--gold)}
/* layouts */
.billboard .film:before{background:linear-gradient(90deg,var(--ink) 0,var(--ink) 26%,rgba(22,20,18,.82) 42%,rgba(22,20,18,.25) 64%,rgba(22,20,18,0) 80%),linear-gradient(0deg,rgba(22,20,18,.5),transparent 40%)}
.billboard .brand{left:30px;top:26px;width:118px}
.billboard .eyebrow{position:absolute;z-index:5;left:30px;top:84px;max-width:480px}
.billboard .lines{position:absolute;left:30px;top:104px;width:500px;height:84px}
.billboard .lines p{font-size:34px;line-height:1.08}
.billboard .cta{left:30px;bottom:24px;height:38px;padding:0 18px;font-size:15px}
.billboard .chip{right:22px;bottom:22px}
.billboard .cover{right:auto;left:556px;top:26px;width:132px;height:176px}
.halfpage .film:before{background:linear-gradient(180deg,var(--ink) 0,var(--ink) 22%,rgba(22,20,18,.7) 36%,rgba(22,20,18,0) 56%,rgba(22,20,18,0) 66%,rgba(22,20,18,.9) 92%)}
.halfpage .brand{left:24px;top:24px;width:112px}
.halfpage .eyebrow{position:absolute;z-index:5;left:24px;top:76px;right:24px}
.halfpage .lines{position:absolute;left:24px;right:20px;top:98px;height:120px}
.halfpage .lines p{font-size:28px;line-height:1.1}
.halfpage .cta{left:24px;bottom:24px;height:40px;padding:0 18px;font-size:15px}
.halfpage .chip{left:24px;right:24px;bottom:78px}
.halfpage .cover{left:150px;top:300px;width:124px;height:166px}
.rect .film:before{background:linear-gradient(180deg,rgba(22,20,18,.85) 0,rgba(22,20,18,.25) 28%,rgba(22,20,18,0) 44%,rgba(22,20,18,.72) 58%,var(--ink) 100%)}
.rect .brand{left:18px;top:16px;width:84px}
.rect .eyebrow{display:none}
.rect .lines{position:absolute;left:18px;right:16px;bottom:62px;height:56px}
.rect .lines p{top:auto;bottom:0;font-size:22px;line-height:1.1}
.rect .cta{left:18px;bottom:16px;height:32px;padding:0 14px;font-size:13px}
.rect .chip{right:12px;top:12px;border-radius:10px}
.rect .count{gap:8px;padding:7px 10px}.rect .n{font-size:16px}.rect .k{font-size:7.5px}
.rect .tick{padding:7px 10px;max-width:150px}.rect .tick b{font-size:11px}
.rect .cover{right:18px;top:28px;width:78px;height:104px}
.rect .wave{height:30px;padding:0 10px;gap:2px}
/* strips and minis are a grid row, so a long line can never run under the button */
.strip,.mini{display:grid!important;align-items:center;column-gap:${w > 900 ? 20 : 16}px;padding:0 ${w > 400 ? 16 : 8}px 0 ${w > 900 ? 22 : w > 400 ? 14 : 10}px}
.strip{grid-template-columns:auto auto minmax(0,1fr) auto auto;grid-template-rows:1fr auto auto 1fr}
.mini{grid-template-columns:auto minmax(0,1fr) auto;column-gap:${w > 400 ? 14 : 9}px}
.strip .brand,.mini .brand{position:relative;grid-row:1/-1;grid-column:1;width:${w > 900 ? 96 : w > 700 ? 80 : w > 400 ? 62 : 46}px}
.strip .rule{display:block;position:relative;z-index:5;grid-row:1/-1;grid-column:2;width:1px;height:${h - 36}px;background:var(--rule)}
.strip .eyebrow{position:relative;z-index:5;grid-column:3;grid-row:2;font-size:9px;margin-bottom:5px}
.strip .lines{grid-column:3;grid-row:3;height:${w > 900 ? 26 : 23}px}
.strip .lines p{font-size:${w > 900 ? 21 : 18}px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.strip .chip{position:relative;grid-column:4;grid-row:1/-1;border-radius:10px}
.strip .count{gap:9px;padding:7px 11px}.strip .n{font-size:17px}.strip .k{font-size:7.5px}
.strip .tick{padding:7px 11px;max-width:230px}.strip .tick b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.strip .cta,.mini .cta{position:relative;grid-row:1/-1;justify-self:end}
.strip .cta{grid-column:5;height:34px;padding:0 16px;font-size:14px}
.strip .film{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34%);mask-image:linear-gradient(90deg,transparent,#000 34%)}
.mini .film{-webkit-mask-image:linear-gradient(90deg,transparent,#000 45%);mask-image:linear-gradient(90deg,transparent,#000 45%)}
.mini .eyebrow,.mini .chip,.mini .cover,.mini .rule{display:none}
.mini .lines{grid-column:2;grid-row:1;height:${w > 400 ? 19 : 17}px}
.mini .lines p{font-size:${w > 400 ? 15 : 13}px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mini .cta{grid-column:3;height:${w > 400 ? 28 : 26}px;padding:0 ${w > 400 ? 12 : 10}px;font-size:${w > 400 ? 12 : 11.5}px}
#widget:empty{display:none}
.strip .brand.ca-brand,.mini .brand.ca-brand{width:auto}
.strip .mark.ca{font-size:${w > 900 ? 11 : 9.5}px;letter-spacing:.14em}
.mini .mark.ca{font-size:${w > 400 ? 8 : 7}px;letter-spacing:.1em;line-height:1.15}
.rect .cover .k{display:none}
.cover .k{white-space:nowrap;overflow:hidden}
@media (prefers-reduced-motion:reduce){.lines p,.tick b,.film video{transition:none!important;filter:none!important}.wave span{animation:none}}
</style></head>
<body>
<a id="ad" class="${size.kind}" href="#" aria-label="${esc(c.title)}: ${esc(c.lines[0])}. ${esc(c.cta)}.">
  <div class="film"><video muted playsinline loop preload="none" poster="poster.jpg" aria-hidden="true"></video><div class="grain"></div></div>
  ${c.widget === 'flash' ? '<div class="flash"></div>' : ''}
  <div class="brand${c.brand === 'ca' ? ' ca-brand' : ''}">${brand}</div>
  ${size.kind === 'strip' ? '<span class="rule"></span>' : ''}
  <div class="eyebrow">${esc(small ? c.short : c.eyebrow)}</div>
  <div class="lines">${lines.map((l, i) => `<p${i === 0 ? ' class="on"' : ''}>${esc(l).replace(/\$22/, '<em>$22</em>')}</p>`).join('')}</div>
  <div id="widget"></div>
  <span class="cta">${esc(size.kind === 'mini' ? c.ctaShort : c.cta)} <i>&rarr;</i></span>
</a>
<script>
(function(){
var AD=${JSON.stringify(ad)},ad=document.getElementById("ad"),film=ad.querySelector(".film"),video=film.querySelector("video");
var lines=[].slice.call(ad.querySelectorAll(".lines p")),cta=ad.querySelector(".cta"),w=document.getElementById("widget");
var still=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches,timers=[],t0=0,done=false;
ad.addEventListener("click",function(e){e.preventDefault();window.open(window.clickTag,"_blank");});
function every(fn,ms){var t=setInterval(fn,ms);timers.push(t);return t;}
function pad(n){return(n<10?"0":"")+n;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
/* the widget */
var compact=AD.kind==="rect"||AD.kind==="strip",big=AD.kind==="billboard"||AD.kind==="halfpage",swap=null;
if(AD.kind!=="mini"){
  if(AD.widget==="countdown"&&AD.kind!=="strip"||AD.widget==="countdown"&&AD.size==="970x90"){
    var doors=new Date(AD.data.doors).getTime();
    var day=function(){return new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"})).toISOString().slice(0,10);};
    var draw=function(){
      if(/[?&]static=1/.test(location.search)){ w.className="chip tick"; w.innerHTML='<span class="k">Friday, Nov 20</span><b>New York Marriott Marquis</b>'; return; }
      var ms=doors-Date.now();
      if(ms<=0||day()===AD.data.day){ w.className="chip tick"; w.innerHTML=ms>-6*36e5?'<span class="k">Tonight</span><b>Doors 6:30 PM</b>':'<span class="k">Thank you</span><b>See you next year</b>'; return; }
      var d=Math.floor(ms/864e5),h=Math.floor(ms%864e5/36e5),m=Math.floor(ms%36e5/6e4),s=Math.floor(ms%6e4/1e3);
      w.className="chip count";
      w.innerHTML='<div><span class="n">'+d+'</span><span class="k">days</span></div><div><span class="n">'+pad(h)+'</span><span class="k">hrs</span></div><div><span class="n">'+pad(m)+'</span><span class="k">min</span></div>'+(big?'<div><span class="n">'+pad(s)+'</span><span class="k">sec</span></div>':'');
    };
    draw(); every(draw,1000);
  }else if(AD.widget==="ratings"&&AD.data.ratings.length&&(AD.kind!=="strip"||AD.size==="970x90")){
    var R=AD.data.ratings,ri=0; w.className="chip tick";
    var show=function(){var r=R[ri++%R.length];w.innerHTML='<span class="k">Just rated</span><div class="score"><span class="n" data-to="'+r.score+'">80</span><b>'+esc(r.name)+'</b></div>';
      var n=w.querySelector(".n"),v=80;var c=setInterval(function(){v++;n.textContent=v;if(v>=r.score)clearInterval(c);},40);};
    show(); swap=show;
  }else if(AD.widget==="stories"&&AD.data.stories.length&&AD.kind!=="strip"&&AD.kind!=="rect"){
    var S=AD.data.stories,si=0; w.className="chip tick";
    var showS=function(){w.innerHTML='<span class="k">On the site now</span><b>'+esc(S[si++%S.length])+'</b>';}; showS(); swap=showS;
  }else if(AD.widget==="cocktails"&&AD.data.cocktails.length&&AD.kind!=="strip"){
    var C=AD.data.cocktails,ci=0; w.className="chip tick";
    var showC=function(){w.innerHTML='<span class="k">On the list</span><b>'+esc(C[ci++%C.length])+'</b>';}; showC(); swap=showC;
  }else if(AD.widget==="wave"&&AD.kind!=="strip"){
    w.className="chip wave"; var bars="";for(var i=0;i<(big?22:12);i++)bars+='<span style="animation-delay:-'+(i*137%900)/1000+'s;animation-duration:'+(0.7+(i*53%60)/100)+'s"></span>';w.innerHTML=bars;
  }else if(AD.widget==="cover"&&AD.kind!=="strip"){
    w.className="cover"; w.innerHTML='<div class="sheet">'+ad.querySelector(".brand").innerHTML+'<div class="ph"></div><span class="k">Ratings · Reviews</span></div>';
  }
}
if(w.className==="chip tick"&&AD.kind==="halfpage"){w.style.minHeight="64px";}
/* the sequence: a line every 3.2 s, the widget turns with it, everything stops by 30 s on the first line */
var li=0;
function next(){
  var prev=lines[li];li=(li+1)%lines.length;
  prev.classList.remove("on");prev.classList.add("off");setTimeout(function(){prev.classList.remove("off");},700);
  lines[li].classList.add("on");
  if(swap&&li%1===0){var b=w.querySelector("b");if(b){b.classList.add("swap");setTimeout(swap,380);}else swap();}
  if(li===0){cta.classList.remove("shine");void cta.offsetWidth;cta.classList.add("shine");var f=ad.querySelector(".flash");if(f){f.classList.remove("go");void f.offsetWidth;f.classList.add("go");}}
}
function stop(){
  if(done)return;done=true;timers.forEach(clearInterval);
  lines.forEach(function(p,i){p.classList.toggle("on",i===0);p.classList.remove("off");});
  try{video.pause();}catch(e){}
  [].forEach.call(ad.querySelectorAll(".wave span"),function(s){s.style.animationPlayState="paused";});
}
function start(){
  if(still){return;}
  t0=Date.now();
  video.src="loop.mp4";
  video.addEventListener("playing",function(){film.classList.add("on");});
  var p=video.play();if(p&&p.catch)p.catch(function(){});
  if(lines.length>1)every(next,3200);
  var f=ad.querySelector(".flash");if(f)f.classList.add("go");
  setTimeout(function(){cta.classList.add("shine");},900);
  setTimeout(stop,29500);
  if("IntersectionObserver"in window)new IntersectionObserver(function(es){es.forEach(function(e){if(done)return;if(e.isIntersecting){var q=video.play();if(q&&q.catch)q.catch(function(){});}else video.pause();});}).observe(ad);
}
/* polite load: the poster shows at once, the film loads after the page has */
if(document.readyState==="complete")setTimeout(start,250);else window.addEventListener("load",function(){setTimeout(start,250);});
})();
</script>
</body></html>
`;
}

/* ------------------------------ build ------------------------------ */

const fontFiles = fonts();
const manifest = { built: new Date().toISOString(), campaigns: {} };
const manifestPath = join(outRoot, 'manifest.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
for (const [id, c] of Object.entries(campaigns)) {
  if (only && !only.includes(id)) { if (previous?.campaigns[id]) manifest.campaigns[id] = previous.campaigns[id]; continue; }
  const entry = { title: c.title, url: c.url, brand: c.brand, sizes: {} };
  for (const [sizeName, size] of Object.entries(sizes)) {
    if (onlySize && !onlySize.includes(sizeName)) { if (previous?.campaigns[id]?.sizes[sizeName]) entry.sizes[sizeName] = previous.campaigns[id].sizes[sizeName]; continue; }
    const loopIn = join(src, `${id}-${size.shape}.mp4`);
    const stillIn = ['png', 'webp'].map((x) => join(src, `${id}-${size.shape}.${x}`)).find(existsSync);
    if (!existsSync(loopIn)) { console.warn(`  missing ${id}-${size.shape}, skipped ${sizeName}`); continue; }
    const dir = join(outRoot, id, sizeName);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const [W0, H0] = sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', loopIn]).trim().split(',').map(Number);
    const focus = await focusOf(stillIn);
    fontFiles.forEach((f) => copyFileSync(join(fontCache, f), join(dir, f)));
    writeFileSync(join(dir, 'index.html'), page(id, c, sizeName, size));
    let crf = size.kind === 'mini' ? 26 : 25, total = 0;
    for (;;) {
      encode(loopIn, join(dir, 'loop.mp4'), [W0, H0], focus, size, crf);
      sh('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, 'loop.mp4'), '-frames:v', '1', '-q:v', '5', join(dir, 'poster.jpg')]);
      total = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
      if (total <= BUDGET || crf >= 36) break;
      crf += 2;
    }
    const files = readdirSync(dir).sort();
    entry.sizes[sizeName] = { bytes: total, files, crf };
    console.log(`  ${id} ${sizeName}  ${(total / 1024).toFixed(0)} KB  crf ${crf}`);
  }
  manifest.campaigns[id] = entry;
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
