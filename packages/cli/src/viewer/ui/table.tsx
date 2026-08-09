/**
 * Stock shadcn table, minus the "use client" it shipped with. Nothing in this
 * file uses a hook, a ref or an event handler, and its only consumer is a
 * server component — the directive was turning ~422 <tr> and ~2954 <td> into
 * client elements, serialized into the flight payload AND hydrated. Measured
 * SSR for the 422-row Problems table: 27.6ms with the old per-row dialogs and
 * client boundary vs 10.9ms without.
 */
import * as React from "react"

import { cn } from "../lib/utils.js"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      // No transition on the row wash. The old rule was 0ms in / 120ms out on
      // --ease-in (cubic-bezier(0.2,0,1,0.9), Carbon's *exit* curve, which
      // holds ~80% of the value through the first half of its life) — so the
      // wash visibly lagged the cursor on release. That asymmetry is what
      // "the hover doesn't disappear immediately" was. Nobody ships it:
      // GitHub Primer and Vercel Geist use no transition at all on row hover,
      // stock shadcn uses symmetric 150ms, Carbon symmetric 70ms. A table is a
      // high-frequency pointer surface; instant both ways is the honest choice.
      //
      // Also gone: data-stretched, [data-hover-reveal] and (on TableHead)
      // data-sort. grep found no consumer setting any of the three — they were
      // dead rules costing three motion behaviours and, in the checkbox case,
      // 2954 :has() subjects on one page.
      //
      // The open-row wash keys on `details[open]`, not on aria-expanded. The
      // rule used to be has-aria-expanded:, which compiles to
      // :has([aria-expanded=true]) — and <summary> sets NO aria-expanded
      // attribute (it exposes expanded state in the a11y tree only), so with a
      // native <details> as the only in-table expander the rule had zero
      // consumers and an open row was indistinguishable from its neighbours
      // once the pointer left. Same one :has() subject per row, now firing. If
      // a button-based expander (.disclosure, which does set aria-expanded)
      // ever lands in a table, add has-aria-expanded: back alongside this.
      className={cn(
        "border-b border-border hover:bg-muted/50 has-[details[open]]:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      // no [&:has([role=checkbox])] — this table has no checkboxes, and the
      // rule put a :has() subject on every one of ~2954 cells
      className={cn("p-2 align-middle whitespace-nowrap", className)}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
