import { mkdirSync, readFileSync } from "node:fs";
import { emitLine, failJson as fail } from "./protocol.js";
import { reviewsDir } from "./reviews.js";
import { type SessionOptions, approve, runSession, sendReply, sendStatus, stopServer } from "./agent.js";
import { runServer } from "./server.js";
import { installSkills, type SkillDest } from "./skills.js";

const USAGE = `gloss — files-first design review

Usage:
  gloss dir           Print (and create) this repo's reviews directory
  gloss session <review> [--no-browser] [--serve-host <host>]
                          Freeze <review>/draft/ as the next revision when
                          its facts changed (else serve the latest
                          again), publish it to the review's server,
                          starting the server if needed, then stream
                          JSONL events until the human finishes or
                          approves, and print a JSON summary.
                          Run it under a supervisor that streams stdout;
                          the process exiting is the completion signal.
                          Open tabs follow the new revision; a browser is
                          opened only when none is connected.
                          --serve-host also accepts requests proxied from
                          a private hostname (e.g. tailscale serve)
  gloss reply <review> <fact-path> <question-id> [--text <text>]
                          Append the agent's answer to a question's thread
                          (reads stdin when --text is absent)
  gloss status <review> <text>
                          Show a status line in the open tabs, e.g.
                          "writing revision 3"
  gloss approve <review> [--rev <n>]
                          Copy a revision to approved/ (default: the one
                          on screen, else the latest)
  gloss stop <review>     Stop the review's server
  gloss skill install [--agents] [--global]
                          Install the Gloss skills into this repo — to
                          .claude/skills/ by default, or with --agents
                          to .agents/skills/ for other harnesses that
                          can supervise a streaming background process.
                          --global installs into your home directory
                          for every repo
  gloss help          Show this help

Command results are single-line JSON on stdout; errors are single-line
JSON on stderr with exit code 1. State lives in plain files under the
directory \`gloss dir\` prints — agents read and write them directly.
`;

function dir(cwd: string): void {
  const path = reviewsDir(cwd);
  mkdirSync(path, { recursive: true });
  emitLine({ ok: true, path });
}

function parseSessionArgs(args: string[]): SessionOptions {
  const opts: SessionOptions = { review: "", noBrowser: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--no-browser") opts.noBrowser = true;
    else if (arg === "--serve-host") {
      const value = args[++i];
      if (!value) fail("--serve-host expects a hostname");
      opts.serveHost = value;
    } else if (arg.startsWith("-")) fail(`unknown flag: ${arg}`);
    else if (opts.review) fail("session takes one review name");
    else opts.review = arg;
  }
  if (!opts.review) fail("usage: gloss session <review> [--no-browser] [--serve-host <host>]");
  return opts;
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "dir":
    if (rest.length > 0) fail("dir takes no arguments");
    dir(process.cwd());
    break;
  case "session":
    void runSession(process.cwd(), parseSessionArgs(rest));
    break;
  case "__serve": {
    // internal: the detached server process `gloss session` starts
    const serveHost = rest[1] === "--serve-host" ? rest[2] : undefined;
    if (!rest[0]) fail("usage: gloss __serve <review> [--serve-host <host>]");
    runServer(process.cwd(), { review: rest[0], serveHost });
    break;
  }
  case "status":
    if (rest.length !== 2) fail("usage: gloss status <review> <text>");
    void sendStatus(process.cwd(), rest[0]!, rest[1]!);
    break;
  case "stop":
    if (rest.length !== 1) fail("usage: gloss stop <review>");
    void stopServer(process.cwd(), rest[0]!);
    break;
  case "approve": {
    const usage = "usage: gloss approve <review> [--rev <n>]";
    if (!rest[0] || rest[0].startsWith("-")) fail(usage);
    let revision: number | undefined;
    if (rest[1] === "--rev") {
      revision = Number(rest[2]);
      if (!Number.isInteger(revision)) fail("--rev expects a number");
    } else if (rest.length > 1) fail(usage);
    void approve(process.cwd(), rest[0], revision);
    break;
  }
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
