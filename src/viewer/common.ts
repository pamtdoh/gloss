import type { SidecarItem } from "../summary.js";
import type { Anchor } from "./anchor.js";

// a touch screen. The viewer shows buttons where there is no keyboard
// and key hints where there is one; width decides layout, the pointer
// decides input. Guarded so the model tests can import this module.
export const COARSE =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

// replies have no composer mode: they live in the thread subpage,
// which owns its own always-visible reply box. `initial` is the text the
// box opens with: the item's own for an edit, and the text so far once
// the composer is kept as a draft (drafts.ts).
export type Composer =
  | { mode: "new"; type: SidecarItem["type"]; path: string; anchor?: Anchor; initial?: string }
  | { mode: "edit"; path: string; id: string; initial: string };

// JSON in localStorage — the viewer's browser-local memory (theme, seen
// marks, drafts): a missing or unparsable value reads as the fallback,
// and writing null removes the key
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

// Dialogs restore focus on close; if that would land in a text field, the
// single-key shortcuts die silently — drop the restore instead.
export function keepFocusOutOfFields(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, [contenteditable]")) {
    event.preventDefault();
    target.blur();
  }
}
