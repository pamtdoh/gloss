// Shapes from DESIGN.md §6 — a shared convention, not a validated schema.
// Round 3 (owner): the decision field is gone; everything the human raises
// is an item. "Decisions" live on only as viewer quick-presets that create
// ordinary whole-fact annotations.

export interface ThreadEntry {
  who: "human" | "agent";
  text: string;
}

export interface SidecarItem {
  id: string;
  /** "comment" is legacy (merged into annotation, owner round 3+); it is
   *  still rendered and counted as an annotation. */
  type: "annotation" | "question" | "comment";
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

export interface Summary {
  review: string;
  snapshot: number;
  facts: number;
  annotations: number;
  openQuestions: number;
  approved: boolean;
}

export function summarize(input: {
  review: string;
  snapshot: number;
  sidecars: (Sidecar | undefined)[]; // one slot per fact; undefined = no sidecar
  approved: boolean;
}): Summary {
  let annotations = 0;
  let openQuestions = 0;
  for (const sidecar of input.sidecars) {
    for (const item of sidecar?.items ?? []) {
      if (item.type === "question") openQuestions++;
      else annotations++; // annotation, or legacy comment
    }
  }
  return {
    review: input.review,
    snapshot: input.snapshot,
    facts: input.sidecars.length,
    annotations,
    openQuestions,
    approved: input.approved,
  };
}
