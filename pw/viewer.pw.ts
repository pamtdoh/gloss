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
const cli = join(root, "packages/cli/dist/gloss.js");

let tmp: string;
let proc: ChildProcessWithoutNullStreams;
let exited: Promise<number>;
let context: BrowserContext;
let page: Page;
const stdoutLines: Record<string, unknown>[] = [];

const snap2 = (...parts: string[]) => join(tmp, ".gloss/design-review/2", ...parts);
const readSidecar = (relative: string) => JSON.parse(readFileSync(snap2(relative), "utf8"));

const RICH_FACT = `# The design in one picture

| piece | role |
|-------|------|
| facts | one claim per file |
| sidecars | the human's review state |

\`\`\`json
{ "items": [ { "id": "c1", "type": "comment" } ] }
\`\`\`

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
  tmp = mkdtempSync(join(tmpdir(), "gloss-pw-"));
  cpSync(join(root, "e2e/fixture"), tmp, { recursive: true });
  execFileSync("node", [cli, "init"], { cwd: tmp });
  cpSync(
    join(root, "e2e/generated-review/design-review"),
    join(tmp, ".gloss/design-review"),
    { recursive: true },
  );
  // snapshot 2 = iterated copy: one changed fact, one new rich fact
  cpSync(join(tmp, ".gloss/design-review/1"), snap2(), { recursive: true });
  appendFileSync(
    snap2("storage/whole-file-writes.md"),
    "A write-through cache was considered and rejected for v1.\n",
  );
  writeFileSync(snap2("architecture.md"), RICH_FACT);
  // ...and one fact deleted between 1 and 2 (written to 1 only, after the copy)
  writeFileSync(
    join(tmp, ".gloss/design-review/1/slugs/legacy-dedupe.md"),
    "# Slugs are deduplicated by a nightly job\n\nThe old approach, dropped in snapshot 2.\n",
  );

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
  await expect(page.locator("#progress")).toContainText("0 / 10 reviewed");
  // first row is the cli/ directory; its view shows the child-fact table
  await expect(page.locator(".tree .row").first()).toHaveAttribute("data-kind", "dir");
  await expect(page.locator("#dir-view")).toBeVisible();
  await expect(page.locator("#fact-table .trow")).toHaveCount(1);
  // interdiff badges from snapshot 1 -> 2 (14px glyphs in the tree)
  await expect(
    page.locator('.tree .row[data-path="storage/whole-file-writes.md"] .gbadge.changed'),
  ).toBeVisible();
  await expect(
    page.locator('.tree .row[data-path="architecture.md"] .gbadge.new'),
  ).toBeVisible();
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

test("quick-comment keys write comment items; u undoes them", async () => {
  await page.locator('.tree .row[data-path="http/create-link.md"]').click();
  await page.keyboard.press("1");
  await expect
    .poll(() => existsSync(snap2("http/create-link.review.json")) && readSidecar("http/create-link.review.json"))
    .toEqual({ items: [{ id: "c1", type: "comment", text: "Not needed." }] });
  await expect(
    page.locator('.tree .row[data-path="http/create-link.md"] .chip.count'),
  ).toHaveText("1");

  await page.keyboard.press("u"); // undo — resolution is deletion
  await expect.poll(() => existsSync(snap2("http/create-link.review.json"))).toBe(false);

  await page.keyboard.press("2");
  await expect
    .poll(() => existsSync(snap2("http/create-link.review.json")) && readSidecar("http/create-link.review.json"))
    .toEqual({ items: [{ id: "c1", type: "comment", text: "Simplify." }] });

  await page.keyboard.press("j");
  await page.keyboard.press("3");
  await expect
    .poll(() => existsSync(snap2("http/redirect.review.json")) && readSidecar("http/redirect.review.json"))
    .toEqual({ items: [{ id: "c1", type: "comment", text: "Defer." }] });
});

test("directory table: bulk quick comments with undo toast", async () => {
  await page.locator('.tree .row[data-path="storage"]').click();
  await expect(page.locator("#fact-table .trow")).toHaveCount(2);
  for (const path of ["storage/hit-counting.md", "storage/whole-file-writes.md"]) {
    await page.locator(`#fact-table .trow[data-path="${path}"] [role=checkbox]`).click();
  }
  await expect(page.locator("#bulkbar")).toContainText("2 selected");
  await page.locator('#bulkbar button:has-text("Not needed")').click();
  await expect
    .poll(() => existsSync(snap2("storage/hit-counting.review.json")) && readSidecar("storage/hit-counting.review.json"))
    .toEqual({ items: [{ id: "c1", type: "comment", text: "Not needed." }] });
  await expect
    .poll(() => existsSync(snap2("storage/whole-file-writes.review.json")) && readSidecar("storage/whole-file-writes.review.json"))
    .toEqual({ items: [{ id: "c1", type: "comment", text: "Not needed." }] });

  await expect(page.locator("#toast")).toContainText("Commented “Not needed” on 2 facts");
  await page.locator('#toast button:has-text("Undo")').click();
  await expect.poll(() => existsSync(snap2("storage/hit-counting.review.json"))).toBe(false);
  await expect.poll(() => existsSync(snap2("storage/whole-file-writes.review.json"))).toBe(false);
});

