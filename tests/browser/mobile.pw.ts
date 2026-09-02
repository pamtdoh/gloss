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

const root = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(root, "dist/gloss.js");
const PHONE = { width: 390, height: 844 };

let tmp: string;
let proc: ChildProcessWithoutNullStreams;
let url: string;
let context: BrowserContext;
let page: Page;

const sidecarPath = (relative: string) => join(tmp, ".gloss/design-review/2", relative);
const sidecar = (relative: string) => JSON.parse(readFileSync(sidecarPath(relative), "utf8"));

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  execFileSync("bun", ["run", "build"], { cwd: root });
  tmp = mkdtempSync(join(tmpdir(), "gloss-pwm-"));
  cpSync(join(root, "tests/fixture"), tmp, { recursive: true });
  execFileSync("node", [cli, "init"], { cwd: tmp });
  cpSync(
    join(root, "tests/generated-review/design-review"),
    join(tmp, ".gloss/design-review"),
    { recursive: true },
  );
  // revision 2 = iterated copy with one changed fact, so the phone can
  // exercise compare mode too
  cpSync(join(tmp, ".gloss/design-review/1"), join(tmp, ".gloss/design-review/2"), {
    recursive: true,
  });
  appendFileSync(
    join(tmp, ".gloss/design-review/2/storage/whole-file-writes.md"),
    "A write-through cache was considered and rejected for v1.\n",
  );
  proc = spawn("node", [cli, "session", "design-review", "--no-browser"], {
    cwd: tmp,
  });
  url = await new Promise((resolve) => {
    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const line = buffer.split("\n").find((l) => l.includes("session.started"));
      if (line) resolve(JSON.parse(line).url as string);
    });
  });
  context = await browser.newContext({ viewport: PHONE, hasTouch: true });
  page = await context.newPage();
  await page.goto(url);
  await expect(page.locator(".hamburger")).toBeVisible();
});

