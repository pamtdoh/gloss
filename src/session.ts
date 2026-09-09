import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { emitLine, emitLines, failJson, toProtocolPath } from "./protocol.js";
import { type Sidecar, isEmptySidecar, mergeSidecar, summarize } from "./summary.js";
import { VIEWER_HTML } from "./viewer/html.js";
// Bundled at build time; served as /client.js, /client.css, /mermaid.js.
import clientJs from "./viewer/client.gen.js" with { type: "text" };
import clientCss from "./viewer/client.gen.css" with { type: "text" };
import mermaidJs from "./viewer/mermaid.gen.js" with { type: "text" };

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// Pictures the reviewer pastes into notes: raster only (an SVG can carry
// script), content-addressed into images/notes/ of the served revision,
// referenced from the note text like any figure (ARCHITECTURE.md).
const UPLOAD_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
const UPLOAD_LIMIT = 10 * 1024 * 1024;
const NOTE_IMAGES = "images/notes";

export interface SessionOptions {
  review: string;
  revision?: number;
  noBrowser: boolean;
  /**
   * Extra hostname to accept in Host/Origin checks, for a private proxy
   * that terminates in front of the loopback server (e.g. tailscale
   * serve). The server still binds 127.0.0.1 only; the one-time token
   * still gates the session.
   */
  serveHost?: string;
}

// The one piece of session state on disk (ARCHITECTURE.md): an ephemeral
// dotfile next to the revision directories, holding the live server's pid
// and address so `gloss reply` can find it. Written on listen, removed on
// exit; a stale copy is detected by the pid check.
function sessionFilePath(cwd: string, review: string): string {
  return join(cwd, ".gloss", review, ".session");
}

function listRevisions(reviewDir: string): number[] {
  return readdirSync(reviewDir)
    .filter((name) => /^\d+$/.test(name) && statSync(join(reviewDir, name)).isDirectory())
    .map(Number)
    .sort((a, b) => a - b);
}

// Every text read from the review tree flows through here. Facts and
// sidecars are written by agents, possibly on Windows: strip a UTF-8 BOM
// (PowerShell's default, breaks JSON.parse and CommonMark headings) and
// normalize CRLF so the offsets the viewer stamps into sidecar anchors
// index the same string the browser's HTML parser yields (its input
// preprocessing folds CRLF to LF).
function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

// resolve() must land strictly inside base. startsWith(base + sep) is not
// enough on Windows, where trailing dots/spaces in a segment (".. ") survive
// resolve() but are trimmed by the filesystem.
function escapesDir(baseDir: string, abs: string): boolean {
  const rel = relative(baseDir, abs);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
}

/** A request's fact path resolved inside one revision, as the protocol
 * path — null unless it names an existing .md strictly within the
 * revision. The one place both write routes check what they may touch. */
function resolveFact(revisionDir: string, raw: unknown): string | null {
  const abs = resolve(revisionDir, String(raw));
  if (escapesDir(revisionDir, abs) || !abs.endsWith(".md") || !existsSync(abs)) return null;
  return toProtocolPath(relative(revisionDir, abs));
}

function walkFacts(revisionDir: string, dir = revisionDir): string[] {
  const facts: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) facts.push(...walkFacts(revisionDir, path));
    else if (name.endsWith(".md")) facts.push(toProtocolPath(relative(revisionDir, path)));
  }
  return facts.sort();
}

function sidecarPath(revisionDir: string, factPath: string): string {
  return join(revisionDir, factPath.replace(/\.md$/, ".review.json"));
}

function noteImagesDir(revisionDir: string): string {
  return join(revisionDir, NOTE_IMAGES);
}

function readSidecar(revisionDir: string, factPath: string): Sidecar | undefined {
  const path = sidecarPath(revisionDir, factPath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readText(path));
  } catch {
    return undefined; // unreadable sidecar = treat as absent; never police files
  }
}

/** The request body, or null once it passes the limit. The rest is then
 * drained, not kept, so the reply still reaches the browser — a destroyed
 * socket would read as a network failure instead of a 413. */
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

async function readBody(req: IncomingMessage): Promise<string> {
  const bytes = await readBytes(req, 1_000_000);
  if (bytes === null) throw new Error("body too large");
  return bytes.toString("utf8");
}

/** Pasted pictures no note mentions any more. images/notes/ is the one
 * place the tool writes files into a revision, so the tool tidies it: a
 * composer cancelled after a paste, a thumbnail removed before posting,
 * or a note resolved in the copy that became this revision each leave a
 * file nothing references. Runs on the served revision only — when it is
 * served, so the copy the agent just iterated is clean before anyone
 * reads it, and when it finishes, for what the session itself orphaned.
 * Older revisions are never touched. */
