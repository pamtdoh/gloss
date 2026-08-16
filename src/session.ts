import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { emitLine, emitLines, failJson, teeLinesTo, toProtocolPath } from "./protocol.js";
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

// Session state (ARCHITECTURE.md): top-level dot-names under .gloss/ are
// reserved for the tool, and .local/ is the gitignored home for per-review
// session state — the event log, the drain cursor, the session pid.
function sessionStateDir(cwd: string, review: string): string {
  return join(cwd, ".gloss", ".local", review);
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

function readSidecar(revisionDir: string, factPath: string): Sidecar | undefined {
  const path = sidecarPath(revisionDir, factPath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readText(path));
  } catch {
    return undefined; // unreadable sidecar = treat as absent; never police files
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolvePromise(body));
    req.on("error", reject);
  });
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

  // Every stdout line is also appended to a session log, so a harness
  // that cannot hold a pipe open can read the stream as a file via
  // `gloss session <review> --drain`. The pid is written before the
  // log, so a log without a pid file can only mean hand-deletion; the
  // drain cursor carries this pid, so a cursor left by a drain of an
  // earlier run resets instead of skipping this run's first events.
  const stateDir = sessionStateDir(cwd, opts.review);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "session.pid"), String(process.pid) + "\n");
  const logPath = join(stateDir, "session.jsonl");
  writeFileSync(logPath, "");
  teeLinesTo((chunk) => appendFileSync(logPath, chunk));

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

  const finishSession = (res: ServerResponse, payload: object, revision: number): void => {
    if (finishing) return;
    finishing = true;
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
        const revision = url.searchParams.has("revision")
          ? Number(url.searchParams.get("revision"))
          : defaultRevision;
        if (!revisions.includes(revision)) return sendJson(404, { ok: false, error: "no such revision" });
        const dir = revisionDir(revision);
        const facts = walkFacts(dir).map((factPath) => ({
          path: factPath,
          content: readText(join(dir, factPath)),
          sidecar: readSidecar(dir, factPath) ?? null,
        }));
        return sendJson(200, { review: opts.review, revision, revisions, facts });
      }
      if (req.method === "PUT" && url.pathname === "/api/sidecar") {
        const body = JSON.parse(await readBody(req));
        const revision: number = body.revision ?? defaultRevision;
        if (!revisions.includes(revision)) return sendJson(404, { ok: false, error: "no such revision" });
        const dir = revisionDir(revision);
        const factAbs = resolve(dir, String(body.path));
        if (escapesDir(dir, factAbs) || !factAbs.endsWith(".md") || !existsSync(factAbs)) {
          return sendJson(404, { ok: false, error: "no such fact" });
        }
        const factPath = toProtocolPath(relative(dir, factAbs));
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
        cpSync(revisionDir(revision), approvedDir, { recursive: true });
        return finishSession(res, { ok: true }, revision);
      }
      return sendJson(404, { ok: false, error: "not found" });
    } catch (error) {
      return sendJson(500, { ok: false, error: String(error) });
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
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

export interface DrainOptions {
  review: string;
  timeoutMs: number;
}

// Bounded read of the session log: print every event line that arrived
// since the last drain, then exit within timeoutMs. Exit codes are the
// signal — 0: the session finished; 3: still open, call again; 4: the
// session process is gone without finishing. Together with the tee in
// runSession this lets a harness with no long-lived pipe supervise the
// review as a sequence of short calls.
export async function drainSession(cwd: string, opts: DrainOptions): Promise<never> {
  const stateDir = sessionStateDir(cwd, opts.review);
  const logPath = join(stateDir, "session.jsonl");
  const cursorPath = join(stateDir, "session.offset");
  const pidPath = join(stateDir, "session.pid");
  if (!existsSync(logPath)) {
    failJson(`no session log for ${opts.review} — start gloss session first`);
  }

  // The cursor is "<pid> <offset>". Stamping the run's pid means a
  // cursor left by a drain of an earlier session resets instead of
  // skipping the new session's first events.
  let cursorPid = 0;
  let offset = 0;
  if (existsSync(cursorPath)) {
    const parts = readFileSync(cursorPath, "utf8").trim().split(" ");
    const pid = Number(parts[0]);
    const stored = Number(parts[1]);
    if (Number.isInteger(pid) && pid > 0 && Number.isInteger(stored) && stored >= 0) {
      cursorPid = pid;
      offset = stored;
    }
  }
  let finished = false;

  // runSession writes the pid before the log, so a missing pid file next
  // to an existing log means someone deleted it by hand — report the
  // session gone rather than poll to the deadline forever.
  const sessionPid = (): number => {
    if (!existsSync(pidPath)) return 0;
    const pid = Number(readFileSync(pidPath, "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  };
  const alive = (pid: number): boolean => {
    if (pid === 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const drainOnce = (): void => {
    const buffer = readFileSync(logPath);
    if (offset > buffer.length) offset = 0; // cursor corrupt; recover from the start
    const text = buffer.toString("utf8", offset);
    const end = text.lastIndexOf("\n");
    if (end < 0) return; // a line is mid-write; the next poll gets it whole
    const complete = text.slice(0, end + 1);
    writeSync(1, complete);
    offset += Buffer.byteLength(complete, "utf8");
    writeFileSync(cursorPath, `${cursorPid} ${offset}\n`);
    for (const line of complete.split("\n")) {
      if (!line) continue;
      try {
        if (JSON.parse(line).event === "session.finished") finished = true;
      } catch {
        // not JSON we understand; pass through without interpreting
      }
    }
  };

  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const pid = sessionPid();
    if (pid !== cursorPid) {
      // a different session owns the log now; read it from the start
      cursorPid = pid;
      offset = 0;
    }
    const wasAlive = alive(pid);
    // liveness is checked before the drain, so lines written up to the
    // session's death are drained before the death is reported
    drainOnce();
    if (finished) process.exit(0);
    if (!wasAlive) process.exit(4);
    if (Date.now() >= deadline) process.exit(3);
    await sleep(Math.min(300, Math.max(1, deadline - Date.now())));
  }
}
