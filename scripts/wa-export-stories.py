#!/usr/bin/env python3
"""Export every published Whisky Advocate article from the CMS into the static site's
stories.json and articles/<shard>.json. Runs SQL through the Supabase management API
(the session proxy adds the credential; nothing is stored here)."""
import json, re, sys, os, html, datetime, urllib.request
from collections import Counter, defaultdict
REF = "itludqxofwurjwtbgkcl"; WEB = sys.argv[1] if len(sys.argv) > 1 else "/tmp/ga/web"
def q(sql):
    if os.environ.get("WA_EXPORT_VIA_CLI"):
        import subprocess
        out = subprocess.run(["supabase", "db", "query", "--linked", "--project-ref", REF, "-o", "json", sql], capture_output=True, text=True, check=True).stdout
        return json.loads(out[out.index("{"):])["rows"]
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=json.dumps({"query": sql}).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
def shard(slug):
    h = 0
    for ch in slug: h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return str(h % 64).zfill(2)
old = json.load(open(f"{WEB}/stories.json")); old_by = {s["slug"]: s for s in old}
ratings = json.load(open(f"{WEB}/ratings.json")); ci = ratings["cols"].index("slug") if "slug" in ratings["cols"] else None
rating_slugs = {str(r[ci]).lower() for r in ratings["rows"]} if ci is not None else set()
CACHE = os.environ.get("WA_EXPORT_CACHE", "")
if CACHE and os.path.exists(CACHE): rows = json.load(open(CACHE))
else:
    rows = []; off = 0
    while True:
        page = q(f"""select id, slug, title, byline, excerpt, body_html, metadata->'seo'->>'description' as seo, metadata->'sponsored' as sponsored, metadata->'categories' as cats, metadata->'tags' as tags, metadata->'ai_tags' as ai_tags, metadata->>'ai_summary' as ai_summary, metadata->'ai_search' as ai_search,
          metadata->'legacy_dates'->>'published_date' as d, metadata->'legacy_media'->>'thumb_file' as thumb, metadata->'legacy_media'->>'banner' as banner,
          metadata->'lead_image' as lead, (select min(i.n - 1) from jsonb_array_elements(case when jsonb_typeof(metadata->'media') = 'array' then metadata->'media' else '[]'::jsonb end) with ordinality as i(m, n) where i.m->>'is_lead' = 'true') as lead_index
          from cms_documents where brand='wa' and kind='article' and publication_state='published' and slug is not null order by id limit 120 offset {off}""")
        rows += page; off += 120; print("fetched", len(rows), file=sys.stderr)
        if len(page) < 120: break
    if CACHE: json.dump(rows, open(CACHE, "w"))
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

# Fields the old index carried that the pages read (guide kinds, travel places and regions), kept per slug, and derived for new stories.
LEGACY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "wa-story-fields.json")
LEGACY = json.load(open(LEGACY_PATH)) if os.path.exists(LEGACY_PATH) else {}
KIND_RULES = [("gear", {"Whisky Gear", "Gear", "Books", "Glassware"}), ("collecting", {"Collecting", "Auctions", "Auction"}), ("101", {"Whisky 101", "Basics", "Whisky Essentials", "Tasting Lesson", "Glossary"}), ("howto", {"How To", "DIY", "Pairings", "Food", "Food Pairing"}), ("buying", {"Buying Guide", "Reviews", "Ratings", "Gift Guide", "Gifts", "Value"}), ("list", {"Whisky List"})]
def kind_of(tags):
    bag = set(tags)
    for k, names in KIND_RULES:
        if bag & names: return k
    return "list"
