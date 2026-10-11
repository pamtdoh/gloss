// M1 end-to-end check: on a disposable copy of the fixture repo, resolve its
// reviews directory, plant the agent-generated revision-1 fact tree (agents
// write files directly — planting IS the write path), then verify the review is
// structurally sound and readable entirely from the terminal.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
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

execFileSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "gloss-e2e-")));
let reviews = "";
try {
  // 1. Disposable fixture repo.
  cpSync(join(repoRoot, "tests/fixture"), tmp, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: tmp });

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
  check(dir(join(tmp, "src")).path === reviews, "every subdirectory resolves to the same reviews");
  check(dir(tmp).path === reviews, "dir is idempotent");
  check(status() === before, "nothing is scaffolded in the repo");

  // 3. The agent writes revision 1 (plain file writes of the generated tree).
  cpSync(
    join(repoRoot, "tests/generated-review/design-review"),
    join(reviews, "design-review"),
    { recursive: true },
  );

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

  // 6. The terminal reading path: the whole review, printed.
  console.log("\n=== <reviews>/design-review/1 ===");
  for (const f of facts) console.log(`  ${f}`);
  for (const f of files) {
    console.log(`\n--- ${relative(revision, f)} ---`);
    console.log(readFileSync(f, "utf8").trimEnd());
  }

  const groups = new Set(facts.filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
  console.log(
    `\n${failures === 0 ? "E2E PASS" : "E2E FAIL"}: ${facts.length} facts across ${groups.size} groups`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (reviews) rmSync(reviews, { recursive: true, force: true });
}
