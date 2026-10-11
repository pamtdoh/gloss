import { mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { writeAtomic } from "./files.js";
import { failJson } from "./protocol.js";

// Gloss's home (ARCHITECTURE.md): ~/.gloss, or $GLOSS_HOME. One place for
// the user's preferences and every review, the same path on every OS —
// kept across reboots, outside every repo, private to the user.

export function glossHome(): string {
  const dir = process.env.GLOSS_HOME ? resolve(process.env.GLOSS_HOME) : join(homedir(), ".gloss");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // a home someone else owns (a planted directory, a wrong GLOSS_HOME)
  // would hand them the reviews
  const uid = process.getuid?.();
  if (uid !== undefined && statSync(dir).uid !== uid) {
    failJson(`refusing to use ${dir}: it isn't owned by this user`);
  }
  return dir;
}

export type GroupBy = "repo" | "remote" | "checkout";

/** Preferences the viewer remembers across every review. */
export interface ViewerPrefs {
  theme?: "light" | "dark";
  diffLayout?: "rendered" | "unified" | "split";
  panelWidth?: number;
  treeWidth?: number;
}

export interface Config extends ViewerPrefs {
  /** what one reviews folder groups: all worktrees of a repository (the
   * default), every clone of one remote, or each checkout on its own */
  groupReviewsBy?: GroupBy;
}

const configPath = () => join(glossHome(), "config.json");

/** The config as written, or nothing: a missing or malformed file is the
 * defaults, never an error — it is the user's file to edit. */
export function readConfig(): Config {
  try {
    const value = JSON.parse(readFileSync(configPath(), "utf8"));
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

export function groupBy(config: Config = readConfig()): GroupBy {
  const value = config.groupReviewsBy;
  return value === "remote" || value === "checkout" ? value : "repo";
}

const PREFS: Record<keyof ViewerPrefs, (v: unknown) => boolean> = {
  theme: (v) => v === "light" || v === "dark" || v === null,
  diffLayout: (v) => v === "rendered" || v === "unified" || v === "split" || v === null,
  panelWidth: (v) => (typeof v === "number" && v >= 120 && v <= 2000) || v === null,
  treeWidth: (v) => (typeof v === "number" && v >= 120 && v <= 2000) || v === null,
};

export function viewerPrefs(config: Config = readConfig()): ViewerPrefs {
  const prefs: ViewerPrefs = {};
  for (const key of Object.keys(PREFS) as (keyof ViewerPrefs)[]) {
    if (config[key] !== undefined && PREFS[key](config[key])) (prefs as Record<string, unknown>)[key] = config[key];
  }
  return prefs;
}

/** Save viewer preferences into the config, keeping everything else in
 * it. A key set to null goes back to the default. Unknown keys and bad
 * values are refused, since the body comes from a browser. */
export function saveViewerPrefs(patch: Record<string, unknown>): ViewerPrefs | string {
  const config: Record<string, unknown> = { ...readConfig() };
  for (const [key, value] of Object.entries(patch)) {
    const valid = PREFS[key as keyof ViewerPrefs];
    if (!valid) return `unknown preference: ${key}`;
    if (!valid(value)) return `bad value for ${key}`;
    if (value === null) delete config[key];
    else config[key] = value;
  }
  writeAtomic(configPath(), JSON.stringify(config, null, 2) + "\n");
  return viewerPrefs(config);
}
