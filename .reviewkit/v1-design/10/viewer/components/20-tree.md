# The fact tree is hand-rolled: nested, filtered, keyboard-first

Directories nest with expand/collapse carets and roll up question/item
counts; facts carry change badges, decision chips (hollow when stale),
seen checks, and bold-when-unread. A visible filter input (`f`) narrows
by path, fact text, and item text, with a match count. The cursor row
follows j/k with scroll-into-view and an accent rail; rows are ARIA
treeitems with roving tabindex. No radix tree primitive exists, so this
stays ours. The reading pane ends with blog-style Previous/Next links
so the whole tree walks like a book, keyboard or not.
