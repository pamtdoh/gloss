import { describe, expect, test } from "bun:test";
import { isEmptySidecar, mergeSidecar, summarize } from "./summary.js";
import type { Sidecar } from "./summary.js";

describe("mergeSidecar", () => {
  const q = (thread: { who: "human" | "agent"; text: string }[]): Sidecar => ({
    items: [{ id: "q1", type: "question", thread }],
  });

  test("a stale tab cannot erase an agent answer", () => {
    const disk = q([
      { who: "human", text: "why?" },
      { who: "agent", text: "because." },
    ]);
    const incoming = q([{ who: "human", text: "why?" }]);
    expect(mergeSidecar(disk, incoming)).toEqual(disk);
  });

  test("agent answer lands before a later human reply", () => {
    const disk = q([
      { who: "human", text: "why?" },
      { who: "agent", text: "because." },
    ]);
    const incoming = q([
      { who: "human", text: "why?" },
      { who: "human", text: "still unsure" },
    ]);
    expect(mergeSidecar(disk, incoming)).toEqual(
      q([
        { who: "human", text: "why?" },
        { who: "agent", text: "because." },
        { who: "human", text: "still unsure" },
      ]),
    );
  });

  test("viewer deletions win: a removed item drops its agent entries", () => {
    const disk = q([
      { who: "human", text: "why?" },
      { who: "agent", text: "because." },
    ]);
    expect(mergeSidecar(disk, { items: [] })).toEqual({ items: [] });
  });

  test("human edits and new items pass through untouched", () => {
    const disk: Sidecar = { items: [{ id: "c1", type: "comment", text: "old" }] };
    const incoming: Sidecar = {
      items: [
        { id: "c1", type: "comment", text: "edited" },
        { id: "c2", type: "comment", text: "new" },
      ],
    };
    expect(mergeSidecar(disk, incoming)).toEqual(incoming);
  });

  test("idempotent when the tab already has the answer", () => {
    const disk = q([
      { who: "human", text: "why?" },
      { who: "agent", text: "because." },
    ]);
    expect(mergeSidecar(disk, disk)).toEqual(disk);
  });
});

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
