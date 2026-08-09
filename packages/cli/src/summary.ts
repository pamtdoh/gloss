// Shapes from DESIGN.md §6 — a shared convention, not a validated schema.
export type Decision = "not-needed" | "simplify" | "defer";

export interface ThreadEntry {
  who: "human" | "agent";
  text: string;
}

export interface SidecarItem {
  id: string;
  type: "annotation" | "question" | "comment";
  anchor?: { quote: string; prefix?: string; suffix?: string };
  text?: string;
  thread?: ThreadEntry[];
}

export interface Sidecar {
  decision?: Decision;
  items?: SidecarItem[];
}

export function isEmptySidecar(sidecar: Sidecar): boolean {
  return sidecar.decision === undefined && (sidecar.items ?? []).length === 0;
}

export interface Summary {
  review: string;
  snapshot: number;
  facts: number;
  decisions: Record<string, number>;
  annotations: number;
  comments: number;
  openQuestions: number;
  approved: boolean;
}

export function summarize(input: {
  review: string;
  snapshot: number;
  sidecars: (Sidecar | undefined)[]; // one slot per fact; undefined = no sidecar
  approved: boolean;
}): Summary {
  const decisions: Record<string, number> = {
    "not-needed": 0,
    simplify: 0,
    defer: 0,
    undecided: 0,
  };
  let annotations = 0;
  let comments = 0;
  let openQuestions = 0;
  for (const sidecar of input.sidecars) {
    const decision = sidecar?.decision ?? "undecided";
    decisions[decision] = (decisions[decision] ?? 0) + 1;
    for (const item of sidecar?.items ?? []) {
      if (item.type === "annotation") annotations++;
      else if (item.type === "comment") comments++;
      else if (item.type === "question") openQuestions++;
    }
  }
  return {
    review: input.review,
    snapshot: input.snapshot,
    facts: input.sidecars.length,
    decisions,
    annotations,
    comments,
    openQuestions,
    approved: input.approved,
  };
}
