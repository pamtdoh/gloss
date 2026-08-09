// Bundled separately and served at /mermaid.js; the client injects it only
// when a fact actually contains a mermaid fence.
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  theme: "neutral",
});

(window as unknown as { __rkMermaid: typeof mermaid }).__rkMermaid = mermaid;
document.dispatchEvent(new CustomEvent("rk-mermaid-ready"));
