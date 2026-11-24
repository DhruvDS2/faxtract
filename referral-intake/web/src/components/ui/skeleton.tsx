import { cn } from "@/lib/utils";

/** A placeholder bar. It breathes (opacity only) while the data is on its way. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-breathe rounded-sm bg-surface-2", className)} {...props} />;
}
