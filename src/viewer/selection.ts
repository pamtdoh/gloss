import { useEffect, useRef, useState } from "react";
import { COARSE } from "./common.js";
import { sourceSpanForSelection } from "./dom-anchor.js";

export interface Span {
  path: string;
  start: number;
  end: number;
}

const same = (a: Span | null, b: Span): boolean =>
  a !== null && a.path === b.path && a.start === b.start && a.end === b.end;

/**
 * The reader's text selection, mapped to source offsets of the fact.
 *
 * Fine pointers: `live` mirrors the native selection (it drives the
 * bubble), settled a moment after the mouse button comes up. While a
 * composer is open the selection is ignored, so its anchor holds still.
 *
 * Touch: iOS drops a selection when the page re-renders mid-gesture, and
 * native handle drags fire no pointer events — so nothing touches state
 * while a selection is live. The span is tracked in a ref and committed
 * to `pending` once the selection collapses; the bottom bar acts on it.
 */
export function useSelection(opts: {
  readRef: React.MutableRefObject<HTMLElement | null>;
  composerOpen: () => boolean;
}) {
  const [pending, setPending] = useState<Span | null>(null);
  const [live, setLive] = useState<Span | null>(null);
  const lastSpan = useRef<Span | null>(null);
  const touchActive = useRef(false);
  const lastActivity = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout>;
    const settle = (): void => {
      const sel = window.getSelection();
      const container = optsRef.current.readRef.current;
      const inside = sel && !sel.isCollapsed && container && container.contains(sel.anchorNode);
      const path = container?.getAttribute("data-fact-path") ?? null;
      const span = inside && path ? sourceSpanForSelection(container, sel) : null;
      if (!COARSE) {
        if (optsRef.current.composerOpen()) return;
        setLive((current) => (span && path ? (same(current, { path, ...span }) ? current : { path, ...span }) : null));
        return;
      }
      if (span && path) lastSpan.current = { path, ...span };
      else if (!inside && lastSpan.current) {
        const committed = lastSpan.current;
        setPending((current) => (same(current, committed) ? current : committed));
      }
    };
    const onSelection = (): void => {
      lastActivity.current = Date.now();
      clearTimeout(debounce);
      if (COARSE) debounce = setTimeout(settle, 250);
      else if (!touchActive.current) debounce = setTimeout(settle, 100);
    };
    const onDown = (): void => {
      touchActive.current = true;
    };
    const onUp = (): void => {
      touchActive.current = false;
      if (!COARSE) {
        clearTimeout(debounce);
        debounce = setTimeout(settle, 10);
      }
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      clearTimeout(debounce);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
    };
  }, []);

  /** a gesture may be under way: a finger down, or selection activity
   * in the last two seconds (handle drags fire nothing else) */
  const busy = (): boolean =>
    touchActive.current ||
    Date.now() - lastActivity.current < 2000 ||
    !(window.getSelection()?.isCollapsed ?? true);

  /** The span to anchor a new note on, best source first: the native
   * selection, the mirrored one, the committed one, the last tracked. */
  const current = (path: string): { start: number; end: number } | null => {
    const sel = window.getSelection();
    const container = optsRef.current.readRef.current;
    if (sel && !sel.isCollapsed && container && container.contains(sel.anchorNode)) {
      const span = sourceSpanForSelection(container, sel);
      if (span) return span;
    }
    if (!COARSE && live?.path === path) return live;
    if (pending?.path === path) return pending;
    if (lastSpan.current?.path === path) return lastSpan.current;
    return null;
  };

  const clear = (): void => {
    setPending(null);
    setLive(null);
    lastSpan.current = null;
  };

  return { pending, setPending, live, setLive, lastSpan, busy, current, clear };
}
