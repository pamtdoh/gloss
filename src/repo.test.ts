import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCheckout, gitState, groupName, mainRoot, normalizeRemote, originUrl } from "./repo.js";

// Real repositories: a main checkout with a commit, a linked worktree on
// another branch, a second clone of the same remote, and a plain folder.
let base: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    stdio: "ignore",
  });

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "gloss-repo-")));
  const main = join(base, "myapp");
  mkdirSync(join(main, "src/deep"), { recursive: true });
  git(main, "init", "-q", "-b", "main");
  writeFileSync(join(main, "a.txt"), "a");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "init");
  git(main, "remote", "add", "origin", "git@github.com:Me/MyApp.git");
  git(main, "worktree", "add", "-q", "-b", "feature/pay", join(base, "myapp-wt"));
  const clone = join(base, "elsewhere/myapp-clone");
  mkdirSync(clone, { recursive: true });
  git(clone, "init", "-q");
  git(clone, "remote", "add", "origin", "https://github.com/me/myapp");
  mkdirSync(join(base, "plain"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("which repository a folder belongs to", () => {
  test("every worktree and subdirectory of a repository is one group", () => {
    const main = findCheckout(join(base, "myapp/src/deep"));
    const worktree = findCheckout(join(base, "myapp-wt"));
    expect(main.root).toBe(join(base, "myapp"));
    expect(worktree.root).toBe(join(base, "myapp-wt"));
    expect(worktree.commonDir).toBe(main.commonDir);
    expect(mainRoot(worktree)).toBe(join(base, "myapp"));
    expect(groupName(worktree, "repo")).toBe(groupName(main, "repo"));
    expect(groupName(main, "repo")).toMatch(/^myapp-[0-9a-f]{8}$/);
  });

  test("by checkout, each worktree is its own group (the old behavior)", () => {
    expect(groupName(findCheckout(join(base, "myapp-wt")), "checkout")).not.toBe(
      groupName(findCheckout(join(base, "myapp")), "checkout"),
    );
  });

  test("by remote, separate clones of one remote are one group", () => {
    const main = findCheckout(join(base, "myapp"));
    const clone = findCheckout(join(base, "elsewhere/myapp-clone"));
    expect(originUrl(main)).toBe("git@github.com:Me/MyApp.git");
    expect(groupName(clone, "remote")).toBe(groupName(main, "remote"));
    expect(groupName(clone, "repo")).not.toBe(groupName(main, "repo"));
  });

  test("a folder outside git is its own group", () => {
    const plain = findCheckout(join(base, "plain"));
    expect(plain.gitDir).toBeUndefined();
    expect(groupName(plain, "repo")).toMatch(/^plain-[0-9a-f]{8}$/);
  });

  test("remote URLs are compared in one spelling", () => {
    for (const url of [
      "git@github.com:me/myapp.git",
      "https://github.com/me/myapp",
      "ssh://git@GitHub.com/me/myapp.git",
      "https://user@github.com/me/myapp.git/",
    ]) {
      expect(normalizeRemote(url)).toBe("github.com/me/myapp");
    }
  });
});

test("git state: branch, commit, uncommitted changes", () => {
  const worktree = findCheckout(join(base, "myapp-wt"));
  const clean = gitState(worktree);
  expect(clean).toMatchObject({ worktree: join(base, "myapp-wt"), branch: "feature/pay", dirty: false });
  expect(clean.commit).toMatch(/^[0-9a-f]{40}$/);
  writeFileSync(join(base, "myapp-wt/b.txt"), "b");
  expect(gitState(worktree).dirty).toBe(true);
  expect(gitState(findCheckout(join(base, "plain")))).toEqual({ worktree: join(base, "plain") });
});
