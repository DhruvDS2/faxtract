import { cn } from "@/lib/utils";

export type PageHeaderProps = {
  /** The display line. Prefer a sentence that says what matters: "31 referrals need review". */
  title: React.ReactNode;
  /** One meta line under the title (counts, provenance), 13px muted. */
  meta?: React.ReactNode;
  /** A StatusLine (or other one-line status) between title and meta. */
  status?: React.ReactNode;
  /** Right-aligned actions; at most one primary. */
  actions?: React.ReactNode;
  /** Something above the title, e.g. a "← Queue" back link. */
  eyebrow?: React.ReactNode;
  /** Hairline under the header (default true). */
  divider?: boolean;
  className?: string;
};

/** Page header: the page's one display line, a meta line, an actions slot. */
export function PageHeader({ title, meta, status, actions, eyebrow, divider = true, className }: PageHeaderProps) {
  return (
    <header className={cn("flex shrink-0 items-start gap-4 px-6 pt-5 pb-4", divider && "border-b border-border", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {eyebrow && <div className="text-meta text-fg-muted">{eyebrow}</div>}
        <h1 className="truncate text-display text-fg">{title}</h1>
        {status}
        {meta && <div className="text-body text-fg-muted tabular-nums">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-0.5">{actions}</div>}
    </header>
  );
}

/** A label / value row (label column is --kv-label wide). */
export function KeyValue({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[var(--kv-label)_minmax(0,1fr)] items-baseline gap-4 py-1", className)}>
      <div className="text-meta text-fg-muted">{label}</div>
      <div className="min-w-0 text-body">{children}</div>
    </div>
  );
}
