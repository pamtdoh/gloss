// Safe rich-Markdown rendering with source offsets.
//
// Facts and thread text are CommonMark + GFM. We parse with mdast and emit
// every byte of HTML ourselves — raw HTML in the source is re-escaped to
// visible text, so nothing unsanitized can pass by construction. Inline
// text runs carry data-s/data-e source offsets so anchors map exactly
// between the rendered DOM and the fact source.
import { decodeNamedCharacterReference } from "decode-named-character-reference";
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
  /** URL prefix for in-revision images, e.g. "/asset/1/". */
  assetBase?: string;
  /** Directory of the fact within the revision, for relative image paths. */
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
  // Agents authoring facts on Windows may emit backslash image paths;
  // fold them before the "/" split so ".." handling still applies.
  url = url.replace(/\\/g, "/");
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url) || url.startsWith("/")) return null;
  const parts: string[] = [];
  for (const seg of `${opts.factDir ?? ""}/${url}`.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null; // escaping the revision is not a thing
      parts.pop();
    } else parts.push(seg);
  }
  return (opts.assetBase ?? "") + parts.join("/");
}

function children(node: Parent, opts: RenderOptions): string {
  return node.children.map((child) => render(child, opts)).join("");
}

/** One exact stamp: src.slice(s, e) === line.slice(vs, ve). */
interface Run {
  s: number;
  e: number;
  vs: number;
  ve: number;
}

// CommonMark's escapable ASCII punctuation
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/** Decode a character reference at src[at] the way micromark does. */
function refAt(src: string, at: number, end: number): { char: string; length: number } | null {
  if (src[at] !== "&") return null;
  const m = /^&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|([A-Za-z][A-Za-z0-9]{0,31}));/.exec(
    src.slice(at, Math.min(end, at + 34)),
  );
  if (!m) return null;
  if (m[3] !== undefined) {
    const char = decodeNamedCharacterReference(m[3]);
    return char === false ? null : { char, length: m[0].length };
  }
  const code = m[1] !== undefined ? parseInt(m[1], 16) : parseInt(m[2]!, 10);
  const invalid = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
  return { char: invalid ? "�" : String.fromCodePoint(code), length: m[0].length };
}

/**
 * Match one line of rendered value against src at exactly `at`, split into
 * runs that each satisfy the stamp equality. With `encoded`, markdown's
 * in-line rewrites are crossed instead of failing the match: a backslash
 * escape stamps the character after the backslash, a character reference
 * stamps its leading "&" when that is what it decodes to, and rewritten
 * source characters become unstamped gaps between runs.
 */
function matchLineAt(
  line: string,
  src: string,
  at: number,
  end: number,
  encoded: boolean,
): { runs: Run[]; end: number } | null {
  const runs: Run[] = [];
  let si = at;
  let vi = 0;
  let runS = -1;
  let runV = -1;
  const close = (): void => {
    if (runS !== -1) {
      runs.push({ s: runS, e: si, vs: runV, ve: vi });
      runS = -1;
    }
  };
  while (vi < line.length) {
    if (si >= end) return null;
    if (encoded) {
      // a well-formed reference is always decoded in text, so it can only
      // match its decoded form — check before the literal comparison, or
      // "&amp;" would eat the "&" and desync inside "amp;"
      const ref = refAt(src, si, end);
      if (ref) {
        if (!line.startsWith(ref.char, vi)) return null;
        close();
        if (ref.char === "&") runs.push({ s: si, e: si + 1, vs: vi, ve: vi + 1 });
        si += ref.length;
        vi += ref.char.length;
        continue;
      }
      if (
        src[si] === "\\" &&
        si + 1 < end &&
        src[si + 1] === line[vi] &&
        ESCAPABLE.test(line[vi]!)
      ) {
        close();
        runS = si + 1;
        runV = vi;
        si += 2;
        vi += 1;
        continue;
      }
    }
    if (src[si] !== line[vi]) return null;
    if (runS === -1) {
      runS = si;
      runV = vi;
    }
    si++;
    vi++;
  }
  close();
  return { runs, end: si };
}

/** Earliest match of `line` at or after `cursor`. */
function findLine(
  line: string,
  src: string,
  cursor: number,
  end: number,
  encoded: boolean,
): { runs: Run[]; end: number } | null {
  for (let at = cursor; at < end; at++) {
    const match = matchLineAt(line, src, at, end, encoded);
    if (match) return match;
  }
  return null;
}

