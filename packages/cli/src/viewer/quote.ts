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

// Widen a selected quote with surrounding source text until it is unique
// within the fact (DESIGN.md §6). `occurrence` picks which of several
// identical matches the user actually selected.
export function widenQuote(source: string, quote: string, occurrence = 0): string {
  const positions = indexesOf(source, quote);
  if (positions.length <= 1) return quote;
  const pos = positions[Math.min(occurrence, positions.length - 1)]!;
  let start = pos;
  let end = pos + quote.length;
  while (start > 0 || end < source.length) {
    if (start > 0) start--;
    if (end < source.length) end++;
    const widened = source.slice(start, end);
    if (indexesOf(source, widened).length === 1) return widened;
  }
  return source;
}
