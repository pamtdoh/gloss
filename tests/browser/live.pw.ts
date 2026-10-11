import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The long-running review server, end to end: one address for the whole
// review, every change pushed to every tab, the agent's status, rounds
// that end without ending the tab, and a review that stays readable after
// its server stops.

const root = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(root, "dist/gloss.js");

let tmp: string;
let review: string;
let url: string;
const contexts: BrowserContext[] = [];

const gloss = (...args: string[]) =>
  JSON.parse(execFileSync("node", [cli, ...args], { cwd: tmp, encoding: "utf8" }));
const sidecar = (revision: number, relative: string) =>
  JSON.parse(readFileSync(join(review, String(revision), relative), "utf8"));
const draftNotes = (relative: string) => JSON.parse(readFileSync(join(review, "draft", relative), "utf8"));

interface Session {
  lines: Record<string, any>[];
  exited: Promise<number>;
  proc: ChildProcessWithoutNullStreams;
}

async function startSession(): Promise<Session> {
  const proc = spawn("node", [cli, "session", "design-review", "--no-browser"], { cwd: tmp });
  const lines: Record<string, any>[] = [];
  const exited = new Promise<number>((resolve) => proc.on("exit", (code) => resolve(code ?? -1)));
  let buffer = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) lines.push(JSON.parse(line));
    }
  });
  await expect.poll(() => lines.find((l) => l.event === "session.started"), { timeout: 15_000 }).toBeTruthy();
  return { lines, exited, proc };
}

async function openTab(browser: Browser, serviceWorkers: "allow" | "block" = "block"): Promise<Page> {
  const context = await browser.newContext({ serviceWorkers });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.locator("#fact-content")).toBeVisible();
  return page;
}

async function comment(page: Page, factPath: string, text: string): Promise<void> {
  await page.locator(`.tree .row[data-path="${factPath}"]`).click();
  await page.locator("#fact-content").click(); // no selection: a whole-fact note
  await page.keyboard.press("c");
  await page.locator("#item-input").fill(text);
  await page.locator("#item-save").click();
}

test.describe.configure({ mode: "serial" });

let first: Session;

test.beforeAll(async () => {
  execFileSync("bun", ["run", "build"], { cwd: root });
  tmp = mkdtempSync(join(tmpdir(), "gloss-live-"));
  cpSync(join(root, "tests/fixture"), tmp, { recursive: true });
  review = join(gloss("dir").path, "design-review");
  cpSync(join(root, "tests/generated-review/design-review"), review, { recursive: true });
  first = await startSession();
  url = first.lines.find((l) => l.event === "session.started")!.url;
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
  if (tmp) execFileSync("node", [cli, "stop", "design-review"], { cwd: tmp });
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (review) rmSync(dirname(review), { recursive: true, force: true });
});

let tabA: Page;
let tabB: Page;

test("a note posted in one tab appears in another at once", async ({ browser }) => {
  tabA = await openTab(browser);
  tabB = await openTab(browser);
  await tabB.locator('.tree .row[data-path="cli/add-and-list.md"]').click();
  await comment(tabA, "cli/add-and-list.md", "Drop list; nobody reads it.");
  // no reload, no poll: the server pushes the change to every tab
  await expect(tabB.locator(".card.item-comment")).toContainText("Drop list", { timeout: 3000 });
  // notes are written to the draft while the round is open
  await expect.poll(() => existsSync(join(review, "draft/cli/add-and-list.review.json"))).toBe(true);
  expect(existsSync(join(review, "1/cli/add-and-list.review.json"))).toBe(false);
});

test("an agent answer reaches every tab; a stale tab's edit erases nothing", async () => {
  await tabA.locator('.tree .row[data-path="slugs/collision-retry.md"]').click();
  await tabB.locator('.tree .row[data-path="slugs/collision-retry.md"]').click();
  // tab B holds an open composer, the state that used to stop a tab from
  // taking in anything the others did
  await tabB.locator("#fact-content").click();
  await tabB.keyboard.press("c");
  await expect(tabB.locator("#item-input")).toBeVisible();

  await tabA.locator("#fact-content").click();
  await tabA.keyboard.press("q");
  await tabA.locator("#item-input").fill("Why ten retries?");
  await tabA.locator("#item-save").click();
  await expect.poll(() => first.lines.find((l) => l.event === "question.asked")).toMatchObject({
    path: "slugs/collision-retry.md",
    id: "q1",
  });
  gloss("reply", "design-review", "slugs/collision-retry.md", "q1", "--text", "Nothing chose ten; it is a guess.");
  await expect(tabA.locator(".card.item-question .q-preview")).toContainText("Nothing chose ten");

  // tab B posts its own comment on the same fact: one operation, so the
  // question and its answer — which tab B's composer sat through — stay
  await tabB.locator("#item-input").fill("Name the retry count's source.");
  await tabB.locator("#item-save").click();
  await expect.poll(() => draftNotes("slugs/collision-retry.review.json").items.length).toBe(2);
  const items = draftNotes("slugs/collision-retry.review.json").items;
  expect(items.map((i: { id: string }) => i.id)).toEqual(["q1", "c1"]);
  expect(items[0].thread.map((t: { who: string }) => t.who)).toEqual(["human", "agent"]);
  await expect(tabB.locator(".card.item-question")).toBeVisible();
});

test("the agent's status line shows in every tab", async () => {
  gloss("status", "design-review", "reading your notes");
  await expect(tabA.locator("#agent-status")).toContainText("reading your notes");
  await expect(tabB.locator("#agent-status")).toContainText("reading your notes");
});

