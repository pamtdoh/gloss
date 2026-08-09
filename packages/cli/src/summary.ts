// Shapes from DESIGN.md §6 — a shared convention, not a validated schema.
// Rounds 3-4 (owner): no decision field; items are comments and questions.
// "Decisions" live on only as Quick Comment presets with canned text.

export interface ThreadEntry {
  who: "human" | "agent";
  text: string;
}

export interface SidecarItem {
  id: string;
  /** "annotation" is legacy (the owner settled on "comment", round 4);
   *  it is still rendered and counted as a comment. */
  type: "comment" | "question" | "annotation";
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
  let comments = 0;
  let openQuestions = 0;
  for (const sidecar of input.sidecars) {
    for (const item of sidecar?.items ?? []) {
      if (item.type === "question") openQuestions++;
      else comments++; // comment, or legacy annotation
    }
  }
  return {
    review: input.review,
    snapshot: input.snapshot,
    facts: input.sidecars.length,
    comments,
    openQuestions,
    approved: input.approved,
  };
}
