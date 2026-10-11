import { readJson, writeJson } from "./common.js";

// The viewer's preferences — theme, diff layout, column widths — belong to
// the user, not to one review: they live in ~/.gloss/config.json, read and
// written through whichever review server the tab is on. A browser-local
// copy paints the first frame right and covers a tab whose server is gone.

export interface Prefs {
  theme?: "light" | "dark";
  diffLayout?: "rendered" | "unified" | "split";
  panelWidth?: number;
  treeWidth?: number;
}

const CACHE = "gloss-prefs";
// the page carries the saved preferences (html.ts); the browser's copy is
// the fallback for a page that doesn't (an old cached one)
let prefs: Prefs = (window as { __GLOSS_PREFS?: Prefs }).__GLOSS_PREFS ?? readJson<Prefs>(CACHE, {});
const listeners = new Set<() => void>();

export const getPrefs = (): Prefs => prefs;

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function replace(next: Prefs): void {
  prefs = next;
  writeJson(CACHE, prefs);
  for (const listener of listeners) listener();
}

/** The user's saved preferences, from the server. */
export async function loadPrefs(): Promise<void> {
  try {
    const res = await fetch("/api/config");
    if (res.ok) replace((await res.json()) as Prefs);
  } catch {
    // no server: the cached copy stands
  }
}

/** Change one preference (undefined = back to the default) everywhere. */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K] | undefined): void {
  const next = { ...prefs };
  if (value === undefined) delete next[key];
  else next[key] = value;
  replace(next);
  void fetch("/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: value ?? null }),
  }).catch(() => {
    // offline: kept in this browser until the next change reaches a server
  });
}
