import { describe, expect, test } from "bun:test";
import { describeAnchor, resolveAnchor } from "./anchor.js";

const source =
  "The store loads the file, and the store saves the file back to disk.";

describe("describeAnchor", () => {
  test("a unique selection stores only the verbatim quote", () => {
    const start = source.indexOf("saves");
    const anchor = describeAnchor(source, start, start + 5);
    expect(anchor).toEqual({ quote: "saves" });
  });

  test("an ambiguous selection gains prefix/suffix; the quote stays verbatim", () => {
    const second = source.indexOf("the file", source.indexOf("the file") + 1);
    const anchor = describeAnchor(source, second, second + 8);
    expect(anchor.quote).toBe("the file");
    expect(anchor.prefix).toBeTruthy();
    expect(anchor.suffix).toBeTruthy();
    const resolved = resolveAnchor(source, anchor)!;
    expect(resolved.start).toBe(second);
    expect(resolved.state).toBe("exact");
  });
});

describe("resolveAnchor", () => {
  test("unique quote resolves exactly", () => {
    const r = resolveAnchor(source, { quote: "loads" })!;
    expect(source.slice(r.start, r.end)).toBe("loads");
    expect(r.state).toBe("exact");
  });

  test("ambiguous quote without context picks a match rather than dropping", () => {
    const r = resolveAnchor(source, { quote: "the file" });
    expect(r).not.toBeNull();
  });

  test("small edits resolve fuzzily as drifted", () => {
    const edited = source.replace("saves the file", "saves the files");
    const r = resolveAnchor(edited, { quote: "saves the file back" })!;
    expect(r.state).toBe("drifted");
    expect(edited.slice(r.start, r.end)).toContain("saves the files");
  });

  test("edits beyond the 20% error budget detach rather than mis-anchor", () => {
    const edited = source.replace("saves the file", "saves the whole file");
    expect(resolveAnchor(edited, { quote: "saves the file back" })).toBeNull();
  });

  test("a rewritten fact detaches the anchor", () => {
    expect(resolveAnchor("Entirely different prose now.", { quote: "saves the file back" })).toBeNull();
  });
});
