import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Buttons. Teal (`primary`, `quiet`) means "act on this": one primary per view, and
 * `quiet` for the single row quick action ("Review", "Retry send"). Everything
 * else is neutral.
 */
const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none",
    "transition-[background-color,border-color,color,opacity] duration-fast ease-enter",
    "disabled:cursor-not-allowed disabled:opacity-45 aria-busy:cursor-progress",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-hover",
        secondary: "border border-border-strong bg-bg text-fg hover:border-control hover:bg-surface active:bg-surface-2",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg active:bg-selected",
        danger: "border border-border-strong bg-bg text-bad hover:border-bad-border hover:bg-bad-bg active:bg-bad-bg",
        quiet: "border border-border bg-bg text-accent hover:border-accent-border hover:bg-accent-subtle active:bg-accent-subtle",
      },
      size: { sm: "h-7 px-2.5 text-meta", md: "h-8 px-3 text-body", icon: "size-8" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Busy: disabled, aria-busy, and the label breathes. `loadingText` replaces the label. */
  loading?: boolean;
  loadingText?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingText, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {loading && !asChild ? (
          <span className="inline-flex animate-breathe items-center gap-1.5">{loadingText ?? children}</span>
        ) : (
          <Slottable>{children}</Slottable>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
export { buttonVariants };