function pruneNoteImages(revisionDir: string): void {
  const dir = noteImagesDir(revisionDir);
  if (!existsSync(dir)) return;
  const texts: string[] = [];
  for (const factPath of walkFacts(revisionDir)) {
    if (!existsSync(sidecarPath(revisionDir, factPath))) continue;
    const sidecar = readSidecar(revisionDir, factPath);
    // a sidecar that does not parse may still mention a picture: a
    // destructive tidy stays its hand rather than guess
    if (!sidecar) return;
    for (const item of sidecar.items ?? []) {
      if (item.text) texts.push(item.text);
      for (const turn of item.thread ?? []) texts.push(turn.text);
    }
  }
  const mentioned = texts.join("\n");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || mentioned.includes(`${NOTE_IMAGES}/${entry.name}`)) continue;
    unlinkSync(join(dir, entry.name));
  }
  // the directories go with the last file; an agent's own images/ stays
  if (readdirSync(dir).length === 0) {
    rmdirSync(dir);
    const images = join(revisionDir, "images");
    if (readdirSync(images).length === 0) rmdirSync(images);
  }
}

export function runSession(cwd: string, opts: SessionOptions): void {
  const reviewDir = join(cwd, ".gloss", opts.review);
  if (!existsSync(reviewDir)) failJson(`no such review: ${opts.review}`);
  const revisions = listRevisions(reviewDir);
  if (revisions.length === 0) failJson(`review ${opts.review} has no revisions`);
  const defaultRevision = opts.revision ?? revisions[revisions.length - 1]!;
  if (!revisions.includes(defaultRevision)) failJson(`no such revision: ${defaultRevision}`);

  const revisionDir = (n: number) => join(reviewDir, String(n));
  // Auth guards the network path only: with --serve-host the viewer is
  // reachable beyond this machine, so a one-time token gates a session
  // cookie. Plain loopback skips both — anything local can already edit
  // .gloss/ directly, so a token adds ceremony, not protection. The host
  // and origin checks below hold in both modes.
  const authRequired = opts.serveHost !== undefined;
  const token = randomBytes(32).toString("hex");
  const sessionCookie = randomBytes(32).toString("hex");
  let tokenUsed = false;
  let finishing = false;

  const sessionFile = sessionFilePath(cwd, opts.review);
  const removeSessionFile = (): void => {
    try {
      // only the owner may clean up: a newer session for the same review
      // has overwritten the file with its own pid, and this exit must not
      // delete the live pointer out from under it
      const current = JSON.parse(readFileSync(sessionFile, "utf8"));
      if (current.pid === process.pid) unlinkSync(sessionFile);
    } catch {
      // already gone or unreadable; nothing to clean
    }
  };
  // a killed session must not leave a live-looking .session file behind;
  // re-raising after cleanup keeps the death observable (a supervisor
  // reads "exited by SIGTERM", not a successful exit 0)
  process.on("exit", removeSessionFile);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      removeSessionFile();
      process.kill(process.pid, signal);
    });
  }

  const emit = (event: string, data: Record<string, unknown>): void => {
    emitLine({ event, ...data });
  };

  const computeSummary = (revision: number) => {
    const dir = revisionDir(revision);
    const facts = walkFacts(dir);
    return summarize({
      review: opts.review,
      revision,
      sidecars: facts.map((factPath) => readSidecar(dir, factPath)),
      approved: existsSync(join(reviewDir, "approved")),
    });
  };

  // The session's last act: tidy the served revision's pictures, do the
  // caller's own step (approve's copy) on the tidied files, answer, and
  // exit once the answer is out.
  const finishSession = (
    res: ServerResponse,
    payload: object,
    revision: number,
    act?: () => void,
  ): void => {
    if (finishing) return;
    finishing = true;
    if (revision === defaultRevision) pruneNoteImages(revisionDir(revision));
    act?.();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload), () => {
      const summary = computeSummary(revision);
      emitLines([{ event: "session.finished", summary }, summary]);
      process.exit(0);
    });
  };

  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port;
    // one construction for the name that the set-cookie and the check
    // must agree on exactly
    const cookie = `rk_session_${port}=${sessionCookie}`;
    const sendJson = (status: number, value: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const revisionParam = (url: URL): number =>
      url.searchParams.has("revision") ? Number(url.searchParams.get("revision")) : defaultRevision;
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const hostOk =
        req.headers.host === `127.0.0.1:${port}` ||
        (opts.serveHost !== undefined &&
          (req.headers.host ?? "").split(":")[0] === opts.serveHost);
      if (!hostOk) return sendJson(400, { ok: false, error: "bad host" });

      if (url.pathname === "/auth") {
        if (!authRequired) {
          // stale token links from older sessions still land somewhere useful
          res.writeHead(302, { location: "/" });
          return res.end();
        }
        // GET never consumes the token — messaging apps prefetch links for
        // previews and would burn a one-time GET. The page below submits
        // the token via POST (prefetchers don't run JS or submit forms).
        if (req.method === "GET") {
          const candidate = url.searchParams.get("token") ?? "";
          if (tokenUsed || !/^[a-f0-9]{64}$/.test(candidate)) {
            res.writeHead(403, { "content-type": "text/plain" });
            return res.end("This one-time review link has expired. Restart the session for a new one.");
          }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          return res.end(
            `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Review</title>` +
              `<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
              `<form method="POST" action="/auth"><input type="hidden" name="token" value="${candidate}">` +
              `<button style="font:16px system-ui;padding:10px 22px;border-radius:8px;border:1px solid #ccc;cursor:pointer">Open review</button>` +
              `</form><script>document.forms[0].submit()</script></body>`,
          );
        }
        if (req.method === "POST") {
          const body = new URLSearchParams(await readBody(req));
          if (tokenUsed || body.get("token") !== token) {
            res.writeHead(403, { "content-type": "text/plain" });
            return res.end("This one-time review link has expired. Restart the session for a new one.");
          }
          tokenUsed = true;
          res.writeHead(303, {
            // port-scoped name: cookies ignore ports, so concurrent sessions
            // on 127.0.0.1 would otherwise overwrite each other's cookie and
            // 401 every request from the older tab
            "set-cookie": `${cookie}; HttpOnly; SameSite=Strict; Path=/`,
            location: "/",
          });
          return res.end();
        }
        return sendJson(405, { ok: false, error: "method not allowed" });
      }

      // Agent write path, checked before the cookie gate on purpose: a
      // local CLI has no cookie. Two zero-state checks close it to
      // everything but local processes — a browser always sends Origin on
      // a cross-origin POST, and a request through a --serve-host proxy
      // carries the proxy's Host, so requiring the loopback Host keeps
      // remote peers off the write path the viewer's token exists to gate.
      if (url.pathname === "/api/agent/reply") {
        if (req.method !== "POST") return sendJson(405, { ok: false, error: "method not allowed" });
        if (req.headers.origin !== undefined || req.headers.host !== `127.0.0.1:${port}`) {
          return sendJson(403, { ok: false, error: "the agent route is for local processes only" });
        }
        const body = JSON.parse(await readBody(req));
        // end-to-end identity: a stale .session whose pid and port were
        // both recycled must not deliver a reply meant for another review
        if (body.review !== opts.review) {
          return sendJson(400, { ok: false, error: `this session serves ${opts.review}, not ${body.review}` });
        }
        // replies always land on the served revision — every other
        // revision is read-only
        const dir = revisionDir(defaultRevision);
        const factPath = resolveFact(dir, body.path);
        if (!factPath) return sendJson(404, { ok: false, error: "no such fact" });
        const sidecar = readSidecar(dir, factPath);
        const item = sidecar?.items?.find((i) => i.id === String(body.id));
        if (!item) return sendJson(404, { ok: false, error: `no item ${body.id} on ${factPath}` });
        if (item.type !== "question") {
          return sendJson(400, { ok: false, error: `${item.id} is a comment — comments are addressed in the next revision, not replied to` });
        }
        const text = String(body.text ?? "").trim();
        if (!text) return sendJson(400, { ok: false, error: "empty reply" });
        // Append-through-the-server is what makes retries safe: a resend
        // of an agent turn already in the thread is ACKed, not appended —
        // the whole thread is scanned, so a human turn landing between a
        // reply and its retry can't sneak the duplicate in. The sidecar
        // file is the record, so the ACK carries nothing else.
        const thread = (item.thread ??= []);
        if (!thread.some((t) => t.who === "agent" && t.text === text)) {
          thread.push({ who: "agent", text });
          writeFileSync(sidecarPath(dir, factPath), JSON.stringify(sidecar, null, 2) + "\n");
        }
        return sendJson(200, { ok: true });
      }

      const cookies = (req.headers.cookie ?? "").split(";").map((c) => c.trim());
      if (authRequired && !cookies.includes(cookie)) {
        if (url.pathname.startsWith("/api/")) return sendJson(401, { ok: false, error: "unauthorized" });
        res.writeHead(401, { "content-type": "text/html" });
        return res.end("<h1>Unauthorized</h1><p>Open the one-time URL printed by the review session.</p>");
      }
      // http is accepted for the proxied host too: tailscale serve without
      // HTTPS certificates still rides WireGuard between the devices.
      const originHostname = (() => {
        try {
          return req.headers.origin ? new URL(req.headers.origin).hostname : null;
        } catch {
          return null;
        }
      })();
      const originOk =
        req.headers.origin === `http://127.0.0.1:${port}` ||
        (opts.serveHost !== undefined && originHostname === opts.serveHost);
      if (req.method !== "GET" && !originOk) {
        return sendJson(403, { ok: false, error: "bad origin" });
      }

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(VIEWER_HTML);
      }
      if (req.method === "GET" && url.pathname === "/client.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        return res.end(clientJs);
      }
      if (req.method === "GET" && url.pathname === "/client.css") {
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        return res.end(clientCss);
      }
      if (req.method === "GET" && url.pathname === "/mermaid.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
        return res.end(mermaidJs);
      }
      if (req.method === "GET" && url.pathname.startsWith("/asset/")) {
        // /asset/<revision>/<path> — images stored inside the revision
        const [, , ver, ...restPath] = url.pathname.split("/");
        const revision = Number(ver);
        const ext = ("." + (restPath[restPath.length - 1] ?? "").split(".").pop()).toLowerCase();
        const type = IMAGE_TYPES[ext];
        if (!revisions.includes(revision) || !type) return sendJson(404, { ok: false, error: "not found" });
        const dir = revisionDir(revision);
        const abs = resolve(dir, restPath.map(decodeURIComponent).join("/"));
        if (escapesDir(dir, abs) || !existsSync(abs)) return sendJson(404, { ok: false, error: "not found" });
        res.writeHead(200, { "content-type": type });
        return res.end(readFileSync(abs));
      }
      if (req.method === "GET" && url.pathname === "/api/review") {
        const revision = revisionParam(url);
        if (!revisions.includes(revision)) return sendJson(404, { ok: false, error: "no such revision" });
        const dir = revisionDir(revision);
        const facts = walkFacts(dir).map((factPath) => ({
          path: factPath,
          content: readText(join(dir, factPath)),
          sidecar: readSidecar(dir, factPath) ?? null,
        }));
        return sendJson(200, { review: opts.review, revision, served: defaultRevision, revisions, facts });
      }
      if (req.method === "PUT" && url.pathname === "/api/sidecar") {
        const body = JSON.parse(await readBody(req));
        const revision: number = body.revision ?? defaultRevision;
        // the served revision is the only writable one: feedback on any
        // other refers to text iteration no longer starts from
        if (revision !== defaultRevision) {
          return sendJson(400, { ok: false, error: `revision ${revision} is read-only — this session serves ${defaultRevision}` });
        }
        const dir = revisionDir(revision);
        const factPath = resolveFact(dir, body.path);
        if (!factPath) return sendJson(404, { ok: false, error: "no such fact" });
        const previous = readSidecar(dir, factPath);
        // merge, don't overwrite: the agent may have appended thread
        // answers to the file since this tab last read it
        const sidecar: Sidecar = mergeSidecar(previous, body.sidecar ?? {});
        const target = sidecarPath(dir, factPath);
        if (isEmptySidecar(sidecar)) {
          if (existsSync(target)) unlinkSync(target);
        } else {
          writeFileSync(target, JSON.stringify(sidecar, null, 2) + "\n");
        }
        const knownThreads = new Map(
          (previous?.items ?? [])
            .filter((i) => i.type === "question")
            .map((i) => [i.id, i.thread?.length ?? 0]),
        );
        for (const item of sidecar.items ?? []) {
          if (item.type !== "question") continue;
          const thread = item.thread ?? [];
          if (!knownThreads.has(item.id)) {
            emit("question.asked", { path: factPath, id: item.id, text: thread[0]?.text ?? "" });
            continue;
          }
          // a human turn appended to a known thread is a reply the agent
          // must hear about — edits in place change no length and stay silent
          const last = thread[thread.length - 1];
          if (thread.length > (knownThreads.get(item.id) ?? 0) && last?.who === "human") {
            emit("question.replied", { path: factPath, id: item.id, text: last.text ?? "" });
          }
        }
        return sendJson(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        // a picture for a note: stored under the served revision, named by
        // its content so a retry or a repeat paste is the same file, and
        // handed back as the revision-relative path the note will write
        const revision = revisionParam(url);
        if (revision !== defaultRevision) {
          return sendJson(400, { ok: false, error: `revision ${revision} is read-only — this session serves ${defaultRevision}` });
        }
        const mime = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
        const ext = UPLOAD_TYPES[mime];
        if (!ext) return sendJson(415, { ok: false, error: "images only: PNG, JPEG, GIF, or WebP" });
        const bytes = await readBytes(req, UPLOAD_LIMIT);
        if (bytes === null) {
          return sendJson(413, { ok: false, error: `image too large (${UPLOAD_LIMIT / 1024 / 1024} MB limit)` });
        }
        if (bytes.length === 0) return sendJson(400, { ok: false, error: "empty image" });
        const name = createHash("sha1").update(bytes).digest("hex").slice(0, 16) + ext;
        const dir = noteImagesDir(revisionDir(revision));
        mkdirSync(dir, { recursive: true });
        const target = join(dir, name);
        if (!existsSync(target)) writeFileSync(target, bytes);
        return sendJson(200, { ok: true, path: `${NOTE_IMAGES}/${name}` });
      }
      if (req.method === "POST" && url.pathname === "/api/finish") {
        const body = JSON.parse((await readBody(req)) || "{}");
        return finishSession(res, { ok: true }, body.revision ?? defaultRevision);
      }
      if (req.method === "POST" && url.pathname === "/api/approve") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const revision: number = body.revision ?? defaultRevision;
        if (!revisions.includes(revision)) return sendJson(404, { ok: false, error: "no such revision" });
        const approvedDir = join(reviewDir, "approved");
        if (existsSync(approvedDir)) return sendJson(409, { ok: false, error: "approved/ already exists" });
        return finishSession(res, { ok: true }, revision, () =>
          cpSync(revisionDir(revision), approvedDir, { recursive: true }),
        );
      }
      return sendJson(404, { ok: false, error: "not found" });
    } catch (error) {
      return sendJson(500, { ok: false, error: String(error) });
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    // the revision may be a copy the agent just iterated: pictures of the
    // notes it resolved are gone before the human reads it
    pruneNoteImages(revisionDir(defaultRevision));
    // where `gloss reply` finds this run — written after bind so the file
    // never names a port nothing listens on
    writeFileSync(
      sessionFile,
      JSON.stringify({ pid: process.pid, addr: `http://127.0.0.1:${port}` }) + "\n",
    );
    const url = authRequired
      ? `http://127.0.0.1:${port}/auth?token=${token}`
      : `http://127.0.0.1:${port}/`;
    process.stderr.write(`gloss session: ${url}\n`);
    if (opts.serveHost) {
      process.stderr.write(
        `gloss session (proxied): https://${opts.serveHost}/auth?token=${token}\n`,
      );
    }
    emit("session.started", { review: opts.review, revision: defaultRevision, url });
    if (!opts.noBrowser) {
      try {
        // "start" needs cmd; the empty arg is its window-title slot. The URL
        // is loopback + hex token, so it contains no cmd metacharacters.
        const [opener, args]: [string, string[]] =
          process.platform === "darwin"
            ? ["open", [url]]
            : process.platform === "win32"
              ? ["cmd", ["/c", "start", "", url]]
              : ["xdg-open", [url]];
        spawn(opener, args, {
          stdio: "ignore",
          detached: true,
          windowsHide: true,
        }).unref();
      } catch {
        // no opener available; the printed URL is enough
      }
    }
  });
}

