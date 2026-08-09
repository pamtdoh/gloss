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
      snapshot: 2,
      approved: true,
      sidecars: [
        {
          items: [
            { id: "a1", type: "annotation", text: "tighten" },
            { id: "a2", type: "annotation", text: "Not needed." },
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
      facts: 4,
      annotations: 2,
      comments: 1,
      openQuestions: 1,
      approved: true,
    });
  });
});
