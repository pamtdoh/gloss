import { execFileSync } from "node:child_process";
import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

// One review server per review (ARCHITECTURE.md): a lock file holding the
// owner's pid. A lock whose owner is gone, or whose pid now belongs to
// some other program, is stale and taken over.

export function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
  // a killed process nobody has reaped yet (common in containers, where
  // pid 1 may never reap) still answers signal 0: it is dead all the same
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z";
  } catch {
    return true; // no /proc (macOS, Windows): signal 0 is the answer
  }
}

/** Whether a live pid is a review server — pids are reused, and a lock
 * left by a killed server may name some unrelated program by now. When
 * the platform can't say (no /proc, no ps), it is assumed to be one. */
export function isReviewServer(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").includes("__serve");
  } catch {
    // no /proc: ask ps
  }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes("__serve");
  } catch {
    return true;
  }
}

/** Take the lock, or return false while a live review server holds it.
 * The lock is created by hard-linking a file that already holds this pid,
 * so no reader ever sees it empty — an empty lock read as "pid 0, dead"
 * would let a second server steal a starting one's lock. */
export function acquireLock(path: string): boolean {
  const mine = `${path}.${process.pid}.tmp`;
  writeFileSync(mine, String(process.pid));
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(mine, path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      let owner: number;
      try {
        owner = Number(readFileSync(path, "utf8"));
      } catch {
        continue; // removed meanwhile: try again
      }
      if (owner === process.pid) return true;
      if (pidAlive(owner) && isReviewServer(owner)) return false;
      try {
        unlinkSync(path); // stale
      } catch {
        // another starter removed it first
      }
    }
    return false;
  } finally {
    try {
      unlinkSync(mine);
    } catch {
      // already gone
    }
  }
}
