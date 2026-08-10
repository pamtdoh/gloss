# On fine pointers, a bubble rides the selection

Select text with a mouse and a small Comment | Ask bubble appears just
above the selection, clamped to the viewport and re-anchored on scroll
and resize. Its buttons act on `pointerdown` with `preventDefault`, so
clicking them never collapses the selection they act on. The bubble
follows native desktop selection semantics: click elsewhere (or press
Escape) and the selection — and the bubble — are gone. While the
composer is open the painted highlight stays, marking what the comment
anchors to.

The selection itself is now guaranteed to survive: React 19 diffs
raw-HTML islands by *object* identity, so any re-render used to
rewrite the fact's DOM byte-for-byte and the browser dropped the live
selection half a second after mouse-up (the round-1 bug report). The
viewer pins those `{__html}` objects, making re-renders inert — the
same root cause the mermaid cache once worked around.
