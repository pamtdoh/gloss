import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./files.js";
import type { GitState } from "./repo.js";

// <review>/review.json (ARCHITECTURE.md): where a review came from and
// how each round went — the context a reader needs months later, which
// the folder structure cannot carry. Written by gloss only, at each
// publish, finish, and approval; plain JSON, readable without gloss.

export interface RevisionMeta {
  published: string;
  /** the code the revision described: the checkout it was published from */
  worktree?: string;
  branch?: string;
  commit?: string;
  dirty?: boolean;
  finished?: string;
  comments?: number;
  questions?: number;
}

export interface ReviewMeta {
  review: string;
  /** the request the review answers, as the human gave it */
  prompt?: string;
  created: string;
  repo?: { name: string; root: string; remote?: string };
  started?: { worktree: string; branch?: string };
  agent?: string;
  gloss: string;
  revisions: Record<string, RevisionMeta>;
  approved?: { revision: number; at: string };
}

/** What the CLI knows at publish time — where it runs, which can be any
 * worktree, unlike the long-running server. */
export interface PublishContext {
  prompt?: string;
  repo?: ReviewMeta["repo"];
  state?: GitState;
  agent?: string;
}

const metaPath = (reviewDir: string) => join(reviewDir, "review.json");

export function readMeta(reviewDir: string): ReviewMeta | null {
  if (!existsSync(metaPath(reviewDir))) return null;
  try {
    return JSON.parse(readFileSync(metaPath(reviewDir), "utf8"));
  } catch {
    return null;
  }
}

function update(reviewDir: string, review: string, version: string, change: (meta: ReviewMeta) => void): void {
  const meta: ReviewMeta = readMeta(reviewDir) ?? {
    review,
    created: new Date().toISOString(),
    gloss: version,
    revisions: {},
  };
  meta.revisions ??= {};
  change(meta);
  writeAtomic(metaPath(reviewDir), JSON.stringify(meta, null, 2) + "\n");
}

/** A round starts. The first one records where the review came from; a
 * newly frozen revision records the code it describes. */
export function recordPublish(
  reviewDir: string,
  review: string,
  version: string,
  revision: number,
  frozen: boolean,
  context: PublishContext,
): void {
  update(reviewDir, review, version, (meta) => {
    if (context.prompt && !meta.prompt) meta.prompt = context.prompt;
    if (context.repo && !meta.repo) meta.repo = context.repo;
    if (context.state && !meta.started) meta.started = { worktree: context.state.worktree, branch: context.state.branch };
    if (context.agent && !meta.agent) meta.agent = context.agent;
    const key = String(revision);
    if (frozen || !meta.revisions[key]) {
      meta.revisions[key] = { published: new Date().toISOString(), ...context.state };
    }
  });
}

export function recordFinish(
  reviewDir: string,
  review: string,
  version: string,
  revision: number,
  counts: { comments: number; questions: number },
): void {
  update(reviewDir, review, version, (meta) => {
    const entry = (meta.revisions[String(revision)] ??= { published: new Date().toISOString() });
    entry.finished = new Date().toISOString();
    entry.comments = counts.comments;
    entry.questions = counts.questions;
  });
}

export function recordApproval(reviewDir: string, review: string, version: string, revision: number): void {
  update(reviewDir, review, version, (meta) => {
    meta.approved = { revision, at: new Date().toISOString() };
  });
}
