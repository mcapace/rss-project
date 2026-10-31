#!/usr/bin/env python3
"""Export every published Whisky Advocate article from the CMS into the static site's
stories.json and articles/<shard>.json. Runs SQL through the Supabase management API
(the session proxy adds the credential; nothing is stored here)."""
import json, re, sys, os, html, urllib.request
from collections import Counter, defaultdict
REF = "itludqxofwurjwtbgkcl"; WEB = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ga/web"
def q(sql):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=json.dumps({"query": sql}).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
def shard(slug):
    h = 0
    for ch in slug: h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return str(h % 64).zfill(2)
old = json.load(open(f"{WEB}/stories.json")); old_by = {s["slug"]: s for s in old}
ratings = json.load(open(f"{WEB}/ratings.json")); ci = ratings["cols"].index("slug") if "slug" in ratings["cols"] else None
rating_slugs = {str(r[ci]).lower() for r in ratings["rows"]} if ci is not None else set()
CACHE = "/tmp/ga/export/rows.json"
if os.path.exists(CACHE): rows = json.load(open(CACHE))
else:
    rows = []; off = 0
    while True:
        page = q(f"""select id, slug, title, byline, excerpt, body_html, metadata->'seo'->>'description' as seo, metadata->'categories' as cats, metadata->'tags' as tags,
          metadata->'legacy_dates'->>'published_date' as d, metadata->'legacy_media'->>'thumb_file' as thumb, metadata->'legacy_media'->>'banner' as banner
          from cms_documents where brand='wa' and kind='article' and publication_state='published' and slug is not null order by id limit 120 offset {off}""")
        rows += page; off += 120; print("fetched", len(rows), file=sys.stderr)
        if len(page) < 120: break
    json.dump(rows, open(CACHE, "w"))
# Section from the tags, the way the site already files its stories.
TAGSETS = [("cocktails", {"Cocktails", "Cocktail", "Recipe", "Recipes", "Old Fashioned", "Highball", "Manhattan", "Hot Toddy", "Punch"}),
           ("travel", {"Travel", "Bars", "Where To", "whisky bars", "Dispatches", "Distillery Tours", "Bar", "Restaurants"}),
           ("guides", {"Whisky List", "How To", "Collecting", "Reviews", "Buying Guide", "Auctions", "Ratings", "Whisky 101", "Glossary", "Whisky Gear", "Gear", "Gift Guide", "Gifts", "Value"}),
           ("news", {"New Releases", "News", "Industry", "Whisky News and Spirit Updates", "Trending", "Whisky Watch"}),
           ("features", {"Insights", "Features", "Magazine", "Profiles", "Interviews", "History"}),
           ("life", {"Whisky Life", "Pairings", "Food", "Sports", "Movies", "Music"})]
def section(tags, cats, title, words):
    bag = set(tags) | set(cats); t = title.lower()
    if re.search(r"cocktail|recipe|highball|old fashioned|manhattan|toddy|sour\b|punch\b", t) or bag & TAGSETS[0][1]: return "cocktails"
    if bag & TAGSETS[1][1] or re.search(r"\bbars?\b|travel|distillery tour|where to drink|guide to [A-Z]", title): return "travel"
    if bag & TAGSETS[2][1] or re.search(r"^\d+ |how to|guide|best .* under|auction|collect", t): return "guides"
    if bag & TAGSETS[3][1] or "New Releases" in bag: return "news"
    if bag & TAGSETS[4][1] and words >= 1100: return "features"
    if bag & TAGSETS[5][1]: return "life"
    return "news"
def text(h): return html.unescape(re.sub(r"<[^>]+>", " ", h or "")).strip()
stories = []; shards = defaultdict(dict); missing_date = 0
for r in rows:
    slug = r["slug"]; o = old_by.get(slug) or {}
    cats = r["cats"] or []; tags = [t for t in (r["tags"] or []) if t not in cats and not re.fullmatch(r"[a-z0-9_]+", t)]
    body = r["body_html"] or ""
    words = len(text(body).split())
    sec = o.get("sec") or section(r["tags"] or [], cats, r["title"] or "", words)
    first = text(next(iter(re.findall(r"<p[^>]*>(.*?)</p>", body, re.S)), ""))
    dek = (r["seo"] or r["excerpt"] or o.get("dek") or first)[:320].strip()
    thumb = r["thumb"] or r["banner"] or ""
    hero = o.get("hero") or (("https://whiskyadvocate.com" + thumb) if thumb.startswith("/") else thumb)
    refs = sorted({m.group(1).rstrip("/") for m in re.finditer(r'href="https?://(?:www\.)?whiskyadvocate\.com/([^"?#]+)', body) if m.group(1).rstrip("/").lower() in rating_slugs})
    d = (r["d"] or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d): d = o.get("d") or ""; missing_date += 1 if not d else 0
    stories.append({"id": r["id"], "title": r["title"], "slug": slug, "by": r["byline"] or o.get("by") or "", "d": d, "sec": sec, "tags": tags or o.get("tags") or [], "hero": hero, "dek": dek, "min": str(max(1, round(words / 230))) if words else o.get("min"), "refs": refs or o.get("refs") or []})
    shards[shard(slug)][slug] = body
stories = [s for s in stories if s["d"]]; stories.sort(key=lambda s: s["d"], reverse=True)
os.makedirs(f"{WEB}/articles", exist_ok=True)
for k in {shard(s) for s in [str(i).zfill(2) for i in range(64)]} | set(shards): pass
for i in range(64):
    k = str(i).zfill(2); json.dump(shards.get(k, {}), open(f"{WEB}/articles/{k}.json", "w"), ensure_ascii=False)
json.dump(stories, open(f"{WEB}/stories.json", "w"), ensure_ascii=False)
print(json.dumps({"stories": len(stories), "bodies": sum(len(v) for v in shards.values()), "no_date": missing_date, "sections": Counter(s["sec"] for s in stories), "oldest": stories[-1]["d"], "newest": stories[0]["d"]}, default=dict), file=sys.stderr)
