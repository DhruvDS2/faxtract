import * as React from "react";
import { cn } from "@/lib/utils";

/** Form controls share one look: a 3:1 `control` edge, accent focus, red when aria-invalid. */
export const controlClass = cn(
  "w-full rounded-md border border-control bg-bg text-body text-fg placeholder:text-fg-faint",
  "transition-[border-color,box-shadow] duration-fast ease-enter",
  "hover:border-fg-faint focus-visible:border-focus focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus",
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface disabled:text-fg-faint",
  "aria-[invalid=true]:border-bad aria-[invalid=true]:focus-visible:ring-bad",
  "read-only:bg-surface",
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(controlClass, "h-8 px-2.5", className)} {...props} />,
);
Input.displayName = "Input";
