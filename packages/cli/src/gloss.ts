import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSession, type SessionOptions } from "./session.js";
import { installSkills, isSkillAgent } from "./skills.js";

const USAGE = `gloss — files-first design review

Usage:
  gloss init          Scaffold .gloss/ in the current directory
  gloss session <review> [--snapshot <n>] [--events] [--no-browser]
                    [--serve-host <host>]
                          Serve the viewer, block until the review is
                          finished, then print a JSON summary.
                          --serve-host additionally accepts requests
                          proxied from a private hostname (e.g.
                          tailscale serve); binding stays loopback-only
  gloss skill install --agent claude|codex [--global]
                          Install the Gloss skills into this repo, or
                          with --global into $HOME for every repo
  gloss help          Show this help

Command results are single-line JSON on stdout; errors are single-line
JSON on stderr with exit code 1. State lives in plain files under
.gloss/ — agents read and write them directly.
`;

function emit(result: object): void {
  process.stdout.write(JSON.stringify(result) + "\n");
}

function fail(error: string): never {
  process.stderr.write(JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}

function init(cwd: string): void {
  const root = resolve(cwd, ".gloss");
  const created = !existsSync(root);
  mkdirSync(root, { recursive: true });
  // .local/ is reserved for tool session state (DESIGN.md §6); keep it out of git.
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, ".local/\n");
  emit({ ok: true, path: root, created });
}

function parseSessionArgs(args: string[]): SessionOptions {
  const opts: SessionOptions = { review: "", events: false, noBrowser: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--events") opts.events = true;
    else if (arg === "--no-browser") opts.noBrowser = true;
    else if (arg === "--snapshot") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value)) fail("--snapshot expects a number");
      opts.snapshot = value;
    } else if (arg === "--serve-host") {
      const value = args[++i];
      if (!value) fail("--serve-host expects a hostname");
      opts.serveHost = value;
    } else if (arg.startsWith("-")) fail(`unknown flag: ${arg}`);
    else if (opts.review) fail("session takes one review name");
    else opts.review = arg;
  }
  if (!opts.review) fail("usage: gloss session <review> [--snapshot <n>] [--events] [--no-browser]");
  return opts;
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "init":
    if (rest.length > 0) fail("init takes no arguments");
    init(process.cwd());
    break;
  case "session":
    runSession(process.cwd(), parseSessionArgs(rest));
    break;
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
    emit({ ok: true, agent, global, installed: installSkills(process.cwd(), agent, global) });
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
