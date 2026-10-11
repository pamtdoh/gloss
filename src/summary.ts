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
