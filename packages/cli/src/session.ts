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
import { join, relative, resolve, sep } from "node:path";
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
  snapshot?: number;
  events: boolean;
  noBrowser: boolean;
  /**
   * Extra hostname to accept in Host/Origin checks, for a private proxy
   * that terminates in front of the loopback server (e.g. tailscale
   * serve). The server still binds 127.0.0.1 only; the one-time token
   * still gates the session.
   */
  serveHost?: string;
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

function listSnapshots(reviewDir: string): number[] {
  return readdirSync(reviewDir)
    .filter((name) => /^\d+$/.test(name) && statSync(join(reviewDir, name)).isDirectory())
    .map(Number)
    .sort((a, b) => a - b);
}

function walkFacts(snapshotDir: string, dir = snapshotDir): string[] {
  const facts: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) facts.push(...walkFacts(snapshotDir, path));
    else if (name.endsWith(".md")) facts.push(relative(snapshotDir, path));
  }
  return facts.sort();
}

function sidecarPath(snapshotDir: string, factPath: string): string {
  return join(snapshotDir, factPath.replace(/\.md$/, ".review.json"));
}

function readSidecar(snapshotDir: string, factPath: string): Sidecar | undefined {
  const path = sidecarPath(snapshotDir, factPath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
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
  const fail = (error: string): never => {
    process.stderr.write(jsonLine({ ok: false, error }));
    process.exit(1);
  };

  const reviewDir = join(cwd, ".reviewkit", opts.review);
  if (!existsSync(reviewDir)) fail(`no such review: ${opts.review}`);
  const snapshots = listSnapshots(reviewDir);
  if (snapshots.length === 0) fail(`review ${opts.review} has no snapshots`);
  const defaultSnapshot = opts.snapshot ?? snapshots[snapshots.length - 1]!;
  if (!snapshots.includes(defaultSnapshot)) fail(`no such snapshot: ${defaultSnapshot}`);

  const snapshotDir = (n: number) => join(reviewDir, String(n));
  const token = randomBytes(32).toString("hex");
  const sessionCookie = randomBytes(32).toString("hex");
  let tokenUsed = false;
  let finishing = false;

  const emit = (event: string, data: Record<string, unknown>): void => {
    if (opts.events) process.stdout.write(jsonLine({ event, ...data }));
  };

  const computeSummary = (snapshot: number) => {
    const dir = snapshotDir(snapshot);
    const facts = walkFacts(dir);
    return summarize({
      review: opts.review,
      snapshot,
      sidecars: facts.map((factPath) => readSidecar(dir, factPath)),
      approved: existsSync(join(reviewDir, "approved")),
    });
  };

  const finishSession = (res: ServerResponse, payload: object, snapshot: number): void => {
    if (finishing) return;
    finishing = true;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload), () => {
      const summary = computeSummary(snapshot);
      emit("session.finished", { summary });
      process.stdout.write(jsonLine(summary));
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
            `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>reviewkit</title>` +
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
        return res.end("<h1>Unauthorized</h1><p>Open the one-time URL printed by <code>reviewkit session</code>.</p>");
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
        // /asset/<snapshot>/<path> — images stored inside the snapshot
        const [, , snap, ...restPath] = url.pathname.split("/");
        const snapshot = Number(snap);
        const ext = ("." + (restPath[restPath.length - 1] ?? "").split(".").pop()).toLowerCase();
        const type = IMAGE_TYPES[ext];
        if (!snapshots.includes(snapshot) || !type) return sendJson(404, { ok: false, error: "not found" });
        const dir = snapshotDir(snapshot);
        const abs = resolve(dir, restPath.map(decodeURIComponent).join("/"));
        if (!abs.startsWith(dir + sep) || !existsSync(abs)) return sendJson(404, { ok: false, error: "not found" });
        res.writeHead(200, { "content-type": type });
        return res.end(readFileSync(abs));
      }
      if (req.method === "GET" && url.pathname === "/api/review") {
        const snapshot = url.searchParams.has("snapshot")
          ? Number(url.searchParams.get("snapshot"))
          : defaultSnapshot;
        if (!snapshots.includes(snapshot)) return sendJson(404, { ok: false, error: "no such snapshot" });
        const dir = snapshotDir(snapshot);
        const facts = walkFacts(dir).map((factPath) => ({
          path: factPath,
          content: readFileSync(join(dir, factPath), "utf8"),
          sidecar: readSidecar(dir, factPath) ?? null,
        }));
        return sendJson(200, { review: opts.review, snapshot, snapshots, facts });
      }
      if (req.method === "PUT" && url.pathname === "/api/sidecar") {
        const body = JSON.parse(await readBody(req));
        const snapshot: number = body.snapshot ?? defaultSnapshot;
        if (!snapshots.includes(snapshot)) return sendJson(404, { ok: false, error: "no such snapshot" });
        const dir = snapshotDir(snapshot);
        const factAbs = resolve(dir, String(body.path));
        if (!factAbs.startsWith(dir + sep) || !factAbs.endsWith(".md") || !existsSync(factAbs)) {
          return sendJson(404, { ok: false, error: "no such fact" });
        }
        const factPath = relative(dir, factAbs);
        const previous = readSidecar(dir, factPath);
        const sidecar: Sidecar = body.sidecar ?? {};
        const target = sidecarPath(dir, factPath);
        if (isEmptySidecar(sidecar)) {
          if (existsSync(target)) unlinkSync(target);
        } else {
          writeFileSync(target, JSON.stringify(sidecar, null, 2) + "\n");
        }
        const knownQuestions = new Set(
          (previous?.items ?? []).filter((i) => i.type === "question").map((i) => i.id),
        );
        for (const item of sidecar.items ?? []) {
          if (item.type === "question" && !knownQuestions.has(item.id)) {
            emit("question.asked", { path: factPath, id: item.id, text: item.thread?.[0]?.text ?? "" });
          }
        }
        return sendJson(200, { ok: true });
      }
      if (req.method === "POST" && url.pathname === "/api/finish") {
        const body = JSON.parse((await readBody(req)) || "{}");
        return finishSession(res, { ok: true }, body.snapshot ?? defaultSnapshot);
      }
      if (req.method === "POST" && url.pathname === "/api/approve") {
        const body = JSON.parse((await readBody(req)) || "{}");
        const snapshot: number = body.snapshot ?? defaultSnapshot;
        if (!snapshots.includes(snapshot)) return sendJson(404, { ok: false, error: "no such snapshot" });
        const approvedDir = join(reviewDir, "approved");
        if (existsSync(approvedDir)) return sendJson(409, { ok: false, error: "approved/ already exists" });
        cpSync(snapshotDir(snapshot), approvedDir, { recursive: true });
        return finishSession(res, { ok: true }, snapshot);
      }
      return sendJson(404, { ok: false, error: "not found" });
    } catch (error) {
      return sendJson(500, { ok: false, error: String(error) });
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/auth?token=${token}`;
    process.stderr.write(`reviewkit session: ${url}\n`);
    if (opts.serveHost) {
      process.stderr.write(
        `reviewkit session (proxied): https://${opts.serveHost}/auth?token=${token}\n`,
      );
    }
    emit("session.started", { review: opts.review, snapshot: defaultSnapshot, url });
    if (!opts.noBrowser) {
      try {
        spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
          stdio: "ignore",
          detached: true,
        }).unref();
      } catch {
        // no opener available; the printed URL is enough
      }
    }
  });
}
