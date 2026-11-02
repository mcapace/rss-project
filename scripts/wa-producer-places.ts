#!/usr/bin/env node
/**
 * public/wa/globe.json for the distillery globe: where each producer with three or more ratings makes its whisky
 * (the distillery, or the home of a blender or bottler), placed by a model from the producer's name and bottles and
 * kept only when it is sure of the place; plus a dotted landmass (Natural Earth 110m, from world-atlas) to draw
 * the continents with. Resumable: producers already placed in the existing file are kept.
 *
 *   node --import tsx scripts/wa-producer-places.ts [--limit 700]
 *
 * Needs ANTHROPIC_API_KEY. Reads public/wa/ratings.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

const OUT = "public/wa/globe.json";
const MODEL = process.env.WA_PLACES_MODEL || "claude-sonnet-5-5";
type Place = { n: string; kind: string; place: string; country: string; lat: number; lon: number };
type Producer = { n: string; count: number; avg: number; cats: string[]; bottles: string[] };

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["places"],
  properties: { places: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "kind", "place", "country", "lat", "lon", "confidence"], properties: {
    name: { type: "string" }, kind: { type: "string", enum: ["distillery", "blender", "bottler", "brand"] },
    place: { type: "string", description: "Town and region, e.g. 'Port Ellen, Islay' or 'Bardstown, Kentucky'." }, country: { type: "string" },
    lat: { type: "number" }, lon: { type: "number" }, confidence: { type: "string", enum: ["high", "medium", "low"] },
  } } } },
};
const SYSTEM = `You place whisky producers on a map. For each producer give where its whisky is made: the distillery's town for a distillery; the company's home town for a blender, independent bottler or a brand without its own distillery. Coordinates in decimal degrees for that town. confidence: high when you know the location for certain, medium when you know the town or region but not precisely, low when you are guessing. Never invent a town; say low instead. Return only the JSON asked for.`;

function producers(): Producer[] {
  const r = JSON.parse(readFileSync("public/wa/ratings.json", "utf8")) as { cols: string[]; rows: unknown[][] };
  const c = (k: string) => r.cols.indexOf(k);
  type Tally = { scores: number[]; cats: Map<string, number>; bottles: string[] };
  const by = new Map<string, Tally>();
  for (const row of r.rows) {
    const n = String(row[c("pr")] || ""); if (!n || n === "Unknown producer") continue;
    const e: Tally = by.get(n) ?? { scores: [], cats: new Map(), bottles: [] };
    e.scores.push(Number(row[c("s")]) || 0); e.cats.set(String(row[c("c")]), (e.cats.get(String(row[c("c")])) ?? 0) + 1);
    if (e.bottles.length < 3) e.bottles.push(String(row[c("n")]));
    by.set(n, e);
  }
  return [...by].filter(([, e]) => e.scores.length >= 3).map(([n, e]) => ({ n, count: e.scores.length, avg: Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 10) / 10, cats: [...e.cats].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]), bottles: e.bottles }))
    .sort((a, b) => b.count - a.count);
}

/** Dots on land, spaced roughly evenly over the sphere: rows every `gap` degrees of latitude, wider in longitude toward the poles. */
function landDots(gap: number, box: [number, number, number, number], scale: number): number[] {
  const require = createRequire(import.meta.url);
  const topo = require("world-atlas/land-50m.json") as Topology<{ land: GeometryCollection }>;
  const land = feature(topo, topo.objects.land);
  const [south, west, north, east] = box, out: number[] = [];
  for (let lat = south; lat <= north; lat += gap) {
    const step = gap / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    for (let lon = west; lon < east; lon += step) if (geoContains(land, [lon, lat])) out.push(Math.round(lat * scale), Math.round(lon * scale));
  }
  return out;
}

/** Whisky country gets finer dots for close zoom: the British Isles, Kentucky and Tennessee, Japan. [south, west, north, east] */
const PATCHES: [number, number, number, number][] = [[49.8, -11, 61, 2], [34.5, -90.5, 39.5, -81.5], [30.5, 129, 45.8, 146]];

/** One name per country: "USA" becomes United States, and the United Kingdom splits into its nations. */
function country(p: { country: string; place: string; lat: number }): string {
  if (/^(usa|us|u\.s\.a?\.?|united states of america)$/i.test(p.country)) return "United States";
  if (!/^(uk|united kingdom|great britain|britain)$/i.test(p.country)) return p.country;
  if (/county (down|antrim|armagh|londonderry|derry|tyrone|fermanagh)|belfast/i.test(p.place)) return "Northern Ireland";
  if (/wales|powys|gwynedd|brecon|cardiff/i.test(p.place)) return "Wales";
  return p.lat >= 54.9 ? "Scotland" : "England";
}

async function main() {
  const { values } = parseArgs({ options: { limit: { type: "string", default: "700" } }, strict: true });
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY.");
  const all = producers().slice(0, Number(values.limit) || 700);
  const old = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as { places?: Place[]; skipped?: string[] }) : {};
  const placed = new Map((old.places ?? []).map(p => [p.n, p])), skipped = new Set(old.skipped ?? []);
  const todo = all.filter(p => !placed.has(p.n) && !skipped.has(p.n));
  const anthropic = new Anthropic({ maxRetries: 4 });
  for (let i = 0; i < todo.length; i += 30) {
    const batch = todo.slice(i, i + 30);
    const message = await anthropic.messages.create({
      model: MODEL, max_tokens: 8000, system: SYSTEM,
      messages: [{ role: "user", content: batch.map(p => `${p.n} | ${p.cats.join(", ")} | e.g. ${p.bottles.join("; ")}`).join("\n") }],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    if (message.stop_reason === "max_tokens") throw new Error("answer ran past max_tokens");
    const out = JSON.parse(message.content.map(c => (c.type === "text" ? c.text : "")).join("")) as { places: (Place & { name: string; confidence: string })[] };
    const names = new Set(batch.map(p => p.n));
    for (const p of out.places) {
      if (!names.has(p.name)) continue;
      const ok = p.confidence !== "low" && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.lat || p.lon);
      if (ok) placed.set(p.name, { n: p.name, kind: p.kind, place: p.place, country: p.country, lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 });
      else skipped.add(p.name);
    }
    for (const p of batch) if (!placed.has(p.n)) skipped.add(p.n);
    console.error(`placed ${placed.size}, skipped ${skipped.size}, ${Math.min(i + 30, todo.length)}/${todo.length}`);
  }
  const stats = new Map(all.map(p => [p.n, p]));
  const places = [...placed.values()].filter(p => stats.has(p.n)).map(p => ({ ...p, country: country(p), count: stats.get(p.n)!.count, avg: stats.get(p.n)!.avg })).sort((a, b) => b.count - a.count);
  writeFileSync(OUT, JSON.stringify({ v: 1, land: landDots(0.9, [-56, -180, 78, 180], 10), patches: PATCHES, detail: PATCHES.flatMap(box => landDots(0.3, box, 100)), places, skipped: [...skipped].sort() }));
  console.log(JSON.stringify({ out: OUT, places: places.length, skipped: skipped.size }));
}

if (/(?:^|[/\\])wa-producer-places\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
