# The review panel: one decision control, one card per item

Decisions are a radix ToggleGroup (not-needed / simplify / defer, keys
1–3, same value clears; disabled when nothing is targeted). Each item is
a card with a type-colored edge, Markdown-rendered text, a kebab menu
(radix DropdownMenu) for edit and delete, Reply on question threads, and
drifted/detached states — detached cards carry a re-anchor action fed by
the last selection. Hovering or focusing a card highlights its quote in
the fact. The panel collapses to a badge rail.
