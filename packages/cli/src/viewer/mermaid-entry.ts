// Bundled separately and served at /mermaid.js; the client injects it only
// when a fact actually contains a mermaid fence.
import mermaid from "mermaid";

const styles = getComputedStyle(document.documentElement);
const token = (name: string, fallback: string): string =>
  styles.getPropertyValue(name).trim() || fallback;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  // ride the viewer's tokens so diagrams match both themes
  theme: "base",
  themeVariables: {
    background: "transparent",
    primaryColor: token("--panel-2", "#eef0f3"),
    primaryTextColor: token("--text", "#1c2024"),
    primaryBorderColor: token("--line", "#d9d9e0"),
    lineColor: token("--muted", "#60646c"),
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
  },
});

(window as unknown as { __rkMermaid: typeof mermaid }).__rkMermaid = mermaid;
document.dispatchEvent(new CustomEvent("rk-mermaid-ready"));
