# The reading pane renders rich Markdown at a 72ch centred measure

GFM tables scroll inside their own containers, fenced code and
in-snapshot images render inline, and Mermaid diagrams draw themed from
the token layer, loading their 3.5 MB renderer only when a diagram
exists. Anchored items paint via the CSS Custom Highlight API with
per-type underline styles as a non-color cue. Selecting text raises a
small popover (Annotate / Ask) at the selection; `a`/`q` do the same
from the keyboard.
