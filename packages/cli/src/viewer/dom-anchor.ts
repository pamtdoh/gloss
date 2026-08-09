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
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const toSource = (node: Node, offset: number): number | null => {
    let el: Element | null = node instanceof Element ? node : node.parentElement;
    while (el && el !== container && !el.hasAttribute("data-s")) el = el.parentElement;
    if (!el || el === container) return null;
    return Number(el.getAttribute("data-s")) + offset;
  };
  const start = toSource(range.startContainer, range.startOffset);
  const end = toSource(range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}
