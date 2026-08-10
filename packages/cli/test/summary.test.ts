import { describe, expect, test } from "bun:test";
import { isEmptySidecar, summarize } from "../src/summary.js";

describe("isEmptySidecar", () => {
  test("empty when nothing remains", () => {
    expect(isEmptySidecar({})).toBe(true);
    expect(isEmptySidecar({ items: [] })).toBe(true);
  });
  test("an item keeps it alive", () => {
    expect(isEmptySidecar({ items: [{ id: "c1", type: "comment", text: "x" }] })).toBe(false);
  });
});

describe("summarize", () => {
  test("counts items by type across facts", () => {
    const summary = summarize({
      review: "r",
      revision: 2,
      approved: true,
      sidecars: [
        {
          items: [
            { id: "c1", type: "comment", text: "tighten" },
            { id: "c2", type: "comment", text: "Not needed." },
            { id: "q1", type: "question", thread: [{ who: "human", text: "why?" }] },
          ],
        },
        // legacy annotation items count as comments
        { items: [{ id: "a1", type: "annotation", text: "nice" }] },
        undefined,
        undefined,
      ],
    });
    expect(summary).toEqual({
      review: "r",
      revision: 2,
      facts: 4,
      comments: 3,
      openQuestions: 1,
      approved: true,
    });
  });
});
