import { describe, expect, test } from "bun:test";
import { isEmptySidecar, summarize } from "../src/summary.js";

describe("isEmptySidecar", () => {
  test("empty when nothing remains", () => {
    expect(isEmptySidecar({})).toBe(true);
    expect(isEmptySidecar({ items: [] })).toBe(true);
  });
  test("a decision or an item keeps it alive", () => {
    expect(isEmptySidecar({ decision: "keep" })).toBe(false);
    expect(isEmptySidecar({ items: [{ id: "c1", type: "comment", text: "x" }] })).toBe(false);
  });
});

describe("summarize", () => {
  test("counts decisions, items, and undecided facts", () => {
    const summary = summarize({
      review: "r",
      snapshot: 2,
      approved: true,
      sidecars: [
        { decision: "keep" },
        {
          decision: "simplify",
          items: [
            { id: "a1", type: "annotation", text: "tighten" },
            { id: "q1", type: "question", thread: [{ who: "human", text: "why?" }] },
          ],
        },
        { items: [{ id: "c1", type: "comment", text: "nice" }] },
        undefined,
        undefined,
      ],
    });
    expect(summary).toEqual({
      review: "r",
      snapshot: 2,
      facts: 5,
      decisions: { keep: 1, "not-needed": 0, simplify: 1, defer: 0, undecided: 3 },
      annotations: 1,
      comments: 1,
      openQuestions: 1,
      approved: true,
    });
  });
});