test("finishing ends the round, not the tab", async () => {
  await tabA.locator("#btn-finish").click();
  await tabA.locator("#confirm-finish").click();
  expect(await first.exited).toBe(0);
  expect(first.lines.at(-1)).toMatchObject({ review: "design-review", revision: 1, comments: 2, openQuestions: 1 });
  for (const tab of [tabA, tabB]) {
    await expect(tab.locator("#round-banner")).toContainText("Review of revision 1 finished");
    await expect(tab.locator("#btn-finish")).toHaveCount(0);
  }
  // nothing more can be written to a finished round
  const refused = await tabA.evaluate(async () => {
    const res = await fetch("/api/op", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, path: "_index.md", op: "create", type: "comment", text: "late" }),
    });
    return res.status;
  });
  expect(refused).toBe(409);
});

let second: Session;

test("a new revision opens in the same tab, showing what changed", async () => {
  // the finished round's notes are revision 1's record now, and still in
  // the draft, where the agent works in place: resolve the notes, change
  // a fact, publish — no copying
  expect(sidecar(1, "cli/add-and-list.review.json")).toEqual(draftNotes("cli/add-and-list.review.json"));
  rmSync(join(review, "draft/cli/add-and-list.review.json"));
  rmSync(join(review, "draft/slugs/collision-retry.review.json"));
  writeFileSync(
    join(review, "draft/cli/add-and-list.md"),
    "# The CLI adds links\n\nThe list command was removed; nothing read it.\n",
  );
  second = await startSession();
  expect(second.lines[0]).toMatchObject({ revision: 2, frozen: true });
  expect(readFileSync(join(review, "2/cli/add-and-list.md"), "utf8")).toContain("list command was removed");
  // same address: the tab that was open all along follows
  expect(second.lines[0]).toMatchObject({ event: "session.started", revision: 2, url });
  for (const tab of [tabA, tabB]) {
    await expect(tab.locator("#toast")).toContainText("Revision 2 is ready");
    await expect(tab.locator("#compare-bar")).toContainText("Changes from revision");
    await expect(tab.locator("#round-banner")).toHaveCount(0);
    await expect(tab.locator("#btn-finish")).toBeVisible();
    await expect(tab.locator("#agent-status")).toHaveCount(0); // a new round clears it
  }
  // the changed scope leads, so the one changed fact is what's listed
  await expect(tabA.locator(".tree .row[data-path='cli/add-and-list.md']")).toBeVisible();
});

test("changes made while the server is down are kept and sent when it's back", async () => {
  await tabA.keyboard.press("d"); // out of compare: revision 2 itself
  await expect(tabA.locator("#compare-bar")).toHaveCount(0);
  const port = new URL(url).port;
  gloss("stop", "design-review");
  expect(await second.exited).not.toBe(0); // the round's stream ended without a finish
  await expect(tabA.locator("#conn-banner")).toBeVisible({ timeout: 8000 });

  await comment(tabA, "http/redirect.md", "Say what happens to a deleted slug.");
  await expect(tabA.locator("#unsaved-pill")).toHaveText("1 unsent");
  await expect(tabA.locator(".card.item-comment")).toContainText("deleted slug"); // shown meanwhile

  // the agent re-attaches; the server comes back on the same port, the tab
  // reconnects by itself and sends what it kept
  second = await startSession();
  expect(new URL(second.lines[0]!.url).port).toBe(port);
  await expect(tabA.locator("#conn-banner")).toHaveCount(0, { timeout: 10_000 });
  await expect(tabA.locator("#unsaved-pill")).toHaveCount(0);
  await expect
    .poll(() => existsSync(join(review, "draft/http/redirect.review.json")) && draftNotes("http/redirect.review.json").items[0].text)
    .toBe("Say what happens to a deleted slug.");
});

test("with its server gone, the review stays readable — across a reload", async ({ browser }) => {
  const tab = await openTab(browser, "allow");
  await tab.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // a reload under the worker's control, then a visit to every revision
  // so each is in its cache
  await tab.reload();
  await expect.poll(() => tab.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(tab.locator("#fact-content")).toBeVisible();

  gloss("stop", "design-review");
  await expect(tab.locator("#conn-banner")).toContainText("The review server was stopped", { timeout: 8000 });
  await tab.reload();
  await expect(tab.locator("#conn-banner")).toContainText("saved copy");
  await expect(tab.locator("#review-name")).toHaveText("design-review");
  await tab.locator('.tree .row[data-path="http/redirect.md"]').click();
  await expect(tab.locator("#fact-content")).toBeVisible();
  await expect(tab.locator(".card.item-comment")).toContainText("deleted slug");
  // nothing can be finished from a copy
  await expect(tab.locator("#btn-finish")).toHaveCount(0);
});

test("approval: the review is agreed, the server stops, the tab stays", async () => {
  second = await startSession();
  await expect(tabA.locator("#conn-banner")).toHaveCount(0, { timeout: 10_000 });
  await tabA.locator("#btn-finish").click();
  await tabA.locator("#confirm-approve").click();
  await tabA.locator("#approve-go").click();
  expect(await second.exited).toBe(0);
  expect(second.lines.at(-1)).toMatchObject({ revision: 2, approved: true });
  expect(existsSync(join(review, "approved/cli/add-and-list.md"))).toBe(true);
  // approving mid-round snapshots the open notes first: revision 2 and the
  // approval both carry them
  expect(sidecar(2, "http/redirect.review.json").items[0].text).toBe("Say what happens to a deleted slug.");
  expect(existsSync(join(review, "approved/http/redirect.review.json"))).toBe(true);
  await expect(tabA.locator("#conn-banner")).toContainText("approved", { timeout: 10_000 });
  await expect(tabA.locator("#fact-content")).toBeVisible();
});
