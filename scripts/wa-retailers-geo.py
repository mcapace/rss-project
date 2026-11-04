"""Where to buy, store coordinates (2026-11-04): adds lat/lng to every store in public/wa/retailers.json for the map.

US cities come from the Census Bureau's 2023 gazetteers (incorporated places first, then towns and townships); the rest
(neighborhoods such as Brooklyn or Canoga Park, and the stores outside the US) from OpenStreetMap's Nominatim, one
request a second, kept in scripts/data/retailers-geo.json so a rerun only looks up cities it has not seen.
Run:  python3 -I scripts/wa-retailers-geo.py public/wa
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request, zipfile

WEB = sys.argv[1] if len(sys.argv) > 1 else "public/wa"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "retailers-geo.json")
GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_{}_national.zip"
LSAD = re.compile(r"\s+(city and borough|consolidated government|metropolitan government|unified government|urban county|municipality|city|town|village|borough|township|charter township|plantation|CDP|comunidad|zona urbana|\(balance\))+$", re.I)
FIX = {"Rumsford, RI": "Rumford, Rhode Island", "Westboro, MA": "Westborough, MA", "Utr, Netherlands": "Utrecht, Netherlands"}  # misspellings in the store list
UA = {"User-Agent": "WhiskyAdvocate-retailer-map/1.0 (whiskyadvocate.com)"}

def key(name, st): return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("saint ", "st ").replace("st. ", "st ")).strip() + "|" + st

def gazetteer(kind):
    raw = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(GAZ.format(kind), timeout=60).read()))
    rows = raw.read(raw.namelist()[0]).decode("latin-1").splitlines()
    head = [h.strip() for h in rows[0].split("\t")]
    out = {}
    for line in rows[1:]:
        r = dict(zip(head, [c.strip() for c in line.split("\t")]))
        k = key(LSAD.sub("", r["NAME"]), r["USPS"])
        land = float(r["ALAND"] or 0)
        if k not in out or land > out[k][2]: out[k] = (round(float(r["INTPTLAT"]), 5), round(float(r["INTPTLONG"]), 5), land)
    return out

def nominatim(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})
    time.sleep(1.1)
    hit = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read())
    return [round(float(hit[0]["lat"]), 5), round(float(hit[0]["lon"]), 5)] if hit else None

data = json.load(open(os.path.join(WEB, "retailers.json")))
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
places, towns = gazetteer("place"), gazetteer("cousubs")
missing = []
for s in data:
    us = s["state"].endswith(", US")
    country = s["state"].replace(", US", "") if not us else "USA"
    for x in s["stores"]:
        city = x["city"].strip()
        fixed = FIX.get(city)
        m = re.match(r"^(.*?),\s*([A-Z]{2})$", city)
        ll = None
        if us and m and not fixed:
            k = key(m.group(1), m.group(2))
            hit = places.get(k) or towns.get(k)
            if hit: ll = [hit[0], hit[1]]
        if not ll:
            q = fixed or (city if us else (city if country.lower() in city.lower() else f"{city}, {country}"))
            if q not in cache:
                try: cache[q] = nominatim(q)
                except Exception as e: print("lookup failed:", q, e); cache[q] = None
            ll = cache[q]
        if ll: x["lat"], x["lng"] = ll
        else: x.pop("lat", None); x.pop("lng", None); missing.append(city)

os.makedirs(os.path.dirname(CACHE), exist_ok=True)
json.dump(cache, open(CACHE, "w"), indent=1, sort_keys=True)
json.dump(data, open(os.path.join(WEB, "retailers.json"), "w"), separators=(",", ":"), ensure_ascii=False)
n = sum(len(s["stores"]) for s in data)
print(f"{n - len(missing)} of {n} stores placed; no match for: {sorted(set(missing))}")
