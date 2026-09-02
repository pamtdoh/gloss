import { describe, expect, test } from "bun:test";
import { ROOT, buildRows, dirStats, indexFactOf, isRoot, type Fact } from "./model.js";

const fact = (path: string, items = 0): Fact => ({
  path,
  content: `# ${path}`,
  sidecar: items ? { items: Array.from({ length: items }, (_, i) => ({ id: `c${i + 1}`, type: "comment" as const, text: "x" })) } : null,
});

const facts = [
  fact("_index.md", 1),
  fact("a/_index.md"),
  fact("a/one.md", 2),
  fact("two.md"),
];

describe("the front page", () => {
  test("leads the rows, never collapses, and is never a child entry", () => {
    const rows = buildRows(facts, () => false);
    expect(rows[0]).toEqual(ROOT);
    expect(isRoot(rows[0]!)).toBe(true);
    // the root's children still walk even though nothing is "expanded"
    expect(rows.map((r) => r.path)).toEqual(["", "a", "two.md"]);
    expect(rows.some((r) => r.path === "_index.md")).toBe(false);
  });

  test("can be left out when a filter or scope excludes its overview", () => {
    const rows = buildRows(facts, () => true, false);
    expect(rows.map((r) => r.path)).toEqual(["a", "a/one.md", "two.md"]);
  });

  test("its index fact is the root _index.md", () => {
    expect(indexFactOf(facts, "")?.path).toBe("_index.md");
    expect(indexFactOf(facts.slice(1), "")).toBeNull();
  });

  test("its directory stats span the whole tree", () => {
    expect(dirStats(facts, "")).toEqual({ facts: 4, items: 3, questions: 0 });
    expect(dirStats(facts, "a")).toEqual({ facts: 2, items: 2, questions: 0 });
  });
});
