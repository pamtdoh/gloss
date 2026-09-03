// One declarative table drives both key dispatch and the "?" overlay
// (client.tsx builds its tinykeys map from this array), so the help can
// never drift from reality (Gerrit's shortcuts-config idea).
export interface ShortcutDef {
  id: string;
  /** tinykeys binding(s) */
  keys: string[];
  /** display form for the help overlay */
  shown: string;
  section: "Navigate" | "Progress" | "Notes" | "Everywhere";
  label: string;
  allowRepeat?: boolean;
  /** fires even when a field has focus (palette toggle, escape) */
  raw?: boolean;
}

// tinykeys resolves $mod to Meta on Apple platforms and Control everywhere
// else; every printed label must say the key the user actually has.
export const MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘" : "Ctrl+";

export const SHORTCUTS: ShortcutDef[] = [
  { id: "next", keys: ["j"], shown: "j", section: "Navigate", label: "Next fact", allowRepeat: true },
  { id: "prev", keys: ["k"], shown: "k", section: "Navigate", label: "Previous fact", allowRepeat: true },
  { id: "nextItems", keys: ["Shift+J"], shown: "J", section: "Navigate", label: "Next fact with notes" },
  { id: "prevItems", keys: ["Shift+K"], shown: "K", section: "Navigate", label: "Previous fact with notes" },
  { id: "nextQuestion", keys: ["n"], shown: "n", section: "Navigate", label: "Next open question" },
  { id: "prevQuestion", keys: ["p"], shown: "p", section: "Navigate", label: "Previous open question" },
  { id: "expand", keys: ["ArrowRight"], shown: "→", section: "Navigate", label: "Expand directory" },
  { id: "collapse", keys: ["ArrowLeft"], shown: "←", section: "Navigate", label: "Collapse directory" },
  { id: "filter", keys: ["f", "/"], shown: "f or /", section: "Navigate", label: "Filter the fact tree" },
  { id: "scope", keys: ["s"], shown: "s", section: "Navigate", label: "Cycle scope: all / changed / raised" },
  { id: "compare", keys: ["d"], shown: "d", section: "Navigate", label: "Toggle diff against the previous revision" },
  { id: "help", keys: ["Shift+?"], shown: "?", section: "Everywhere", label: "Keyboard help" },
  { id: "close", keys: ["Escape"], shown: "esc", section: "Everywhere", label: "Close / clear selection", raw: true },
  { id: "seen", keys: ["v"], shown: "v", section: "Progress", label: "Toggle seen" },
  { id: "seenAdvance", keys: ["Shift+Enter"], shown: "⇧↵", section: "Progress", label: "Mark seen, go to next unseen" },
  { id: "comment", keys: ["c", "a"], shown: "c", section: "Notes", label: "Comment on selection (or whole fact)" },
  { id: "question", keys: ["q"], shown: "q", section: "Notes", label: "Ask a question" },
  { id: "undo", keys: ["u"], shown: "u", section: "Notes", label: "Undo last comment" },
];

/** The printed key of one shortcut, for hints at the point of use. */
export const keyFor = (id: string): string => SHORTCUTS.find((s) => s.id === id)?.shown ?? "";