test("reading a fact marks it seen automatically; v unmarks", async () => {
  await page.locator('.tree .row[data-path="slugs/collision-retry.md"]').click();
  await expect(
    page.locator('.tree .row[data-path="slugs/collision-retry.md"] .seen-check'),
  ).toBeVisible({ timeout: 5_000 });
  const progress = await page.locator("#progress").textContent();
  expect(Number(progress!.split("/")[0])).toBeGreaterThan(0);
  await page.keyboard.press("v");
  await expect(
    page.locator('.tree .row[data-path="slugs/collision-retry.md"] .seen-check'),
  ).toHaveCount(0);
});

test("selection comment stores the verbatim quote and paints a highlight", async () => {
  // make seen state deterministic for the screenshot below
  await page.keyboard.press("/");
  await page.locator("[cmdk-input]").fill("mark all facts");
  await page.keyboard.press("Enter");
  await expect(page.locator("#progress")).toContainText("10 / 10 reviewed");

  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').click();
  await selectText("last write wins");
  await expect(page.locator("#sel-pop")).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.locator("#item-form")).toBeVisible();
  await expect(page.locator("#item-form-label")).toContainText("comment");
  await page.locator("#item-input").fill("Consider write-through with an atomic rename.");
  await page.locator("#item-save").click();

  await expect
    .poll(() => existsSync(snap2("storage/whole-file-writes.review.json")))
    .toBe(true);
  const sidecar = readSidecar("storage/whole-file-writes.review.json");
  expect(sidecar.items).toEqual([
    {
      id: "c1",
      type: "comment",
      anchor: { quote: "last write wins" },
      text: "Consider write-through with an atomic rename.",
    },
  ]);
  await expect(page.locator(".card.item-comment blockquote")).toHaveText("last write wins");
  const highlights = await page.evaluate(() => [...(CSS as any).highlights.keys()]);
  expect(highlights).toContain("rk-anno");
  await expect(page).toHaveScreenshot("viewer-annotated.png");
});

test("a real mouse selection survives re-renders", async () => {
  // regression: React 19 diffs dangerouslySetInnerHTML by object identity,
  // so an inline {__html} object rewrote innerHTML on every re-render and
  // the browser dropped the live selection ~500ms after mouse-up
  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').click();
  const box = (await page.locator("#fact-content p").first().boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 10, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator("#sel-pop")).toBeVisible();
  await page.waitForTimeout(2500); // outlives the commit debounce and a poll tick
  expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(false);
  await expect(page.locator("#sel-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#sel-pop")).toHaveCount(0);
});

