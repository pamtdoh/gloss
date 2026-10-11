import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import {
  DRAFT,
  NOTE_IMAGES,
  draftDiffers,
  ensureDraft,
  escapesDir,
  freezeDraft,
  listRevisions,
  pruneNoteImages,
  readRevision,
  readSidecar,
  resolveFact,
  reviewExists,
  walkFacts,
  writeAtomic,
  snapshotNotes,
  writeSidecar,
} from "./files.js";
import { type NoteOp, applyAgentReply, applyOp, pendingQuestions } from "./notes.js";
import { failJson } from "./protocol.js";
import { reviewsDir } from "./reviews.js";
import { summarize } from "./summary.js";
import { VERSION } from "./version.js";
import { viewerHtml } from "./viewer/html.js";
import { SW_JS } from "./viewer/sw.js";
// Bundled at build time; served as /client.js, /client.css, /mermaid.js.
import clientJs from "./viewer/client.gen.js" with { type: "text" };
import clientCss from "./viewer/client.gen.css" with { type: "text" };
import mermaidJs from "./viewer/mermaid.gen.js" with { type: "text" };

// The review server (ARCHITECTURE.md): one long-running process per
// review. It owns every write to the review's files while it runs, keeps
// a numbered event log, and pushes each event to the open browser tabs
// and to the agent's `gloss session`. It keeps its port across restarts,
// so a tab opened on the first revision follows every later one.

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
// Pictures pasted into notes: raster only (an SVG can carry script).
const UPLOAD_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const UPLOAD_LIMIT = 10 * 1024 * 1024;
const HEARTBEAT_MS = 20_000;
/** after approval, long enough for open tabs to receive the event */
const APPROVAL_GRACE_MS = 1500;
const DEFAULT_IDLE_MS = 30 * 60_000;

export interface ServerInfo {
  pid?: number;
  port: number;
  /** the agent's credential: only a process that can read the private
   * reviews directory can drive the server */
  key: string;
  /** the browser session secret behind --serve-host's cookie */
  cookie: string;
  serveHost?: string;
  version: string;
}

export interface ReviewEvent {
  seq: number;
  type: string;
  [key: string]: unknown;
}

export const serverFile = (reviewDir: string) => join(reviewDir, ".server.json");
const lockFile = (reviewDir: string) => join(reviewDir, ".server.lock");
const eventsFile = (reviewDir: string) => join(reviewDir, ".events.jsonl");

export function readServerInfo(reviewDir: string): ServerInfo | null {
  try {
    return JSON.parse(readFileSync(serverFile(reviewDir), "utf8"));
  } catch {
    return null;
  }
}

export function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  // a killed process nobody has reaped yet (common in containers, where
  // pid 1 may never reap) still answers signal 0: it is dead all the same
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch {
    return true; // no /proc (macOS, Windows): signal 0 is the answer
  }
}

function readEvents(reviewDir: string): ReviewEvent[] {
  if (!existsSync(eventsFile(reviewDir))) return [];
  const events: ReviewEvent[] = [];
  for (const line of readFileSync(eventsFile(reviewDir), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // a line torn by a crash mid-append; the rest of the log still holds
    }
  }
  return events;
}

/** One server per review: the lock file holds the owner's pid, and a lock
 * whose pid is dead is taken over. */
function acquireLock(reviewDir: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockFile(reviewDir), "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number(readFileSync(lockFile(reviewDir), "utf8"));
      if (pidAlive(owner) && owner !== process.pid) return false;
      unlinkSync(lockFile(reviewDir));
    }
  }
  return false;
}

