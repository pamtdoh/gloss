import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSession, type SessionOptions } from "./session.js";
import { installSkills, isSkillAgent } from "./skills.js";

const USAGE = `reviewkit — files-first design review

Usage:
  reviewkit init          Scaffold .reviewkit/ in the current directory
  reviewkit session <review> [--snapshot <n>] [--events] [--no-browser]
                          Serve the viewer, block until the review is
                          finished, then print a JSON summary
  reviewkit skill install --agent claude|codex
                          Install the ReviewKit skills into this repo
  reviewkit help          Show this help

Command results are single-line JSON on stdout; errors are single-line
JSON on stderr with exit code 1. State lives in plain files under
.reviewkit/ — agents read and write them directly.
`;

function emit(result: object): void {
  process.stdout.write(JSON.stringify(result) + "\n");
}

function fail(error: string): never {
  process.stderr.write(JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}

function init(cwd: string): void {
  const root = resolve(cwd, ".reviewkit");
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
    } else if (arg.startsWith("-")) fail(`unknown flag: ${arg}`);
    else if (opts.review) fail("session takes one review name");
    else opts.review = arg;
  }
  if (!opts.review) fail("usage: reviewkit session <review> [--snapshot <n>] [--events] [--no-browser]");
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
    const usage = "usage: reviewkit skill install --agent claude|codex";
    if (rest[0] !== "install") fail(usage);
    let agent = "";
    for (let i = 1; i < rest.length; i++) {
      if (rest[i] === "--agent") agent = rest[++i] ?? "";
      else fail(usage);
    }
    if (!isSkillAgent(agent)) fail(usage);
    emit({ ok: true, agent, installed: installSkills(process.cwd(), agent) });
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
