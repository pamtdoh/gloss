import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { toProtocolPath } from "./protocol.js";
import type { Sidecar } from "./summary.js";

// The review on disk (ARCHITECTURE.md): numbered revision directories of
// fact files, a sidecar next to each fact the human has noted, and the
// server's own dotfiles. Everything that touches those files goes
// through here.

export const NOTE_IMAGES = "images/notes";

/** The one directory the agent writes: the next revision, in progress.
 * Numbered revisions are frozen copies of it, made by the tool. */
export const DRAFT = "draft";

export const isSidecar = (path: string): boolean => path.endsWith(".review.json");

/** Every file under a directory, as sorted relative protocol paths. */
export function walkFiles(root: string, dir = root): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile() && !entry.name.endsWith(".tmp")) files.push(toProtocolPath(relative(root, path)));
  }
  return files.sort();
}

/** A review exists once it has a draft or a revision. */
export function reviewExists(reviewDir: string): boolean {
  return existsSync(join(reviewDir, DRAFT)) || listRevisions(reviewDir).length > 0;
}

/** A note file: a sidecar, or a picture pasted into a note. Notes are
 * state about a revision, not its content: they live in the draft while
 * a round runs, and a revision gets its copy when its round ends. */
export const isNoteFile = (path: string): boolean => isSidecar(path) || path.startsWith(`${NOTE_IMAGES}/`);

const contentFiles = (dir: string): string[] => walkFiles(dir).filter((f) => !isNoteFile(f));

/** Whether the draft's facts or figures differ from the latest
 * revision's. Notes don't count: resolving notes alone serves the same
 * revision again. The first revision always differs. */
export function draftDiffers(reviewDir: string): boolean {
  const draft = join(reviewDir, DRAFT);
  if (!contentFiles(draft).some((f) => f.endsWith(".md"))) return false;
  const latest = listRevisions(reviewDir).at(-1);
  if (latest === undefined) return true;
  const frozen = join(reviewDir, String(latest));
  const a = contentFiles(draft);
  const b = contentFiles(frozen);
  if (a.length !== b.length || a.some((f, i) => f !== b[i])) return true;
  return a.some((f) => !readFileSync(join(draft, f)).equals(readFileSync(join(frozen, f))));
}

/** A review planted as numbered revisions, with no draft yet, gets one:
 * a writable copy of the latest revision, notes included. */
export function ensureDraft(reviewDir: string): void {
  const draft = join(reviewDir, DRAFT);
  const latest = listRevisions(reviewDir).at(-1);
  if (existsSync(draft) || latest === undefined) return;
  cpSync(join(reviewDir, String(latest)), draft, { recursive: true });
  for (const file of walkFiles(draft)) chmodSync(join(draft, file), 0o644);
}

/** Freeze the draft's facts and figures as the next revision, and return
 * its number. The copy is built aside and renamed into place, so a
 * revision is never half there, and made read-only, since a published
 * revision is never edited again. Its notes come later (snapshotNotes). */
export function freezeDraft(reviewDir: string): number {
  const draft = join(reviewDir, DRAFT);
  const next = (listRevisions(reviewDir).at(-1) ?? 0) + 1;
  const target = join(reviewDir, String(next));
  const building = `${target}.${process.pid}.tmp`;
  rmSync(building, { recursive: true, force: true });
  for (const file of contentFiles(draft)) {
    const to = join(building, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(draft, file), to);
    chmodSync(to, 0o444);
  }
  renameSync(building, target);
  return next;
}

/** A revision's notes as they stand at the end of its round — the record
 * of what was raised on it. The draft's note files replace whatever the
 * revision held; the draft keeps its own, for the agent to resolve. */
export function snapshotNotes(reviewDir: string, revision: number): void {
  const draft = join(reviewDir, DRAFT);
  const frozen = join(reviewDir, String(revision));
  for (const file of walkFiles(frozen)) if (isNoteFile(file)) unlinkSync(join(frozen, file));
  rmSync(join(frozen, NOTE_IMAGES), { recursive: true, force: true });
  for (const file of walkFiles(draft)) {
    if (!isNoteFile(file)) continue;
    const to = join(frozen, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(draft, file), to);
  }
}

