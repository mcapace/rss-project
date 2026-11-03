#!/usr/bin/env node
/**
 * public/wa/flavor.json: every live rating's flavor profile (published, and published_at empty or past) (metadata.flavor, from wa-flavor-profiles.ts)
 * in a compact form, with a 2D position from UMAP over the profiles so bottles that taste alike sit together.
 * The flavor map draws it; rating pages read a bottle's own row. Seeded, so the layout is stable between runs.
 *
 *   node --import tsx scripts/wa-export-flavor.ts [--out public/wa/flavor.json]
 *
 * Columns: slug, f (twelve axes then body and finish, one character each: 0-9 and "a" for 10), x and y (0-1000),
 * t (the note's three main flavors, joined by " · ").
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { UMAP } from "umap-js";
import { liveFilter } from "../src/lib/wa/live";
import { connectReader } from "./lib/target";

const AXES = ["smoke", "maritime", "sweet", "fresh_fruit", "dried_fruit", "tropical", "floral", "spice", "oak", "grain", "nutty", "herbal"] as const;
type Flavor = { axes: Record<string, number>; body: number; finish: number; notes: string[] };

function seeded(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const encodeFlavor = (f: Flavor) => [...AXES.map(a => f.axes?.[a] ?? 0), f.body ?? 3, f.finish ?? 3].map(n => Math.max(0, Math.min(10, Math.round(n))).toString(11)).join("");

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string", default: "public/wa/flavor.json" } }, strict: true });
  const db = connectReader();
  // Live ratings only (src/lib/wa/live.ts): a scheduled rating stays out of the public file until its time has come.
  const startedAt = Date.now();
  const rows: { slug: string; flavor: Flavor }[] = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await db.from("cms_documents").select("id,slug,flavor:metadata->flavor").eq("brand", "wa").eq("kind", "rating").eq("publication_state", "published").or(liveFilter(startedAt)).not("metadata->flavor", "is", null).gt("id", after).order("id").limit(1000);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    after = data[data.length - 1].id;
    rows.push(...(data as unknown as { slug: string; flavor: Flavor }[]).filter(r => r.slug && r.flavor?.axes));
  }
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  const vectors = rows.map(r => [...AXES.map(a => r.flavor.axes[a] ?? 0), (r.flavor.body ?? 3) * 2, (r.flavor.finish ?? 3) * 2]);
  const layout = new UMAP({ nComponents: 2, nNeighbors: 30, minDist: 0.3, random: seeded(20261102) }).fit(vectors);
  const [xs, ys] = [layout.map(p => p[0]), layout.map(p => p[1])];
  const scale = (v: number, list: number[]) => { const lo = Math.min(...list), hi = Math.max(...list); return Math.round(((v - lo) / (hi - lo || 1)) * 1000); };
  const out = {
    v: 1, axes: [...AXES, "body", "finish"], cols: ["slug", "f", "x", "y", "t"],
    rows: rows.map((r, i) => [r.slug, encodeFlavor(r.flavor), scale(xs[i], xs), scale(ys[i], ys), (r.flavor.notes ?? []).slice(0, 3).join(" · ")]),
  };
  writeFileSync(values.out!, JSON.stringify(out));
  console.log(JSON.stringify({ out: values.out, bottles: out.rows.length }));
}

if (/(?:^|[/\\])wa-export-flavor\.(?:ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
