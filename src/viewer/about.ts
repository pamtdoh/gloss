// How review.json's raw values read in the viewer.

/** A commit as people quote it: short, marked when the worktree had
 * uncommitted changes on top of it. */
export function commitLabel(entry: { commit?: string; dirty?: boolean } | undefined): string | null {
  if (!entry?.commit) return null;
  return entry.commit.slice(0, 7) + (entry.dirty ? " + uncommitted" : "");
}

/** A path under the user's home as ~/…, the way they'd type it. */
export function tildePath(path: string, home: string | undefined): string {
  if (!home) return path;
  const base = home.replace(/[\\/]+$/, "");
  if (path === base) return "~";
  for (const sep of ["/", "\\"]) if (path.startsWith(base + sep)) return `~${sep}${path.slice(base.length + 1)}`;
  return path;
}

/** The agent's name as a person would write it. Harnesses report an
 * identifier (Claude Code: "claude-code_2-1-296_agent"); a known shape is
 * spelled out, anything else is shown as given. */
export function agentLabel(raw: string): string {
  const claudeCode = /^claude-code(?:_(\d+)-(\d+)-(\d+))?(?:_\w+)?$/.exec(raw);
  if (claudeCode) return claudeCode[1] ? `Claude Code ${claudeCode[1]}.${claudeCode[2]}.${claudeCode[3]}` : "Claude Code";
  return raw;
}
