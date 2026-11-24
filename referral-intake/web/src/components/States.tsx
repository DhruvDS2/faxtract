import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Align = "center" | "start";

/** Nothing here yet: one sentence of what this is, one of what to do next. No icon. */
export function EmptyState({
  title,
  hint,
  action,
  align = "center",
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 py-16",
        align === "center" ? "items-center px-6 text-center" : "items-start px-6",
        className,
      )}
    >
      <div className="text-body font-medium text-fg">{title}</div>
      {hint && <div className="max-w-md text-body text-fg-muted">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Plain-language cause for an API failure, plus the technical detail for engineers. */
export function describeError(error: unknown): { cause: string; detail: string | null } {
  if (error instanceof ApiError) {
    const detail = `HTTP ${error.status} · ${error.message}`;
    if (error.status >= 500) return { cause: "The API isn't responding.", detail };
    if (error.status === 404) return { cause: "It isn't there any more.", detail };
    if (error.status === 409) return { cause: "Someone else changed it first. Reload to see the latest.", detail };
    if (error.status === 422) return { cause: "The server didn't accept that value.", detail };
    return { cause: "The API refused the request.", detail };
  }
  if (error instanceof TypeError) return { cause: "Can't reach the API. Check that it's running.", detail: error.message };
  return { cause: "Something went wrong.", detail: error instanceof Error ? error.message : error == null ? null : String(error) };
}

/**
 * A failed load: what didn't load (title), why in plain words, the technical
 * detail in faint mono, and Retry. No icon circle.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  align = "center",
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  /** "Couldn't load referrals". Defaults to the plain-language cause. */
  title?: React.ReactNode;
  align?: Align;
  className?: string;
}) {
  const { cause, detail } = describeError(error);
  return (
    <div
      role="alert"
      className={cn("flex flex-col gap-1 py-16", align === "center" ? "items-center px-6 text-center" : "items-start px-6", className)}
    >
      <div className="text-body font-medium text-fg">{title ?? cause}</div>
      {title && <div className="max-w-md text-body text-fg-muted">{cause}</div>}
      {detail && <div className="max-w-md font-mono text-code break-words text-fg-faint">{detail}</div>}
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

const WIDTHS = ["w-40", "w-16", "w-28", "w-20"];

/** Skeleton rows (40px) that appear top to bottom once, then breathe while waiting. */
export function LoadingRows({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex h-10 animate-row-in items-center gap-6 border-b border-border px-6"
          style={{ "--i": i } as React.CSSProperties}
        >
          {WIDTHS.map((w, j) => (
            <Skeleton key={j} className={cn("h-2.5", w, j === WIDTHS.length - 1 && "ml-auto")} />
          ))}
        </div>
      ))}
    </div>
  );
}
