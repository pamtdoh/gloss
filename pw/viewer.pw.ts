import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "packages/cli/dist/reviewkit.js");

let tmp: string;
let proc: ChildProcessWithoutNullStreams;
let exited: Promise<number>;
let context: BrowserContext;
let page: Page;
const stdoutLines: Record<string, unknown>[] = [];

const snap2 = (...parts: string[]) => join(tmp, ".reviewkit/design-review/2", ...parts);
const readSidecar = (relative: string) => JSON.parse(readFileSync(snap2(relative), "utf8"));

const RICH_FACT = `# The design in one picture

| piece | role |
|-------|------|
| facts | one claim per file |
| sidecars | the human's review state |

\`\`\`mermaid
flowchart LR
  A[facts] --> B[sidecars] --> C[approved/]
\`\`\`
`;

async function selectText(needle: string): Promise<void> {
  await page.evaluate((text) => {
    const container = document.getElementById("fact-content")!;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent!.indexOf(text);
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + text.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }
    throw new Error(`text not found in fact: ${text}`);
  }, needle);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  execFileSync("bun", ["run", "build"], { cwd: root });
  tmp = mkdtempSync(join(tmpdir(), "reviewkit-pw-"));
  cpSync(join(root, "e2e/fixture"), tmp, { recursive: true });
  execFileSync("node", [cli, "init"], { cwd: tmp });
  cpSync(
    join(root, "e2e/generated-review/design-review"),
    join(tmp, ".reviewkit/design-review"),
    { recursive: true },
  );
  // snapshot 2 = iterated copy: one changed fact, one new rich fact
  cpSync(join(tmp, ".reviewkit/design-review/1"), snap2(), { recursive: true });
  appendFileSync(
    snap2("storage/whole-file-writes.md"),
    "A write-through cache was considered and rejected for v1.\n",
  );
  writeFileSync(snap2("architecture.md"), RICH_FACT);

  proc = spawn("node", [cli, "session", "design-review", "--events", "--no-browser"], {
    cwd: tmp,
  });
  exited = new Promise((resolve) => proc.on("exit", (code) => resolve(code ?? -1)));
  let buffer = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) stdoutLines.push(JSON.parse(line));
    }
  });

  await expect
    .poll(() => stdoutLines.find((l) => l.event === "session.started"))
    .toBeTruthy();
  const url = stdoutLines.find((l) => l.event === "session.started")!.url as string;
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(url);
  await expect(page.locator(".tree .row")).toHaveCount(11); // 4 dirs + 7 facts
});

