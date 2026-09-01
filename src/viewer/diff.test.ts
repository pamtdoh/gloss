import { describe, expect, test } from "bun:test";
import { computeBlockDiff, computeDiff } from "./diff.js";

const text = (lines: string[]): string => lines.join("\n") + "\n";

describe("computeDiff", () => {
  test("unchanged text yields only context lines with both numbers", () => {
    const src = text(["# Title", "", "Body line."]);
    const diff = computeDiff(src, src);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.unified.map((l) => l.kind)).toEqual(["context", "context", "context"]);
    expect(diff.unified[2]).toMatchObject({ oldNum: 3, newNum: 3 });
  });

  test("a modified line pairs del with add and marks the changed words", () => {
    const before = text(["# Title", "The token works once."]);
    const after = text(["# Title", "The token works exactly once."]);
    const diff = computeDiff(before, after);
    expect(diff.unified.map((l) => l.kind)).toEqual(["context", "del", "add"]);
    const add = diff.unified[2]!;
    expect(add.newNum).toBe(2);
    expect(add.segs.filter((s) => s.changed).map((s) => s.text)).toEqual(["exactly "]);
    // split view puts the pair on one row
    const changedRow = diff.split[1]!;
    expect(changedRow.left?.kind).toBe("del");
    expect(changedRow.right?.kind).toBe("add");
  });

  test("a dissimilar replacement stays unmarked", () => {
    const diff = computeDiff(text(["alpha beta gamma"]), text(["completely different words here"]));
    for (const line of diff.unified) {
      expect(line.segs.some((s) => s.changed)).toBe(false);
    }
  });

  test("a new file is pure additions; a removed file pure deletions", () => {
    const src = text(["a", "b"]);
    expect(computeDiff("", src).unified.map((l) => l.kind)).toEqual(["add", "add"]);
    expect(computeDiff(src, "").unified.map((l) => l.kind)).toEqual(["del", "del"]);
  });

  test("uneven del/add runs leave filler cells in the split view", () => {
    const diff = computeDiff(text(["one", "two", "three"]), text(["one"]));
    expect(diff.removed).toBe(2);
    expect(diff.added).toBe(0);
    const fillers = diff.split.filter((r) => r.left && !r.right);
    expect(fillers).toHaveLength(2);
  });

  test("line numbers advance independently per side", () => {
    const diff = computeDiff(text(["keep", "drop", "keep2"]), text(["keep", "keep2", "tail"]));
    const tail = diff.unified.find((l) => l.segs.map((s) => s.text).join("") === "tail")!;
    expect(tail).toMatchObject({ kind: "add", newNum: 3 });
    const drop = diff.unified.find((l) => l.segs.map((s) => s.text).join("") === "drop")!;
    expect(drop).toMatchObject({ kind: "del", oldNum: 2 });
  });
});

describe("computeBlockDiff", () => {
  test("unchanged text is all context blocks", () => {
    const src = "# Title\n\nA paragraph.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    const diff = computeBlockDiff(src, src);
    expect(diff.rows.map((r) => r.kind)).toEqual(["context", "context", "context"]);
    expect(diff.added + diff.removed + diff.changed).toBe(0);
  });

  test("an edited paragraph pairs as changed with added-word marks", () => {
    const before = "# Title\n\nThe token works once.\n";
    const after = "# Title\n\nThe token works exactly once.\n";
    const diff = computeBlockDiff(before, after);
    expect(diff.rows.map((r) => r.kind)).toEqual(["context", "changed"]);
    const changed = diff.rows[1]!;
    expect(changed.oldSource).toBe("The token works once.");
    const marked = changed.marks!.map((m) => changed.source.slice(m.start, m.end));
    expect(marked).toEqual(["exactly "]);
    expect(changed.invisible).toBeUndefined();
  });

  test("a link-target edit is flagged invisible — the rendered text is identical", () => {
    const before = "See [the docs](https://old.example).\n";
    const after = "See [the docs](https://new.example).\n";
    const diff = computeBlockDiff(before, after);
    expect(diff.rows[0]!.kind).toBe("changed");
    expect(diff.rows[0]!.invisible).toBe(true);
  });

  test("filler-word matches coalesce into one region: del run then add run", () => {
    // shared "and", "with", spaces would otherwise chop this into a
    // dozen interleaved fragments (the word-soup regression)
    const before =
      "The panel shows what you raised on the base revision: each comment and each question with its full thread.\n";
    const after =
      "The panel shows what you raised on the base revision: comments as whole cards and questions folded to summary cards.\n";
    const diff = computeBlockDiff(before, after);
    expect(diff.rows.map((r) => r.kind)).toEqual(["changed"]);
    const row = diff.rows[0]!;
    expect(row.dels).toHaveLength(1);
    expect(row.marks).toHaveLength(1);
    // git word-diff grouping: the struck old run sits immediately before
    // the marked new run
    expect(row.dels![0]!.at).toBe(row.marks![0]!.start);
    expect(row.dels![0]!.text).toContain("each comment and each question");
    expect(row.source.slice(row.marks![0]!.start, row.marks![0]!.end)).toContain(
      "comments as whole cards",
    );
  });

  test("a long shared run keeps two small edits apart", () => {
    // two one-word edits around an eleven-character common run stay
    // two regions — a fixed absorb window would have struck the lot
    const before = "A cat and a dog sat on the mat.\n";
    const after = "B cat and a fog sat on the mat.\n";
    const row = computeBlockDiff(before, after).rows[0]!;
    expect(row.kind).toBe("changed");
    expect(row.dels!.map((d) => d.text)).toEqual(["A", "dog"]);
    expect(row.marks!.map((m) => row.source.slice(m.start, m.end))).toEqual(["B", "fog"]);
  });

  test("paragraph reflow is whitespace for whitespace — no edit region", () => {
    const before = "The cat sat\non the mat, and\nthe dog watched.\n";
    const after = "The cat sat on the mat, and the dog watched.\n";
    const row = computeBlockDiff(before, after).rows[0]!;
    expect(row.kind).toBe("changed");
    expect(row.marks).toEqual([]);
    expect(row.invisible).toBe(true);
  });

  test("a rewrite that shares only filler falls back to del plus add blocks", () => {
    const before = "Blocks are matched between revisions and an edited pair gets word-level highlights.\n";
    const after = "An edited matched pair gets struck deleted words and added-word marks spliced inline.\n";
    const diff = computeBlockDiff(before, after);
    expect(diff.rows.map((r) => r.kind)).toEqual(["del", "add"]);
  });

  test("a new block is add, a removed block is del, a rewrite is del plus add", () => {
    const before = "# Title\n\nalpha beta gamma delta.\n";
    const after = "# Title\n\nEntirely different words here now.\n\nA new closing thought.\n";
    const diff = computeBlockDiff(before, after);
    expect(diff.rows.map((r) => r.kind)).toEqual(["context", "del", "add", "add"]);
    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(2);
  });
});
