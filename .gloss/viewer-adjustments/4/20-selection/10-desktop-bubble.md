# The bubble is a pure mirror of the native selection

Rebuilt on the prior art (Hypothesis's adder, medium-editor, Plate,
tiptap): instant after mouseup, nothing mid-drag, and the browser's
own blue selection is the only highlight while selecting.

Round 3 (owner: still buggy — wrong span, lingering tint, dead clicks)
ended in a restructure, not another patch. On fine pointers there is
no captured-selection state at all while you select: the bubble is
derived from the live native selection and vanishes with it. The
draft anchor — and its painted highlight — comes into existence only
at the moment Comment/Ask is pressed, and while the composer is open
all selection churn is ignored, so the anchor can never move under
the composer.

The wrong-span bug was in offset mapping: a selection endpoint can sit
on an *element* node (triple-click, drags past a block edge) where the
browser's offset is a child index, not a character offset — mapped
naively, a sentence shrank to a word. Spans are now computed by
intersecting the selection range with every offset-carrying run, which
handles any endpoint shape; a triple-click regression test pins it.
Dead clicks are gone with the stale state that caused them, and the
whole bubble surface swallows `pointerdown` so no press on it can
collapse the selection it acts on. Stress-checked: 8/8 rapid
select-and-comment cycles, zero tint frames while selecting.
