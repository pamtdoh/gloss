import { describe, expect, test } from "bun:test";
import { applyAgentReply, applyOp, nextId, pendingQuestions } from "./notes.js";
import type { Sidecar } from "./summary.js";

const answered: Sidecar = {
  items: [
    { id: "c1", type: "comment", text: "one" },
    {
      id: "q1",
      type: "question",
      thread: [
        { who: "human", text: "why?" },
        { who: "agent", text: "because." },
      ],
    },
  ],
};

describe("applyOp", () => {
  test("create assigns the next free id per type, on the file as it is", () => {
    const r = applyOp(answered, { op: "create", type: "comment", text: "two", anchor: { quote: "x" } });
    expect(r.ok && r.id).toBe("c2");
    const q = applyOp(answered, { op: "create", type: "question", text: "how?" });
    expect(q.ok && q.id).toBe("q2");
    expect(q.ok && q.sidecar.items?.at(-1)).toEqual({
      id: "q2",
      type: "question",
      thread: [{ who: "human", text: "how?" }],
    });
    expect(q.ok && q.event).toEqual({ type: "question.asked", id: "q2", text: "how?" });
  });

  test("a stale tab's edit touches only the note it names", () => {
    // the regression the whole-sidecar PUT had: a tab that never saw q1
    // saved an edit to c1 and erased q1 with its answer
    const r = applyOp(answered, { op: "edit", id: "c1", text: "one edited" });
    expect(r.ok && r.sidecar.items).toEqual([
      { id: "c1", type: "comment", text: "one edited" },
      answered.items![1]!,
    ]);
  });

  test("editing a question rewrites its opening turn only", () => {
    const r = applyOp(answered, { op: "edit", id: "q1", text: "why, really?" });
    expect(r.ok && r.sidecar.items?.[1]?.thread).toEqual([
      { who: "human", text: "why, really?" },
      { who: "agent", text: "because." },
    ]);
  });

  test("delete removes one note; deleting the last empties the sidecar", () => {
    const r = applyOp({ items: [{ id: "c1", type: "comment", text: "x" }] }, { op: "delete", id: "c1" });
    expect(r.ok && r.sidecar).toEqual({ items: [] });
  });

  test("reply appends a human turn and is news to the agent", () => {
    const r = applyOp(answered, { op: "reply", id: "q1", text: "and then?" });
    expect(r.ok && r.sidecar.items?.[1]?.thread?.at(-1)).toEqual({ who: "human", text: "and then?" });
    expect(r.ok && r.event).toEqual({ type: "question.replied", id: "q1", text: "and then?" });
  });

  test("refusals: a missing note, empty text, a reply to a comment", () => {
    expect(applyOp(answered, { op: "edit", id: "c9", text: "x" })).toMatchObject({ ok: false, status: 404 });
    expect(applyOp(answered, { op: "create", type: "comment", text: "  " })).toMatchObject({ ok: false, status: 400 });
    expect(applyOp(answered, { op: "reply", id: "c1", text: "x" })).toMatchObject({ ok: false, status: 400 });
  });

  test("restore puts a note back, renumbering a taken id; anchor moves one", () => {
    const back = applyOp(answered, { op: "restore", item: { id: "c1", type: "comment", text: "again" } });
    expect(back.ok && back.id).toBe("c2");
    const moved = applyOp(answered, { op: "anchor", id: "c1", anchor: { quote: "new words" } });
    expect(moved.ok && moved.sidecar.items?.[0]?.anchor).toEqual({ quote: "new words" });
  });

  test("never mutates its input", () => {
    const before = structuredClone(answered);
    applyOp(answered, { op: "delete", id: "q1" });
    applyOp(answered, { op: "reply", id: "q1", text: "x" });
    expect(answered).toEqual(before);
  });
});

describe("applyAgentReply", () => {
  test("appends once; a retry of the same text changes nothing", () => {
    const asked: Sidecar = { items: [{ id: "q1", type: "question", thread: [{ who: "human", text: "why?" }] }] };
    const first = applyAgentReply(asked, "q1", "because.");
    expect(first.ok && first.changed).toBe(true);
    const again = applyAgentReply(first.ok ? first.sidecar : asked, "q1", "because.");
    expect(again.ok && again.changed).toBe(false);
  });

  test("comments take no replies", () => {
    expect(applyAgentReply(answered, "c1", "ok")).toMatchObject({ ok: false, status: 400 });
  });
});

test("nextId and pendingQuestions", () => {
  expect(nextId([{ id: "c3", type: "comment" }, { id: "q7", type: "question" }], "c")).toBe("c4");
  expect(pendingQuestions(answered)).toEqual([]);
  const r = applyOp(answered, { op: "reply", id: "q1", text: "more?" });
  expect(pendingQuestions(r.ok ? r.sidecar : undefined)).toEqual([{ id: "q1", text: "more?" }]);
});