async function readBytes(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      if (total > limit) return;
      total += chunk.length;
      if (total > limit) chunks.length = 0;
      else chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(total > limit ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const bytes = await readBytes(req, 1_000_000);
  if (bytes === null) throw new Error("body too large");
  const text = bytes.toString("utf8");
  return text ? JSON.parse(text) : {};
}

export interface ServeOptions {
  review: string;
  serveHost?: string;
}

export function runServer(cwd: string, opts: ServeOptions): void {
  const reviewDir = join(reviewsDir(cwd), opts.review);
  if (!reviewExists(reviewDir)) failJson(`no such review: ${opts.review}`);
  if (!acquireLock(reviewDir)) failJson(`a server for ${opts.review} is already running`);

  const idleMs = Number(process.env.GLOSS_IDLE_MS) || DEFAULT_IDLE_MS;
  const previous = readServerInfo(reviewDir);
  const info: ServerInfo = {
    port: 0,
    key: randomBytes(24).toString("hex"),
    cookie: previous?.cookie ?? randomBytes(32).toString("hex"),
    serveHost: opts.serveHost,
    version: VERSION,
  };
  const revisionDir = (n: number) => join(reviewDir, String(n));
  const draftDir = join(reviewDir, DRAFT);
  // Notes live in the draft while their revision's round is open, and
  // each revision gets its copy when the round ends (ARCHITECTURE.md).
  const notesDir = (n: number) => (n === served && roundOpen ? draftDir : revisionDir(n));
  const tokens = new Set<string>();

  // ---------- state, rebuilt from the event log ----------
  const log = readEvents(reviewDir);
  let seq = log.at(-1)?.seq ?? 0;
  let served: number | null = null;
  let roundOpen = false;
  let status: string | null = null;
  for (const event of log) {
    if (event.type === "revision.published") {
      served = event.revision as number;
      roundOpen = true;
      status = null;
    } else if (event.type === "round.finished" || event.type === "review.approved") {
      roundOpen = false;
    } else if (event.type === "agent.status") {
      status = (event.text as string) || null;
    }
  }
  const appliedOps = new Map<string, Record<string, unknown>>();
  for (const event of log) {
    if (event.type === "note.changed" && typeof event.opId === "string") {
      appliedOps.set(event.opId, { ok: true, id: event.id, sidecar: event.sidecar, seq: event.seq });
    }
  }
  const approvedRevision = (): number | null => {
    if (!existsSync(join(reviewDir, "approved"))) return null;
    const event = log.findLast((e) => e.type === "review.approved");
    return (event?.revision as number | undefined) ?? -1;
  };

  // ---------- event fan-out ----------
  const viewers = new Set<ServerResponse>();
  const agents = new Set<ServerResponse>();
  let lastActive = Date.now();
  const touch = () => (lastActive = Date.now());

  const writeViewer = (res: ServerResponse, event: ReviewEvent) =>
    res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
  const writeAgent = (res: ServerResponse, event: ReviewEvent) =>
    res.write(JSON.stringify(event) + "\n");

  const emit = (type: string, data: Record<string, unknown> = {}): ReviewEvent => {
    const event: ReviewEvent = { seq: ++seq, type, at: new Date().toISOString(), ...data };
    appendFileSync(eventsFile(reviewDir), JSON.stringify(event) + "\n");
    log.push(event);
    for (const res of viewers) writeViewer(res, event);
    for (const res of agents) writeAgent(res, event);
    return event;
  };

  const summaryOf = (revision: number) => {
    const notes = notesDir(revision);
    return summarize({
      review: opts.review,
      revision,
      sidecars: walkFacts(revisionDir(revision)).map((path) => readSidecar(notes, path) ?? undefined),
      approved: existsSync(join(reviewDir, "approved")),
    });
  };

  const snapshot = () => ({
    review: opts.review,
    version: VERSION,
    seq,
    served,
    round: roundOpen ? "open" : "closed",
    approved: approvedRevision(),
    status,
    revisions: listRevisions(reviewDir),
  });

  // ---------- lifecycle ----------
  let server: Server;
  let stopping = false;
  const shutdown = (reason: string): void => {
    if (stopping) return;
    stopping = true;
    emit("server.stopping", { reason });
    for (const res of [...viewers, ...agents]) res.end();
    // keep the port and the cookie secret for the next start, so open tabs
    // reconnect to the same address and a --serve-host login survives
    const { pid: _pid, ...rest } = info;
    writeAtomic(serverFile(reviewDir), JSON.stringify(rest) + "\n");
    try {
      unlinkSync(lockFile(reviewDir));
    } catch {
      // already gone
    }
    server.close();
    setTimeout(() => process.exit(0), 200).unref();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => shutdown(signal));
  setInterval(() => {
    if (viewers.size === 0 && agents.size === 0 && Date.now() - lastActive > idleMs) shutdown("idle");
  }, Math.min(60_000, idleMs)).unref();

  const publish = (revision: number) => {
    // re-attaching to the round that is already open changes nothing
    if (served === revision && roundOpen) return;
    pruneNoteImages(draftDir);
    served = revision;
    roundOpen = true;
    status = null;
    emit("revision.published", { revision, revisions: listRevisions(reviewDir) });
  };

  const approve = (revision: number): { ok: boolean; status: number; error?: string } => {
    const approvedDir = join(reviewDir, "approved");
    if (existsSync(approvedDir)) return { ok: false, status: 409, error: "approved/ already exists" };
    // an open round's notes are snapshotted first: approval accepts the
    // revision with the notes as they stand
    if (revision === served && roundOpen) {
      pruneNoteImages(draftDir);
      snapshotNotes(reviewDir, revision);
      roundOpen = false;
    }
    cpSync(revisionDir(revision), approvedDir, { recursive: true });
    emit("review.approved", { revision, summary: summaryOf(revision) });
    setTimeout(() => shutdown("approved"), APPROVAL_GRACE_MS).unref();
    return { ok: true, status: 200 };
  };

  const viewerUrl = (): string => {
    if (!opts.serveHost) return `http://127.0.0.1:${info.port}/`;
    const token = randomBytes(32).toString("hex");
    tokens.add(token);
    return `https://${opts.serveHost}/auth?token=${token}`;
  };

  // ---------- requests ----------
  server = createServer(async (req, res) => {
    touch();
    const sendJson = (code: number, value: unknown): void => {
      res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(value));
    };
    try {
      const port = info.port;
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const loopbackHost = req.headers.host === `127.0.0.1:${port}`;
      const hostOk =
        loopbackHost ||
        (opts.serveHost !== undefined && (req.headers.host ?? "").split(":")[0] === opts.serveHost);
      if (!hostOk) return sendJson(400, { ok: false, error: "bad host" });

      // ---- the agent's routes: local process, holding the key ----
      if (url.pathname.startsWith("/api/agent/")) {
        if (req.headers.origin !== undefined || !loopbackHost || req.headers["x-gloss-key"] !== info.key) {
          return sendJson(403, { ok: false, error: "the agent routes are for the local gloss CLI only" });
        }
        const route = url.pathname.slice("/api/agent/".length);
        if (req.method === "GET" && route === "ping") {
          return sendJson(200, { ok: true, ...snapshot(), viewers: viewers.size, pid: process.pid });
        }
        if (req.method === "GET" && route === "events") {
          const since = Number(url.searchParams.get("since") ?? seq);
          res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
          for (const event of log) if (event.seq > since) writeAgent(res, event);
          agents.add(res);
          const beat = setInterval(() => res.write(JSON.stringify({ type: "ping" }) + "\n"), HEARTBEAT_MS);
          req.on("close", () => {
            clearInterval(beat);
            agents.delete(res);
            touch();
          });
          return;
        }
        if (req.method !== "POST") return sendJson(405, { ok: false, error: "method not allowed" });
        const body = await readJson(req);
        if (route === "publish") {
          // which revision this round is on: the open round's (a
          // re-attach); else the draft, frozen, when its facts changed;
          // else the latest again. Only the latest can be under review:
          // the draft's notes are on it.
          const since = seq;
          let revision: number;
          let frozen = false;
          ensureDraft(reviewDir);
          if (roundOpen && served !== null) {
            revision = served;
          } else if (draftDiffers(reviewDir)) {
            revision = freezeDraft(reviewDir);
            frozen = true;
          } else if (listRevisions(reviewDir).length > 0) {
            revision = listRevisions(reviewDir).at(-1)!;
          } else {
            return sendJson(409, { ok: false, error: `nothing to review yet — write the facts in ${opts.review}/draft/ first` });
          }
          publish(revision);
          const pending = walkFacts(revisionDir(revision)).flatMap((path) =>
            pendingQuestions(readSidecar(draftDir, path) ?? undefined).map((q) => ({ path, ...q })),
          );
          return sendJson(200, { ok: true, revision, frozen, since, url: viewerUrl(), viewers: viewers.size, pending });
        }
        if (route === "reply") {
          if (served === null || !roundOpen) {
            return sendJson(409, { ok: false, error: "no round is open — the human finished; treat the question as iteration feedback" });
          }
          const factPath = resolveFact(revisionDir(served), body.path);
          if (!factPath) return sendJson(404, { ok: false, error: "no such fact" });
          const current = readSidecar(draftDir, factPath);
          if (current === null) return sendJson(409, { ok: false, error: `${factPath}'s sidecar does not parse` });
          const result = applyAgentReply(current, String(body.id), String(body.text ?? ""));
          if (!result.ok) return sendJson(result.status, { ok: false, error: result.error });
          if (result.changed) {
            writeSidecar(draftDir, factPath, result.sidecar);
            emit("note.changed", { revision: served, path: factPath, id: result.id, sidecar: result.sidecar, by: "agent" });
          }
          return sendJson(200, { ok: true });
        }
        if (route === "status") {
          status = String(body.text ?? "").trim() || null;
          emit("agent.status", { text: status });
          return sendJson(200, { ok: true });
        }
        if (route === "approve") {
          const revision = body.revision === undefined ? (served ?? listRevisions(reviewDir).at(-1)!) : Number(body.revision);
          if (!listRevisions(reviewDir).includes(revision)) return sendJson(404, { ok: false, error: `no such revision: ${revision}` });
          const result = approve(revision);
          return sendJson(result.status, result.ok ? { ok: true, revision } : { ok: false, error: result.error });
        }
        if (route === "stop") {
          sendJson(200, { ok: true });
          return shutdown("stopped");
        }
        return sendJson(404, { ok: false, error: "not found" });
      }

      // ---- --serve-host login: a one-time link becomes a cookie ----
      const cookieName = `gloss_${port}`;
      if (url.pathname === "/auth") {
        if (!opts.serveHost) {
          res.writeHead(302, { location: "/" });
          return res.end();
        }
        // GET never consumes the token: messaging apps prefetch links for
        // previews. The page posts it back (prefetchers don't run JS).
        if (req.method === "GET") {
          const candidate = url.searchParams.get("token") ?? "";
          if (!tokens.has(candidate)) {
            res.writeHead(403, { "content-type": "text/plain" });
            return res.end("This one-time review link has expired. Ask the agent for a new one.");
          }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Review</title>` +
              `<form method="POST" action="/auth"><input type="hidden" name="token" value="${candidate}"></form>` +
              `<script>document.forms[0].submit()</script>`,
          );
        }
        if (req.method === "POST") {
          const bytes = await readBytes(req, 10_000);
          const token = new URLSearchParams(bytes?.toString("utf8") ?? "").get("token") ?? "";
          if (!tokens.delete(token)) {
            res.writeHead(403, { "content-type": "text/plain" });
            return res.end("This one-time review link has expired. Ask the agent for a new one.");
          }
          res.writeHead(303, {
            "set-cookie": `${cookieName}=${info.cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
            location: "/",
          });
          return res.end();
        }
        return sendJson(405, { ok: false, error: "method not allowed" });
      }
      if (opts.serveHost) {
        const cookies = (req.headers.cookie ?? "").split(";").map((c) => c.trim());
        if (!cookies.includes(`${cookieName}=${info.cookie}`)) {
          if (url.pathname.startsWith("/api/")) return sendJson(401, { ok: false, error: "unauthorized" });
          res.writeHead(401, { "content-type": "text/html" });
          return res.end("<h1>Unauthorized</h1><p>Open the one-time link the agent printed.</p>");
        }
      }
      if (req.method !== "GET") {
        const originHost = (() => {
          try {
            return new URL(req.headers.origin ?? "").host;
          } catch {
            return null;
          }
        })();
        const originOk =
          originHost === `127.0.0.1:${port}` ||
          (opts.serveHost !== undefined && originHost?.split(":")[0] === opts.serveHost);
        if (!originOk) return sendJson(403, { ok: false, error: "bad origin" });
      }

      // ---- the viewer: static files ----
      const staticFile = (type: string, body: string, cache = true) => {
        res.writeHead(200, {
          "content-type": `${type}; charset=utf-8`,
          "cache-control": cache ? "no-cache" : "no-store",
        });
        res.end(body);
      };
      if (req.method === "GET") {
        if (url.pathname === "/") return staticFile("text/html", viewerHtml(VERSION));
        if (url.pathname === "/client.js") return staticFile("text/javascript", clientJs);
        if (url.pathname === "/client.css") return staticFile("text/css", clientCss);
        if (url.pathname === "/mermaid.js") return staticFile("text/javascript", mermaidJs);
        if (url.pathname === "/sw.js") return staticFile("text/javascript", SW_JS, false);
        if (url.pathname.startsWith("/asset/")) {
          // /asset/<revision>/<path>: images stored inside a revision
          const [, , ver, ...rest] = url.pathname.split("/");
          const revision = Number(ver);
          const ext = ("." + (rest.at(-1) ?? "").split(".").pop()).toLowerCase();
          const type = IMAGE_TYPES[ext];
          if (!listRevisions(reviewDir).includes(revision) || !type) return sendJson(404, { ok: false, error: "not found" });
          // a note's picture is where the note is; a figure is the revision's
          const dir = rest[0] === "images" && rest[1] === "notes" ? notesDir(revision) : revisionDir(revision);
          const abs = resolve(dir, rest.map(decodeURIComponent).join("/"));
          if (escapesDir(dir, abs) || !existsSync(abs)) return sendJson(404, { ok: false, error: "not found" });
          res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
          return res.end(readFileSync(abs));
        }
        if (url.pathname === "/api/review") return sendJson(200, snapshot());
        const revisionMatch = /^\/api\/revision\/(\d+)$/.exec(url.pathname);
        if (revisionMatch) {
          const revision = Number(revisionMatch[1]);
          if (!listRevisions(reviewDir).includes(revision)) return sendJson(404, { ok: false, error: "no such revision" });
          return sendJson(200, { revision, facts: readRevision(revisionDir(revision), notesDir(revision)) });
        }
        if (url.pathname === "/api/events") {
          // the browser resumes from the last event it saw; a first
          // connection names the snapshot it loaded
          const since = Number(req.headers["last-event-id"] ?? url.searchParams.get("since") ?? seq);
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
          });
          res.write("retry: 1000\n\n");
          // a gap the log can't fill (a log reset) asks the tab to reload
          if (since > seq) res.write(`data: ${JSON.stringify({ seq, type: "reset" })}\n\n`);
          else for (const event of log) if (event.seq > since) writeViewer(res, event);
          viewers.add(res);
          const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
          req.on("close", () => {
            clearInterval(beat);
            viewers.delete(res);
            touch();
          });
          return;
        }
        return sendJson(404, { ok: false, error: "not found" });
      }

      // ---- the viewer: writes, to the served revision of an open round ----
      const writable = (revision: number): string | null => {
        if (revision !== served) return `revision ${revision} is read-only — the review is on ${served}`;
        if (!roundOpen) return "this round is finished — the agent is working on the next revision";
        return null;
      };
      if (req.method === "POST" && url.pathname === "/api/op") {
        const body = await readJson(req);
        const opId = typeof body.opId === "string" ? body.opId : undefined;
        // a retried operation is answered, not applied twice
        if (opId && appliedOps.has(opId)) return sendJson(200, appliedOps.get(opId));
        const revision = Number(body.revision);
        const closed = writable(revision);
        if (closed) return sendJson(409, { ok: false, error: closed });
        // the fact is the revision's; its notes are the draft's
        const factPath = resolveFact(revisionDir(revision), body.path);
        if (!factPath) return sendJson(404, { ok: false, error: "no such fact" });
        const current = readSidecar(draftDir, factPath);
        if (current === null) return sendJson(409, { ok: false, error: `${factPath}'s sidecar does not parse — fix or remove the file` });
        const result = applyOp(current, body as NoteOp);
        if (!result.ok) return sendJson(result.status, { ok: false, error: result.error });
        writeSidecar(draftDir, factPath, result.sidecar);
        const changed = emit("note.changed", { revision, path: factPath, id: result.id, sidecar: result.sidecar, opId, by: "human" });
        if (result.event) emit(result.event.type, { revision, path: factPath, id: result.event.id, text: result.event.text });
        // seq orders this answer against the event stream, so a tab never
        // lets an older answer overwrite a newer event
        const response = { ok: true, id: result.id, sidecar: result.sidecar, seq: changed.seq };
        if (opId) appliedOps.set(opId, response);
        return sendJson(200, response);
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        // stored with the notes, in the draft, named by content so a retry
        // or a repeat paste is the same file
        const revision = Number(url.searchParams.get("revision"));
        const closed = writable(revision);
        if (closed) return sendJson(409, { ok: false, error: closed });
        const mime = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        const ext = UPLOAD_TYPES[mime];
        if (!ext) return sendJson(415, { ok: false, error: "images only: PNG, JPEG, GIF, or WebP" });
        const bytes = await readBytes(req, UPLOAD_LIMIT);
        if (bytes === null) return sendJson(413, { ok: false, error: `image too large (${UPLOAD_LIMIT / 1024 / 1024} MB limit)` });
        if (bytes.length === 0) return sendJson(400, { ok: false, error: "empty image" });
        const name = createHash("sha1").update(bytes).digest("hex").slice(0, 16) + ext;
        const dir = join(draftDir, NOTE_IMAGES);
        mkdirSync(dir, { recursive: true });
        if (!existsSync(join(dir, name))) writeAtomic(join(dir, name), bytes);
        return sendJson(200, { ok: true, path: `${NOTE_IMAGES}/${name}` });
      }
      if (req.method === "POST" && url.pathname === "/api/finish") {
        const body = await readJson(req);
        const revision = Number(body.revision);
        const closed = writable(revision);
        if (closed) return sendJson(409, { ok: false, error: closed });
        // the round's notes, as they stand, become the revision's record;
        // the draft keeps them for the agent to resolve
        pruneNoteImages(draftDir);
        snapshotNotes(reviewDir, revision);
        roundOpen = false;
        emit("round.finished", { revision, summary: summaryOf(revision) });
        return sendJson(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/approve") {
        const body = await readJson(req);
        const revision = Number(body.revision);
        // only what is on screen as the current revision can be approved
        // from the viewer; an older tab cannot approve stale text
        if (revision !== served) return sendJson(409, { ok: false, error: `revision ${revision} is not the current one` });
        const result = approve(revision);
        return sendJson(result.status, result.ok ? { ok: true } : { ok: false, error: result.error });
      }
      return sendJson(404, { ok: false, error: "not found" });
    } catch (error) {
      return sendJson(500, { ok: false, error: String(error) });
    }
  });

  const listen = (port: number): void => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      // the old port is taken: any free one will do; tabs on the old
      // address will need the new link
      if (error.code === "EADDRINUSE" && port !== 0) return listen(0);
      failJson(String(error));
    });
    server.listen(port, "127.0.0.1", () => {
      info.port = (server.address() as { port: number }).port;
      info.pid = process.pid;
      writeAtomic(serverFile(reviewDir), JSON.stringify(info) + "\n");
      process.stderr.write(`gloss server for ${opts.review} on http://127.0.0.1:${info.port}/\n`);
    });
  };
  listen(previous?.port ?? 0);
}
