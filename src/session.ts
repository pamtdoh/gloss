import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { emitLine, failJson, toProtocolPath } from "./protocol.js";
import { type Sidecar, isEmptySidecar, summarize } from "./summary.js";
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
  const token = randomBytes(32).toString("hex");
  const sessionCookie = randomBytes(32).toString("hex");
  let tokenUsed = false;
  let finishing = false;

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
      emit("session.finished", { summary });
      emitLine(summary);
      process.exit(0);
    });
  };

  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port;
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
            "set-cookie": `rk_session=${sessionCookie}; HttpOnly; SameSite=Strict; Path=/`,
            location: "/",
          });
          return res.end();
        }
        return sendJson(405, { ok: false, error: "method not allowed" });
      }

      const cookies = (req.headers.cookie ?? "").split(";").map((c) => c.trim());
      if (!cookies.includes(`rk_session=${sessionCookie}`)) {
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
        const sidecar: Sidecar = body.sidecar ?? {};
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
    const url = `http://127.0.0.1:${port}/auth?token=${token}`;
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
