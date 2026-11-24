import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "./input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(controlClass, "min-h-16 px-2.5 py-1.5", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";
