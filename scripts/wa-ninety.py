"""The 90+ Club page's data (2026-11-01): reads whiskyadvocate.com/90plus into public/wa/ninety.json.

The live page is the source of truth for who is in the club (a paid partner program): the featured film, the member
bottles (score, category, price, picture), the club's stories and the "Top-Shelf Spirits". Members are matched to the
site's ratings so "Learn More" opens our bottle page; stories to the story index.
Run:  python3 -I scripts/wa-ninety.py public/wa
"""
import html, json, re, sys, urllib.request, unicodedata

WEB = sys.argv[1] if len(sys.argv) > 1 else "public/wa"
BASE = "https://whiskyadvocate.com"
page = urllib.request.urlopen(urllib.request.Request(BASE + "/90plus", headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode("utf-8", "ignore")

def text(s): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()
def absu(u): return u if not u or u.startswith("http") else BASE + u
def norm(s):
    s = unicodedata.normalize("NFKD", html.unescape(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r",?\s*\d+(\.\d+)?\s*[%$]\s*$", "", s)          # trailing ABV
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

intro = text(re.search(r"In whisky, excellence is earned.*?</p>", page, re.S).group(0)).replace("—", ", ").replace(" ,", ",")
vid = re.search(r'cdn\.jwplayer\.com/previews/([A-Za-z0-9]+)-([A-Za-z0-9]+)', page)
vtitle = text(re.search(r"(The Glenlivet[^<]{0,80}Tasting|<h[1-4][^>]*>([^<]{6,90})</h[1-4]>\s*(?:<[^>]+>\s*)*<[^>]*jwplayer)", page).group(0)) if vid else ""
video = {"title": vtitle, "embed": f"https://cdn.jwplayer.com/players/{vid.group(1)}-{vid.group(2)}.html", "poster": f"https://cdn.jwplayer.com/v2/media/{vid.group(1)}/poster.jpg?width=1280"} if vid else None

items = []
for m in re.finditer(r'<div class="postsItem[^"]*">(.*?)<p class="postsItemLinks"(.*?)</p>', page, re.S):
    body, links = m.group(1), m.group(2)
    img = re.search(r'data-img="([^"]+)"', body)
    name = re.search(r"<h6>\s*<a[^>]*href=\"([^\"]*)\"[^>]*>(.*?)</a>", body, re.S)
    score = re.search(r'postsItemRanking">.*?<strong>(\d+)</strong>', body, re.S)
    price = re.search(r'postsItemPrice">\s*(.*?):\s*<strong>([^<]*)</strong>', body, re.S)
    shop = re.search(r'<a href="([^"]*)" class="showBuyNow"', links)
    if not name: continue
    items.append({"n": text(name.group(2)), "href": absu(name.group(1)), "s": int(score.group(1)) if score else None,
                  "c": text(price.group(1)) if price else "", "p": text(price.group(2)) if price else "",
                  "img": absu(img.group(1)) if img else "", "shop": absu(shop.group(1)) if shop and shop.group(1) else ""})

ratings = json.load(open(f"{WEB}/ratings.json")); cols = ratings["cols"]
rows = [dict(zip(cols, r)) for r in ratings["rows"]]
by_name = {}
for r in rows: by_name.setdefault(norm(r["n"]), r)
by_slug = {r["slug"].lower(): r for r in rows}
def match(it):
    old = it["href"].rsplit("/", 1)[-1].lower()
    if old in by_slug: return by_slug[old]["slug"]
    r = by_name.get(norm(it["n"]))
    return r["slug"] if r else ""

# Each item's own page on the old site: the note (the review for members, the brand's copy for spirits), issue, reviewer.
def details(it):
    try:
        pg = urllib.request.urlopen(urllib.request.Request(it["href"], headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode("utf-8", "ignore")
    except Exception:
        return
    stats = re.search(r'class="postDetailsStats">\s*<p>(.*?)</p>', pg, re.S)
    st = text(stats.group(1)) if stats else ""
    for key, field in (("Issue", "issue"), ("Reviewer", "reviewer")):
        m = re.search(key + r":\s*([^●]+)", st)
        if m: it[field] = m.group(1).strip()
    body = re.search(r'class="postDetailsContent">(.*?)</div>', pg, re.S)
    if body: it["desc"] = text(body.group(1))
    pic = re.search(r'<img class="postImg" src="([^"]+)"', pg)
    if pic and not it.get("img"): it["img"] = absu(pic.group(1))
for it in items:
    it["id"] = it["href"].rsplit("/", 1)[-1]
    details(it)

members, spirits = [], []
for it in items:
    if it["s"]:
        it["slug"] = match(it); members.append(it)
    else:
        spirits.append(it)

stories_idx = json.load(open(f"{WEB}/stories.json")) + json.load(open(f"{WEB}/stories-archive.json"))
slugs = {s["slug"].lower(): s["slug"] for s in stories_idx}
titles = {norm(s["title"]): s["slug"] for s in stories_idx}
blk = page[page.find("Shop the Members"):page.find("Top-Shelf Spirits")]
stories = []
for href, title in re.findall(r'<a[^>]+href="/([A-Za-z0-9-]+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{8,140})</', blk):
    s = slugs.get(href.lower()) or titles.get(norm(title))
    if s and s not in stories and not any(m.get("href", "").endswith("/" + href) for m in members): stories.append(s)
st_heads = re.findall(r'<h[2-4][^>]*>\s*([^<]{8,120})\s*</h[2-4]>', blk)
for t in st_heads:
    s = titles.get(norm(t))
    if s and s not in stories: stories.append(s)

out = {"source": BASE + "/90plus", "intro": intro, "video": video, "members": members, "stories": stories, "spirits": spirits,
       "spiritsIntro": text((re.search(r"Top-Shelf Spirits.*?<p[^>]*>(.*?)</p>", page, re.S) or [None, ""])[1])}
json.dump(out, open(f"{WEB}/ninety.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({"with_notes": sum(1 for x in items if x.get("desc")), "members": len(members), "matched": sum(1 for m in members if m["slug"]), "spirits": len(spirits), "stories": len(stories), "video": bool(video), "title": video and video["title"]}))
for m in members:
    if not m["slug"]: print("  unmatched:", m["n"])
