# The URL names the page, so the browser's back button works

The hash is the current page — `#flows/checkout.md` for a fact,
`#flows/` for a directory. Every navigation (tree click, j/k, palette
jump, page links) pushes a history entry, so back/forward walk the
pages you actually visited. A reload or a shared link restores the
place, and switching snapshots keeps it: the hash is re-resolved
against the new snapshot's facts and only falls back to the first row
when the path no longer exists. No server routes were added — the hash
keeps the page self-contained.
