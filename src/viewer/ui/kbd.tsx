/**
 * The house keyboard chip.
 *
 * The app runs ten live bindings and, until now, printed exactly zero of them
 * anywhere a user could read: `mod+k` existed only in two code comments, and
 * `<kbd>` appeared nowhere in `src`. `aria-keyshortcuts` is an AT channel with
 * uneven support and no sighted path at all, so a keyboard-first app owed a
 * visible form. This is that form, in one place, so the second and third
 * surface to print a binding cannot draw it differently.
 *
 * Deliberately NOT a client component: it holds no state and no handler, so it
 * renders inside server components with no island. The one thing that IS
 * platform-dependent — whether the modifier prints as `Ctrl` or `⌘` — stays at
 * the call site, because resolving it needs an effect and this file should not
 * force one on every consumer.
 *
 * `.stat` (the instrument mono) rather than the sans: a key cap is a token you
 * press, not a word you read. Note the shipped JetBrains Mono subset is the
 * Google-Fonts `latin` range, which does not contain U+2318 ⌘ — on a Mac that
 * one glyph falls back to the system font. Harmless (it is the glyph macOS
 * users read everywhere else) and recorded so it is not re-discovered as a bug.
 */
import * as React from "react";
import { cn } from "../lib/utils.js";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "stat inline-flex h-4 items-center rounded border border-line px-1 text-[10px] leading-none text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
