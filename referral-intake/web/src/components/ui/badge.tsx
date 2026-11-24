import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * A neutral label (a count, a code, "Synthetic data"). Badges never fill with
 * colour: a status tone shows as a small dot before neutral text, and `accent`
 * renders neutral too (teal is for actions only).
 */
const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1.5 rounded-sm border border-border bg-bg px-1.5 text-meta font-medium whitespace-nowrap text-fg-muted",
  {
    variants: {
      tone: {
        ok: "before:size-1.5 before:shrink-0 before:rounded-full before:bg-ok",
        warn: "before:size-1.5 before:shrink-0 before:rounded-full before:bg-warn",
        bad: "before:size-1.5 before:shrink-0 before:rounded-full before:bg-bad",
        idle: "before:size-1.5 before:shrink-0 before:rounded-full before:border before:border-idle",
        accent: "",
        outline: "",
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