export function listRevisions(reviewDir: string): number[] {
  if (!existsSync(reviewDir)) return [];
  return readdirSync(reviewDir)
    .filter((name) => /^\d+$/.test(name) && statSync(join(reviewDir, name)).isDirectory())
    .map(Number)
    .sort((a, b) => a - b);
}

// Facts and sidecars are written by agents, possibly on Windows: strip a
// UTF-8 BOM (breaks JSON.parse and CommonMark headings) and fold CRLF, so
// the offsets the viewer stamps into anchors index the same string the
// browser's HTML parser yields.
export function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/** Write through a temp file and rename, so a crash mid-write leaves the
 * old file or the new one, never half of either. */
export function writeAtomic(path: string, data: string | Buffer): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

// resolve() must land strictly inside base. startsWith(base + sep) is not
// enough on Windows, where trailing dots/spaces in a segment survive
// resolve() but are trimmed by the filesystem.
export function escapesDir(baseDir: string, abs: string): boolean {
  const rel = relative(baseDir, abs);
  // ".." as a whole segment, not a name that starts with two dots
  return rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** A requested fact path as the protocol path — null unless it names an
 * existing .md strictly inside the revision. */
export function resolveFact(revisionDir: string, raw: unknown): string | null {
  const abs = resolve(revisionDir, String(raw));
  if (escapesDir(revisionDir, abs) || !abs.endsWith(".md") || !existsSync(abs)) return null;
  return toProtocolPath(relative(revisionDir, abs));
}

export function walkFacts(revisionDir: string, dir = revisionDir): string[] {
  const facts: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) facts.push(...walkFacts(revisionDir, path));
    else if (name.endsWith(".md")) facts.push(toProtocolPath(relative(revisionDir, path)));
  }
  return facts.sort();
}

export function sidecarPath(revisionDir: string, factPath: string): string {
  return join(revisionDir, factPath.replace(/\.md$/, ".review.json"));
}

/** A fact's sidecar: undefined when there is none, null when one exists
 * but does not parse — which callers must not mistake for "no notes". */
export function readSidecar(revisionDir: string, factPath: string): Sidecar | undefined | null {
  const path = sidecarPath(revisionDir, factPath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

export function writeSidecar(revisionDir: string, factPath: string, sidecar: Sidecar): void {
  const target = sidecarPath(revisionDir, factPath);
  if ((sidecar.items ?? []).length === 0) {
    if (existsSync(target)) unlinkSync(target);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeAtomic(target, JSON.stringify(sidecar, null, 2) + "\n");
  }
}

export interface FactFile {
  path: string;
  content: string;
  sidecar: Sidecar | null;
  /** the sidecar exists but does not parse: shown, never written over */
  broken?: true;
}

/** A revision's facts, with the notes from `notesDir`: the draft while
 * the revision's round is open, the revision's own copy otherwise. */
export function readRevision(revisionDir: string, notesDir = revisionDir): FactFile[] {
  return walkFacts(revisionDir).map((path) => {
    const sidecar = readSidecar(notesDir, path);
    const fact: FactFile = { path, content: readText(join(revisionDir, path)), sidecar: sidecar ?? null };
    if (sidecar === null) fact.broken = true;
    return fact;
  });
}

/** Pasted pictures no note mentions any more. images/notes/ is where
 * the tool writes them, in the draft, so the tool tidies it — when a
 * round starts and when it ends, before the revision takes its copy. A
 * sidecar that does not parse may still mention a picture, so a
 * destructive tidy stays its hand rather than guess. */
export function pruneNoteImages(revisionDir: string): void {
  const dir = join(revisionDir, NOTE_IMAGES);
  if (!existsSync(dir)) return;
  const texts: string[] = [];
  for (const factPath of walkFacts(revisionDir)) {
    const sidecar = readSidecar(revisionDir, factPath);
    if (sidecar === null) return;
    for (const item of sidecar?.items ?? []) {
      if (item.text) texts.push(item.text);
      for (const turn of item.thread ?? []) texts.push(turn.text);
    }
  }
  const mentioned = texts.join("\n");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || mentioned.includes(`${NOTE_IMAGES}/${entry.name}`)) continue;
    unlinkSync(join(dir, entry.name));
  }
  // the directories go with the last file; an agent's own images/ stays
  if (readdirSync(dir).length === 0) {
    rmdirSync(dir);
    const images = join(revisionDir, "images");
    if (readdirSync(images).length === 0) rmdirSync(images);
  }
}
