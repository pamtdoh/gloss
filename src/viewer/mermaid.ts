// Shared Mermaid machinery for every surface that renders fact HTML (the
// fact view and the rendered diff). Rendering goes THROUGH React state,
// never DOM mutation: mutating dangerouslySetInnerHTML's subtree behind
// React's back means any re-render reverts the diagram to raw source.
// SVGs render once per source into a module cache and are spliced into
// the HTML React owns.
import { useEffect, useMemo, useRef, useState } from "react";

let seq = 0;
const cache = new Map<string, string>(); // source -> svg | "__error__"
let loader: Promise<void> | null = null;

const MERMAID_BLOCK = /<pre class="rk-mermaid"><code[^>]*>([\s\S]*?)<\/code><\/pre>/g;

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function ensureMermaid(): Promise<void> {
  if ((window as unknown as { __rkMermaid?: unknown }).__rkMermaid) return Promise.resolve();
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/mermaid.js";
      script.onload = () => resolve();
      script.onerror = () => {
        loader = null; // a failed load may retry next time
        script.remove();
        reject(new Error("mermaid failed to load"));
      };
      document.body.appendChild(script);
    });
  }
  return loader;
}

/** Render any uncached mermaid sources found in the fragments, then call
 * onDone (never called when everything was already cached, or after the
 * returned cancel function runs). */
function renderMermaidIn(fragments: string[], onDone: () => void): () => void {
  const sources = fragments.flatMap((html) =>
    [...html.matchAll(MERMAID_BLOCK)].map((m) => unescapeHtml(m[1]!)),
  );
  const missing = sources.filter((src) => !cache.has(src));
  if (!missing.length) return () => {};
  let cancelled = false;
  void ensureMermaid()
    .then(async () => {
      const mermaid = (
        window as unknown as {
          __rkMermaid: { render: (id: string, src: string) => Promise<{ svg: string }> };
        }
      ).__rkMermaid;
      for (const src of missing) {
        if (cache.has(src)) continue;
        try {
          const { svg } = await mermaid.render(`rk-mmd-${++seq}`, src);
          cache.set(src, svg);
        } catch {
          cache.set(src, "__error__");
        }
      }
      if (!cancelled) onDone();
    })
    .catch(() => {
      /* load failed; a later view retries */
    });
  return () => {
    cancelled = true;
  };
}

/** Splice cached SVGs into an HTML fragment; uncached sources stay as
 * visible source until renderMermaidIn's onDone triggers a re-splice. */
function spliceMermaid(html: string): string {
  return html.replace(MERMAID_BLOCK, (block, code: string) => {
    const svg = cache.get(unescapeHtml(code));
    if (!svg) return block; // still loading: show the source
    if (svg === "__error__") {
      return `<pre class="rk-mermaid" data-error="1"><code>${code}</code></pre>`;
    }
    return `<div class="rk-mermaid">${svg}</div>`;
  });
}

/** The HTML fragments with their diagrams spliced in, as
 * dangerouslySetInnerHTML props — one per fragment, re-spliced when a
 * render lands. React 19 diffs dangerouslySetInnerHTML by OBJECT identity,
 * not by the __html string: a fresh {__html} every render rewrites
 * innerHTML even when the markup is byte-identical, destroying the
 * reader's live text selection. A fragment whose markup is unchanged
 * keeps its object, so re-renders are inert. */
export function useMermaidHtml(fragments: string[]): { __html: string }[] {
  const [version, setVersion] = useState(0);
  useEffect(() => renderMermaidIn(fragments, () => setVersion((v) => v + 1)), [fragments]);
  const previous = useRef<{ __html: string }[]>([]);
  return useMemo(() => {
    void version;
    const next = fragments.map((html, i) => {
      const spliced = spliceMermaid(html);
      const prior = previous.current[i];
      return prior?.__html === spliced ? prior : { __html: spliced };
    });
    previous.current = next;
    return next;
  }, [fragments, version]);
}
