import type { Sidecar, SidecarItem } from "../summary.js";

export interface Fact {
  path: string;
  content: string;
  sidecar: Sidecar | null;
}

export interface ReviewData {
  review: string;
  snapshot: number;
  snapshots: number[];
  facts: Fact[];
}

export interface Row {
  kind: "dir" | "fact";
  path: string;
  depth: number;
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function isIndex(path: string): boolean {
  return nameOf(path) === "_index.md";
}

export function titleOf(fact: Fact): string {
  const m = /^#{1,6} +(.+)$/m.exec(fact.content);
  return m?.[1]?.trim() ?? nameOf(fact.path);
}

export function allDirs(facts: Fact[]): string[] {
  const dirs = new Set<string>();
  for (const fact of facts) {
    let dir = dirOf(fact.path);
    while (dir) {
      dirs.add(dir);
      dir = dirOf(dir);
    }
  }
  return [...dirs].sort();
}

/** Depth-first visible rows: directories first, then facts, alphabetical. */
export function buildRows(
  facts: Fact[],
  isExpanded: (dir: string) => boolean,
): Row[] {
  const dirs = allDirs(facts);
  const rows: Row[] = [];
  const walk = (parent: string, depth: number): void => {
    for (const dir of dirs.filter((d) => dirOf(d) === parent)) {
      rows.push({ kind: "dir", path: dir, depth });
      if (isExpanded(dir)) walk(dir, depth + 1);
    }
    for (const fact of facts) {
      if (dirOf(fact.path) === parent && !isIndex(fact.path)) {
        rows.push({ kind: "fact", path: fact.path, depth });
      }
    }
  };
  walk("", 0);
  return rows;
}

export function indexFactOf(facts: Fact[], dir: string): Fact | null {
  const path = dir ? `${dir}/_index.md` : "_index.md";
  return facts.find((f) => f.path === path) ?? null;
}

export function childFactsOf(facts: Fact[], dir: string): Fact[] {
  return facts.filter((f) => dirOf(f.path) === dir && !isIndex(f.path));
}

export function childDirsOf(facts: Fact[], dir: string): string[] {
  return allDirs(facts).filter((d) => dirOf(d) === dir);
}

export function isQuestion(item: SidecarItem): boolean {
  return item.type === "question";
}

/** A question whose last turn is the agent's is "answered — your turn". */
export function answeredByAgent(item: SidecarItem): boolean {
  return isQuestion(item) && item.thread?.[item.thread.length - 1]?.who === "agent";
}

export function factStats(fact: Fact): { items: number; questions: number; answered: number } {
  const items = fact.sidecar?.items ?? [];
  return {
    items: items.length,
    questions: items.filter(isQuestion).length,
    answered: items.filter(answeredByAgent).length,
  };
}

export interface DirStats {
  facts: number;
  items: number;
  questions: number;
  undecided: number;
}

export function dirStats(facts: Fact[], dir: string): DirStats {
  const within = facts.filter((f) => f.path.startsWith(dir + "/"));
  let items = 0;
  let questions = 0;
  let undecided = 0;
  for (const fact of within) {
    const stats = factStats(fact);
    items += stats.items;
    questions += stats.questions;
    if (!fact.sidecar?.decision) undecided++;
  }
  return { facts: within.length, items, questions, undecided };
}

export type ChangeStatus = "new" | "changed" | undefined;

export function changeStatus(prev: Map<string, string> | null, fact: Fact): ChangeStatus {
  if (!prev) return undefined;
  const before = prev.get(fact.path);
  if (before === undefined) return "new";
  return before === fact.content ? undefined : "changed";
}

export function nextId(items: SidecarItem[], prefix: string): string {
  let max = 0;
  for (const item of items) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + (max + 1);
}

export function normalizeSidecar(sidecar: Sidecar): Sidecar | null {
  if (sidecar.items && sidecar.items.length === 0) delete sidecar.items;
  if (sidecar.decision === undefined && !sidecar.items) return null;
  return sidecar;
}
