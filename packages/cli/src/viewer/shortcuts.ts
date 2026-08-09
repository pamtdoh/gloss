// One declarative table drives both key dispatch and the "?" overlay, so
// the help can never drift from reality (Gerrit's shortcuts-config idea).
export interface ShortcutDef {
  id: string;
  /** tinykeys binding(s) */
  keys: string[];
  /** display form for the help overlay */
  shown: string;
  section: "Navigate" | "Decide" | "Items" | "Everywhere";
  label: string;
  allowRepeat?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: "next", keys: ["j"], shown: "j", section: "Navigate", label: "Next fact", allowRepeat: true },
  { id: "prev", keys: ["k"], shown: "k", section: "Navigate", label: "Previous fact", allowRepeat: true },
  { id: "nextItems", keys: ["Shift+J"], shown: "J", section: "Navigate", label: "Next fact with items" },
  { id: "prevItems", keys: ["Shift+K"], shown: "K", section: "Navigate", label: "Previous fact with items" },
  { id: "nextQuestion", keys: ["n"], shown: "n", section: "Navigate", label: "Next open question" },
  { id: "prevQuestion", keys: ["p"], shown: "p", section: "Navigate", label: "Previous open question" },
  { id: "expand", keys: ["ArrowRight"], shown: "→", section: "Navigate", label: "Expand directory" },
  { id: "collapse", keys: ["ArrowLeft"], shown: "←", section: "Navigate", label: "Collapse directory" },
  { id: "palette", keys: ["$mod+KeyK", "/"], shown: "⌘K or /", section: "Everywhere", label: "Search & commands" },
  { id: "filter", keys: ["f"], shown: "f", section: "Navigate", label: "Filter the fact tree" },
  { id: "help", keys: ["Shift+?"], shown: "?", section: "Everywhere", label: "Keyboard help" },
  { id: "close", keys: ["Escape"], shown: "esc", section: "Everywhere", label: "Close / clear selection" },
  { id: "notNeeded", keys: ["1"], shown: "1", section: "Decide", label: "Not needed (again to clear)" },
  { id: "simplify", keys: ["2"], shown: "2", section: "Decide", label: "Simplify (again to clear)" },
  { id: "defer", keys: ["3"], shown: "3", section: "Decide", label: "Defer (again to clear)" },
  { id: "clearDecision", keys: ["0"], shown: "0", section: "Decide", label: "Clear decision" },
  { id: "seen", keys: ["v"], shown: "v", section: "Decide", label: "Toggle seen" },
  { id: "seenAdvance", keys: ["Shift+Enter"], shown: "⇧↵", section: "Decide", label: "Mark seen, go to next unseen" },
  { id: "select", keys: ["x"], shown: "x", section: "Decide", label: "Select fact for bulk decision" },
  { id: "annotate", keys: ["a"], shown: "a", section: "Items", label: "Annotate selection (or whole fact)" },
  { id: "question", keys: ["q"], shown: "q", section: "Items", label: "Ask a question" },
  { id: "comment", keys: ["c"], shown: "c", section: "Items", label: "Comment on the fact" },
  { id: "undo", keys: ["u"], shown: "u", section: "Items", label: "Undo last annotation/comment" },
];
