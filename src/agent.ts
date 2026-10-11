import { spawn } from "node:child_process";
import { chmodSync, existsSync, openSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { listRevisions, reviewExists, walkFiles } from "./files.js";
import { emitLine, emitLines, failJson } from "./protocol.js";
import { type PublishContext, readMeta } from "./meta.js";
import { findCheckout, gitState, mainRoot, originUrl } from "./repo.js";
import { reviewsDir } from "./reviews.js";
import { type ServerInfo, pidAlive, readServerInfo } from "./server.js";
import { VERSION } from "./version.js";

// The agent's side of the review server (ARCHITECTURE.md). Every command
// finds the server through the review's .server.json, which only this
// user can read; `gloss session` starts it when none is running.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reviewDirOf(cwd: string, review: string): string {
  const dir = join(reviewsDir(cwd), review);
  if (!reviewExists(dir)) failJson(`no such review: ${review}`);
  return dir;
}

async function call(info: ServerInfo, route: string, body?: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${info.port}/api/agent/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-gloss-key": info.key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok || !json?.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

/** The running server's info, or null — a .server.json whose pid is dead
 * or whose server doesn't answer with this review's name is not one. */
async function liveServer(reviewDir: string, review: string): Promise<(ServerInfo & { ping: any }) | null> {
  const info = readServerInfo(reviewDir);
  if (!info || !pidAlive(info.pid)) return null;
  try {
    const ping = await call(info, "ping");
    return ping.review === review ? { ...info, ping } : null;
  } catch {
    return null;
  }
}

async function ensureServer(
  cwd: string,
  review: string,
  serveHost: string | undefined,
): Promise<ServerInfo & { ping: any }> {
  const reviewDir = reviewDirOf(cwd, review);
  const live = await liveServer(reviewDir, review);
  if (live && live.version === VERSION && live.serveHost === serveHost) return live;
  if (live) {
    // another version, or other --serve-host: stop it, then start fresh
    await call(live, "stop", {}).catch(() => {});
    for (let i = 0; i < 50 && pidAlive(live.pid); i++) await sleep(100);
  }
  const log = openSync(join(reviewDir, ".server.log"), "a");
  const args = [process.argv[1]!, "__serve", review, ...(serveHost ? ["--serve-host", serveHost] : [])];
  // a spawn can lose a race (a dying server still holds the lock), so a
  // server that hasn't come up is spawned again
  for (let attempt = 0; attempt < 3; attempt++) {
    const child = spawn(process.execPath, args, { cwd, detached: true, stdio: ["ignore", log, log] });
    let exited = false;
    child.once("exit", () => (exited = true));
    child.unref();
    for (let i = 0; i < 40 && !exited; i++) {
      await sleep(100);
      const started = await liveServer(reviewDir, review);
      if (started) return started;
    }
    const started = await liveServer(reviewDir, review);
    if (started) return started;
    await sleep(300);
  }
  return failJson(`the review server did not start — see ${join(reviewDir, ".server.log")}`);
}

function openBrowser(url: string): void {
  try {
    // "start" needs cmd; the empty arg is its window-title slot
    const [opener, args]: [string, string[]] =
      process.platform === "darwin"
        ? ["open", [url]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : ["xdg-open", [url]];
    spawn(opener, args, { stdio: "ignore", detached: true, windowsHide: true }).unref();
  } catch {
    // no opener; the printed URL is enough
  }
}

/** Where this publish comes from — gathered here, in the checkout the
 * agent works in, which may not be the one the server started from. */
function publishContext(cwd: string, prompt: string | undefined): PublishContext {
  const checkout = findCheckout(cwd);
  const remote = originUrl(checkout);
  return {
    prompt,
    repo: { name: basename(mainRoot(checkout)), root: mainRoot(checkout), ...(remote ? { remote } : {}) },
    state: gitState(checkout),
    agent: process.env.AI_AGENT || (process.env.CLAUDECODE ? "claude-code" : undefined),
  };
}

export interface SessionOptions {
  review: string;
  /** the human's request, recorded with the review the first time */
  prompt?: string;
  noBrowser: boolean;
  serveHost?: string;
}

/** One round: publish the revision, then stream what the agent must act
 * on until the human finishes or approves. Exiting is the signal. */
export async function runSession(cwd: string, opts: SessionOptions): Promise<void> {
  // refused before a server is started for nothing (the server refuses too)
  if (existsSync(join(reviewDirOf(cwd, opts.review), "approved"))) {
    failJson(`${opts.review} is approved — start a new review to change it`);
  }
  let info = await ensureServer(cwd, opts.review, opts.serveHost);
  const published = await call(info, "publish", { context: publishContext(cwd, opts.prompt) }).catch((e) =>
    failJson(String(e.message)),
  );
  const revision: number = published.revision;
  emitLine({ event: "session.started", review: opts.review, revision, frozen: published.frozen, url: published.url });
  // questions already waiting (a re-attach after a lost stream) are
  // delivered again, so the agent never has to go looking
  for (const q of published.pending) emitLine({ event: "question.asked", path: q.path, id: q.id, text: q.text });

  // a tab that is already open reconnects within a second or two; only
  // when none does is a new one opened
  if (!opts.noBrowser && published.viewers === 0) {
    void sleep(2500).then(async () => {
      const ping = await call(info, "ping").catch(() => null);
      if (ping && ping.viewers === 0) openBrowser(published.url);
    });
  }

  let since: number = published.since;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${info.port}/api/agent/events?since=${since}`, {
        headers: { "x-gloss-key": info.key },
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      attempt = 0;
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (typeof event.seq === "number") since = event.seq;
          if (event.type === "revision.published" && event.revision !== revision) {
            // another `gloss session` published a newer revision: this
            // round was superseded, not finished
            failJson(`revision ${event.revision} was published by another session`);
          }
          // approval ends the review — whichever revision was approved
          if (event.type === "review.approved") {
            emitLines([{ event: "session.finished", summary: event.summary }, event.summary]);
            process.exit(0);
          }
          if (event.type === "server.stopping") {
            // stopped on purpose (gloss stop, idle, approval): not a crash
            // to recover from by starting it again
            failJson(`the review server stopped (${event.reason}) before the round finished`);
          }
          if (event.revision !== undefined && event.revision !== revision) continue;
          if (event.type === "question.asked" || event.type === "question.replied") {
            emitLine({ event: event.type, path: event.path, id: event.id, text: event.text });
          } else if (event.type === "round.finished") {
            emitLines([{ event: "session.finished", summary: event.summary }, event.summary]);
            process.exit(0);
          }
        }
      }
      throw new Error("stream closed");
    } catch {
      // the server went away mid-round: start it again (state comes back
      // from its event log) and resume from the last event seen
      await sleep(500 * (attempt + 1));
      info = await ensureServer(cwd, opts.review, opts.serveHost);
    }
  }
  failJson("lost the review server");
}

async function requireServer(cwd: string, review: string): Promise<ServerInfo> {
  const live = await liveServer(reviewDirOf(cwd, review), review);
  if (!live) return failJson(`no review server is running for ${review} — start gloss session first`);
  return live;
}

export async function sendReply(
  cwd: string,
  opts: { review: string; path: string; id: string; text: string },
): Promise<void> {
  const info = await requireServer(cwd, opts.review);
  await call(info, "reply", { path: opts.path, id: opts.id, text: opts.text }).catch((e) => failJson(e.message));
  emitLine({ ok: true });
}

/** A status line for the open tabs. With no server running there is no
 * tab to show it in, which is not an error: it is reported, not raised. */
export async function sendStatus(cwd: string, review: string, text: string): Promise<void> {
  const live = await liveServer(reviewDirOf(cwd, review), review);
  if (!live) return emitLine({ ok: true, delivered: false });
  await call(live, "status", { text }).catch((e) => failJson(e.message));
  emitLine({ ok: true, delivered: true });
}

export async function stopServer(cwd: string, review: string): Promise<void> {
  const live = await liveServer(reviewDirOf(cwd, review), review);
  if (live) {
    await call(live, "stop", {}).catch((e) => failJson(`stop failed: ${e.message}`));
    // done means gone: wait for the process to exit
    for (let i = 0; i < 50 && pidAlive(live.pid); i++) await sleep(100);
    if (pidAlive(live.pid)) failJson(`the review server (pid ${live.pid}) did not exit`);
  }
  emitLine({ ok: true, wasRunning: live !== null });
}

/** Approval from the conversation always goes through the review server
 * — started for it when none runs — so it is the same act as the
 * viewer's button: an open round's notes are snapshotted first, the
 * default is the revision under review, and any open tab sees it. */
export async function approve(cwd: string, review: string, revision?: number): Promise<void> {
  const info = await ensureServer(cwd, review, readServerInfo(reviewDirOf(cwd, review))?.serveHost);
  const result = await call(info, "approve", { revision }).catch((e) => failJson(e.message));
  emitLine({ ok: true, revision: result.revision });
}

export interface ReviewEntry {
  name: string;
  prompt?: string;
  branch?: string;
  revisions: number;
  approved: number | null;
  /** when the review last changed: its latest record */
  updated: string;
  running: boolean;
}

/** This repository's reviews, newest first. In a terminal, a table;
 * otherwise the JSON line every command speaks. */
export async function listReviews(cwd: string): Promise<void> {
  const root = reviewsDir(cwd);
  const entries: ReviewEntry[] = [];
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory() || !reviewExists(dir)) continue;
    const meta = readMeta(dir);
    const revisions = listRevisions(dir);
    const times = [
      meta?.approved?.at,
      ...Object.values(meta?.revisions ?? {}).flatMap((r) => [r.published, r.finished]),
    ].filter((t): t is string => !!t);
    entries.push({
      name,
      ...(meta?.prompt ? { prompt: meta.prompt } : {}),
      ...(meta?.started?.branch ? { branch: meta.started.branch } : {}),
      revisions: revisions.length,
      approved: meta?.approved?.revision ?? (existsSync(join(dir, "approved")) ? -1 : null),
      updated: times.sort().at(-1) ?? statSync(dir).mtime.toISOString(),
      running: (await liveServer(dir, name)) !== null,
    });
  }
  entries.sort((a, b) => b.updated.localeCompare(a.updated));
  if (!process.stdout.isTTY) return emitLine({ ok: true, path: root, reviews: entries });
  if (entries.length === 0) {
    process.stdout.write(`No reviews yet for this repository (${root}).\n`);
    return;
  }
  for (const e of entries) {
    const state = e.approved !== null ? "approved" : e.running ? "in review" : `${e.revisions} revision${e.revisions === 1 ? "" : "s"}`;
    const meta = [state, e.branch, e.updated.slice(0, 10)].filter(Boolean).join(" · ");
    process.stdout.write(`${e.name}  ${meta}\n${e.prompt ? `  “${e.prompt}”\n` : ""}`);
  }
}

/** Open a review in the browser: its server, started if needed, with no
 * round published — a finished or approved review is read-only. */
export async function openReview(cwd: string, review: string, noBrowser: boolean): Promise<void> {
  const reviewDir = reviewDirOf(cwd, review);
  const info = await ensureServer(cwd, review, readServerInfo(reviewDir)?.serveHost);
  const url = `http://127.0.0.1:${info.port}/`;
  if (!noBrowser) openBrowser(url);
  emitLine({ ok: true, review, url });
}

/** Delete a review for good: its server stopped first, then its folder. */
export async function removeReview(cwd: string, review: string): Promise<void> {
  const reviewDir = reviewDirOf(cwd, review);
  const live = await liveServer(reviewDir, review);
  if (live) {
    await call(live, "stop", {}).catch(() => {});
    for (let i = 0; i < 50 && pidAlive(live.pid); i++) await sleep(100);
  }
  // frozen revisions are read-only; make them deletable everywhere
  for (const file of walkFiles(reviewDir)) chmodSync(join(reviewDir, file), 0o644);
  rmSync(reviewDir, { recursive: true, force: true });
  emitLine({ ok: true, removed: reviewDir });
}
