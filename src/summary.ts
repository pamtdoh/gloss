// Shapes from ARCHITECTURE.md — a shared convention, not a validated schema.
// No decision field: items are comments and questions, both typed by the
// human (the canned quick-comment presets were removed unused).

export interface ThreadEntry {
  who: "human" | "agent";
  text: string;
}

export interface SidecarItem {
  id: string;
  type: "comment" | "question";
  anchor?: { quote: string; prefix?: string; suffix?: string };
  text?: string;
  thread?: ThreadEntry[];
}

export interface Sidecar {
  items?: SidecarItem[];
}

export function isEmptySidecar(sidecar: Sidecar): boolean {
  return (sidecar.items ?? []).length === 0;
}

// The viewer PUTs whole sidecars from its in-memory copy while the agent
// appends thread answers to the same file on disk — two writers, one file.
// Merge policy: the viewer owns the item set (its creations, edits, and
// deletions win), the agent owns its thread entries (an agent entry on
// disk that the incoming copy lacks is re-inserted after its disk
// predecessor, so a stale tab can never erase an answer).
export function mergeSidecar(disk: Sidecar | undefined, incoming: Sidecar): Sidecar {
  if (!disk?.items?.length) return incoming;
  const diskById = new Map(disk.items.map((item) => [item.id, item]));
  const same = (a: ThreadEntry, b: ThreadEntry): boolean => a.who === b.who && a.text === b.text;
  const items = (incoming.items ?? []).map((item) => {
    const prior = diskById.get(item.id)?.thread;
    if (!prior?.length) return item;
    const thread = [...(item.thread ?? [])];
    prior.forEach((entry, i) => {
      if (entry.who !== "agent" || thread.some((t) => same(t, entry))) return;
      const prev = i > 0 ? prior[i - 1] : undefined;
      const at = prev ? thread.findIndex((t) => same(t, prev)) : -1;
      thread.splice(at === -1 ? thread.length : at + 1, 0, entry);
    });
    return { ...item, thread };
  });
  return { ...incoming, items };
}

export interface Summary {
  review: string;
  revision: number;
  facts: number;
  comments: number;
  openQuestions: number;
  approved: boolean;
}

export function summarize(input: {
  review: string;
  revision: number;
  sidecars: (Sidecar | undefined)[]; // one slot per fact; undefined = no sidecar
  approved: boolean;
}): Summary {
  let comments = 0;
  let openQuestions = 0;
  for (const sidecar of input.sidecars) {
    for (const item of sidecar?.items ?? []) {
      if (item.type === "question") openQuestions++;
      else comments++;
    }
  }
  return {
    review: input.review,
    revision: input.revision,
    facts: input.sidecars.length,
    comments,
    openQuestions,
    approved: input.approved,
  };
}