test.afterAll(async () => {
  await context?.close();
  if (proc && proc.exitCode === null) proc.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("phone layout: no horizontal scroll, compact header, panel closed", async () => {
  const overflow = await page.evaluate(() => ({
    doc: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.doc).toBe(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
  await expect(page.locator(".panel-col.panel")).toHaveCount(0);
  await expect(page.locator("#panel-fab")).toBeVisible();
  await expect(page).toHaveScreenshot("mobile-initial.png");
});

test("hamburger opens the tree drawer; tapping a fact navigates and closes it", async () => {
  await page.locator("#btn-tree").tap();
  await expect(page.locator(".tree-col")).toHaveAttribute("data-open", "");
  // revision switcher + search live in the drawer on mobile
  await expect(page.locator(".drawer-tools")).toBeVisible();
  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').tap();
  await expect(page.locator(".tree-col")).not.toHaveAttribute("data-open", "");
  await expect(page.locator("#fact-content h1")).toHaveText(
    "Every mutation rewrites the whole file",
  );
  // dwell marks it seen — wait so the screenshot is deterministic
  await expect(page.locator(".crumb .seen-check")).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveScreenshot("mobile-fact.png");
});

test("the review panel opens as a bottom sheet; a whole-fact comment writes and closes it", async () => {
  await page.locator("#panel-fab").tap();
  await expect(page.locator(".panel-col.panel")).toBeVisible();
  await expect(page).toHaveScreenshot("mobile-panel.png");
  // no keyboard on a phone: the panel's buttons are the whole-fact path
  await page.locator("#note-comment").tap();
  await expect(page.locator(".panel-col.panel #item-form")).toBeVisible();
  await page.locator("#item-input").fill("Simplify.");
  await page.locator("#item-save").tap();
  await expect
    .poll(
      () =>
        existsSync(sidecarPath("storage/whole-file-writes.review.json")) &&
        sidecar("storage/whole-file-writes.review.json"),
    )
    .toEqual({ items: [{ id: "c1", type: "comment", text: "Simplify." }] });
  // the sheet gets out of the way after an action
  await expect(page.locator(".panel-col.panel")).toHaveCount(0);
});

test("selection popup comments via touch (composer opens in the sheet)", async () => {
  await page.evaluate(() => {
    const container = document.getElementById("fact-content")!;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent!.indexOf("last write wins");
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + "last write wins".length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
    }
    throw new Error("text not found");
  });
  // on touch, nothing commits while the selection is live (a re-render
  // would make iOS drop the gesture); the collapse is what commits it
  await page.waitForTimeout(600);
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  await expect(page.locator("#sel-bar")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const pending = (CSS as unknown as { highlights: Map<string, Iterable<Range>> })
          .highlights.get("rk-pending");
        return pending ? [...pending].length : 0;
      }),
    )
    .toBeGreaterThan(0);
  await page.locator('#sel-bar button:has-text("Comment")').tap();
  // the composer must be visible inside the (auto-opened) bottom sheet
  await expect(page.locator(".panel-col.panel #item-form")).toBeVisible();
  await page.locator("#item-input").fill("Atomic rename, please.");
  await page.locator("#item-save").tap();
  await expect
    .poll(() =>
      sidecar("storage/whole-file-writes.review.json").items?.find(
        (i: { anchor?: unknown }) => i.anchor,
      ),
    )
    .toEqual({
      id: "c2",
      type: "comment",
      anchor: { quote: "last write wins" },
      text: "Atomic rename, please.",
    });
  // saving closes the sheet on mobile
  await expect(page.locator(".panel-col.panel")).toHaveCount(0);
});

test("book-style prev/next navigation walks the facts", async () => {
  await expect(page.locator(".crumb")).toContainText("storage/whole-file-writes.md");
  await expect(page.locator("#nav-prev .pagenav-label")).toHaveText("hit-counting.md");
  await page.locator("#nav-prev").tap();
  await expect(page.locator(".crumb")).toContainText("storage/hit-counting.md");
  await page.locator("#nav-next").tap();
  await expect(page.locator(".crumb")).toContainText("storage/whole-file-writes.md");
  // last row: next is disabled
  await expect(page.locator("#nav-next")).toBeDisabled();
});

test("a question thread opens as a subpage inside the bottom sheet", async () => {
  // an answered thread lands on disk (the poll picks it up), on the fact
  // the cursor is already on
  const path = sidecarPath("storage/whole-file-writes.review.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.items.push({
    id: "q1",
    type: "question",
    thread: [
      { who: "human", text: "Is the whole-file write ever fsynced?" },
      { who: "agent", text: "No — `writeFileSync` without fsync; a crash can lose the tail." },
    ],
  });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");

  await page.locator("#panel-fab").tap();
  const card = page.locator(".card.item-question");
  await expect(card.locator(".q-meta")).toContainText("1 reply", { timeout: 10_000 });
  await card.tap();
  await expect(page.locator(".panel-col.panel #thread-page")).toBeVisible();
  await expect(page.locator("#thread-page .msg.agent .msg-body")).toContainText("fsync");
  await expect(page.locator("#thread-reply-input")).toBeVisible();
  await page.locator("#thread-back").tap();
  await expect(page.locator("#thread-page")).toHaveCount(0);
  // close the sheet so later tests start from the reading view
  await page.locator('[aria-label="Collapse panel"]').tap();
  await expect(page.locator(".panel-col.panel")).toHaveCount(0);
});

test("compare mode works at phone width without sideways scroll", async () => {
  await page.locator("#btn-compare").tap();
  await expect(page.locator("#compare-bar")).toBeVisible();
  // the drawer opens on the scoped tree; the changed fact shows its diff
  await page.locator("#btn-tree").tap();
  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').tap();
  await expect(page.locator("#diff-view .rblock.changed")).toContainText("write-through cache");
  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
  );
  expect(overflow).toBe(0);
  await page.locator("#compare-exit").tap();
  await expect(page.locator("#compare-bar")).toHaveCount(0);
});

test("dark theme on mobile", async ({ browser }) => {
  const dark = await browser.newContext({
    viewport: PHONE,
    hasTouch: true,
    colorScheme: "dark",
    storageState: await context.storageState(), // the auth token is one-time
  });
  const darkPage = await dark.newPage();
  await darkPage.goto(new URL(url).origin + "/");
  await expect(darkPage.locator(".hamburger")).toBeVisible();
  await expect(darkPage).toHaveScreenshot("mobile-dark.png");
  await dark.close();
});
