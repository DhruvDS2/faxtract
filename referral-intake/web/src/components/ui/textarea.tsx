import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-16 w-full rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-faint",
        "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 aria-[invalid=true]:border-bad",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
