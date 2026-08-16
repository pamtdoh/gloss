import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emitLine, failJson as fail } from "./protocol.js";
import { drainSession, runSession, type SessionOptions } from "./session.js";
import { installSkills, isSkillAgent } from "./skills.js";

const USAGE = `gloss — files-first design review

Usage:
  gloss init          Scaffold .gloss/ in the current directory
  gloss session <review> [--rev <n>] [--no-browser]
                    [--serve-host <host>]
                          Serve the viewer, emit JSONL events on stdout,
                          block until the review is finished, then print
                          a JSON summary. Every line is also written to
                          .gloss/.local/<review>/session.jsonl.
                          --serve-host additionally accepts requests
                          proxied from a private hostname (e.g.
                          tailscale serve); binding stays loopback-only
  gloss session <review> --drain [--timeout <seconds>]
                          Print the event lines that arrived since the
                          last drain, then exit within the timeout
                          (default 25). Exit code 0: the session
                          finished; 3: still open, call again; 4: the
                          session process is gone without finishing
  gloss skill install --agent claude|codex [--global]
                          Install the Gloss skills into this repo, or
                          with --global into your home directory for
                          every repo
  gloss help          Show this help

Command results are single-line JSON on stdout; errors are single-line
JSON on stderr with exit code 1. State lives in plain files under
.gloss/ — agents read and write them directly.
`;

function init(cwd: string): void {
  const root = resolve(cwd, ".gloss");
  const created = !existsSync(root);
  mkdirSync(root, { recursive: true });
  // .local/ is reserved for tool session state (ARCHITECTURE.md); keep it out of git.
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, ".local/\n");
  emitLine({ ok: true, path: root, created });
}

type SessionArgs = SessionOptions & { drain: boolean; timeoutMs?: number };

function parseSessionArgs(args: string[]): SessionArgs {
  const opts: SessionArgs = { review: "", noBrowser: false, drain: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--no-browser") opts.noBrowser = true;
    else if (arg === "--drain") opts.drain = true;
    else if (arg === "--timeout") {
      const seconds = Number(args[++i]);
      if (!Number.isInteger(seconds) || seconds <= 0) fail("--timeout expects whole seconds");
      opts.timeoutMs = seconds * 1000;
    } else if (arg === "--rev") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value)) fail("--rev expects a number");
      opts.revision = value;
    } else if (arg === "--serve-host") {
      const value = args[++i];
      if (!value) fail("--serve-host expects a hostname");
      opts.serveHost = value;
    } else if (arg.startsWith("-")) fail(`unknown flag: ${arg}`);
    else if (opts.review) fail("session takes one review name");
    else opts.review = arg;
  }
  if (!opts.review) fail("usage: gloss session <review> [--rev <n>] [--no-browser]");
  if (opts.timeoutMs !== undefined && !opts.drain) fail("--timeout requires --drain");
  if (opts.drain && (opts.revision !== undefined || opts.noBrowser || opts.serveHost)) {
    fail("--drain combines only with --timeout");
  }
  return opts;
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "init":
    if (rest.length > 0) fail("init takes no arguments");
    init(process.cwd());
    break;
  case "session": {
    const opts = parseSessionArgs(rest);
    // drainSession is async (it sleeps between polls) and exits the
    // process itself; the pending timers keep the event loop alive.
    if (opts.drain) {
      void drainSession(process.cwd(), { review: opts.review, timeoutMs: opts.timeoutMs ?? 25_000 });
    } else runSession(process.cwd(), opts);
    break;
  }
  case "skill": {
    const usage = "usage: gloss skill install --agent claude|codex [--global]";
    if (rest[0] !== "install") fail(usage);
    let agent = "";
    let global = false;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--agent") agent = rest[++i] ?? "";
      else if (rest[i] === "--global") global = true;
      else fail(usage);
    }
    if (!isSkillAgent(agent)) fail(usage);
    emitLine({ ok: true, agent, global, installed: installSkills(process.cwd(), agent, global) });
    break;
  }
  case undefined:
  case "help":
  case "--help":
  case "-h":
    process.stdout.write(USAGE);
    break;
  default:
    fail(`unknown command: ${command}`);
}
