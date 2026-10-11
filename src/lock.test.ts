import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, isReviewServer } from "./lock.js";

let dir: string;
let lock: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gloss-lock-"));
  lock = join(dir, ".server.lock");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("a free lock is taken, holding this pid, with no temp file left", () => {
  expect(acquireLock(lock)).toBe(true);
  expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
  expect(existsSync(`${lock}.${process.pid}.tmp`)).toBe(false);
});

test("a lock whose owner is dead is taken over", () => {
  writeFileSync(lock, "2147483646");
  expect(acquireLock(lock)).toBe(true);
  expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
});

test("a lock whose pid now belongs to another program is stale", async () => {
  // a live process that is not a review server: its pid in the lock is
  // what a killed server leaves once the pid is reused
  const other = spawn("sleep", ["5"]);
  await new Promise((r) => other.once("spawn", r));
  try {
    expect(isReviewServer(other.pid!)).toBe(false);
    writeFileSync(lock, String(other.pid));
    expect(acquireLock(lock)).toBe(true);
  } finally {
    other.kill();
  }
});

test("a lock held by a live review server is respected", async () => {
  // stands in for a server: its command line carries __serve
  const server = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)", "__serve"]);
  await new Promise((r) => server.once("spawn", r));
  try {
    expect(isReviewServer(server.pid!)).toBe(true);
    writeFileSync(lock, String(server.pid));
    expect(acquireLock(lock)).toBe(false);
  } finally {
    server.kill();
  }
});
