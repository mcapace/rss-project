/** Reciprocal rank fusion: blend ranked lists (lexical, semantic) into one order. */
export function reciprocalRankFusion<T>(lists: { items: T[]; weight?: number }[], key: (item: T) => string, k = 60): { item: T; score: number; sources: number }[] {
  const scores = new Map<string, { item: T; score: number; sources: number }>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.items.forEach((item, index) => {
      const id = key(item);
      const current = scores.get(id) ?? { item, score: 0, sources: 0 };
      current.score += weight / (k + index + 1);
      current.sources += 1;
      scores.set(id, current);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}
