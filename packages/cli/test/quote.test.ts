import { describe, expect, test } from "bun:test";
import { indexesOf, widenQuote } from "../src/viewer/quote.js";

describe("indexesOf", () => {
  test("finds all occurrences", () => {
    expect(indexesOf("a b a b a", "a")).toEqual([0, 4, 8]);
  });
  test("empty needle matches nothing", () => {
    expect(indexesOf("abc", "")).toEqual([]);
  });
});

describe("widenQuote", () => {
  const source = "The store loads the file, and the store saves the file back.";

  test("a unique quote is returned unchanged", () => {
    expect(widenQuote(source, "saves")).toBe("saves");
  });

  test("a duplicated quote is widened until unique", () => {
    const widened = widenQuote(source, "the store");
    expect(widened).toContain("the store");
    expect(indexesOf(source, widened)).toHaveLength(1);
  });

  test("occurrence picks which duplicate is widened", () => {
    const first = widenQuote(source, "the file", 0);
    const second = widenQuote(source, "the file", 1);
    expect(first).not.toBe(second);
    expect(source.indexOf(first)).toBeLessThan(source.indexOf(second));
    expect(indexesOf(source, first)).toHaveLength(1);
    expect(indexesOf(source, second)).toHaveLength(1);
  });

  test("a quote absent from the source is returned as-is", () => {
    expect(widenQuote(source, "not here")).toBe("not here");
  });
});
