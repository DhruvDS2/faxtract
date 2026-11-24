import { AlertTriangle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/api/client";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Inbox className="size-5 text-fg-faint" />
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="max-w-sm text-xs text-fg-muted">{hint}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center" role="alert">
      <AlertTriangle className="size-5 text-bad" />
      <div className="text-sm font-medium">{status ? `Request failed (${status})` : "Something went wrong"}</div>
      <div className="max-w-md text-xs text-fg-muted">{message}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function LoadingRows({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={className} aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-8 items-center gap-3 border-b border-border px-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
