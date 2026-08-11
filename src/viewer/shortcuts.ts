// One declarative table drives both key dispatch and the "?" overlay
// (client.tsx builds its tinykeys map from this array), so the help can
// never drift from reality (Gerrit's shortcuts-config idea).
export interface ShortcutDef {
  id: string;
  /** tinykeys binding(s) */
  keys: string[];
  /** display form for the help overlay */
  shown: string;
  section: "Navigate" | "Decide" | "Items" | "Everywhere";
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
  { id: "nextItems", keys: ["Shift+J"], shown: "J", section: "Navigate", label: "Next fact with items" },
  { id: "prevItems", keys: ["Shift+K"], shown: "K", section: "Navigate", label: "Previous fact with items" },
  { id: "nextQuestion", keys: ["n"], shown: "n", section: "Navigate", label: "Next open question" },
  { id: "prevQuestion", keys: ["p"], shown: "p", section: "Navigate", label: "Previous open question" },
  { id: "expand", keys: ["ArrowRight"], shown: "→", section: "Navigate", label: "Expand directory" },
  { id: "collapse", keys: ["ArrowLeft"], shown: "←", section: "Navigate", label: "Collapse directory" },
  { id: "filter", keys: ["f", "/"], shown: "f or /", section: "Navigate", label: "Filter the fact tree" },
  { id: "scope", keys: ["d"], shown: "d", section: "Navigate", label: "Cycle scope: all / changed / raised" },
  { id: "help", keys: ["Shift+?"], shown: "?", section: "Everywhere", label: "Keyboard help" },
  { id: "close", keys: ["Escape"], shown: "esc", section: "Everywhere", label: "Close / clear selection", raw: true },
  { id: "notNeeded", keys: ["1"], shown: "1", section: "Decide", label: "Quick comment: not needed" },
  { id: "simplify", keys: ["2"], shown: "2", section: "Decide", label: "Quick comment: simplify" },
  { id: "defer", keys: ["3"], shown: "3", section: "Decide", label: "Quick comment: defer" },
  { id: "seen", keys: ["v"], shown: "v", section: "Decide", label: "Toggle seen" },
  { id: "seenAdvance", keys: ["Shift+Enter"], shown: "⇧↵", section: "Decide", label: "Mark seen, go to next unseen" },
  { id: "select", keys: ["x"], shown: "x", section: "Decide", label: "Select fact for bulk quick comments" },
  { id: "comment", keys: ["c", "a"], shown: "c", section: "Items", label: "Comment on selection (or whole fact)" },
  { id: "question", keys: ["q"], shown: "q", section: "Items", label: "Ask a question" },
  { id: "undo", keys: ["u"], shown: "u", section: "Items", label: "Undo last comment" },
];
