// Safe rich-Markdown rendering with source offsets.
//
// Facts and thread text are CommonMark + GFM. We parse with mdast and emit
// every byte of HTML ourselves — raw HTML in the source is re-escaped to
// visible text, so nothing unsanitized can pass by construction. Inline
// text runs carry data-s/data-e source offsets so anchors map exactly
// between the rendered DOM and the fact source.
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type {
  AlignType,
  Code,
  Heading,
  Html,
  Image,
  InlineCode,
  Link,
  List,
  Node,
  Parent,
  Table,
  Text,
} from "mdast";

export interface RenderOptions {
  /** URL prefix for in-snapshot images, e.g. "/asset/1/". */
  assetBase?: string;
  /** Directory of the fact within the snapshot, for relative image paths. */
  factDir?: string;
  /** set internally by renderMarkdown; used to locate code-block offsets */
  sourceText?: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SAFE_LINK = /^(https?:|mailto:|#)/i;

function offsets(node: Node): string {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  return s !== undefined && e !== undefined ? ` data-s="${s}" data-e="${e}"` : "";
}

function resolveAsset(opts: RenderOptions, url: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url) || url.startsWith("/")) return null;
  const parts: string[] = [];
  for (const seg of `${opts.factDir ?? ""}/${url}`.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null; // escaping the snapshot is not a thing
      parts.pop();
    } else parts.push(seg);
  }
  return (opts.assetBase ?? "") + parts.join("/");
}

function children(node: Parent, opts: RenderOptions): string {
  return node.children.map((child) => render(child, opts)).join("");
}

function render(node: Node, opts: RenderOptions): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${children(node as Parent, opts)}</p>\n`;
    case "heading": {
      const depth = Math.min((node as Heading).depth, 6);
      return `<h${depth}>${children(node as Parent, opts)}</h${depth}>\n`;
    }
    case "text":
      return `<span${offsets(node)}>${escapeHtml((node as Text).value)}</span>`;
    case "strong":
      return `<strong>${children(node as Parent, opts)}</strong>`;
    case "emphasis":
      return `<em>${children(node as Parent, opts)}</em>`;
    case "delete":
      return `<del>${children(node as Parent, opts)}</del>`;
    case "inlineCode": {
      const code = node as InlineCode;
      let attrs = "";
      const s = code.position?.start.offset;
      const e = code.position?.end.offset;
      if (s !== undefined && e !== undefined) {
        // position spans the backtick delimiters; the value does not
        const pad = (e - s - code.value.length) / 2;
        attrs = ` data-s="${s + pad}" data-e="${e - pad}"`;
      }
      return `<code${attrs}>${escapeHtml(code.value)}</code>`;
    }
    case "break":
      return "<br>\n";
    case "thematicBreak":
      return "<hr>\n";
    case "blockquote":
      return `<blockquote>\n${children(node as Parent, opts)}</blockquote>\n`;
    case "list": {
      const list = node as List;
      const tag = list.ordered ? "ol" : "ul";
      const start = list.ordered && list.start != null && list.start !== 1
        ? ` start="${list.start}"` : "";
      return `<${tag}${start}>\n${children(list, opts)}</${tag}>\n`;
    }
    case "listItem": {
      const item = node as Parent & { checked?: boolean | null };
      const box = item.checked == null
        ? ""
        : `<input type="checkbox" disabled${item.checked ? " checked" : ""}> `;
      // unwrap single-paragraph items so lists stay tight
      const inner = item.children
        .map((child) =>
          child.type === "paragraph" ? children(child as Parent, opts) : render(child, opts),
        )
        .join("");
      return `<li>${box}${inner}</li>\n`;
    }
    case "code": {
      const code = node as Code;
      if (code.lang === "mermaid") {
        return `<pre class="rk-mermaid"${offsets(node)}><code>${escapeHtml(code.value)}</code></pre>\n`;
      }
      // locate the raw value inside the fence so selections in code anchor
      let attrs = "";
      const start = code.position?.start.offset;
      const end = code.position?.end.offset;
      if (opts.sourceText && start !== undefined && end !== undefined && code.value) {
        const idx = opts.sourceText.indexOf(code.value, start);
        if (idx !== -1 && idx < end) attrs = ` data-s="${idx}" data-e="${idx + code.value.length}"`;
      }
      const lang = code.lang ? ` class="lang-${escapeHtml(code.lang)}"` : "";
      return `<pre><code${lang}${attrs}>${escapeHtml(code.value)}</code></pre>\n`;
    }
    case "link": {
      const url = (node as Link).url;
      const inner = children(node as Parent, opts);
      if (!SAFE_LINK.test(url)) return inner;
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    case "image": {
      const img = node as Image;
      const src = resolveAsset(opts, img.url);
      const alt = escapeHtml(img.alt ?? "");
      if (!src) return `<em>[image: ${alt || escapeHtml(img.url)}]</em>`;
      const title = img.title ? ` title="${escapeHtml(img.title)}"` : "";
      return `<img src="${escapeHtml(src)}" alt="${alt}"${title} loading="lazy">`;
    }
    case "table": {
      const table = node as Table;
      const aligns: (AlignType | undefined)[] = table.align ?? [];
      const rows = table.children.map((row, r) => {
        const cells = row.children.map((cell, c) => {
          const tag = r === 0 ? "th" : "td";
          const scope = r === 0 ? ` scope="col"` : "";
          const align = aligns[c] ? ` style="text-align:${aligns[c]}"` : "";
          return `<${tag}${scope}${align}>${children(cell as Parent, opts)}</${tag}>`;
        }).join("");
        return `<tr>${cells}</tr>`;
      });
      const head = `<thead>${rows[0] ?? ""}</thead>`;
      const body = rows.length > 1 ? `<tbody>${rows.slice(1).join("\n")}</tbody>` : "";
      // wide tables scroll inside their own container, never the reading pane
      return `<div class="tablewrap" role="region" aria-label="Table" tabindex="0"><table>${head}${body}</table></div>\n`;
    }
    case "html":
      // raw HTML is never emitted — it renders as visible escaped text
      return `<span${offsets(node)}>${escapeHtml((node as Html).value)}</span>`;
    default:
      if ("children" in (node as Parent)) return children(node as Parent, opts);
      if ("value" in node) return escapeHtml((node as { value: string }).value);
      return "";
  }
}

export function renderMarkdown(source: string, opts: RenderOptions = {}): string {
  const tree = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const withSource = { ...opts, sourceText: source };
  return tree.children.map((child) => render(child, withSource)).join("").trimEnd();
}
