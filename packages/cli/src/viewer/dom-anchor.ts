// Map between fact-source offsets and the rendered DOM, via the
// data-s/data-e offsets the markdown renderer stamps on inline runs.

/** All offset-carrying elements inside the rendered fact, in order. */
function offsetRuns(container: HTMLElement): { el: Element; s: number; e: number }[] {
  return [...container.querySelectorAll("[data-s]")]
    .map((el) => ({
      el,
      s: Number(el.getAttribute("data-s")),
      e: Number(el.getAttribute("data-e")),
    }))
    .filter((r) => Number.isFinite(r.s) && Number.isFinite(r.e));
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
  const firstText = first.el.firstChild;
  const lastText = last.el.firstChild;
  if (!firstText || !lastText) return null;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, max));
  range.setStart(firstText, clamp(start - first.s, firstText.textContent?.length ?? 0));
  range.setEnd(lastText, clamp(end - last.s, lastText.textContent?.length ?? 0));
  return range;
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
    const text = run.el.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE || !range.intersectsNode(text)) continue;
    const len = text.textContent?.length ?? 0;
    const from = range.startContainer === text ? range.startOffset : 0;
    const to = range.endContainer === text ? range.endOffset : len;
    if (to <= from) continue;
    if (start === null || run.s + from < start) start = run.s + from;
    if (end === null || run.s + to > end) end = run.s + to;
  }
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}
