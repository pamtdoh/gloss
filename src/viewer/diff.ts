import { diffArrays, diffLines, diffWordsWithSpace, type ArrayChange, type Change } from "diff";
import { parseMarkdown, renderMarkdown } from "./markdown.js";

// Diff of one fact between two revisions at two grains: lines, for the
// unified and split source layouts, and top-level Markdown blocks, for
// the rendered layout. Facts are short documents, so the whole file is
// shown — no hunk headers, no folded context to expand.

/** A run of characters within one line; `changed` marks the words that
 * differ from the paired line on the other side. */
export interface Seg {
  text: string;
  changed: boolean;
}

export type LineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  /** 1-based line number in the base revision (absent on added lines) */
  oldNum?: number;
  /** 1-based line number in the target revision (absent on deleted lines) */
  newNum?: number;
  segs: Seg[];
}

export interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

export interface FactDiff {
  unified: DiffLine[];
  split: SplitRow[];
  added: number;
  removed: number;
}

function toLines(chunk: string): string[] {
  const lines = chunk.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const plain = (text: string): Seg[] => [{ text, changed: false }];

/** Both grains pair the same way: a removed run directly followed by an
 * added run is modification, and its members pair index-wise. Everything
 * else is context, pure removal, or pure addition. */
function* pairRuns<T>(
  changes: ArrayChange<T>[],
): Generator<{ context: T[] } | { dels: T[]; adds: T[] }> {
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]!;
    if (!change.added && !change.removed) {
      yield { context: change.value };
      continue;
    }
    const next = changes[i + 1];
    if (change.removed && next?.added) {
      i++;
      yield { dels: change.value, adds: next.value };
    } else {
      yield { dels: change.removed ? change.value : [], adds: change.added ? change.value : [] };
    }
  }
}

/** The word-level parts of a pair that is an edit, or null for a pair
 * sharing too little (under ~30% common characters): a wholesale rewrite
 * with rainbow word-marks reads worse than plain remove-and-add. */
function similarParts(a: string, b: string): Change[] | null {
  const parts = diffWordsWithSpace(a, b);
  let common = 0;
  for (const part of parts) {
    if (!part.added && !part.removed) common += part.value.length;
  }
  return common / Math.max(a.length, b.length, 1) < 0.3 ? null : parts;
}

/** Word-level highlights for one deleted/added line pair. */
function wordSegs(a: string, b: string): { del: Seg[]; add: Seg[] } | null {
  const parts = similarParts(a, b);
  if (!parts) return null;
  const del: Seg[] = [];
  const add: Seg[] = [];
  for (const part of parts) {
    if (!part.added) del.push({ text: part.value, changed: part.removed === true });
    if (!part.removed) add.push({ text: part.value, changed: part.added === true });
  }
  return { del, add };
}

// ---------------------------------------------------------------- blocks
// The rendered diff works at the grain of top-level Markdown blocks
// (paragraph, heading, list, table, code fence): each block renders as
// itself, tinted by what happened to it, with word-level marks inside a
// changed pair. mdast supplies the block boundaries as source offsets.

export interface BlockRow {
  kind: "context" | "add" | "del" | "changed";
  /** the block's source — the new side's for a changed pair */
  source: string;
  /** a changed pair's old source */
  oldSource?: string;
  /** added-word spans, offsets relative to `source` */
  marks?: { start: number; end: number }[];
  /** removed words with the offset in `source` where each was removed —
   * rendered struck inline, suggestion-mode style */
  dels?: { at: number; text: string }[];
  /** the pair's rendered text is identical — a link, image path, or
   * formatting edit that rendering cannot show */
  invisible?: boolean;
}

export interface BlockDiff {
  rows: BlockRow[];
  added: number;
  removed: number;
  changed: number;
}

function blocksOf(source: string): string[] {
  return parseMarkdown(source)
    .children.map((child) =>
      child.position?.start.offset !== undefined && child.position.end.offset !== undefined
        ? source.slice(child.position.start.offset, child.position.end.offset)
        : "",
    )
    .filter((block) => block.trim() !== "");
}

/** What the reader would actually see: rendered HTML with the markup
 * stripped. Equal visible text across a changed pair means the edit is
 * invisible in rendered form (a URL, a path, pure formatting). State
 * carried by attributes rather than text — an image's src, a task-list
 * checkbox — is tokenized first, so those changes stay visible. */
