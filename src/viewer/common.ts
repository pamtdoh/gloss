import type { SidecarItem } from "../summary.js";
import type { Anchor } from "./anchor.js";

// Quick Comment — the old "decisions": one-tap whole-fact comments with
// canned text. One concept, simpler files.
export interface QuickComment { key: string; label: string; text: string }
export const QUICK_COMMENTS: QuickComment[] = [
  { key: "1", label: "Not needed", text: "Not needed." },
  { key: "2", label: "Simplify", text: "Simplify." },
  { key: "3", label: "Defer", text: "Defer." },
];

export type Composer =
  | { mode: "new"; type: SidecarItem["type"]; path: string; anchor?: Anchor }
  | { mode: "edit"; path: string; id: string; initial: string }
  | { mode: "reply"; path: string; id: string };

// Dialogs restore focus on close; if that would land in a text field, the
// single-key shortcuts die silently — drop the restore instead.
export function keepFocusOutOfFields(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, [contenteditable]")) {
    event.preventDefault();
    target.blur();
  }
}
