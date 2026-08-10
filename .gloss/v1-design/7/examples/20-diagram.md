# Mermaid diagrams draw themed, loaded only when needed

```mermaid
flowchart LR
  A[generate facts] --> B[human reviews]
  B --> C{notes left?}
  C -- yes --> D[copy snapshot, resolve] --> B
  C -- no --> E[approve]
```

The 3.5 MB renderer is fetched lazily the first time a diagram appears,
the SVG takes its colors from the viewer's tokens, and diagram text is
not selectable (comments anchor to the fact source, not the drawing).
