import { describe, expect, test } from "bun:test";
import { escapeHtml, renderMarkdown } from "../../src/viewer/markdown.js";

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
    expect(renderMarkdown("```mermaid\nflowchart LR\nA-->B\n```")).toContain(
      `class="rk-mermaid"`,
    );
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

  test("text runs carry data-s/data-e matching the source", () => {
    const html = renderMarkdown(source);
    const spans = [...html.matchAll(/<span data-s="(\d+)" data-e="(\d+)">([^<]*)<\/span>/g)];
    expect(spans.length).toBeGreaterThan(2);
    for (const [, s, e, text] of spans) {
      expect(source.slice(Number(s), Number(e))).toBe(text!);
    }
  });

  test("inline code offsets exclude the backticks", () => {
    const html = renderMarkdown(source);
    const m = /<code data-s="(\d+)" data-e="(\d+)">code<\/code>/.exec(html)!;
    expect(source.slice(Number(m[1]), Number(m[2]))).toBe("code");
  });
});
