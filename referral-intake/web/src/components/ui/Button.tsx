import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "plain" | "quiet";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:opacity-85",
  plain: "text-fg border border-border hover:bg-subtle",
  quiet: "text-muted hover:text-fg",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children?: ReactNode }
>(function Button({ variant = "plain", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3",
        "text-[13px] font-medium whitespace-nowrap transition-all duration-100",
        "disabled:pointer-events-none disabled:opacity-35",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Bare glyph button. No border, no fill until hover. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children?: ReactNode }
>(function IconButton({ className, children, label, ...rest }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted",
        "transition-colors duration-100 hover:bg-subtle hover:text-fg",
        "disabled:pointer-events-none disabled:opacity-25",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
