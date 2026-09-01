import { describe, expect, test } from "bun:test";
import { escapeHtml, renderMarkdown } from "./markdown.js";

describe("escapeHtml", () => {
  test("neutralizes markup", () => {
    expect(escapeHtml(`<script>alert("hi") & more</script>`)).toBe(
      "&lt;script&gt;alert(&quot;hi&quot;) &amp; more&lt;/script&gt;",
    );
  });
});

describe("renderMarkdown safety", () => {
  test("raw HTML blocks render as escaped text", () => {
    const html = renderMarkdown(`# Title\n\n<img src=x onerror=alert(1)>`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("inline HTML renders as escaped text", () => {
    const html = renderMarkdown("uses <review> and <n> placeholders");
    expect(html).toContain("&lt;review&gt;");
    expect(html).toContain("&lt;n&gt;");
  });

  test("javascript: links are stripped to their text", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("href");
    expect(html).toContain("click");
  });

  test("https links pass with rel=noopener", () => {
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain(`href="https://example.com"`);
    expect(html).toContain(`rel="noopener noreferrer"`);
  });
});

describe("renderMarkdown richness", () => {
  test("GFM tables render with alignment inside a scroll container", () => {
    const html = renderMarkdown("| a | b |\n|:--|--:|\n| 1 | 2 |");
    expect(html).toContain(`<div class="tablewrap"`);
    expect(html).toContain("<table>");
    expect(html).toContain(`<th scope="col" style="text-align:left">`);
    expect(html).toContain("<tbody>");
  });

  test("fenced code keeps its language; mermaid gets its own class", () => {
    expect(renderMarkdown("```ts\nconst x = 1;\n```")).toContain(`class="lang-ts"`);
    // the diagram's stamps sit on the <code> like any fence's: the
    // wrapper stays unstamped so no run ever has an element first child
    const src = "```mermaid\nflowchart LR\nA-->B\n```";
    const html = renderMarkdown(src);
    expect(html).toStartWith(`<pre class="rk-mermaid"><code`);
    const m = /data-s="(\d+)" data-e="(\d+)"/.exec(html)!;
    expect(src.slice(Number(m[1]), Number(m[2]))).toBe("flowchart LR\nA-->B");
  });

  test("ordered lists, task lists, strikethrough", () => {
    expect(renderMarkdown("2. two\n3. three")).toContain(`<ol start="2">`);
    expect(renderMarkdown("- [x] done\n- [ ] open")).toContain(`checked`);
    expect(renderMarkdown("~~gone~~")).toContain("<del>");
  });

  test("relative images resolve through the asset base; remote images do not embed", () => {
    const html = renderMarkdown("![diagram](./img/flow.png)", {
      assetBase: "/asset/2/",
      factDir: "flows",
    });
    expect(html).toContain(`src="/asset/2/flows/img/flow.png"`);
    const remote = renderMarkdown("![x](https://evil.example/x.png)");
    expect(remote).not.toContain("<img");
    const escape = renderMarkdown("![x](../../etc/passwd)", { assetBase: "/asset/1/", factDir: "a" });
    expect(escape).not.toContain("<img");
  });
});

describe("renderMarkdown source offsets", () => {
  const source = "# Title\n\nBody with `code` and **bold** text.";

  const unescape = (html: string) =>
    html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

  /** Every offset-carrying run must quote the source verbatim — dom-anchor's
   * DOM↔source arithmetic depends on it. */
  const expectRunsMatchSource = (src: string, minRuns: number) => {
    const html = renderMarkdown(src);
    const runs = [...html.matchAll(/data-s="(\d+)" data-e="(\d+)"[^>]*>([^<]*)</g)];
    expect(runs.length).toBeGreaterThanOrEqual(minRuns);
    for (const [, s, e, text] of runs) {
      expect(src.slice(Number(s), Number(e))).toBe(unescape(text!));
    }
  };

  test("text runs carry data-s/data-e matching the source", () => {
    expectRunsMatchSource(source, 3);
  });

  test("soft-wrapped blockquote lines stamp per line, past the > markers", () => {
    expectRunsMatchSource("> A callout with a long first line\n> and a second wrapped line.", 2);
  });

  test("wrapped list items stamp per line, past continuation indentation", () => {
    expectRunsMatchSource("- first item\n- second item with wrapped text\n  continuing on the next line", 3);
  });

  test("multi-line inline code and fenced code inside a blockquote", () => {
    expectRunsMatchSource("> some `inline\n> code` here\n\n> ```ts\n> const x = 1;\n> const y = 2;\n> ```", 5);
  });

  test("raw HTML blocks inside a blockquote stamp per line", () => {
    expectRunsMatchSource("> <div>\n> raw html\n> </div>", 3);
  });

  test("the invariant holds across nested structures", () => {
    expectRunsMatchSource("> | col | role |\n> |---|---|\n> | a | wraps |", 4);
    expectRunsMatchSource("> - outer item\n>   - inner item that has\n>     a wrapped line", 3);
    expectRunsMatchSource("> # A heading\n> continued paragraph\n> with a wrap", 3);
    expectRunsMatchSource("> > double quoted\n> > wrapped line", 2);
    expectRunsMatchSource("- [x] a done item with\n  a wrapped continuation", 2);
    expectRunsMatchSource("A setext heading\n====", 1);
    expectRunsMatchSource("> before [link\n> text](https://x.example) after", 4);
  });

  test("escapes and references stamp exactly around unstamped gaps", () => {
    // the rewritten source characters ("\", "amp;") sit between exact runs
    expectRunsMatchSource("> uses foo\\_bar and\n> a second line", 3);
    expectRunsMatchSource("AT&amp;T and more", 3); // "&amp;" stamps its own "&"
    expectRunsMatchSource("a \\* b", 2);
    // a literal "&" (no well-formed reference) is plain text
    expectRunsMatchSource("AT&T works", 1);
  });

  test("a character the source never contains stays an unstamped gap", () => {
    // "&#65;" renders "A": no source slice can equal it, so it gets no
    // stamp — and its neighbors stay exact instead of the node skewing
    const html = renderMarkdown("&#65;grade inflation");
    expect(html).toBe(`<p>A<span data-s="5" data-e="20">grade inflation</span></p>`);
  });

  test("raw HTML keeps its verbatim whole-node stamp (no decoding happens in it)", () => {
    expectRunsMatchSource("<div>&amp;</div>", 1);
  });

  test("corpus sweep: wherever rendered text exists verbatim in a real fact, its stamp is exact", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dir, "../..");
    const files: string[] = [join(root, "README.md")];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".md")) files.push(full);
      }
    };
    walk(join(root, ".gloss"));
    let checked = 0;
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const html = renderMarkdown(src);
      for (const [, s, e, text] of html.matchAll(/data-s="(\d+)" data-e="(\d+)"[^>]*>([^<]*)</g)) {
        const dom = unescape(text!);
        if (src.slice(Number(s), Number(e)) !== dom) {
          expect(src.includes(dom)).toBe(false); // only the declared fallback may mismatch
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test("inline code offsets exclude the backticks", () => {
    const html = renderMarkdown(source);
    const m = /<code data-s="(\d+)" data-e="(\d+)">code<\/code>/.exec(html)!;
    expect(source.slice(Number(m[1]), Number(m[2]))).toBe("code");
  });
});
