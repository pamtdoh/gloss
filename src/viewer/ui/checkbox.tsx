"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "../lib/utils.js"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer group/checkbox size-4 shrink-0 rounded-[4px] border border-input outline-none transition-[background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-primary disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className
      )}
      {...props}
    >
      {/* forceMount keeps the SVG in the DOM so the check can DRAW itself:
          stroke-dashoffset 11 (path length) -> 0 on check, plus a spring
          scale settle; uncheck snaps back instantly (duration-0 rest state) */}
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        forceMount
        className="grid size-full place-items-center text-current"
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-3 scale-90 transition-transform duration-0 group-data-[state=checked]/checkbox:scale-100 group-data-[state=checked]/checkbox:duration-[var(--dur-spring)] group-data-[state=checked]/checkbox:ease-[var(--ease-spring)]"
        >
          <path
            d="M2.5 6.5 5 9l4.5-5.5"
            className="[stroke-dasharray:11] [stroke-dashoffset:11] transition-[stroke-dashoffset] duration-0 ease-[var(--ease-out)] group-data-[state=checked]/checkbox:[stroke-dashoffset:0] group-data-[state=checked]/checkbox:duration-[160ms]"
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
