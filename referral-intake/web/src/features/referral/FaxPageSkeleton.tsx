import type { CSSProperties } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A page-shaped placeholder: a white sheet with skeleton lines, so the fax
 * pane never sits empty (a bare Skeleton is surface-2 on the surface-2 pane). */
export function FaxPageSkeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      className={cn("mx-auto flex aspect-[8.5/11] w-full max-w-2xl flex-col gap-3 bg-bg p-8 shadow-float", className)}
      style={style}
    >
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-2 w-1/4" />
      <div className="h-4" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="flex gap-6">
          <Skeleton className="h-2 w-1/5" />
          <Skeleton className="h-2 w-2/5" />
        </div>
      ))}
    </div>
  );
}
