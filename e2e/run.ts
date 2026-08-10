// M1 end-to-end check: on a disposable copy of the fixture repo, initialize
// Gloss, plant the agent-generated revision-1 fact tree (agents write
// files directly — planting IS the write path), then verify the review is
// structurally sound and readable entirely from the terminal.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
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

const tmp = mkdtempSync(join(tmpdir(), "gloss-e2e-"));
try {
  // 1. Disposable fixture repo.
  cpSync(join(repoRoot, "e2e/fixture"), tmp, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: tmp });

  // 2. gloss init — fresh, then idempotent.
  const first = JSON.parse(
    execFileSync("node", [cli, "init"], { cwd: tmp, encoding: "utf8" }),
  );
  check(first.ok === true && first.created === true, "init scaffolds .gloss/");
  check(first.path === join(tmp, ".gloss"), "init reports the scaffolded path");
  const again = JSON.parse(
    execFileSync("node", [cli, "init"], { cwd: tmp, encoding: "utf8" }),
  );
  check(again.ok === true && again.created === false, "init is idempotent");
  check(
    readFileSync(join(tmp, ".gloss/.gitignore"), "utf8").includes(".local/"),
    "reserved .local/ is git-ignored",
  );

  // 3. The agent writes revision 1 (plain file writes of the generated tree).
  cpSync(
    join(repoRoot, "e2e/generated-review/design-review"),
    join(tmp, ".gloss/design-review"),
    { recursive: true },
  );

  // 4. Structural conventions from DESIGN.md §6.
  const revision = join(tmp, ".gloss/design-review/1");
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

  // 5. The terminal reading path: the whole review, printed.
  console.log("\n=== .gloss/design-review/1 ===");
  for (const f of facts) console.log(`  ${f}`);
  for (const f of files) {
    console.log(`\n--- ${relative(revision, f)} ---`);
    console.log(readFileSync(f, "utf8").trimEnd());
  }

  const groups = new Set(facts.filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
  console.log(
    `\n${failures === 0 ? "E2E PASS" : "E2E FAIL"}: ${facts.length} facts across ${groups.size} groups`,
  );
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
