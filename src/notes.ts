// Review notes as single operations (ARCHITECTURE.md). The viewer and the
// agent never send a whole sidecar: each sends one change, and the server
// applies it to the file as it is on disk. A tab that missed someone
// else's change can only touch the notes it names, so nothing it never
// saw can be erased.

import type { Sidecar, SidecarItem } from "./summary.js";

export type Anchor = NonNullable<SidecarItem["anchor"]>;

export type NoteOp =
  | { op: "create"; type: "comment" | "question"; text: string; anchor?: Anchor }
  | { op: "edit"; id: string; text: string }
  | { op: "delete"; id: string }
  | { op: "reply"; id: string; text: string }
  /** move a note's anchor to new text */
  | { op: "anchor"; id: string; anchor: Anchor }
  /** put a deleted note back as it was (undo); a taken id gets a new one */
  | { op: "restore"; item: SidecarItem };

export type OpResult =
  | { ok: true; sidecar: Sidecar; id: string; event?: AgentEvent }
  | { ok: false; status: number; error: string };

/** What the agent must hear about: a new question, or a human turn on an
 * existing one. Edits and deletions are not news to the agent. */
export type AgentEvent =
  | { type: "question.asked"; id: string; text: string }
  | { type: "question.replied"; id: string; text: string };

const fail = (status: number, error: string): OpResult => ({ ok: false, status, error });

/** The next free id for a prefix, assigned by the server so two tabs
 * creating notes at once can never pick the same one. `ids` holds every
 * id ever used on the fact — the notes there now and the ones its earlier
 * revisions recorded — so a resolved note's id is never handed out again. */
export function nextId(ids: Iterable<string>, prefix: string): string {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isAnchor = (v: unknown): v is Anchor =>
  typeof v === "object" && v !== null && isString((v as Anchor).quote) &&
  ["prefix", "suffix"].every((k) => (v as Record<string, unknown>)[k] === undefined || isString((v as Record<string, unknown>)[k]));

/** A request body as an operation, or why it isn't one. Bodies come from
 * the network, so nothing about their shape is taken on trust. */
export function parseOp(body: Record<string, unknown>): NoteOp | string {
  const { op, id, text, type, anchor, item } = body;
  switch (op) {
    case "create":
      if (type !== "comment" && type !== "question") return "create needs type comment or question";
      if (!isString(text)) return "create needs text";
      if (anchor !== undefined && !isAnchor(anchor)) return "bad anchor";
      return { op, type, text, ...(anchor ? { anchor } : {}) };
    case "edit":
    case "reply":
      if (!isString(id) || !isString(text)) return `${op} needs id and text`;
      return { op, id, text };
    case "delete":
      if (!isString(id)) return "delete needs id";
      return { op, id };
    case "anchor":
      if (!isString(id) || !isAnchor(anchor)) return "anchor needs id and anchor";
      return { op, id, anchor };
    case "restore": {
      const note = item as SidecarItem | undefined;
      if (!note || !isString(note.id) || (note.type !== "comment" && note.type !== "question")) return "restore needs a note";
      return { op, item: note };
    }
    default:
      return `unknown op: ${String(op)}`;
  }
}

/** Apply a human's operation to a sidecar (undefined = no file yet).
 * `usedIds` are ids the fact's earlier revisions recorded (see nextId).
 * Never mutates its input. */
export function applyOp(current: Sidecar | undefined, op: NoteOp, usedIds: Iterable<string> = []): OpResult {
  const items: SidecarItem[] = structuredClone(current?.items ?? []);
  const text = "text" in op ? op.text.trim() : "";
  if ("text" in op && !text) return fail(400, "empty text");
  const ids = (): string[] => [...items.map((i) => i.id), ...usedIds];

  if (op.op === "restore") {
    const item = structuredClone(op.item);
    if (item.type !== "comment" && item.type !== "question") return fail(400, "not a note");
    // an undo puts the note back under its own id unless that is in use now
    if (items.some((i) => i.id === item.id)) item.id = nextId(ids(), item.type === "question" ? "q" : "c");
    items.push(item);
    return { ok: true, sidecar: { items }, id: item.id };
  }

  if (op.op === "create") {
    const id = nextId(ids(), op.type === "question" ? "q" : "c");
    const item: SidecarItem = { id, type: op.type };
    if (op.anchor?.quote) item.anchor = op.anchor;
    if (op.type === "question") item.thread = [{ who: "human", text }];
    else item.text = text;
    items.push(item);
    const event: AgentEvent | undefined =
      op.type === "question" ? { type: "question.asked", id, text } : undefined;
    return { ok: true, sidecar: { items }, id, event };
  }

  const item = items.find((i) => i.id === op.id);
  if (!item) return fail(404, `no note ${op.id}`);

  if (op.op === "delete") {
    return { ok: true, sidecar: { items: items.filter((i) => i !== item) }, id: op.id };
  }
  if (op.op === "anchor") {
    if (!op.anchor?.quote) return fail(400, "empty anchor");
    item.anchor = op.anchor;
    return { ok: true, sidecar: { items }, id: op.id };
  }
  if (op.op === "edit") {
    // a question's text is its opening turn; later turns stay as written
    if (item.type === "question" && item.thread?.length) item.thread[0]!.text = text;
    else item.text = text;
    return { ok: true, sidecar: { items }, id: op.id };
  }
  if (op.op !== "reply") return fail(400, "unknown op");
  if (item.type !== "question") return fail(400, `${op.id} is a comment — only questions take replies`);
  (item.thread ??= []).push({ who: "human", text });
  return {
    ok: true,
    sidecar: { items },
    id: op.id,
    event: { type: "question.replied", id: op.id, text },
  };
}

/** Append the agent's answer to a question. A resend of a turn already in
 * the thread changes nothing, so a retried `gloss reply` never doubles. */
export function applyAgentReply(
  current: Sidecar | undefined,
  id: string,
  rawText: string,
): OpResult & { changed?: boolean } {
  const text = rawText.trim();
  if (!text) return fail(400, "empty reply");
  const items: SidecarItem[] = structuredClone(current?.items ?? []);
  const item = items.find((i) => i.id === id);
  if (!item) return fail(404, `no note ${id}`);
  if (item.type !== "question") {
    return fail(400, `${id} is a comment — comments are addressed in the next revision, not replied to`);
  }
  const thread = (item.thread ??= []);
  if (thread.some((t) => t.who === "agent" && t.text === text)) {
    return { ok: true, sidecar: { items }, id, changed: false };
  }
  thread.push({ who: "agent", text });
  return { ok: true, sidecar: { items }, id, changed: true };
}

/** The question ids still waiting on the agent: the last turn is human. */
export function pendingQuestions(sidecar: Sidecar | undefined): { id: string; text: string }[] {
  return (sidecar?.items ?? [])
    .filter((i) => i.type === "question" && i.thread?.at(-1)?.who === "human")
    .map((i) => ({ id: i.id, text: i.thread!.at(-1)!.text }));
}
