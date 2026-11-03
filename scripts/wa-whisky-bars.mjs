#!/usr/bin/env node
/* Builds public/wa/whisky-bars.json for the America's Top Whisky Bars page (public/wa/whisky-bars.html).
   Source: the editors' Google Sheet behind whiskybars.whiskyadvocate.com (Name, Address, Coordinates, State, Website,
   Description, Whisky List). Bars and state outlines are projected here with an Albers USA projection into a
   975 x 610 box, so the page draws the map as plain SVG with no map service.
   Run: node scripts/wa-whisky-bars.mjs */
import { writeFileSync } from "node:fs";
import { geoAlbersUsa, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const SHEET = "https://docs.google.com/spreadsheets/d/1mRQOw07ofPAK-Vwak0MGcT2qjnEgWZjNB9w6gW_1B0w/gviz/tq?tqx=out:csv";
const ATLAS = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const W = 975, H = 610;

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const slug = (s) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const url = (s) => { s = (s || "").trim(); if (!s) return ""; return /^https?:\/\//i.test(s) ? s : "https://" + s.replace(/^\/+/, ""); };
const r1 = (n) => Math.round(n * 10) / 10;

const [csv, atlas] = await Promise.all([
  fetch(SHEET).then((r) => { if (!r.ok) throw new Error("sheet " + r.status); return r.text(); }),
  fetch(ATLAS).then((r) => { if (!r.ok) throw new Error("atlas " + r.status); return r.json(); }),
]);

const states = feature(atlas, atlas.objects.states);
const proj = geoAlbersUsa().fitExtent([[8, 8], [W - 8, H - 8]], states);
const pr = states.features.find((f) => f.properties.name === "Puerto Rico");
const prProj = geoMercator().fitExtent([[838, 548], [930, 586]], pr);

/* Drops points closer than 0.9px to the last kept one; the full-detail outlines are about ten times larger. */
function thin(projection) {
  return { stream(out) {
    let px = NaN, py = NaN, n = 0, lx, ly;
    const s = projection.stream({
      point(x, y) { lx = x; ly = y; if (n++ === 0 || Math.hypot(x - px, y - py) >= 0.9) { out.point(x, y); px = x; py = y; lx = NaN; } },
      lineStart() { n = 0; out.lineStart(); }, lineEnd() { if (lx === lx) out.point(lx, ly); out.lineEnd(); },
      polygonStart() { out.polygonStart(); }, polygonEnd() { out.polygonEnd(); }, sphere() { out.sphere && out.sphere(); },
    });
    return s;
  } };
}
const path = geoPath(thin(proj)).digits(1);
const prPath = geoPath(thin(prProj)).digits(1);
const place = (lng, lat, state) => (state === "Puerto Rico" ? prProj([lng, lat]) : proj([lng, lat]));

const rows = parseCsv(csv);
const head = rows[0].map((h) => h.trim().toLowerCase());
const col = (name) => head.indexOf(name);
const C = { name: col("name"), addr: col("address"), coord: col("coordinates"), state: col("state"), web: col("website"), desc: col("description"), list: col("whisky list") };

const seen = new Set();
const bars = [];
rows.slice(1).forEach((r, i) => {
  const name = (r[C.name] || "").replace(/^[\s*]+/, "").trim(); if (!name) return;
  const addr = (r[C.addr] || "").trim();
  const state = (r[C.state] || "").trim();
  const [lat, lng] = (r[C.coord] || "").split(",").map((x) => parseFloat(x));
  const parts = addr.split(",").map((x) => x.trim()).filter(Boolean);
  const code = parts.length ? (parts[parts.length - 1].replace(/\./g, "").match(/^[A-Z]{2}\b/) || [""])[0] : "";
  const st = code || (state === "Puerto Rico" ? "PR" : state === "District of Columbia" ? "DC" : "");
  let city = st === "DC" ? "Washington" : code ? (parts.length >= 2 ? parts[parts.length - 2] : "") : parts[parts.length - 1] || "";
  /* "2115 San Pablo Ave. Berkeley, CA": no comma between the street and the city. */
  if (/\d/.test(city)) city = city.replace(/^.*?\b(?:St|Ave|Street|Avenue|Rd|Road|Blvd|Dr|Way|Pl)\.?\s+/i, "");
  const xy = Number.isFinite(lat) && Number.isFinite(lng) ? place(lng, lat, state) : null;
  let s = slug(name); if (seen.has(s)) s += "-" + slug(city || st); seen.add(s);
  bars.push({
    id: i + 1, slug: s, name, addr, city, st, state,
    lat: Number.isFinite(lat) ? +lat.toFixed(5) : null, lng: Number.isFinite(lng) ? +lng.toFixed(5) : null,
    x: xy ? r1(xy[0]) : null, y: xy ? r1(xy[1]) : null,
    web: url(r[C.web]), desc: (r[C.desc] || "").trim(), list: url(r[C.list]),
  });
});

const used = new Set(bars.map((b) => b.state));
const out = {
  title: "America's Top Whisky Bars", edition: 2026, updated: new Date().toISOString().slice(0, 10),
  box: [W, H],
  states: states.features.map((f) => {
    const p = f === pr ? prPath : path;
    return { name: f.properties.name, d: p(f), box: p.bounds(f).flat().map(r1), bars: used.has(f.properties.name) };
  }).filter((s) => s.d),
  bars,
};
writeFileSync(new URL("../public/wa/whisky-bars.json", import.meta.url), JSON.stringify(out));
const missing = bars.filter((b) => b.x == null).map((b) => b.name);
console.log(`${bars.length} bars in ${used.size} states${missing.length ? "; not placed: " + missing.join(", ") : ""}`);
