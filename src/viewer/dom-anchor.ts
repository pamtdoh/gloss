// Map between fact-source offsets and the rendered DOM, via the
// data-s/data-e offsets the markdown renderer stamps on inline runs.

/** All offset-carrying text runs inside the rendered fact, in order. A
 * stamped element whose first child is not a text node carries no run:
 * its character offsets would be read as child indexes by Range. */
function offsetRuns(container: HTMLElement): { text: Text; s: number; e: number }[] {
  return [...container.querySelectorAll("[data-s]")]
    .map((el) => ({
      text: el.firstChild as Text | null,
      s: Number(el.getAttribute("data-s")),
      e: Number(el.getAttribute("data-e")),
    }))
    .filter(
      (r): r is { text: Text; s: number; e: number } =>
        r.text?.nodeType === Node.TEXT_NODE && Number.isFinite(r.s) && Number.isFinite(r.e),
    );
}

/** Build a DOM Range covering source offsets [start, end). Null if unmapped. */
export function rangeForSourceSpan(
  container: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const runs = offsetRuns(container).filter((r) => r.e > start && r.s < end);
  if (!runs.length) return null;
  const range = document.createRange();
  const first = runs[0]!;
  const last = runs[runs.length - 1]!;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  range.setStart(first.text, clamp(start - first.s, first.text.length));
  range.setEnd(last.text, clamp(end - last.s, last.text.length));
  return range;
}

/** The DOM point for one source offset — where something inserted "at"
 * that offset belongs. A run starting exactly there wins over the run
 * ending there, so the insertion lands at the head of the next run and
 * not inside the closing inline element of the previous. */
export function pointForSourceOffset(
  container: HTMLElement,
  at: number,
): { node: Text; offset: number } | null {
  const runs = offsetRuns(container);
  const run = runs.find((r) => r.s === at) ?? runs.find((r) => r.s <= at && at <= r.e);
  if (!run) return null;
  return { node: run.text, offset: Math.min(at - run.s, run.text.length) };
}

/** Source offsets of the current selection inside the fact. Null if unmapped. */
export function sourceSpanForSelection(
  container: HTMLElement,
  selection: Selection,
): { start: number; end: number } | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  // No common-ancestor guard: a triple-click range legally ends at the
  // START of the block after the paragraph, hoisting the common ancestor
  // above the fact container. Intersecting the container is enough — the
  // run scan below can only ever map text inside it.
  if (!range.intersectsNode(container)) return null;
  // Intersect the range with every offset-carrying run instead of mapping
  // the two endpoints. Endpoints can sit on ELEMENT nodes — triple-click,
  // drags past a block edge — where the offset is a child index, not a
  // character offset; endpoint mapping misread those as tiny spans
  // ("selected a sentence, got a word").
  let start: number | null = null;
  let end: number | null = null;
  for (const run of offsetRuns(container)) {
    const text = run.text;
    if (!range.intersectsNode(text)) continue;
    const len = text.length;
    const from = range.startContainer === text ? range.startOffset : 0;
    const to = range.endContainer === text ? range.endOffset : len;
    if (to <= from) continue;
    if (start === null || run.s + from < start) start = run.s + from;
    if (end === null || run.s + to > end) end = run.s + to;
  }
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

// ---------------------------------------------------------- highlights
// The CSS Custom Highlight API paints ranges without touching the DOM
// React owns. Both fact surfaces register named highlights through these
// two calls; where the API is missing they are no-ops.

type HighlightRegistry = Map<string, unknown>;

function registry(): HighlightRegistry | undefined {
  return (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
}

export function setHighlight(name: string, ranges: Range[]): void {
  const Highlight = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (Highlight) registry()?.set(name, new Highlight(...ranges));
}

export function clearHighlight(name: string): void {
  registry()?.delete(name);
}
