// M1 end-to-end check: on a disposable copy of the fixture repo, resolve its
// reviews directory, plant the agent-generated revision-1 fact tree (agents
// write files directly — planting IS the write path), then verify the review is
// structurally sound and readable entirely from the terminal.
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(repoRoot, "dist/gloss.js");

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? "ok" : "FAIL"} - ${label}`);
  if (!ok) failures++;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

interface Session {
  lines: Record<string, any>[];
  exited: Promise<number>;
  err: () => string;
}

function startSession(cwd: string, review: string): Session {
  const proc = spawn("node", [cli, "session", review, "--no-browser"], { cwd });
  const lines: Record<string, any>[] = [];
  let buffer = "";
  let err = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) lines.push(JSON.parse(line));
    }
  });
  proc.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
  const exited = new Promise<number>((resolve) => proc.on("exit", (code) => resolve(code ?? -1)));
  return { lines, exited, err: () => err };
}

async function until<T>(probe: () => T | undefined, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The viewer's write route, as a tab calls it. */
async function viewerPost(reviewDir: string, route: string, body: unknown): Promise<{ status: number; body: any }> {
  const { port } = JSON.parse(readFileSync(join(reviewDir, ".server.json"), "utf8"));
  const res = await fetch(`http://127.0.0.1:${port}/api/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function lifecycle(repo: string, reviews: string): Promise<void> {
  const reviewDir = join(reviews, "design-review");
  const gloss = (...args: string[]) => execFileSync("node", [cli, ...args], { cwd: repo, encoding: "utf8" });

  // a malformed operation is refused, not guessed at
  const round1 = startSession(repo, "design-review");
  await until(() => round1.lines[0]);
  const bogus = await viewerPost(reviewDir, "op", { revision: 1, path: "_index.md", op: "bogus", id: "q1" });
  check(bogus.status === 400 && bogus.body.error === "unknown op: bogus", "an unknown operation is refused with 400");
  const typed = await viewerPost(reviewDir, "op", { revision: 1, path: "_index.md", op: "create", type: "comment", text: 5 });
  check(typed.status === 400, "a non-text note is refused with 400");

  // a resolved note's id stays retired in later revisions
  const asked = await viewerPost(reviewDir, "op", { revision: 1, path: "_index.md", op: "create", type: "question", text: "Why?" });
  check(asked.body.id === "q1", "the first question is q1");
  await viewerPost(reviewDir, "finish", { revision: 1 });
  check((await round1.exited) === 0, "finishing ends the round's session");
  rmSync(join(reviewDir, "draft/_index.review.json")); // the agent resolved q1
  writeFileSync(join(reviewDir, "draft/_index.md"), readFileSync(join(reviewDir, "draft/_index.md"), "utf8") + "\nRevised.\n");
  const round2 = startSession(repo, "design-review");
  await until(() => round2.lines[0]);
  check(round2.lines[0]!.revision === 2, "a changed draft is frozen as revision 2");
  const again = await viewerPost(reviewDir, "op", { revision: 2, path: "_index.md", op: "create", type: "question", text: "And now?" });
  check(again.body.id === "q2", `a new question after q1 was resolved is q2, not q1 again (got ${again.body.id})`);

  // approving another revision mid-round ends the round and the session
  gloss("approve", "design-review", "--rev", "1");
  check((await round2.exited) === 0, "approving revision 1 while 2 is under review ends the session");
  check(round2.lines.some((l) => l.event === "session.finished"), "...with session.finished");
  check(existsSync(join(reviewDir, "2/_index.review.json")), "...and revision 2's open notes snapshotted");
  check(existsSync(join(reviewDir, "approved/_index.md")), "revision 1 is approved");

  // an approved review takes no more rounds
  await until(() => !existsSync(join(reviewDir, ".server.lock")) || undefined);
  const after = startSession(repo, "design-review");
  check((await after.exited) === 1 && after.err().includes("is approved"), "a session on an approved review is refused");
  check(!existsSync(join(reviewDir, ".server.lock")), "...without starting a server for it");

  // approval with no server running snapshots the open notes too
  const second = join(reviews, "second");
  cpSync(join(repoRoot, "tests/generated-review/design-review/1"), join(second, "draft"), { recursive: true });
  const round = startSession(repo, "second");
  await until(() => round.lines[0]);
  await viewerPost(second, "op", { revision: 1, path: "_index.md", op: "create", type: "comment", text: "Open note." });
  gloss("stop", "second");
  await round.exited;
  check(!existsSync(join(second, "1/_index.review.json")), "mid-round, the notes live in the draft only");
  gloss("approve", "second");
  check(
    existsSync(join(second, "approved/_index.review.json")) && existsSync(join(second, "1/_index.review.json")),
    "gloss approve with no server running carries the open notes",
  );
  await sleep(2000); // the server it started stops after approving
}

execFileSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "gloss-e2e-")));
// gloss's home for this run — never the real ~/.gloss
const home = realpathSync(mkdtempSync(join(tmpdir(), "gloss-e2e-home-")));
process.env.GLOSS_HOME = home;
const worktree = `${tmp}-wt`;
let reviews = "";
try {
  // 1. Disposable fixture repo.
  cpSync(join(repoRoot, "tests/fixture"), tmp, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
      cwd: tmp,
      stdio: "ignore",
    });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  git("worktree", "add", "-q", "-b", "feature/x", worktree);

  // 2. gloss dir — outside the repo, stable from any subdirectory, and
  // nothing scaffolded in the working tree.
  const dir = (cwd: string) =>
    JSON.parse(execFileSync("node", [cli, "dir"], { cwd, encoding: "utf8" }));
  const status = () =>
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: tmp, encoding: "utf8" });
  const before = status();
  const first = dir(tmp);
  reviews = first.path;
  check(first.ok === true && existsSync(reviews), "dir creates the reviews directory");
  check(relative(tmp, reviews).startsWith(".."), "reviews live outside the repo");
  check(reviews.startsWith(join(home, "reviews") + "/"), "...in gloss's home, under reviews/");
  check(dir(worktree).path === reviews, "a worktree of the repository shares its reviews");
  check(dir(join(tmp, "src")).path === reviews, "every subdirectory resolves to the same reviews");
  check(dir(tmp).path === reviews, "dir is idempotent");
  check(status() === before, "nothing is scaffolded in the repo");

  // 3. The agent writes the draft (plain file writes of the generated
  // tree), and the first round freezes it as revision 1.
  cpSync(
    join(repoRoot, "tests/generated-review/design-review/1"),
    join(reviews, "design-review/draft"),
    { recursive: true },
  );
  const session = spawn(
    "node",
    [cli, "session", "design-review", "--no-browser", "--prompt", "review the overall design"],
    { cwd: worktree },
  );
  const started = await new Promise<Record<string, unknown>>((resolve) =>
    session.stdout.once("data", (chunk: Buffer) => resolve(JSON.parse(chunk.toString().split("\n")[0]!))),
  );
  check(started.event === "session.started" && started.revision === 1 && started.frozen === true, "the first round freezes the draft as revision 1");
  execFileSync("node", [cli, "stop", "design-review"], { cwd: tmp });
  check(
    (statSync(join(reviews, "design-review/1/_index.md")).mode & 0o222) === 0,
    "a frozen revision's facts are read-only",
  );
  check(existsSync(join(reviews, "design-review/draft/_index.md")), "the draft stays, for the next round");
  const about = JSON.parse(readFileSync(join(reviews, "design-review/review.json"), "utf8"));
  check(about.prompt === "review the overall design", "review.json records the request");
  check(about.started?.branch === "feature/x" && about.started?.worktree === worktree, "...the worktree and branch it started in");
  check(/^[0-9a-f]{40}$/.test(about.revisions?.["1"]?.commit ?? ""), "...and the commit revision 1 described");

  // 4. Structural conventions from ARCHITECTURE.md.
  const revision = join(reviews, "design-review/1");
  const files = walk(revision);
  const facts = files.map((f) => relative(revision, f));
  check(facts.length >= 5, `revision 1 holds a real tree (${facts.length} files)`);
  check(facts.every((f) => f.endsWith(".md")), "revision 1 is facts only — all .md");
  check(!facts.some((f) => f.endsWith(".review.json")), "no sidecars at generation");
  check(facts.some((f) => f.endsWith("_index.md")), "at least one _index.md group fact");
  check(
    files.every((f) => readFileSync(f, "utf8").trim().length > 0),
    "every fact has content",
  );
  check(
    files.every((f) => readFileSync(f, "utf8").startsWith("# ")),
    "every fact opens with a # Title claim",
  );

  // 5. Skill install: one body, two mount points, identical content.
  const install = (flags: string[]) =>
    JSON.parse(execFileSync("node", [cli, "skill", "install", ...flags], { cwd: tmp, encoding: "utf8" }));
  const toClaude = install([]);
  const toAgents = install(["--agents"]);
  check(
    toClaude.ok === true && toClaude.installed.every((p: string) => p.startsWith(".claude/skills/")),
    "default install lands in .claude/skills/",
  );
  check(
    toAgents.ok === true && toAgents.installed.every((p: string) => p.startsWith(".agents/skills/")),
    "--agents install lands in .agents/skills/",
  );
  check(
    readFileSync(join(tmp, ".claude/skills/gloss/SKILL.md"), "utf8") ===
      readFileSync(join(tmp, ".agents/skills/gloss/SKILL.md"), "utf8"),
    "both destinations get identical skill content",
  );

  // 6. Rounds, ids, and approval at their edges, against real servers.
  await lifecycle(tmp, reviews);

  // 7. Past reviews: listed, opened read-only, removed.
  const listed = JSON.parse(execFileSync("node", [cli, "list"], { cwd: tmp, encoding: "utf8" }));
  const names = listed.reviews.map((r: { name: string }) => r.name).sort();
  check(names.join(",") === "design-review,second", `list shows the repository's reviews (${names})`);
  check(
    listed.reviews.find((r: { name: string }) => r.name === "design-review").prompt === "review the overall design",
    "...with the request each answers",
  );
  const opened = JSON.parse(execFileSync("node", [cli, "open", "design-review", "--no-browser"], { cwd: tmp, encoding: "utf8" }));
  const snapshot = (await (await fetch(new URL("/api/review", opened.url))).json()) as Record<string, any>;
  check(snapshot.review === "design-review" && snapshot.approved === 1, "open serves a past review, read-only");
  check(snapshot.about?.prompt === "review the overall design", "...with its review.json");

  // 8. The terminal reading path: the whole review, printed.
  console.log("\n=== <reviews>/design-review/1 ===");
  for (const f of facts) console.log(`  ${f}`);
  for (const f of files) {
    console.log(`\n--- ${relative(revision, f)} ---`);
    console.log(readFileSync(f, "utf8").trimEnd());
  }

  // last, since the printing above reads the review it deletes
  execFileSync("node", [cli, "rm", "design-review"], { cwd: tmp });
  check(!existsSync(join(reviews, "design-review")), "rm deletes a review, read-only revisions and all");

  const groups = new Set(facts.filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
  console.log(
    `\n${failures === 0 ? "E2E PASS" : "E2E FAIL"}: ${facts.length} facts across ${groups.size} groups`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  // servers outlive their sessions; a failed run must not leave them up
  for (const review of ["design-review", "second"]) {
    try {
      execFileSync("node", [cli, "stop", review], { cwd: tmp, stdio: "ignore" });
    } catch {
      // never started, or already gone
    }
  }
  rmSync(tmp, { recursive: true, force: true });
  rmSync(worktree, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  if (reviews) rmSync(reviews, { recursive: true, force: true });
}
