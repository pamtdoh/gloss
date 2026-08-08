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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const snapshotPath = (...parts: string[]) =>
  join(tmp, ".reviewkit/design-review/1", ...parts);

const readSidecar = (relative: string) =>
  JSON.parse(readFileSync(snapshotPath(relative), "utf8"));

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
  await expect(page.locator(".fact-item")).toHaveCount(9);
});

test.afterAll(async () => {
  await context?.close();
  if (proc && proc.exitCode === null) proc.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("renders the fact tree with the first fact selected", async () => {
  await expect(page.locator(".fact-item").first()).toHaveClass(/selected/);
  await expect(page.locator(".fact-item").first()).toHaveAttribute(
    "data-path",
    "cli/add-and-list.md",
  );
  await expect(page.locator("#fact-content h1")).toHaveText(
    "The CLI is a second front door over the same store",
  );
  await expect(page).toHaveScreenshot("viewer-initial.png");
});

test("j/k navigate facts", async () => {
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.locator(".fact-item.selected")).toHaveAttribute(
    "data-path",
    "http/create-link.md",
  );
  await expect(page.locator("#fact-content h1")).toHaveText(
    "Link creation accepts any body without validation",
  );
  await page.keyboard.press("k");
  await expect(page.locator(".fact-item.selected")).toHaveAttribute(
    "data-path",
    "http/_index.md",
  );
});

test("decision keys write real sidecars; repeating a key clears it", async () => {
  // On http/_index.md from the previous test.
  await page.keyboard.press("1");
  await expect.poll(() => existsSync(snapshotPath("http/_index.review.json"))).toBe(true);
  expect(readSidecar("http/_index.review.json")).toEqual({ decision: "keep" });
  await expect(
    page.locator('.fact-item[data-path="http/_index.md"] .badge'),
  ).toHaveText("keep");

  // Toggle off: empty sidecar means agreement, so the file is deleted.
  await page.keyboard.press("1");
  await expect.poll(() => existsSync(snapshotPath("http/_index.review.json"))).toBe(false);

  await page.keyboard.press("3");
  await expect
    .poll(() => existsSync(snapshotPath("http/_index.review.json")) && readSidecar("http/_index.review.json"))
    .toEqual({ decision: "simplify" });

  await page.keyboard.press("j");
  await page.keyboard.press("2");
  await expect
    .poll(() => existsSync(snapshotPath("http/create-link.review.json")) && readSidecar("http/create-link.review.json"))
    .toEqual({ decision: "not-needed" });

  await page.keyboard.press("j");
  await page.keyboard.press("4");
  await expect
    .poll(() => existsSync(snapshotPath("http/redirect.review.json")) && readSidecar("http/redirect.review.json"))
    .toEqual({ decision: "defer" });
});

test("a selection annotation writes an anchored sidecar item", async () => {
  await page.locator('.fact-item[data-path="storage/whole-file-writes.md"]').click();
  await selectText("last write wins");
  await page.keyboard.press("a");
  await expect(page.locator("#item-form")).toBeVisible();
  await expect(page.locator("#item-form-label")).toContainText("annotation");
  await page.locator("#item-input").fill("Consider write-through with an atomic rename.");
  await page.locator("#item-save").click();

  await expect
    .poll(() => existsSync(snapshotPath("storage/whole-file-writes.review.json")))
    .toBe(true);
  const sidecar = readSidecar("storage/whole-file-writes.review.json");
  expect(sidecar.items).toHaveLength(1);
  expect(sidecar.items[0]).toEqual({
    id: "a1",
    type: "annotation",
    anchor: { quote: "last write wins" },
    text: "Consider write-through with an atomic rename.",
  });
  await expect(page.locator(".item-annotation blockquote")).toHaveText("last write wins");
  await expect(page).toHaveScreenshot("viewer-annotated.png");
});

test("an anchored question writes a human thread and emits question.asked", async () => {
  await page.locator('.fact-item[data-path="slugs/collision-retry.md"]').click();
  await selectText("10 collisions");
  await page.keyboard.press("q");
  await page.locator("#item-input").fill("Why ten? Is that enough at scale?");
  await page.locator("#item-save").click();

  await expect
    .poll(() => existsSync(snapshotPath("slugs/collision-retry.review.json")))
    .toBe(true);
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
    .toMatchObject({ id: "q1", text: "Why ten? Is that enough at scale?" });
});

test("an agent answer written to the sidecar appears live, mid-session", async () => {
  // The agent answers by editing the file directly — no API, no reload.
  const path = snapshotPath("slugs/collision-retry.review.json");
  const sidecar = JSON.parse(readFileSync(path, "utf8"));
  sidecar.items[0].thread.push({
    who: "agent",
    text: "At 62^6 slugs, ten retries only fail past ~50M links.",
  });
  writeFileSync(path, JSON.stringify(sidecar, null, 2) + "\n");

  const thread = page.locator(".item-question .who");
  await expect(thread.nth(1)).toHaveText("agent", { timeout: 10_000 });
  await expect(page.locator(".item-question")).toContainText("ten retries only fail");
});

test("the human replies in the same thread", async () => {
  await page.locator(".item-question .item-reply").click();
  await page.locator("#item-input").fill("Good enough — keeping it.");
  await page.locator("#item-save").click();

  await expect
    .poll(() =>
      JSON.parse(
        readFileSync(snapshotPath("slugs/collision-retry.review.json"), "utf8"),
      ).items[0].thread.map((t: { who: string }) => t.who),
    )
    .toEqual(["human", "agent", "human"]);
});

test("undo removes the last comment; empty sidecar is deleted", async () => {
  await page.locator('.fact-item[data-path="cli/add-and-list.md"]').click();
  await page.keyboard.press("c");
  await page.locator("#item-input").fill("Nice and small.");
  await page.locator("#item-save").click();
  await expect
    .poll(() => existsSync(snapshotPath("cli/add-and-list.review.json")) && readSidecar("cli/add-and-list.review.json"))
    .toMatchObject({ items: [{ id: "c1", type: "comment", text: "Nice and small." }] });

  await page.keyboard.press("u");
  await expect.poll(() => existsSync(snapshotPath("cli/add-and-list.review.json"))).toBe(false);
});

test("finish review ends the session with a JSON summary", async () => {
  await page.locator("#btn-finish").click();
  await expect(page.locator("#overlay")).toBeVisible();
  expect(await exited).toBe(0);

  const expectedSummary = {
    review: "design-review",
    snapshot: 1,
    facts: 9,
    decisions: { keep: 0, "not-needed": 1, simplify: 1, defer: 1, undecided: 6 },
    annotations: 1,
    comments: 0,
    openQuestions: 1,
    approved: false,
  };
  const finished = stdoutLines.find((l) => l.event === "session.finished");
  expect(finished?.summary).toEqual(expectedSummary);
  // The last stdout line is the bare summary — the blocking command's result.
  expect(stdoutLines[stdoutLines.length - 1]).toEqual(expectedSummary);
});
