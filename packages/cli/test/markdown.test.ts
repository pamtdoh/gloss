import { describe, expect, test } from "bun:test";
import { escapeHtml, renderMarkdown } from "../src/viewer/markdown.js";

describe("escapeHtml", () => {
  test("neutralizes markup", () => {
    expect(escapeHtml(`<script>alert("hi") & more</script>`)).toBe(
      "&lt;script&gt;alert(&quot;hi&quot;) &amp; more&lt;/script&gt;",
    );
  });
});

describe("renderMarkdown", () => {
  test("never passes raw HTML through", () => {
    const html = renderMarkdown(`# Title\n\n<img src=x onerror=alert(1)>`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("renders headings, paragraphs, inline code and bold", () => {
    const html = renderMarkdown("# A claim\n\nBody with `code` and **bold**\nacross lines.");
    expect(html).toContain("<h1>A claim</h1>");
    expect(html).toContain("<p>Body with <code>code</code> and <strong>bold</strong> across lines.</p>");
  });

  test("renders lists", () => {
    expect(renderMarkdown("- one\n- two")).toBe("<ul><li>one</li><li>two</li></ul>");
  });
});
