import uFuzzy from "@leeoniya/ufuzzy";

export interface SearchDoc {
  path: string;
  title: string;
  body: string;
}

const uf = new uFuzzy({ intraMode: 1 });

/** Fuzzy search over facts; returns paths ranked, best first. */
export function searchFacts(docs: SearchDoc[], query: string, limit = 8): string[] {
  const q = query.trim();
  if (!q) return docs.slice(0, limit).map((d) => d.path);
  const haystack = docs.map((d) => `${d.title} ${d.path} ${d.body}`);
  const [idxs, info, order] = uf.search(haystack, q);
  if (!idxs || idxs.length === 0) {
    // fall back to all-words substring matching
    const words = q.toLowerCase().split(/\s+/);
    return docs
      .filter((d) => {
        const text = `${d.title} ${d.path} ${d.body}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .slice(0, limit)
      .map((d) => d.path);
  }
  const ranked = order && info ? order.map((o) => idxs[info.idx.indexOf(info.idx[o]!)]!) : idxs;
  return [...new Set(ranked)].slice(0, limit).map((i) => docs[i]!.path);
}
