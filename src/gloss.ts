import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emitLine, failJson as fail } from "./protocol.js";
import { runSession, sendReply, type SessionOptions } from "./session.js";
import { installSkills, type SkillDest } from "./skills.js";

const USAGE = `gloss — files-first design review

Usage:
  gloss init          Scaffold .gloss/ in the current directory
  gloss session <review> [--rev <n>] [--no-browser]
                    [--serve-host <host>]
                          Serve the viewer, emit JSONL events on stdout,
                          block until the review is finished, then print
                          a JSON summary. Run it under a supervisor that
                          streams stdout; the process exiting is the
                          completion signal.
                          --serve-host additionally accepts requests
                          proxied from a private hostname (e.g.
                          tailscale serve); binding stays loopback-only
  gloss reply <review> <fact-path> <question-id> [--text <text>]
                          Append an agent answer to a question's thread
                          through the live session (reads the text from
                          stdin when --text is absent). Fails when no
                          session is running
  gloss skill install [--agents] [--global]
                          Install the Gloss skills into this repo — to
                          .claude/skills/ by default, or with --agents
                          to .agents/skills/ for other harnesses that
                          can supervise a streaming background process.
                          --global installs into your home directory
                          for every repo
  gloss help          Show this help

Command results are single-line JSON on stdout; errors are single-line
JSON on stderr with exit code 1. State lives in plain files under
.gloss/ — agents read and write them directly.
`;

function init(cwd: string): void {
  const root = resolve(cwd, ".gloss");
  const created = !existsSync(root);
  mkdirSync(root, { recursive: true });
  // .session is the per-review live-session dotfile (ARCHITECTURE.md);
  // ephemeral state stays out of git. A gitignore from an older install
  // (".local/") is migrated by appending, never rewritten.
  const gitignore = join(root, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, ".session\n");
  else {
    const current = readFileSync(gitignore, "utf8");
    if (!current.split(/\r?\n/).includes(".session")) {
      writeFileSync(gitignore, current.replace(/\n?$/, "\n") + ".session\n");
    }
  }
  emitLine({ ok: true, path: root, created });
}

function parseSessionArgs(args: string[]): SessionOptions {
  const opts: SessionOptions = { review: "", noBrowser: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--no-browser") opts.noBrowser = true;
    else if (arg === "--rev") {
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
  case "reply": {
    const usage = "usage: gloss reply <review> <fact-path> <question-id> [--text <text>]";
    const positional: string[] = [];
    let text: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--text") {
        text = rest[++i];
        if (text === undefined) fail("--text expects a value");
      } else if (rest[i]!.startsWith("--")) fail(`unknown flag: ${rest[i]}`);
      else positional.push(rest[i]!);
    }
    if (positional.length !== 3) fail(usage);
    // no --text: the answer arrives on stdin, so Markdown with quotes and
    // newlines never fights the shell
    if (text === undefined) text = readFileSync(0, "utf8");
    if (!text.trim()) fail("empty reply text");
    void sendReply(process.cwd(), {
      review: positional[0]!,
      path: positional[1]!,
      id: positional[2]!,
      text,
    });
    break;
  }
  case "skill": {
    const usage = "usage: gloss skill install [--agents] [--global]";
    if (rest[0] !== "install") fail(usage);
    let dest: SkillDest = "claude";
    let global = false;
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--agents") dest = "agents";
      else if (rest[i] === "--global") global = true;
      else fail(usage);
    }
    emitLine({ ok: true, dest, global, installed: installSkills(process.cwd(), dest, global) });
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