REGIONS = ["Scotland", "Kentucky", "Ireland", "Japan", "Canada", "Tennessee", "England", "Wales", "India", "Australia", "Taiwan", "Texas", "New York", "Islay", "Speyside", "Highlands", "Lowlands", "Campbeltown", "Mexico", "France"]
def region_of(tags, title):
    for r in REGIONS:
        if r in tags or re.search(r"\b" + re.escape(r) + r"\b", title): return r
    return None

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
    hero = f"/api/media/{r['id']}/{r['lead_index']}?w=1600" if r.get("lead_index") is not None else (o.get("hero") or (("https://whiskyadvocate.com" + thumb) if thumb.startswith("/") else thumb))
    lead = r.get("lead") or {}
    refs = sorted({m.group(1).rstrip("/") for m in re.finditer(r'href="https?://(?:www\.)?whiskyadvocate\.com/([^"?#]+)', body) if m.group(1).rstrip("/").lower() in rating_slugs})
    d = (r["d"] or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d): d = o.get("d") or ""; missing_date += 1 if not d else 0
    ai = r.get("ai_tags") or []
    if ai: tags = list(dict.fromkeys(list(ai) + [t for t in tags if t not in ai]))[:14]
    entry = {"id": r["id"], "title": r["title"], "slug": slug, "by": r["byline"] or o.get("by") or "", "d": d, "sec": sec, "tags": tags or o.get("tags") or [], "hero": hero, "dek": dek, "min": str(max(1, round(words / 230))) if words else o.get("min"), "refs": refs or o.get("refs") or []}
    if (lead.get("caption") or "").strip(): entry["cap"] = lead["caption"].strip()
    if (lead.get("credit") or "").strip(): entry["credit"] = lead["credit"].strip()
    q = " ".join(filter(None, [r.get("ai_summary") or "", " ".join(r.get("ai_search") or [])])).strip()
    if q: entry["q"] = q
    extra = LEGACY.get(slug)
    if extra: entry.update(extra)
    # Paid content (src/lib/cms/sponsored.ts has the same rule): the editor's flag wins, else the legacy byline or tag.
    spf = r.get("sponsored")
    if isinstance(spf, str):
        try: spf = json.loads(spf)
        except Exception: spf = None
    if isinstance(spf, dict) and isinstance(spf.get("on"), bool):
        sp_on, sp_by = spf["on"], (spf.get("by") or "").strip()
    else:
        sp_on = bool(re.search(r"sponsor", r["byline"] or "", re.I)) or any(isinstance(t, str) and t.strip().lower() in ("sponsored content", "sponsored") for t in (r["tags"] or []))
        sp_by = ""
    if sp_on:
        entry["sp"] = 1
        if sp_by: entry["spBy"] = sp_by
    if sec == "guides" and "kind" not in entry: entry["kind"] = kind_of(entry["tags"])
    if sec == "travel" and "region" not in entry:
        rg = region_of(entry["tags"], entry["title"])
        if rg: entry["region"] = rg
    stories.append(entry)
    shards[shard(slug)][slug] = body
stories = [s for s in stories if s["d"]]; stories.sort(key=lambda s: s["d"], reverse=True)
os.makedirs(f"{WEB}/articles", exist_ok=True)
for k in {shard(s) for s in [str(i).zfill(2) for i in range(64)]} | set(shards): pass
for i in range(64):
    k = str(i).zfill(2); json.dump(shards.get(k, {}), open(f"{WEB}/articles/{k}.json", "w"), ensure_ascii=False)
RECENT_FROM = (datetime.date.today() - datetime.timedelta(days=640)).isoformat()
recent = [s for s in stories if s["d"] >= RECENT_FROM]; archive = [s for s in stories if s["d"] < RECENT_FROM]
json.dump(recent, open(f"{WEB}/stories.json", "w"), ensure_ascii=False)
json.dump(archive, open(f"{WEB}/stories-archive.json", "w"), ensure_ascii=False)
# The paid stories, recent and archive, so every page can label them without loading the archive.
json.dump([{"slug": s["slug"], **({"by": s["spBy"]} if s.get("spBy") else {})} for s in stories if s.get("sp")], open(f"{WEB}/sponsored.json", "w"), ensure_ascii=False)
print(json.dumps({"stories": len(stories), "recent": len(recent), "archive": len(archive), "bodies": sum(len(v) for v in shards.values()), "no_date": missing_date, "sections": Counter(s["sec"] for s in stories), "oldest": stories[-1]["d"], "newest": stories[0]["d"]}, default=dict), file=sys.stderr)
