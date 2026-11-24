import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-border-strong bg-bg px-2.5 text-sm text-fg placeholder:text-fg-faint",
        "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint aria-[invalid=true]:border-bad",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