/**
 * Locate each line of a node's value within [cursor, end). Inside
 * blockquotes and list items the source interleaves block prefixes ("> ",
 * indentation) that the value does not contain, so one [start, end) stamp
 * would skew DOM→source arithmetic in dom-anchor — lines are found and
 * stamped one by one instead. A line that cannot be located yields null
 * (rendered unstamped) without disturbing the search for the lines after
 * it: the failure unit is the line, not the node.
 */
function locateLines(
  lines: string[],
  cursor: number,
  end: number,
  src: string,
  encoded: boolean,
): (Run[] | null)[] {
  return lines.map((line) => {
    if (!line) return null;
    const match = findLine(line, src, cursor, end, encoded);
    if (!match) return null;
    cursor = match.end;
    return match.runs;
  });
}

function emitLine(line: string, runs: Run[]): string {
  let out = "";
  let v = 0;
  for (const run of runs) {
    if (run.vs > v) out += escapeHtml(line.slice(v, run.vs));
    out += `<span data-s="${run.s}" data-e="${run.e}">${escapeHtml(line.slice(run.vs, run.ve))}</span>`;
    v = run.ve;
  }
  return out + escapeHtml(line.slice(v));
}

function emitLines(lines: string[], located: (Run[] | null)[]): string {
  return lines.map((line, i) => emitLine(line, located[i] ?? [])).join("\n");
}

/** Render a text-like value as offset-stamped span(s). */
function stampedText(value: string, node: Node, opts: RenderOptions, encoded = true): string {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  const src = opts.sourceText;
  if (s !== undefined && e !== undefined && src !== undefined && src.slice(s, e) !== value) {
    const lines = value.split("\n");
    const located = locateLines(lines, s, e, src, encoded);
    if (located.some(Boolean)) return emitLines(lines, located);
  }
  return `<span${offsets(node)}>${escapeHtml(value)}</span>`;
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
      return stampedText((node as Text).value, node, opts);
    case "strong":
      return `<strong>${children(node as Parent, opts)}</strong>`;
    case "emphasis":
      return `<em>${children(node as Parent, opts)}</em>`;
    case "delete":
      return `<del>${children(node as Parent, opts)}</del>`;
    case "inlineCode": {
      const code = node as InlineCode;
      const s = code.position?.start.offset;
      const e = code.position?.end.offset;
      const src = opts.sourceText;
      if (s !== undefined && e !== undefined && src !== undefined) {
        // position spans the backtick delimiters; the value does not
        const pad = (e - s - code.value.length) / 2;
        if (Number.isInteger(pad) && pad > 0 && src.slice(s + pad, e - pad) === code.value) {
          return `<code data-s="${s + pad}" data-e="${e - pad}">${escapeHtml(code.value)}</code>`;
        }
        // wrapped across lines in a blockquote/list: stamp each line.
        // code is literal — escapes/references are never decoded in it
        const lines = code.value.split("\n");
        const located = locateLines(lines, s, e, src, false);
        if (located.some(Boolean)) return `<code>${emitLines(lines, located)}</code>`;
      }
      return `<code>${escapeHtml(code.value)}</code>`;
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
      const lang = code.lang ? ` class="lang-${escapeHtml(code.lang)}"` : "";
      const start = code.position?.start.offset;
      const end = code.position?.end.offset;
      if (opts.sourceText && start !== undefined && end !== undefined && code.value) {
        const src = opts.sourceText;
        const idx = src.indexOf(code.value, start);
        if (idx !== -1 && idx < end) {
          return `<pre><code${lang} data-s="${idx}" data-e="${idx + code.value.length}">${escapeHtml(code.value)}</code></pre>\n`;
        }
        // fence in a blockquote/list: block prefixes interleave the value's
        // lines, so search per line starting past the opening fence line
        const contentStart = src.indexOf("\n", start) + 1;
        if (contentStart > 0) {
          const lines = code.value.split("\n");
          const located = locateLines(lines, contentStart, end, src, false);
          if (located.some(Boolean)) {
            return `<pre><code${lang}>${emitLines(lines, located)}</code></pre>\n`;
          }
        }
      }
      return `<pre><code${lang}>${escapeHtml(code.value)}</code></pre>\n`;
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
      // raw HTML is never emitted — it renders as visible escaped text.
      // its value is verbatim source (no escape/reference decoding), so
      // tolerant matching would desync on a literal "&amp;"
      return stampedText((node as Html).value, node, opts, false);
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
