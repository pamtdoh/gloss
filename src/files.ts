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
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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

/** Whether the draft holds anything the latest revision doesn't: a
 * changed fact, figure, or note. The first revision always differs. */
export function draftDiffers(reviewDir: string): boolean {
  const draft = join(reviewDir, DRAFT);
  if (walkFiles(draft).filter((f) => f.endsWith(".md")).length === 0) return false;
  const latest = listRevisions(reviewDir).at(-1);
  if (latest === undefined) return true;
  const frozen = join(reviewDir, String(latest));
  const a = walkFiles(draft);
  const b = walkFiles(frozen);
  if (a.length !== b.length || a.some((f, i) => f !== b[i])) return true;
  return a.some((f) => !readFileSync(join(draft, f)).equals(readFileSync(join(frozen, f))));
}

/** Freeze the draft as the next revision, and return its number. The
 * copy is built aside and renamed into place, so a revision is never
 * half there; its facts and figures are made read-only, since a
 * published revision is never edited again. The draft's sidecars (notes
 * carried forward) go with it and leave the draft: during the round,
 * notes accrue in the revision. */
export function freezeDraft(reviewDir: string): number {
  const draft = join(reviewDir, DRAFT);
  const next = (listRevisions(reviewDir).at(-1) ?? 0) + 1;
  const target = join(reviewDir, String(next));
  const building = `${target}.${process.pid}.tmp`;
  rmSync(building, { recursive: true, force: true });
  cpSync(draft, building, { recursive: true });
  for (const file of walkFiles(building)) {
    if (!isSidecar(file) && !file.startsWith(`${NOTE_IMAGES}/`)) chmodSync(join(building, file), 0o444);
  }
  renameSync(building, target);
  for (const file of walkFiles(draft)) if (isSidecar(file)) unlinkSync(join(draft, file));
  rmSync(join(draft, NOTE_IMAGES), { recursive: true, force: true });
  return next;
}

/** After a round, its notes come back to the draft, where the agent
 * resolves them in place: the revision's sidecars and the pictures they
 * show replace the draft's. A review without a draft (planted as numbered
 * revisions) gets one, copied from the revision. */
export function notesToDraft(reviewDir: string, revision: number): void {
  const draft = join(reviewDir, DRAFT);
  const frozen = join(reviewDir, String(revision));
  if (!existsSync(draft)) {
    cpSync(frozen, draft, { recursive: true });
    for (const file of walkFiles(draft)) chmodSync(join(draft, file), 0o644);
    return;
  }
  for (const file of walkFiles(draft)) if (isSidecar(file)) unlinkSync(join(draft, file));
  rmSync(join(draft, NOTE_IMAGES), { recursive: true, force: true });
  for (const file of walkFiles(frozen)) {
    if (!isSidecar(file) && !file.startsWith(`${NOTE_IMAGES}/`)) continue;
    const to = join(draft, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(frozen, file), to);
    chmodSync(to, 0o644);
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
  return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
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
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
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

export function readRevision(revisionDir: string): FactFile[] {
  return walkFacts(revisionDir).map((path) => {
    const sidecar = readSidecar(revisionDir, path);
    const fact: FactFile = { path, content: readText(join(revisionDir, path)), sidecar: sidecar ?? null };
    if (sidecar === null) fact.broken = true;
    return fact;
  });
}

/** Pasted pictures no note mentions any more. images/notes/ is the one
 * place the tool writes files into a revision, so the tool tidies it —
 * on the served revision only, when it is published and when its round
 * ends. A sidecar that does not parse may still mention a picture, so a
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
