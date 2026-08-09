# Touch selection has no time limit and survives the tap

iOS owns text selection: handle drags fire no pointer events and any
tap collapses the selection. So while a selection is live the app
freezes — no state commits, no polls, no auto-seen — and the span is
tracked silently. The collapse (the gesture's true end) commits it:
the text stays marked by the viewer's own highlight and a fixed bottom
bar offers Comment / Ask / dismiss. Selecting again replaces the
pending selection.
