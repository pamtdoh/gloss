import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMeta, recordApproval, recordFinish, recordPublish } from "./meta.js";

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "gloss-meta-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const context = (branch: string, commit: string) => ({
  prompt: "review the checkout flow",
  repo: { name: "myapp", root: "/src/myapp", remote: "git@github.com:me/myapp.git" },
  state: { worktree: "/src/myapp-wt", branch, commit, dirty: false },
  agent: "claude-code",
});

test("the first round records where the review came from; later rounds add their code", () => {
  recordPublish(dir, "checkout", "0.2.0", 1, true, context("feature/pay", "aaa"));
  expect(readMeta(dir)).toMatchObject({
    review: "checkout",
    prompt: "review the checkout flow",
    gloss: "0.2.0",
    repo: { name: "myapp", remote: "git@github.com:me/myapp.git" },
    started: { worktree: "/src/myapp-wt", branch: "feature/pay" },
    agent: "claude-code",
    revisions: { "1": { branch: "feature/pay", commit: "aaa", dirty: false } },
  });
  // a later round, from another branch and with another prompt: the
  // origin stays as it was; the new revision records its own code
  recordPublish(dir, "checkout", "0.2.0", 2, true, { ...context("main", "bbb"), prompt: "something else" });
  const meta = readMeta(dir)!;
  expect(meta.prompt).toBe("review the checkout flow");
  expect(meta.started?.branch).toBe("feature/pay");
  expect(meta.revisions["2"]).toMatchObject({ branch: "main", commit: "bbb" });
});

test("serving a revision again keeps the code it was published with", () => {
  recordPublish(dir, "r", "v", 1, true, context("x", "aaa"));
  recordPublish(dir, "r", "v", 1, false, context("y", "ccc"));
  expect(readMeta(dir)!.revisions["1"]).toMatchObject({ branch: "x", commit: "aaa" });
});

test("a round's end and the approval are recorded", () => {
  recordPublish(dir, "r", "v", 1, true, {});
  recordFinish(dir, "r", "v", 1, { comments: 3, questions: 1 });
  recordApproval(dir, "r", "v", 1);
  const meta = readMeta(dir)!;
  expect(meta.revisions["1"]).toMatchObject({ comments: 3, questions: 1 });
  expect(meta.revisions["1"]!.finished).toBeString();
  expect(meta.approved?.revision).toBe(1);
});
