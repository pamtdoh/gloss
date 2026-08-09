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
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "packages/cli/dist/reviewkit.js");
const PHONE = { width: 390, height: 844 };

let tmp: string;
let proc: ChildProcessWithoutNullStreams;
let url: string;
let context: BrowserContext;
let page: Page;

const sidecar = (relative: string) =>
  JSON.parse(readFileSync(join(tmp, ".reviewkit/design-review/1", relative), "utf8"));

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  execFileSync("bun", ["run", "build"], { cwd: root });
  tmp = mkdtempSync(join(tmpdir(), "reviewkit-pwm-"));
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
  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').tap();
  await expect(page.locator(".tree-col")).not.toHaveAttribute("data-open", "");
  await expect(page.locator("#fact-content h1")).toHaveText(
    "Every mutation rewrites the whole file",
  );
  // dwell marks it seen — wait so the screenshot is deterministic
  await expect(page.locator(".crumb .seen-check")).toBeVisible({ timeout: 5_000 });
  await expect(page).toHaveScreenshot("mobile-fact.png");
});

test("the review panel opens as a bottom sheet; decisions write sidecars", async () => {
  await page.locator("#panel-fab").tap();
  await expect(page.locator(".panel-col.panel")).toBeVisible();
  await page.locator('#decisions [data-decision="simplify"]').tap();
  await expect
    .poll(
      () =>
        existsSync(join(tmp, ".reviewkit/design-review/1/storage/whole-file-writes.review.json")) &&
        sidecar("storage/whole-file-writes.review.json"),
    )
    .toEqual({ decision: "simplify" });
  await expect(page).toHaveScreenshot("mobile-panel.png");
});

test("dark theme on mobile", async ({ browser }) => {
  const dark = await browser.newContext({
    viewport: PHONE,
    hasTouch: true,
    colorScheme: "dark",
    storageState: await context.storageState(), // the auth token is one-time
  });
  const darkPage = await dark.newPage();
  await darkPage.goto(url.split("/auth")[0] + "/");
  await expect(darkPage.locator(".hamburger")).toBeVisible();
  await expect(darkPage).toHaveScreenshot("mobile-dark.png");
  await dark.close();
});
