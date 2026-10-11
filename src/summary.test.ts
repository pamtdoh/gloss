import { describe, expect, test } from "bun:test";
import { summarize } from "./summary.js";

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
        undefined,
        undefined,
        undefined,
      ],
    });
    expect(summary).toEqual({
      review: "r",
      revision: 2,
      facts: 4,
      comments: 2,
      openQuestions: 1,
      approved: true,
    });
  });
});
