import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { GroupBy } from "./home.js";

// Which repository a command runs in, read from git's own files so gloss
// needs no git binary for it. Every worktree of a repository shares one
// git directory — the common dir, the main checkout's .git — so keying
// reviews on it groups all worktrees together.

export interface Checkout {
  /** the working tree: the nearest ancestor holding .git, else cwd */
  root: string;
  /** this checkout's git dir (a worktree's is under the common dir) */
  gitDir?: string;
  /** the git dir every worktree of the repository shares */
  commonDir?: string;
}

export function findCheckout(cwd: string): Checkout {
  const start = realpathSync(cwd);
  for (let dir = start; ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      const gitDir = resolveGitDir(dir, dotGit);
      return { root: dir, gitDir, commonDir: gitDir && commonDirOf(gitDir) };
    }
    if (dirname(dir) === dir) return { root: start };
  }
}

/** .git is the git dir itself, or a file pointing at it ("gitdir: …") in
 * a worktree or a submodule. */
function resolveGitDir(root: string, dotGit: string): string | undefined {
  try {
    if (statSync(dotGit).isDirectory()) return realpathSync(dotGit);
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    return m ? realpathSync(resolve(root, m[1]!.trim())) : undefined;
  } catch {
    return undefined;
  }
}

/** A worktree's git dir names the shared one in its `commondir` file;
 * any other git dir (a main checkout's, a submodule's) is its own. */
function commonDirOf(gitDir: string): string {
  try {
    return realpathSync(resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim()));
  } catch {
    return gitDir;
  }
}

/** The repository's main working tree: where the common dir is `.git`. */
export function mainRoot(checkout: Checkout): string {
  const common = checkout.commonDir;
  if (!common) return checkout.root;
  return basename(common) === ".git" ? dirname(common) : common;
}

/** The `origin` remote's URL, from the shared git config. */
export function originUrl(checkout: Checkout): string | undefined {
  if (!checkout.commonDir) return undefined;
  try {
    const config = readFileSync(join(checkout.commonDir, "config"), "utf8");
    const section = /\[remote "origin"\]([^[]*)/.exec(config)?.[1] ?? "";
    return /^\s*url\s*=\s*(.+?)\s*$/m.exec(section)?.[1];
  } catch {
    return undefined;
  }
}

/** One spelling per remote, whatever the protocol: git@github.com:me/x.git
 * and https://github.com/me/x both become github.com/me/x. */
export function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d)/, "$1/")
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** The reviews folder's name for this checkout: `<name>-<hash>`, the hash
 * keeping two repositories of the same name apart. */
export function groupName(checkout: Checkout, by: GroupBy): string {
  let name: string;
  let identity: string;
  const remote = by === "remote" ? originUrl(checkout) : undefined;
  if (remote) {
    identity = normalizeRemote(remote);
    name = identity.split("/").at(-1)!;
  } else if (by === "checkout" || !checkout.commonDir) {
    identity = checkout.root;
    name = basename(checkout.root);
  } else {
    identity = checkout.commonDir;
    name = basename(mainRoot(checkout));
  }
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 8);
  return `${name.replace(/[^\w.-]/g, "_") || "root"}-${hash}`;
}

export interface GitState {
  worktree: string;
  branch?: string;
  commit?: string;
  /** uncommitted changes in the worktree when the revision was published */
  dirty?: boolean;
}

/** Where the code stands: the branch from git's HEAD file, the commit and
 * any uncommitted changes from git itself when it is installed. */
export function gitState(checkout: Checkout): GitState {
  const state: GitState = { worktree: checkout.root };
  if (!checkout.gitDir) return state;
  try {
    const head = readFileSync(join(checkout.gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (ref) state.branch = ref[1];
  } catch {
    // no HEAD: leave the branch out
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", checkout.root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    state.commit = git("rev-parse", "HEAD");
    state.dirty = git("status", "--porcelain").length > 0;
  } catch {
    // no git, or no commit yet
  }
  return state;
}