function visibleText(source: string): string {
  return renderMarkdown(source)
    .replace(/<img [^>]*src="([^"]*)"[^>]*>/g, " img:$1 ")
    .replace(/<input [^>]*type="checkbox"[^>]*>/g, (tag) =>
      tag.includes(" checked") ? " [x] " : " [ ] ",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-level edits of a changed pair, as coalesced regions: each region
 * contributes one removed run (struck inline, git word-diff style) and
 * one added span, side by side. A common run sandwiched between two
 * edits joins them when it is no longer than the edit on either side of
 * it — diff-match-patch's semantic cleanup — because coincidental matches
 * on filler words otherwise chop one rewrite into unreadable word soup,
 * while a long shared run between two small edits keeps them apart. Null
 * when the pair shares too little, or when the regions swallow the whole
 * block (a rewrite reads better as the framed REMOVED/ADDED pair). */
function pairEdits(
  oldSource: string,
  newSource: string,
): { marks: { start: number; end: number }[]; dels: { at: number; text: string }[] } | null {
  const raw = similarParts(oldSource, newSource);
  if (!raw) return null;
  // whitespace swapped for whitespace is paragraph reflow — a newline
  // become a space renders identically, so it counts as common
  const parts: Change[] = [];
  for (let k = 0; k < raw.length; k++) {
    const part = raw[k]!;
    const next = raw[k + 1];
    if (part.removed && next?.added && /^\s+$/.test(part.value) && /^\s+$/.test(next.value)) {
      parts.push({ value: next.value, added: false, removed: false, count: next.count });
      k++;
    } else {
      parts.push(part);
    }
  }
  // the size of the edit run starting at a part index — the larger of
  // its removed and added character counts — up to the next common part
  const editAt = (from: number): number => {
    let removed = 0;
    let added = 0;
    for (let j = from; j < parts.length && (parts[j]!.added || parts[j]!.removed); j++) {
      if (parts[j]!.removed) removed += parts[j]!.value.length;
      else added += parts[j]!.value.length;
    }
    return Math.max(removed, added);
  };

  const marks: { start: number; end: number }[] = [];
  const dels: { at: number; text: string }[] = [];
  let offset = 0; // position in newSource
  let coveredOld = 0;
  let coveredNew = 0;
  let i = 0;
  while (i < parts.length) {
    const part = parts[i]!;
    if (!part.added && !part.removed) {
      offset += part.value.length;
      i++;
      continue;
    }
    // one edit region: gather removed and added runs, absorbing a common
    // run no longer than the region so far nor the edit that follows it
    const start = offset;
    let delText = "";
    while (i < parts.length) {
      const q = parts[i]!;
      if (q.removed || q.added) {
        if (q.removed) delText += q.value;
        else offset += q.value.length;
        i++;
        continue;
      }
      const region = Math.max(delText.length, offset - start);
      const following = editAt(i + 1);
      if (following > 0 && q.value.length <= region && q.value.length <= following) {
        delText += q.value;
        offset += q.value.length;
        i++;
        continue;
      }
      break;
    }
    if (offset > start) marks.push({ start, end: offset });
    if (delText.trim() !== "") dels.push({ at: start, text: delText });
    coveredOld += delText.length;
    coveredNew += offset - start;
  }
  const rewrite =
    coveredOld / Math.max(oldSource.length, 1) > 0.85 &&
    coveredNew / Math.max(newSource.length, 1) > 0.85;
  return rewrite ? null : { marks, dels };
}

export function computeBlockDiff(before: string, after: string): BlockDiff {
  const rows: BlockRow[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const run of pairRuns(diffArrays(blocksOf(before), blocksOf(after)))) {
    if ("context" in run) {
      for (const source of run.context) rows.push({ kind: "context", source });
      continue;
    }
    const pairs = Math.min(run.dels.length, run.adds.length);
    for (let j = 0; j < pairs; j++) {
      const oldSource = run.dels[j]!;
      const source = run.adds[j]!;
      const edits = pairEdits(oldSource, source);
      if (edits === null) {
        // too dissimilar to be an edit — show as remove plus add
        rows.push({ kind: "del", source: oldSource });
        rows.push({ kind: "add", source });
        removed++;
        added++;
        continue;
      }
      changed++;
      const invisible = visibleText(oldSource) === visibleText(source) || undefined;
      rows.push({
        kind: "changed",
        source,
        oldSource,
        marks: edits.marks,
        // an invisible edit's removed words are raw source (a URL, a
        // marker) — the tag explains it better than struck syntax would
        dels: invisible ? [] : edits.dels,
        invisible,
      });
    }
    for (const source of run.dels.slice(pairs)) {
      rows.push({ kind: "del", source });
      removed++;
    }
    for (const source of run.adds.slice(pairs)) {
      rows.push({ kind: "add", source });
      added++;
    }
  }
  return { rows, added, removed, changed };
}

export function computeDiff(before: string, after: string): FactDiff {
  const unified: DiffLine[] = [];
  const split: SplitRow[] = [];
  let added = 0;
  let removed = 0;
  let oldNum = 1;
  let newNum = 1;

  // diffLines yields chunks of joined lines; pairRuns wants one line per
  // element so the members pair up
  const changes = diffLines(before, after).map((change) => ({
    ...change,
    value: toLines(change.value),
  }));
  for (const run of pairRuns(changes)) {
    if ("context" in run) {
      for (const line of run.context) {
        const entry: DiffLine = { kind: "context", oldNum, newNum, segs: plain(line) };
        unified.push(entry);
        split.push({ left: entry, right: entry });
        oldNum++;
        newNum++;
      }
      continue;
    }
    const dels: DiffLine[] = run.dels.map((line) => ({
      kind: "del",
      oldNum: oldNum++,
      segs: plain(line),
    }));
    const adds: DiffLine[] = run.adds.map((line) => ({
      kind: "add",
      newNum: newNum++,
      segs: plain(line),
    }));
    for (let j = 0; j < Math.min(dels.length, adds.length); j++) {
      const segs = wordSegs(run.dels[j]!, run.adds[j]!);
      if (!segs) continue;
      dels[j]!.segs = segs.del;
      adds[j]!.segs = segs.add;
    }
    removed += dels.length;
    added += adds.length;
    unified.push(...dels, ...adds);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
      split.push({ left: dels[j], right: adds[j] });
    }
  }
  return { unified, split, added, removed };
}