test("triple-click captures the whole paragraph, not a word", async () => {
  // regression: selection endpoints on ELEMENT nodes (triple-click) were
  // misread as char offsets, shrinking a sentence to a single word
  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').click();
  await page.locator("#fact-content p").first().click({ clickCount: 3 });
  await expect(page.locator("#sel-pop")).toBeVisible();
  const quote = await page.locator("#sel-pop").getAttribute("data-quote");
  expect(quote).toContain("addLink");
  expect(quote).toContain("last write wins");
  await page.keyboard.press("Escape");
  await expect(page.locator("#sel-pop")).toHaveCount(0);
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
  await expect(page.locator("#question-pill")).toContainText("1 open question");
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
  await expect(page.locator("#question-pill")).toContainText("1 answered — your turn");
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

test("notes can be edited and deleted from the card menu", async () => {
  await page.locator('.tree .row[data-path="cli/add-and-list.md"]').click();
  await page.keyboard.press("c"); // no selection = whole-fact comment
  await page.locator("#item-input").fill("Nice.");
  await page.locator("#item-save").click();
  await expect
    .poll(() => existsSync(snap2("cli/add-and-list.review.json")) && readSidecar("cli/add-and-list.review.json"))
    .toMatchObject({ items: [{ id: "c1", type: "comment", text: "Nice." }] });

  await page.locator('.card[data-id="c1"] .menu-btn').click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.locator("#item-input").fill("Nice and small.");
  await page.locator("#item-save").click();
  await expect
    .poll(() => readSidecar("cli/add-and-list.review.json").items[0].text)
    .toBe("Nice and small.");

  await page.locator('.card[data-id="c1"] .menu-btn').click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect.poll(() => existsSync(snap2("cli/add-and-list.review.json"))).toBe(false);
  await expect(page.locator("#toast")).toContainText("Deleted c1");
  await page.locator('#toast button[aria-label="Dismiss"]').click();
});

test("rich facts render: GFM table, mermaid, and code selections anchor", async () => {
  await page.locator('.tree .row[data-path="architecture.md"]').click();
  await expect(page.locator("#fact-content table th").first()).toHaveText("piece");
  await expect(page.locator("#fact-content .rk-mermaid svg")).toBeVisible({ timeout: 15_000 });
  // the diagram must survive a poll-driven re-render of its own fact
  writeFileSync(
    snap2("architecture.review.json"),
    JSON.stringify({ items: [{ id: "c9", type: "comment", text: "poll poke" }] }) + "\n",
  );
  await expect(page.locator(".card[data-id=c9]")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#fact-content .rk-mermaid svg")).toBeVisible();
  // and survive navigating away and back
  await page.locator("#nav-prev").click();
  await page.locator("#nav-next").click();
  await expect(page.locator("#fact-content .rk-mermaid svg")).toBeVisible();
  rmSync(snap2("architecture.review.json"));
  await expect(page.locator(".card[data-id=c9]")).toHaveCount(0, { timeout: 10_000 });
  // selecting inside a fenced code block must offer the comment bubble
  await selectText(`"type": "comment"`);
  await expect(page.locator("#sel-pop")).toBeVisible();
  await expect(page.locator("#sel-pop")).toHaveAttribute("data-quote", `"type": "comment"`);
  await page.keyboard.press("Escape");
  await expect(page.locator("#sel-pop")).toHaveCount(0);
});

test("tree filter narrows the tree; palette search jumps", async () => {
  await page.keyboard.press("f");
  await page.locator("#tree-filter").fill("collision");
  await expect(page.locator(".tree .row")).toHaveCount(2); // slugs/ + the match
  await page.keyboard.press("Escape");
  await expect(page.locator("#tree-filter")).toHaveValue("");
  await expect(page.locator(".tree .row")).toHaveCount(11);

  await page.keyboard.press("/");
  await page.locator("[cmdk-input]").fill("collision");
  await expect(page.locator("[cmdk-item][data-selected=true]")).toContainText("collision");
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

test("scope: changed shows changed/new plus a read-only ghost; raised shows noted facts", async () => {
  await page.locator("#scope-btn").click();
  await page.locator("#scope-changed").click();
  await expect(page.locator("#scope-btn")).toContainText("Changed");
  // changed: storage/whole-file-writes; new: architecture; removed ghost: slugs/legacy-dedupe
  await expect(page.locator('.tree .row[data-kind="fact"]')).toHaveCount(3);
  await expect(page.locator('.tree .row[data-path="slugs/legacy-dedupe.md"]')).toHaveClass(
    /ghost/,
  );

  // the ghost opens read-only: banner shown, no composer, no seen mark
  await page.locator('.tree .row[data-path="slugs/legacy-dedupe.md"]').click();
  await expect(page.locator("#ghost-banner")).toContainText("Removed in snapshot 2");
  await expect(page.locator("#fact-content h1")).toHaveText(
    "Slugs are deduplicated by a nightly job",
  );
  await page.keyboard.press("c");
  await expect(page.locator("#item-form")).toHaveCount(0);
  await page.keyboard.press("v");
  await expect(
    page.locator('.tree .row[data-path="slugs/legacy-dedupe.md"] .seen-check'),
  ).toHaveCount(0);

  // raised = facts carrying comments or questions at this point in the run:
  // http/create-link, http/redirect, slugs/collision-retry, storage/whole-file-writes
  await page.locator("#scope-btn").click();
  await page.locator("#scope-raised").click();
  await expect(page.locator('.tree .row[data-kind="fact"]')).toHaveCount(4);
  await expect(page.locator('.tree .row[data-path="storage/whole-file-writes.md"]')).toBeVisible();
  await expect(page.locator('.tree .row[data-path="slugs/collision-retry.md"]')).toBeVisible();

  // d cycles back around to all
  await page.keyboard.press("d");
  await expect(page.locator(".tree .row")).toHaveCount(11);
});

test("the URL names the page; back and forward walk the visited pages", async () => {
  await page.locator('.tree .row[data-path="cli/add-and-list.md"]').click();
  await expect(page).toHaveURL(/#cli\/add-and-list\.md$/);
  await page.locator('.tree .row[data-path="http/create-link.md"]').click();
  await expect(page).toHaveURL(/#http\/create-link\.md$/);
  await page.goBack();
  await expect(page).toHaveURL(/#cli\/add-and-list\.md$/);
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute(
    "data-path",
    "cli/add-and-list.md",
  );
  await page.goForward();
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute(
    "data-path",
    "http/create-link.md",
  );
  // a reload deep-links back to the same page
  await page.reload();
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute(
    "data-path",
    "http/create-link.md",
  );
});

test("theme button toggles dark/light and persists; system is a palette command", async () => {
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  expect(await isDark()).toBe(false); // test context is light-scheme
  await page.locator("#btn-theme").click();
  await expect.poll(isDark).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("rk-theme"))).toBe("dark");
  await page.reload();
  await expect.poll(isDark).toBe(true); // survives reload before first paint
  await page.locator("#btn-theme").click();
  await expect.poll(isDark).toBe(false);

  await page.keyboard.press("/");
  await page.locator("[cmdk-input]").fill("theme: system");
  await page.keyboard.press("Enter");
  await expect.poll(isDark).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("rk-theme"))).toBe(null);
});

test("older snapshots show a banner with a switch back to latest", async () => {
  await page.keyboard.press("/");
  await page.locator("[cmdk-input]").fill("switch to snapshot 1");
  await page.keyboard.press("Enter");
  await expect(page.locator("#stale-banner")).toContainText("Viewing snapshot 1 — latest is 2");
  await page.locator("#stale-banner button").click();
  await expect(page.locator("#stale-banner")).toHaveCount(0);
});

test("finish flow: summary sheet, JSON summary, session exit 0", async () => {
  await page.locator("#btn-finish").click();
  await expect(page.locator("#finish-sheet")).toContainText("4 facts with notes");
  await expect(page.locator("#finish-sheet")).toContainText("1 open question");
  await page.locator("#confirm-finish").click();
  await expect(page.locator("#done")).toBeVisible();
  expect(await exited).toBe(0);

  const expectedSummary = {
    review: "design-review",
    snapshot: 2,
    facts: 10,
    comments: 3, // two quick comments + one selection comment
    openQuestions: 1,
    approved: false,
  };
  const finished = stdoutLines.find((l) => l.event === "session.finished");
  expect(finished?.summary).toEqual(expectedSummary);
  expect(stdoutLines[stdoutLines.length - 1]).toEqual(expectedSummary);
});
