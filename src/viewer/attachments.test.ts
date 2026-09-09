import { describe, expect, test } from "bun:test";
import {
  joinAttachments,
  relativeToFact,
  revisionPathOf,
  splitAttachments,
} from "./attachments.js";

describe("attachments in note text", () => {
  test("a note with two pictures splits into words and chips, and joins back", () => {
    const text = "see this\n\n![shot](../images/notes/abc.png)\n\n![image](../images/notes/def.png)";
    const split = splitAttachments(text);
    expect(split).toEqual({
      text: "see this",
      refs: [
        { alt: "shot", url: "../images/notes/abc.png" },
        { alt: "image", url: "../images/notes/def.png" },
      ],
    });
    expect(joinAttachments(split.text, split.refs)).toBe(text);
  });

  test("a picture with no words is a whole note", () => {
    expect(splitAttachments("![image](images/notes/abc.png)")).toEqual({
      text: "",
      refs: [{ alt: "image", url: "images/notes/abc.png" }],
    });
    expect(joinAttachments("   ", [{ alt: "image", url: "images/notes/abc.png" }])).toBe(
      "![image](images/notes/abc.png)",
    );
  });

  test("only the viewer's own images qualify: a figure or a remote image stays text", () => {
    const figure = "look at\n\n![panel](../images/panel.png)";
    expect(splitAttachments(figure)).toEqual({ text: figure, refs: [] });
    const remote = "![x](https://example.com/x.png)";
    expect(splitAttachments(remote)).toEqual({ text: remote, refs: [] });
    // an image inside a paragraph is prose, not a chip
    const inline = "before ![image](images/notes/abc.png) after";
    expect(splitAttachments(inline)).toEqual({ text: inline, refs: [] });
  });

  test("without chips the text passes through unchanged, trailing whitespace included", () => {
    expect(joinAttachments("typing \n", [])).toBe("typing \n");
  });

  test("paths are written relative to the fact, like figures", () => {
    expect(relativeToFact("_index.md", "images/notes/a.png")).toBe("images/notes/a.png");
    expect(relativeToFact("http/create-link.md", "images/notes/a.png")).toBe("../images/notes/a.png");
    expect(relativeToFact("a/b/c.md", "images/notes/a.png")).toBe("../../images/notes/a.png");
    expect(revisionPathOf("../../images/notes/a.png")).toBe("images/notes/a.png");
  });
});
