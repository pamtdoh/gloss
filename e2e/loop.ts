// M3 end-to-end check: the full review lifecycle as file operations on a
// disposable fixture — human review state written the way the viewer writes
// it, iteration as a plain revision copy, resolution as deletion, approval
// as promotion to approved/, and the implement skill's precondition. Also
// covers `gloss skill install` for both agents.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

const tmp = mkdtempSync(join(tmpdir(), "gloss-loop-"));
try {
  cpSync(join(repoRoot, "e2e/fixture"), tmp, { recursive: true });
  execFileSync("node", [cli, "init"], { cwd: tmp });
  cpSync(
    join(repoRoot, "e2e/generated-review/design-review"),
    join(tmp, ".gloss/design-review"),
    { recursive: true },
  );
  const review = join(tmp, ".gloss/design-review");

  // 1. The human reviews revision 1 — sidecars exactly as the viewer writes them.
  writeFileSync(
    join(review, "1/storage/whole-file-writes.review.json"),
    JSON.stringify(
      {
        items: [
          {
            id: "a1",
            type: "annotation",
            anchor: { quote: "last write wins" },
            text: "Write via a temp file and atomic rename.",
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(review, "1/http/_index.review.json"),
    JSON.stringify(
      { items: [{ id: "a1", type: "annotation", text: "Defer." }] },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(review, "1/slugs/collision-retry.review.json"),
    JSON.stringify(
      {
        items: [
          {
            id: "q1",
            type: "question",
            thread: [
              { who: "human", text: "Is ten retries enough?" },
              { who: "agent", text: "At 62^6 slugs, collisions stay negligible for years." },
            ],
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );

  // 2. Iterate: revision 2 is a plain standalone copy of revision 1.
  cpSync(join(review, "1"), join(review, "2"), { recursive: true });
  check(existsSync(join(review, "2/storage/whole-file-writes.review.json")),
    "sidecars travel with the revision copy");

  // 3. Resolve in revision 2: address the annotation by amending the fact,
  //    then delete the item; delete addressed decisions; keep the open question.
  const fact = join(review, "2/storage/whole-file-writes.md");
  writeFileSync(
    fact,
    readFileSync(fact, "utf8").trimEnd() +
      "\nWrites now go through a temp file and atomic rename; concurrent\nwriters no longer corrupt the store, though last-write-wins remains.\n",
  );
  unlinkSync(join(review, "2/storage/whole-file-writes.review.json"));
  unlinkSync(join(review, "2/http/_index.review.json"));
  const openQuestion = join(review, "2/slugs/collision-retry.review.json");
  check(existsSync(openQuestion), "unresolved question carries forward");

  // 4. The human settles the question in the next session; the agent then
  //    deletes it — a revision with no sidecars has addressed everything.
  unlinkSync(openQuestion);
  const remainingSidecars = walk(join(review, "2")).filter((f) => f.endsWith(".review.json"));
  check(remainingSidecars.length === 0, "resolution is deletion — no sidecars remain");

  // 5. Implement precondition before approval: approved/ must not exist.
  check(!existsSync(join(review, "approved")), "no approved/ before promotion");

  // 6. Approval is promotion: copy the accepted revision to approved/.
  cpSync(join(review, "2"), join(review, "approved"), { recursive: true });
  const approvedFacts = walk(join(review, "approved")).map((f) =>
    relative(join(review, "approved"), f),
  );
  const revisionFacts = walk(join(review, "2")).map((f) => relative(join(review, "2"), f));
  check(
    JSON.stringify(approvedFacts) === JSON.stringify(revisionFacts) &&
      approvedFacts.every(
        (f) =>
          readFileSync(join(review, "approved", f), "utf8") ===
          readFileSync(join(review, "2", f), "utf8"),
      ),
    "approved/ is a faithful copy of the accepted revision",
  );
  check(
    readFileSync(join(review, "approved/storage/whole-file-writes.md"), "utf8").includes(
      "atomic rename",
    ),
    "approved facts carry the iterated design",
  );

  // 7. skill install for both agents.
  for (const [agent, dest] of [
    ["claude", ".claude/skills"],
    ["codex", ".agents/skills"],
  ] as const) {
    const out = JSON.parse(
      execFileSync("node", [cli, "skill", "install", "--agent", agent], {
        cwd: tmp,
        encoding: "utf8",
      }),
    );
    check(out.ok === true && out.installed.length === 2, `skill install --agent ${agent}`);
    for (const name of ["gloss", "gloss-apply"]) {
      const path = join(tmp, dest, name, "SKILL.md");
      check(
        existsSync(path) && readFileSync(path, "utf8").includes(`name: ${name}`),
        `${dest}/${name}/SKILL.md installed`,
      );
    }
  }
  check(
    readFileSync(join(tmp, ".claude/skills/gloss/SKILL.md"), "utf8") ===
      readFileSync(join(tmp, ".agents/skills/gloss/SKILL.md"), "utf8"),
    "claude and codex get identical skill content",
  );

  console.log(`\n${failures === 0 ? "LOOP E2E PASS" : "LOOP E2E FAIL"}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
