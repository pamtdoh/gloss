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
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const cli = join(root, "dist/gloss.js");

let tmp: string;
let proc: ChildProcessWithoutNullStreams;
let exited: Promise<number>;
let context: BrowserContext;
let page: Page;
const stdoutLines: Record<string, unknown>[] = [];

const snap2 = (...parts: string[]) => join(tmp, ".gloss/design-review/2", ...parts);
const readSidecar = (relative: string) => JSON.parse(readFileSync(snap2(relative), "utf8"));

// the agent's one live-session write, as the CLI call the skill makes;
// the error paths speak JSON on stderr and exit 1
function glossReply(
  factPath: string,
  id: string,
  text: string,
): { status: number; out: string; err: string } {
  try {
    const out = execFileSync("node", [cli, "reply", "design-review", factPath, id, "--text", text], {
      cwd: tmp,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out, err: "" };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, out: e.stdout.toString(), err: e.stderr.toString() };
  }
}

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

![fact tree](tree.png)

![review loop](loop.png)
`;

// minimal solid-color PNG encoder — the images must be larger than the
// viewport for PhotoSwipe to offer a secondary zoom level
function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    const wrap = Buffer.alloc(8);
    wrap.writeUInt32BE(data.length, 0);
    wrap.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 4);
    return Buffer.concat([wrap.subarray(0, 4), body, wrap.subarray(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor rgb
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const idat = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
  cpSync(join(root, "tests/fixture"), tmp, { recursive: true });
  execFileSync("node", [cli, "init"], { cwd: tmp });
  cpSync(
    join(root, "tests/generated-review/design-review"),
    join(tmp, ".gloss/design-review"),
    { recursive: true },
  );
  // revision 2 = iterated copy: one changed fact, one new rich fact.
  // The changed fact also carries a mermaid diagram edited between the
  // revisions — the rendered compare layout must diff it without crashing
  // and render it as a diagram (regression: a changed mermaid block threw
  // in the highlight effect and blanked the page).
  cpSync(join(tmp, ".gloss/design-review/1"), snap2(), { recursive: true });
  const mermaidFence = (label: string) =>
    "\n```mermaid\nflowchart LR\n  W[writer] --> " + label + "\n```\n";
  appendFileSync(
    join(tmp, ".gloss/design-review/1/storage/whole-file-writes.md"),
    mermaidFence("S[store]"),
  );
  appendFileSync(
    snap2("storage/whole-file-writes.md"),
    mermaidFence("F[full file]") +
      "\nA write-through cache was considered and rejected for v1.\n",
  );
  writeFileSync(
    snap2("storage/whole-file-writes.md"),
    readFileSync(snap2("storage/whole-file-writes.md"), "utf8").replace(
      "change one entry",
      "change a single entry",
    ),
  );
  writeFileSync(snap2("architecture.md"), RICH_FACT);
  writeFileSync(snap2("tree.png"), png(1600, 1000, [122, 140, 118]));
  writeFileSync(snap2("loop.png"), png(1600, 1000, [70, 82, 104]));
  // ...and one fact deleted between 1 and 2 (written to 1 only, after the copy)
  writeFileSync(
    join(tmp, ".gloss/design-review/1/slugs/legacy-dedupe.md"),
    "# Slugs are deduplicated by a nightly job\n\nThe old approach, dropped in revision 2.\n",
  );

  proc = spawn("node", [cli, "session", "design-review", "--no-browser"], {
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

test("initial render: nested tree, first fact shown", async () => {
  await expect(page.locator("#review-name")).toHaveText("design-review");
  await expect(page.locator("#progress")).toContainText("0 / 10 reviewed");
  // root sorts dirs and facts together: architecture.md leads
  await expect(page.locator(".tree .row").first()).toHaveAttribute(
    "data-path",
    "architecture.md",
  );
  // interdiff badges from revision 1 -> 2 (14px glyphs in the tree)
  await expect(
    page.locator('.tree .row[data-path="storage/whole-file-writes.md"] .gbadge.changed'),
  ).toBeVisible();
  await expect(
    page.locator('.tree .row[data-path="architecture.md"] .gbadge.new'),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("viewer-initial.png");
});

test("j/k walk the tree; a directory row shows its _index fact", async () => {
  await page.keyboard.press("j"); // cli/ directory
  await expect(page.locator(".tree .row.cursor")).toHaveAttribute("data-path", "cli");
  await expect(page.locator("#dir-view")).toBeVisible();
  await expect(page.locator("#fact-table .trow")).toHaveCount(1);
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
  // make seen state deterministic for the screenshot below: seen is
  // content-keyed per review in localStorage
  await page.evaluate(async () => {
    const review = (await (await fetch("/api/review")).json()) as {
      review: string;
      facts: { path: string; content: string }[];
    };
    const store: Record<string, string> = {};
    for (const fact of review.facts) store[fact.path] = fact.content;
    localStorage.setItem(`rk-seen2:${review.review}`, JSON.stringify(store));
  });
  await page.reload();
  await expect(page.locator("#progress")).toContainText("10 / 10 reviewed");

  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').click();
  // the staged diagram's first render splices new innerHTML — let it
  // finish so the selection below isn't dropped by the rewrite
  await expect(page.locator("#fact-content .rk-mermaid svg")).toBeVisible({ timeout: 15_000 });
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

test("a gloss reply lands in the folded card; retries dedupe", async () => {
  const answer = "At 62^6 slugs, ten retries only fail past ~50M links.";
  const reply = () => glossReply("slugs/collision-retry.md", "q1", answer);
  // the ACK is bare — the sidecar file is the record
  expect(JSON.parse(reply().out)).toEqual({ ok: true });
  // an identical resend is ACKed, not appended — the duplication bug
  // gloss reply exists to remove
  expect(JSON.parse(reply().out)).toEqual({ ok: true });
  expect(readSidecar("slugs/collision-retry.review.json").items[0].thread).toHaveLength(2);

  // the error paths: unknown item, reply to a comment
  const replyTo = (factPath: string, id: string) => glossReply(factPath, id, "x");
  const unknown = replyTo("slugs/collision-retry.md", "q9");
  expect(unknown.status).toBe(1);
  expect(JSON.parse(unknown.err)).toMatchObject({ ok: false, error: "no item q9 on slugs/collision-retry.md" });
  const toComment = replyTo("http/create-link.md", "c1");
  expect(toComment.status).toBe(1);
  expect(JSON.parse(toComment.err).error).toContain("c1 is a comment");

  // the folded question card summarizes the thread instead of inlining it
  const card = page.locator(".card.item-question");
  await expect(card.locator(".q-preview")).toContainText("Agent: At 62^6", {
    timeout: 10_000,
  });
  await expect(card.locator(".q-meta")).toContainText("1 reply");
  await expect(card.locator(".chip.q")).toHaveText("your turn");
  await expect(page.locator("#question-pill")).toContainText("1 answered — your turn");
});

test("the thread opens as a panel subpage; the human replies there", async () => {
  await page.locator(".card.item-question").click();
  await expect(page.locator("#thread-page")).toBeVisible();
  // two speakers, visually distinct: tinted human card, labeled agent turn
  await expect(page.locator("#thread-page .msg.human .msg-body").first()).toContainText(
    "Why ten?",
  );
  await expect(page.locator("#thread-page .msg.agent .msg-who")).toContainText("Agent");
  await expect(page).toHaveScreenshot("viewer-thread.png");

  await page.locator("#thread-reply-input").fill("Good enough — keeping it.");
  await page.locator("#thread-send").click();
  await expect
    .poll(() =>
      readSidecar("slugs/collision-retry.review.json").items[0].thread.map(
        (t: { who: string }) => t.who,
      ),
    )
    .toEqual(["human", "agent", "human"]);
  // the reply travels to the agent as an event
  await expect
    .poll(() =>
      stdoutLines.find(
        (l) => l.event === "question.replied" && l.path === "slugs/collision-retry.md",
      ),
    )
    .toMatchObject({ id: "q1" });
  await expect(page.locator("#thread-page .msg")).toHaveCount(3);

  // a reply arriving over gloss reply while the thread is open shows up
  // in place — the live Q&A loop the 2s poll exists for — and an unsent
  // draft in the reply box survives it
  await page.locator("#thread-reply-input").fill("draft in progress");
  expect(glossReply("slugs/collision-retry.md", "q1", "Keeping it, then.").status).toBe(0);
  await expect(page.locator("#thread-page .msg")).toHaveCount(4, { timeout: 10_000 });
  await expect(page.locator("#thread-page .msg").last()).toContainText("Keeping it, then.");
  await expect(page.locator("#thread-reply-input")).toHaveValue("draft in progress");

  // escape in the reply box only leaves the field (the draft is kept);
  // the next escape closes the thread
  await page.locator("#thread-reply-input").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#thread-page")).toBeVisible();
  await expect(page.locator("#thread-reply-input")).toHaveValue("draft in progress");
  await page.keyboard.press("Escape");
  await expect(page.locator("#thread-page")).toHaveCount(0);

  // back returns to the notes list too
  await page.locator(".card.item-question").click();
  await expect(page.locator("#thread-page")).toBeVisible();
  await page.locator("#thread-back").click();
  await expect(page.locator("#thread-page")).toHaveCount(0);
  await expect(page.locator("#quick-comment")).toBeVisible();
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
  // and survive navigating away and back (architecture.md is the first
  // row, so away is forward)
  await page.locator("#nav-next").click();
  await page.locator("#nav-prev").click();
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

test("images open a PhotoSwipe lightbox: navigate, zoom, close", async () => {
  await page.locator('.tree .row[data-path="architecture.md"]').click();
  await page.locator('#fact-content img[alt="fact tree"]').click();
  const box = page.locator(".pswp");
  await expect(box).toBeVisible();
  await expect(box.locator(".pswp__counter")).toHaveText("1 / 2");

  await box.locator(".pswp__button--arrow--next").click();
  await expect(box.locator(".pswp__counter")).toHaveText("2 / 2");
  await page.keyboard.press("ArrowLeft"); // must page the lightbox, not collapse a tree dir
  await expect(box.locator(".pswp__counter")).toHaveText("1 / 2");

  await box.locator(".pswp__button--zoom").click();
  await expect(box).toHaveClass(/pswp--zoomed-in/);

  await page.keyboard.press("Escape");
  await expect(page.locator(".pswp")).toHaveCount(0);
  // Escape stayed inside the lightbox — the fact page is still up
  await expect(page.locator("#fact-content table th").first()).toHaveText("piece");
});

test("tree filter narrows the tree; ? opens help", async () => {
  await page.keyboard.press("f");
  await page.locator("#tree-filter").fill("collision");
  await expect(page.locator(".tree .row")).toHaveCount(2); // slugs/ + the match
  await page.locator('.tree .row[data-path="slugs/collision-retry.md"]').click();
  await page.locator("#tree-filter").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#tree-filter")).toHaveValue("");
  await expect(page.locator(".tree .row")).toHaveCount(11);
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
  await expect(page.locator("#ghost-banner")).toContainText("Removed in revision 2");
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

test("theme button toggles dark/light and persists", async () => {
  const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
  expect(await isDark()).toBe(false); // test context is light-scheme
  await page.locator("#btn-theme").click();
  await expect.poll(isDark).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("rk-theme"))).toBe("dark");
  await page.reload();
  await expect.poll(isDark).toBe(true); // survives reload before first paint
  await page.locator("#btn-theme").click();
  await expect.poll(isDark).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("rk-theme"))).toBe("light");
});

test("a revision the session doesn't serve is read-only", async () => {
  await page.locator("#revision-select").click();
  await page.getByRole("option", { name: "Revision 1" }).click();
  await expect(page.locator("#stale-banner")).toContainText(
    "Viewing revision 1 read-only — the session serves 2",
  );
  // no composer, no quick-comment writes, no seen marks
  await page.locator('.tree .row[data-path="cli/add-and-list.md"]').click();
  await page.keyboard.press("c");
  await expect(page.locator("#item-form")).toHaveCount(0);
  await page.keyboard.press("1");
  await expect(page.locator("#quick-comment")).toHaveCount(0); // read-only panel
  await expect(page.locator(".panel h2").first()).toContainText("Notes on revision 1");
  // the server refuses the write even if a client tries
  const put = await page.evaluate(async () => {
    const res = await fetch("/api/sidecar", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: 1, path: "cli/add-and-list.md", sidecar: { items: [{ id: "c9", type: "comment", text: "x" }] } }),
    });
    return { status: res.status, body: await res.json() };
  });
  expect(put.status).toBe(400);
  expect(put.body.error).toContain("read-only");
  await page.locator("#stale-banner button").click();
  await expect(page.locator("#stale-banner")).toHaveCount(0);
});

test("compare mode: diff of changed facts, base notes read-only", async () => {
  // a note left on revision 1, so the compare panel has history to show
  writeFileSync(
    join(tmp, ".gloss/design-review/1/storage/whole-file-writes.review.json"),
    JSON.stringify({
      items: [
        { id: "c1", type: "comment", text: "Tighten the failure story." },
        {
          id: "q1",
          type: "question",
          thread: [
            { who: "human", text: "Is there any locking at all?" },
            { who: "agent", text: "None — both writers rewrite the whole file." },
          ],
        },
      ],
    }) + "\n",
  );

  // unmark one changed fact so the no-auto-seen guard is observable
  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').click();
  await page.keyboard.press("v");
  await expect(page.locator("#progress")).toContainText("9 / 10 reviewed");

  await page.locator("#btn-compare").click();
  await expect(page.locator("#compare-bar")).toContainText("Changes from revision");
  // the tree scopes to what moved between 1 and 2, deletions included
  await expect(page.locator("#scope-btn")).toContainText("Changed");
  await expect(page.locator('.tree .row[data-kind="fact"]')).toHaveCount(3);

  // the default layout renders blocks, not source: a new fact is all
  // added blocks, its table rendered as a table
  await page.locator('.tree .row[data-path="architecture.md"]').click();
  await expect(page.locator("#diff-view .rblock.add").first()).toBeVisible();
  await expect(page.locator("#diff-view .rblock.del")).toHaveCount(0);
  await expect(page.locator("#diff-view .rblock table th").first()).toHaveText("piece");

  // a changed fact: the new paragraph is an added block, the edited
  // mermaid pair is a changed block rendered as a DIAGRAM (regression:
  // the word-mark effect crashed on it and blanked the page), and the
  // revision-1 notes sit read-only in the panel
  await page.locator('.tree .row[data-path="storage/whole-file-writes.md"]').click();
  await expect(page.locator("#diff-view .rblock.add")).toContainText("write-through cache");
  await expect(page.locator("#diff-view .rblock.context").first()).toBeVisible();
  await expect(
    page.locator("#diff-view .rblock.changed .rk-mermaid svg"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#diff-view .rblock.changed del.rk-dd")).toContainText("one");
  // the struck run stays red: the added-words highlight must start after
  // the spliced <del>, never paint across it
  const delCovered = await page.evaluate(() => {
    const highlight = (CSS as unknown as { highlights: Map<string, Iterable<Range>> })
      .highlights.get("rk-diff-ins");
    const ranges = highlight ? [...highlight] : [];
    return [...document.querySelectorAll("del.rk-dd")].some((del) =>
      ranges.some((range) => range.intersectsNode(del)),
    );
  });
  expect(delCovered).toBe(false);
  await expect(page.locator("#panel-items .card.readonly.item-comment")).toContainText(
    "Tighten the failure story.",
  );
  // the base question folds like the live panel's and opens read-only
  const foldedBase = page.locator("#panel-items .card.readonly.item-question");
  await expect(foldedBase.locator(".q-meta")).toContainText("1 reply");
  await foldedBase.click();
  await expect(page.locator("#thread-page")).toBeVisible();
  await expect(page.locator("#thread-reply")).toHaveCount(0); // no reply box
  await page.locator("#thread-back").click();
  await expect(page.locator("#thread-page")).toHaveCount(0);
  await expect(page).toHaveScreenshot("viewer-compare.png");

  // the source layouts remain one click away
  await page.locator("#diff-unified").click();
  await expect(page.locator("#diff-view .dline.context").first()).toBeVisible();
  await expect(page.locator("#diff-view .dline.add").last()).toContainText("write-through cache");

  // compare is read-only even on a live, changed fact: no composer, no
  // quick-comment writes, and dwelling on a diff marks nothing seen
  await page.keyboard.press("c");
  await expect(page.locator("#item-form")).toHaveCount(0);
  await page.keyboard.press("1");
  expect(readSidecar("storage/whole-file-writes.review.json").items).toHaveLength(1);
  await page.waitForTimeout(2000); // past the 1.5s auto-seen dwell
  await expect(page.locator("#progress")).toContainText("9 / 10 reviewed");

  // split layout: old text left with its line number, new text right
  await page.locator("#diff-split").click();
  const addedRow = page.locator("#diff-view .dtable.split .drow", {
    hasText: "write-through cache",
  });
  await expect(addedRow.locator(".dcell.add")).toContainText("write-through cache");
  await expect(addedRow.locator(".dcell.empty")).toHaveCount(1); // no old side
  const contextRow = page.locator("#diff-view .dtable.split .drow").first();
  await expect(contextRow.locator(".dcell").nth(0)).toContainText("Every mutation");
  await expect(contextRow.locator(".dcell").nth(1)).toContainText("Every mutation");
  await page.locator("#diff-unified").click();

  // a removed fact diffs as pure deletions
  await page.locator('.tree .row[data-path="slugs/legacy-dedupe.md"]').click();
  await expect(page.locator("#diff-view .dline.del").first()).toBeVisible();
  await expect(page.locator("#diff-view .dline.add")).toHaveCount(0);

  // escape leaves compare mode and restores the full tree
  await page.keyboard.press("Escape");
  await expect(page.locator("#compare-bar")).toHaveCount(0);
  await expect(page.locator(".tree .row")).toHaveCount(11);
  rmSync(join(tmp, ".gloss/design-review/1/storage/whole-file-writes.review.json"));
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
    revision: 2,
    facts: 10,
    comments: 3, // two quick comments + one selection comment
    openQuestions: 1,
    approved: false,
  };
  const finished = stdoutLines.find((l) => l.event === "session.finished");
  expect(finished?.summary).toEqual(expectedSummary);
  expect(stdoutLines[stdoutLines.length - 1]).toEqual(expectedSummary);
});
