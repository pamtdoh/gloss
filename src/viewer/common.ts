import type { SidecarItem } from "../summary.js";
import type { Anchor } from "./anchor.js";

// a touch screen. The viewer shows buttons where there is no keyboard
// and key hints where there is one; width decides layout, the pointer
// decides input. Guarded so the model tests can import this module.
export const COARSE =
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

// replies have no composer mode: they live in the thread subpage,
// which owns its own always-visible reply box
export type Composer =
  | { mode: "new"; type: SidecarItem["type"]; path: string; anchor?: Anchor }
  | { mode: "edit"; path: string; id: string; initial: string };

// Dialogs restore focus on close; if that would land in a text field, the
// single-key shortcuts die silently — drop the restore instead.
export function keepFocusOutOfFields(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, [contenteditable]")) {
    event.preventDefault();
    target.blur();
  }
}