test.afterAll(async () => {
  await context?.close();
  if (proc && proc.exitCode === null) proc.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("initial render: nested tree, directory view for the first row", async () => {
  await expect(page.locator("#review-name")).toHaveText("design-review");
  await expect(page.locator("#progress")).toHaveText("0 / 10 reviewed");
  // first row is the cli/ directory; its view shows the child-fact table
  await expect(page.locator(".tree .row").first()).toHaveAttribute("data-kind", "dir");
  await expect(page.locator("#dir-view")).toBeVisible();
  await expect(page.locator("#fact-table .trow")).toHaveCount(1);
  // interdiff badges from snapshot 1 -> 2
  await expect(
    page.locator('.tree .row[data-path="storage/whole-file-writes.md"] .chip.changed'),
  ).toHaveText("changed");
  await expect(
    page.locator('.tree .row[data-path="architecture.md"] .chip.new'),
  ).toHaveText("new");
  await expect(page).toHaveScreenshot("viewer-initial.png");
});

test("j/k walk the tree; a directory row shows its _index fact", async () => {
  await page.keyboard.press("j"); // cli/add-and-list.md
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute(
    "data-path",
    "cli/add-and-list.md",
  );
  await expect(page.locator("#fact-content h1")).toHaveText(
    "The CLI is a second front door over the same store",
  );
  await page.keyboard.press("j"); // http/ directory
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute("data-path", "http");
  await expect(page.locator("#fact-content h1")).toHaveText(
    "The HTTP surface is two routes and nothing else",
  );
  await expect(page.locator("#fact-table .trow")).toHaveCount(2);
  await page.keyboard.press("k");
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute(
    "data-path",
    "cli/add-and-list.md",
  );
});

test("decision keys write sidecars; repeat clears; badges render", async () => {
  await page.locator('.tree .row[data-path="http/create-link.md"]').click();
  await page.keyboard.press("1");
  await expect
    .poll(() => existsSync(snap2("http/create-link.review.json")) && readSidecar("http/create-link.review.json"))
    .toEqual({ decision: "not-needed" });
  await expect(
    page.locator('.tree .row[data-path="http/create-link.md"] .chip.not-needed'),
  ).toHaveText("not-needed");

  await page.keyboard.press("1"); // toggle off — resolution is deletion
  await expect.poll(() => existsSync(snap2("http/create-link.review.json"))).toBe(false);

  await page.keyboard.press("2");
  await expect
    .poll(() => existsSync(snap2("http/create-link.review.json")) && readSidecar("http/create-link.review.json"))
    .toEqual({ decision: "simplify" });

  await page.keyboard.press("j");
  await page.keyboard.press("3");
  await expect
    .poll(() => existsSync(snap2("http/redirect.review.json")) && readSidecar("http/redirect.review.json"))
    .toEqual({ decision: "defer" });
});

test("directory table: bulk decision with undo toast", async () => {
  await page.locator('.tree .row[data-path="storage"]').click();
  await expect(page.locator("#fact-table .trow")).toHaveCount(2);
  for (const path of ["storage/hit-counting.md", "storage/whole-file-writes.md"]) {
    await page.locator(`#fact-table .trow[data-path="${path}"] input[type=checkbox]`).click();
  }
  await expect(page.locator("#bulkbar")).toContainText("2 selected");
  await page.locator('#bulkbar button:has-text("Not needed")').click();
  await expect
    .poll(() => existsSync(snap2("storage/hit-counting.review.json")) && readSidecar("storage/hit-counting.review.json"))
    .toEqual({ decision: "not-needed" });
  await expect
    .poll(() => existsSync(snap2("storage/whole-file-writes.review.json")) && readSidecar("storage/whole-file-writes.review.json"))
    .toEqual({ decision: "not-needed" });

  await expect(page.locator("#toast")).toContainText("Marked 2 facts not-needed");
  await page.locator('#toast button:has-text("Undo")').click();
  await expect.poll(() => existsSync(snap2("storage/hit-counting.review.json"))).toBe(false);
  await expect.poll(() => existsSync(snap2("storage/whole-file-writes.review.json"))).toBe(false);
});

test("reading a fact marks it seen automatically; v unmarks", async () => {
  await page.locator('.tree .row[data-path="slugs/collision-retry.md"]').click();
  await expect(
    page.locator('.tree .row[data-path="slugs/collision-retry.md"] .seen-dot'),
  ).toBeVisible({ timeout: 5_000 });
  const progress = await page.locator("#progress").textContent();
  expect(Number(progress!.split("/")[0])).toBeGreaterThan(0);
  await page.keyboard.press("v");
  await expect(
    page.locator('.tree .row[data-path="slugs/collision-retry.md"] .seen-dot'),
  ).toHaveCount(0);
});

test("selection annotation stores the verbatim quote and paints a highlight", async () => {
  // make seen state deterministic for the screenshot below
  await page.keyboard.press("/");
  await page.locator("#palette-input").fill(">mark all");
  await page.keyboard.press("Enter");
  await expect(page.locator("#progress")).toHaveText("10 / 10 reviewed");

  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').click();
  await selectText("last write wins");
  await expect(page.locator("#sel-hint")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.locator("#item-form")).toBeVisible();
  await expect(page.locator("#item-form-label")).toContainText("annotation");
  await page.locator("#item-input").fill("Consider write-through with an atomic rename.");
  await page.locator("#item-save").click();

  await expect
    .poll(() => existsSync(snap2("storage/whole-file-writes.review.json")))
    .toBe(true);
  const sidecar = readSidecar("storage/whole-file-writes.review.json");
  expect(sidecar.items).toEqual([
    {
      id: "a1",
      type: "annotation",
      anchor: { quote: "last write wins" },
      text: "Consider write-through with an atomic rename.",
    },
  ]);
  await expect(page.locator(".card.item-annotation blockquote")).toHaveText("last write wins");
  const highlights = await page.evaluate(() => [...(CSS as any).highlights.keys()]);
  expect(highlights).toContain("rk-anno");
  await expect(page).toHaveScreenshot("viewer-annotated.png");
});

test("anchored question emits question.asked and shows the header pill", async () => {
  await page.locator('.tree .row[data-path="slugs/collision-retry.md"]').click();
  await selectText("10 collisions");
  await page.keyboard.press("q");
  await page.locator("#item-input").fill("Why ten? Is that enough at scale?");
  await page.locator("#item-save").click();

  await expect.poll(() => existsSync(snap2("slugs/collision-retry.review.json"))).toBe(true);
  const sidecar = readSidecar("slugs/collision-retry.review.json");
  expect(sidecar.items[0]).toEqual({
    id: "q1",
    type: "question",
    anchor: { quote: "10 collisions" },
    thread: [{ who: "human", text: "Why ten? Is that enough at scale?" }],
  });
  await expect
    .poll(() =>
      stdoutLines.find(
        (l) => l.event === "question.asked" && l.path === "slugs/collision-retry.md",
      ),
    )
    .toMatchObject({ id: "q1" });
  await expect(page.locator("#question-pill")).toHaveText("1 open question");
});

test("an agent answer on disk appears live; the pill flips to your-turn", async () => {
  const path = snap2("slugs/collision-retry.review.json");
  const sidecar = JSON.parse(readFileSync(path, "utf8"));
  sidecar.items[0].thread.push({
    who: "agent",
    text: "At 62^6 slugs, ten retries only fail past ~50M links.",
  });
  writeFileSync(path, JSON.stringify(sidecar, null, 2) + "\n");

  await expect(page.locator(".card.item-question .who").nth(1)).toHaveText("agent", {
    timeout: 10_000,
  });
  await expect(page.locator("#question-pill")).toHaveText("1 answered — your turn");
});

test("the human replies in the same thread", async () => {
  await page.locator(".card.item-question .item-reply").click();
  await page.locator("#item-input").fill("Good enough — keeping it.");
  await page.locator("#item-save").click();
  await expect
    .poll(() =>
      readSidecar("slugs/collision-retry.review.json").items[0].thread.map(
        (t: { who: string }) => t.who,
      ),
    )
    .toEqual(["human", "agent", "human"]);
});

test("items can be edited and deleted from the card menu", async () => {
  await page.locator('.tree .row[data-path="cli/add-and-list.md"]').click();
  await page.keyboard.press("c");
  await page.locator("#item-input").fill("Nice.");
  await page.locator("#item-save").click();
  await expect
    .poll(() => existsSync(snap2("cli/add-and-list.review.json")) && readSidecar("cli/add-and-list.review.json"))
    .toMatchObject({ items: [{ id: "c1", type: "comment", text: "Nice." }] });

  await page.locator('.card[data-id="c1"] .menu-btn').click();
  await page.locator('.menu button:has-text("Edit")').click();
  await page.locator("#item-input").fill("Nice and small.");
  await page.locator("#item-save").click();
  await expect
    .poll(() => readSidecar("cli/add-and-list.review.json").items[0].text)
    .toBe("Nice and small.");

  await page.locator('.card[data-id="c1"] .menu-btn').click();
  await page.locator('.menu button:has-text("Delete")').click();
  await expect.poll(() => existsSync(snap2("cli/add-and-list.review.json"))).toBe(false);
  await expect(page.locator("#toast")).toContainText("Deleted c1");
  await page.locator('#toast button[aria-label="Dismiss"]').click();
});

test("rich facts render: GFM table and a mermaid diagram", async () => {
  await page.locator('.tree .row[data-path="architecture.md"]').click();
  await expect(page.locator("#fact-content table th").first()).toHaveText("piece");
  await expect(page.locator("#fact-content .rk-mermaid svg")).toBeVisible({ timeout: 15_000 });
});

test("tree filter narrows the tree; palette search jumps", async () => {
  await page.keyboard.press("f");
  await page.locator("#tree-filter").fill("collision");
  await expect(page.locator(".tree .row")).toHaveCount(2); // slugs/ + the match
  await page.keyboard.press("Escape");
  await expect(page.locator("#tree-filter")).toHaveValue("");
  await expect(page.locator(".tree .row")).toHaveCount(11);

  await page.keyboard.press("/");
  await page.locator("#palette-input").fill("collision");
  await expect(page.locator(".palette .result").first()).toContainText("collision");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute(
    "data-path",
    "slugs/collision-retry.md",
  );

  await page.keyboard.press("Shift+?");
  await expect(page.locator("#help-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#help-sheet")).toHaveCount(0);
});

test("finish flow: summary sheet, JSON summary, session exit 0", async () => {
  await page.locator("#btn-finish").click();
  await expect(page.locator("#finish-sheet")).toContainText("2 decisions");
  await expect(page.locator("#finish-sheet")).toContainText("1 open question");
  await page.locator("#confirm-finish").click();
  await expect(page.locator("#done")).toBeVisible();
  expect(await exited).toBe(0);

  const expectedSummary = {
    review: "design-review",
    snapshot: 2,
    facts: 10,
    decisions: { "not-needed": 0, simplify: 1, defer: 1, undecided: 8 },
    annotations: 1,
    comments: 0,
    openQuestions: 1,
    approved: false,
  };
  const finished = stdoutLines.find((l) => l.event === "session.finished");
  expect(finished?.summary).toEqual(expectedSummary);
  expect(stdoutLines[stdoutLines.length - 1]).toEqual(expectedSummary);
});
