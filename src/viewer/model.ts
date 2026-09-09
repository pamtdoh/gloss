import type { Sidecar, SidecarItem } from "../summary.js";

export interface Fact {
  path: string;
  content: string;
  sidecar: Sidecar | null;
  /** deleted since the previous revision; resurrected read-only from its copy */
  ghost?: true;
}

export interface ReviewData {
  review: string;
  revision: number;
  /** the revision this session serves — the only writable one */
  served: number;
  revisions: number[];
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

/** where the server serves a revision's images from, e.g. "/asset/1/" */
export function assetBase(revision: number): string {
  return `/asset/${revision}/`;
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function isIndex(path: string): boolean {
  return nameOf(path) === "_index.md";
}

/** The review's front page: the root directory, whose index fact (a
 * root `_index.md`, when the agent wrote one) is the overview. Notes on
 * that fact are notes on the review as a whole. */
export const ROOT: Row = { kind: "dir", path: "", depth: 0 };

export function isRoot(row: Row): boolean {
  return row.kind === "dir" && row.path === "";
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

/** Directories and facts of one parent, interleaved by name — numeric
 * prefixes order the reading, so a dir must not jump its siblings. */
export function childEntries(
  facts: Fact[],
  parent: string,
): { kind: "dir" | "fact"; path: string }[] {
  return [
    ...allDirs(facts)
      .filter((d) => dirOf(d) === parent)
      .map((path) => ({ kind: "dir" as const, path })),
    ...facts
      .filter((f) => dirOf(f.path) === parent && !isIndex(f.path))
      .map((f) => ({ kind: "fact" as const, path: f.path })),
  ].sort((a, b) => (nameOf(a.path) < nameOf(b.path) ? -1 : 1));
}

/** Depth-first visible rows: the root page first (when `withRoot`), then
 * dirs and facts interleaved, alphabetical. The root never collapses. */
export function buildRows(
  facts: Fact[],
  isExpanded: (dir: string) => boolean,
  withRoot = true,
): Row[] {
  const rows: Row[] = withRoot ? [ROOT] : [];
  const walk = (parent: string, depth: number): void => {
    for (const entry of childEntries(facts, parent)) {
      rows.push({ ...entry, depth });
      if (entry.kind === "dir" && isExpanded(entry.path)) walk(entry.path, depth + 1);
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
}

export function dirStats(facts: Fact[], dir: string): DirStats {
  const prefix = dir ? `${dir}/` : ""; // the root holds every fact
  const within = facts.filter((f) => f.path.startsWith(prefix));
  let items = 0;
  let questions = 0;
  for (const fact of within) {
    const stats = factStats(fact);
    items += stats.items;
    questions += stats.questions;
  }
  return { facts: within.length, items, questions };
}

/** How an item's anchor resolves against the fact text it sits on. */
export type AnchorState = "exact" | "drifted" | "detached";

/** The revision before the viewed one, if any. */
export function previousRevision(data: ReviewData): number | null {
  return data.revisions.filter((r) => r < data.revision).pop() ?? null;
}

/** path -> content, the shape the changed-since machinery compares against */
export function contentMap(facts: Fact[]): Map<string, string> {
  return new Map(facts.map((f) => [f.path, f.content]));
}

export type ChangeStatus = "new" | "changed" | "removed" | undefined;

export function changeStatus(prev: Map<string, string> | null, fact: Fact): ChangeStatus {
  if (fact.ghost) return "removed";
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
  return sidecar.items ? sidecar : null;
}
