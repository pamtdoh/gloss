import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const USAGE = `reviewkit — files-first design review

Usage:
  reviewkit init          Scaffold .reviewkit/ in the current directory
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

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "init":
    if (rest.length > 0) fail("init takes no arguments");
    init(process.cwd());
    break;
  case undefined:
  case "help":
  case "--help":
  case "-h":
    process.stdout.write(USAGE);
    break;
  default:
    fail(`unknown command: ${command}`);
}
