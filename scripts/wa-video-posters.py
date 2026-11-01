"""Sharper video posters for the WA site (2026-11-01).

videos.json carried YouTube's 480x360 hqdefault (a letterboxed 480x270 picture) and JW Player posters at 640px,
shown on cards up to 1,300px wide. This upgrades each poster in place to the largest image that exists:
YouTube maxresdefault (1280x720), else sddefault (640x480), else hqdefault; JW posters at width=1280.
Rerun after videos are added:  python3 -I scripts/wa-video-posters.py public/wa
"""
import json, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

WEB = sys.argv[1] if len(sys.argv) > 1 else "public/wa"
path = f"{WEB}/videos.json"
videos = json.load(open(path))

def exists(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET", headers={"User-Agent": "wa-posters"}), timeout=15) as r:
            return r.status == 200 and int(r.headers.get("Content-Length") or 99999) > 2000
    except Exception:
        return False

def best(v):
    p = v.get("poster") or ""
    m = re.match(r"https://i\.ytimg\.com/vi/([\w-]+)/", p)
    if m:
        for name in ("maxresdefault", "sddefault"):
            u = f"https://i.ytimg.com/vi/{m.group(1)}/{name}.jpg"
            if exists(u): return u
        return f"https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg"
    if "cdn.jwplayer.com/v2/media/" in p:
        return re.sub(r"([?&])width=\d+", r"\1width=1280", p) if "width=" in p else p + ("&" if "?" in p else "?") + "width=1280"
    return p

with ThreadPoolExecutor(12) as ex:
    upgraded = list(ex.map(best, videos))
changed = 0
for v, u in zip(videos, upgraded):
    if u and u != v.get("poster"): v["poster"] = u; changed += 1
json.dump(videos, open(path, "w"), ensure_ascii=False, separators=(",", ":"))
kinds = {}
for v in videos:
    k = re.sub(r".*/(maxresdefault|sddefault|hqdefault)\.jpg.*", r"yt \1", v.get("poster") or "")
    k = "jw 1280" if "jwplayer" in k else k if k.startswith("yt ") else "other"
    kinds[k] = kinds.get(k, 0) + 1
print(json.dumps({"videos": len(videos), "changed": changed, "posters": kinds}))
