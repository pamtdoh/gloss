import { writeSync } from "node:fs";
import { sep } from "node:path";

// The CLI's external protocol (ARCHITECTURE.md): JSONL on stdout, a JSON
// error line on stderr, exit code as the signal, "/"-separated relative
// paths in every payload. This module is the protocol's one owner.

// writeSync, not stream writes: stdio is async for pipes on Windows and
// process.exit() would drop unflushed lines — exactly the lines agents
// block on.
function writeChunk(chunk: string): void {
  writeSync(1, chunk);
}

export function emitLine(value: unknown): void {
  writeChunk(JSON.stringify(value) + "\n");
}

// One write for lines that must land together (session.finished and the
// final summary), so a reader of either channel never sees one without
// the other.
export function emitLines(values: unknown[]): void {
  writeChunk(values.map((value) => JSON.stringify(value) + "\n").join(""));
}

export function failJson(error: string): never {
  writeSync(2, JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}

// Relative paths in payloads (fact paths, install paths) are protocol
// strings, always "/"-separated even on Windows where node:path yields
// "\". Native separators stop at the filesystem boundary.
export function toProtocolPath(nativeRelative: string): string {
  return nativeRelative.split(sep).join("/");
}
