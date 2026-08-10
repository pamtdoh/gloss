// W3C TextQuoteSelector anchoring (ARCHITECTURE.md): quote is the verbatim
// selection; optional prefix/suffix (~32 chars) disambiguate. Resolution
// tries exact matching first, then fuzzy (approx-string-match), and
// reports drift/detachment instead of ever dropping an item.
import search from "approx-string-match";

export const CONTEXT_LENGTH = 32;

export interface Anchor {
  quote: string;
  prefix?: string;
  suffix?: string;
}

export interface Resolution {
  start: number;
  end: number;
  state: "exact" | "drifted";
}

export function indexesOf(haystack: string, needle: string): number[] {
  const positions: number[] = [];
  if (!needle) return positions;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    positions.push(i);
    i += 1;
  }
  return positions;
}

/** Describe a selection at [start, end) of the source as an anchor. */
export function describeAnchor(source: string, start: number, end: number): Anchor {
  const quote = source.slice(start, end);
  const anchor: Anchor = { quote };
  if (indexesOf(source, quote).length > 1) {
    const prefix = source.slice(Math.max(0, start - CONTEXT_LENGTH), start);
    const suffix = source.slice(end, end + CONTEXT_LENGTH);
    if (prefix) anchor.prefix = prefix;
    if (suffix) anchor.suffix = suffix;
  }
  return anchor;
}

function contextScore(source: string, anchor: Anchor, position: number): number {
  let score = 0;
  if (anchor.prefix) {
    const before = source.slice(Math.max(0, position - anchor.prefix.length), position);
    score += sharedSuffix(before, anchor.prefix);
  }
  if (anchor.suffix) {
    const after = source.slice(position + anchor.quote.length);
    score += sharedPrefix(after, anchor.suffix);
  }
  return score;
}

function sharedPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function sharedSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/**
 * Locate an anchor in the source. Returns null when detached (no match, or
 * an ambiguous fuzzy match).
 */
export function resolveAnchor(source: string, anchor: Anchor): Resolution | null {
  const exact = indexesOf(source, anchor.quote);
  if (exact.length === 1) {
    return { start: exact[0]!, end: exact[0]! + anchor.quote.length, state: "exact" };
  }
  if (exact.length > 1) {
    let best = exact[0]!;
    let bestScore = -1;
    for (const position of exact) {
      const score = contextScore(source, anchor, position);
      if (score > bestScore) {
        bestScore = score;
        best = position;
      }
    }
    return { start: best, end: best + anchor.quote.length, state: "exact" };
  }
  // Fuzzy: the fact was edited. Accept only an unambiguous best match.
  const maxErrors = Math.ceil(anchor.quote.length * 0.2);
  const matches = search(source, anchor.quote, maxErrors);
  if (matches.length === 0) return null;
  const fewest = Math.min(...matches.map((m) => m.errors));
  const best = matches.filter((m) => m.errors === fewest);
  if (best.length > 1) {
    const scored = best.map((m) => contextScore(source, anchor, m.start));
    const top = Math.max(...scored);
    const winners = best.filter((_, i) => scored[i] === top);
    if (winners.length > 1) return null;
    return { start: winners[0]!.start, end: winners[0]!.end, state: "drifted" };
  }
  return { start: best[0]!.start, end: best[0]!.end, state: "drifted" };
}