export interface ReplyOptions {
  review: string;
  path: string;
  id: string;
  text: string;
}

// The agent's one write during a live session. Editing a sidecar by hand
// while the viewer PUTs its own copy of the same file is how threads got
// duplicated; this routes the append through the server, which holds the
// merged truth and dedupes retries. No session, no reply — the command
// says so instead of falling back to the racy path.
export async function sendReply(cwd: string, opts: ReplyOptions): Promise<void> {
  const dead = (): never =>
    failJson(`no live session for ${opts.review} — start gloss session first`);
  let session: { pid: number; addr: string };
  try {
    session = JSON.parse(readFileSync(sessionFilePath(cwd, opts.review), "utf8"));
  } catch {
    return dead();
  }
  try {
    process.kill(session.pid, 0); // a stale file from a killed session
  } catch {
    dead();
  }
  let res: Response;
  try {
    res = await fetch(`${session.addr}/api/agent/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ review: opts.review, path: opts.path, id: opts.id, text: opts.text }),
    });
  } catch {
    return dead();
  }
  const body = (await res.json().catch(() => null)) as
    | { ok: boolean; error?: string }
    | null;
  if (!res.ok || !body?.ok) failJson(body?.error ?? `reply failed: HTTP ${res.status}`);
  emitLine(body);
}
