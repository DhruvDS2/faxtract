import { ApiError } from "@/api/client";
import { Code } from "@/components/Code";
import { EmptyState, ErrorState, LoadingRows } from "@/components/States";
import { cn } from "@/lib/utils";

/** A page section: title row, then content. Sections are separated by a 1 px rule, not boxes. */
export function Section({
  title,
  meta,
  testId,
  children,
  className,
}: {
  title: string;
  meta?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section data-testid={testId} className={cn("px-4 py-4", className)} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {meta && <div className="text-xs text-fg-muted">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

/** Loading / 404 / error for an artifact query. Returns null once there is data. */
export function ArtifactState({
  query,
  missingTitle,
  missingHint,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  missingTitle: string;
  missingHint: React.ReactNode;
}) {
  if (query.isPending) return <LoadingRows rows={5} />;
  if (query.isError) {
    if (isNotFound(query.error))
      return <EmptyState title={missingTitle} action={<div className="max-w-md text-xs text-fg-muted">{missingHint}</div>} />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return null;
}

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

/** Render an arbitrary JSON value from an artifact: scalars as text, the rest as compact JSON. */
export function Value({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-fg-faint">-</span>;
  if (typeof v === "number") return <span className="tabular-nums">{v}</span>;
  if (typeof v === "string") return <span>{v}</span>;
  if (typeof v === "boolean") return <span>{v ? "yes" : "no"}</span>;
  return <Code className="break-all">{JSON.stringify(v)}</Code>;
}

export const pct = (x: number | null | undefined, digits = 1) => (x == null ? "-" : `${(x * 100).toFixed(digits)}%`);
