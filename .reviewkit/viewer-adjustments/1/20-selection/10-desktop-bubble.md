# On fine pointers, a bubble rides the selection

Select text with a mouse and a small Comment | Ask bubble appears just
above the selection, clamped to the viewport and re-anchored on scroll
and resize. Its buttons act on `pointerdown` with `preventDefault`, so
clicking them never collapses the selection they act on. The bubble
follows native desktop selection semantics: click elsewhere (or press
Escape) and the selection — and the bubble — are gone. While the
composer is open the painted highlight stays, marking what the comment
anchors to.
