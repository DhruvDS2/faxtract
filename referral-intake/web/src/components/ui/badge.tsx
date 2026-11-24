import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        ok: "border-ok-border bg-ok-bg text-ok",
        warn: "border-warn-border bg-warn-bg text-warn",
        bad: "border-bad-border bg-bad-bg text-bad",
        idle: "border-idle-border bg-idle-bg text-idle",
        accent: "border-accent-border bg-accent-subtle text-accent",
        outline: "border-border bg-bg text-fg-muted",
      },
    },
    defaultVariants: { tone: "outline" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
export { badgeVariants };
