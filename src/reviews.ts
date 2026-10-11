import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { failJson } from "./protocol.js";

// Where reviews live (ARCHITECTURE.md): outside the repo, in the OS temp
// directory, one directory per repo. Most reviews are never committed,
// so nothing is scaffolded in the working tree; the CLI owns the
// location and `gloss dir` reports it, so any harness that can run the
// CLI finds the same place.

/** The repo a command runs in: the nearest ancestor holding .git (a
 * directory, or a file in a worktree or submodule), else cwd itself —
 * so every subdirectory of a repo resolves to the same reviews. */
export function repoRoot(cwd: string): string {
  const start = realpathSync(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

/** This repo's reviews directory, absolute and native. Not created —
 * `gloss dir` does that; a session over a missing review just fails. */
export function reviewsDir(cwd: string): string {
  const root = repoRoot(cwd);
  const key = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return join(userTempDir(), `${basename(root) || "root"}-${key}`);
}

// On Linux the temp directory is /tmp, shared by every account. A
// per-user directory, created private and checked to be a real one this
// user owns, keeps others from reading reviews or planting a symlink in
// their path. Windows has no uid and already gives each user a temp dir.
function userTempDir(): string {
  const uid = process.getuid?.();
  const dir = join(tmpdir(), uid === undefined ? "gloss" : `gloss-${uid}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (uid !== undefined) {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
      failJson(`refusing to use ${dir}: not a private directory owned by this user`);
    }
  }
  return dir;
}
