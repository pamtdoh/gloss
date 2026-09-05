import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "../lib/utils.js"

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] active:shadow-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[busy]:pointer-events-none dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-[var(--dur-fast)] [&_svg]:ease-[var(--ease-out)] [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        // The wash alone is illegible here (--color-accent is --panel-2, a
        // ~2% luminance step against bg-background), so the border steps up
        // too — a neutral ink-mix, not primary: a hue change on hover reads
        // as meaning, and green is reserved for interactive identity at
        // rest, not hover feedback. (--line-raised is no step in light mode,
        // where it equals --line.) Border colour is paint, so it cannot
        // reflow — the hover rule allows it.
        outline:
          "border bg-background shadow-xs hover:border-[color-mix(in_srgb,var(--line),var(--text)_22%)] hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // has-[svg] (descendant, not >) so the busy label wrap below keeps
        // icon-button padding identical while busy
        default: "h-9 px-4 py-2 has-[svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  busy = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** in-flight: label dims to 60%, a mono 2-dot pulse rides the right
        padding — no layout shift, replaces ad-hoc "…" label swaps */
    busy?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  const showBusy = busy && !asChild

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-busy={busy ? "" : undefined}
      aria-busy={busy || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {showBusy ? (
        <>
          {/* gap-[inherit] keeps icon/label spacing byte-identical to the
              unwrapped render, whatever the size variant's gap is */}
          <span
            data-slot="button-label"
            className="inline-flex items-center justify-center gap-[inherit] opacity-60"
          >
            {children}
          </span>
          <span
            data-slot="busy-dots"
            aria-hidden="true"
            className="thinking stat pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-[10px] leading-none"
          >
            {/* U+2026 …, NOT U+2025 ‥. The shipped JetBrains Mono subset is the
                Google-Fonts `latin` range — 663 codepoints — and U+2025 is not
                in it while U+2026 is. Since this span is `stat` (mono context),
                the two-dot leader was being drawn by whatever font the OS fell
                back to, on the busy indicator of every in-flight button. */}
            &#8230;
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
