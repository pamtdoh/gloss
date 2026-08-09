# On fine pointers, the bubble is instant and the browser owns the highlight

Rebuilt against production prior art (Hypothesis's adder, medium-editor,
Plate's floating toolbar, tiptap's bubble menu — sources read, not
guessed). The pattern all four share, now ReviewKit's:

- **Gate on the mouse, don't debounce.** Nothing shows mid-drag; the
  bubble appears ~10ms after mouseup (Hypothesis's constant). The old
  500ms wait was the sluggishness. Keyboard selections settle on a
  100ms trailing debounce.
- **No painted highlight while the native selection is live** — the
  blue selection *is* the highlight; the round-2 "css highlight" tint
  is gone from desktop. `::highlight(rk-pending)` paints only when the
  composer opens and the native selection is free to collapse (Plate's
  draft-mark handoff). Touch still paints throughout — iOS collapses
  on any tap.
- Buttons act on `pointerdown` + `preventDefault`, so acting never
  collapses the selection; outside click and Escape dismiss for free.

Under it, the round-1 fix stands: `{__html}` objects are pinned so
re-renders never rewrite the fact's DOM (React 19 diffs raw-HTML by
object identity) — the selection survives indefinitely.
