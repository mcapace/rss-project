import type { Match } from "@/lib/wa/semantic";

/** Matches within `spread` of the best one and above `floor`; a query that matches nothing well returns little. */
export function closeMatches(matches: Match[], { floor = 0.5, spread = 0.12, limit = 24 } = {}): Match[] {
  const best = matches[0]?.similarity ?? 0;
  return matches.filter(m => m.similarity >= Math.max(floor, best - spread)).slice(0, limit);
}
