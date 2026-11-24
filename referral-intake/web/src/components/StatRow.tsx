import { cn } from "@/lib/utils";

export type Stat = {
  id: string;
  /** The number (wrap in <CountThrough> for the one-time count). */
  value: React.ReactNode;
  /** What it counts, under the number: "right policy, with CPT". */
  label: React.ReactNode;
  /** An optional comparison line: "v1: 57/60". */
  comparison?: React.ReactNode;
};

/**
 * Headline stats on hairline rules (Stripe): number, label under it, an optional
 * comparison line. Never a bare number: every stat has its label.
 */
export function StatRow({ stats, className, ...rest }: { stats: Stat[]; className?: string } & React.HTMLAttributes<HTMLDListElement>) {
  return (
    <dl
      className={cn("grid border-y border-border", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, stats.length)}, minmax(0, 1fr))` }}
      {...rest}
    >
      {stats.map((s) => (
        <div key={s.id} className="flex min-w-0 flex-col border-l border-border px-6 py-4 first:border-l-0" data-stat={s.id}>
          <dt className="order-2 mt-1 text-body text-fg-muted">{s.label}</dt>
          <dd className="order-1 text-display text-fg tabular-nums">{s.value}</dd>
          {s.comparison && <dd className="order-3 mt-1 text-meta text-fg-faint tabular-nums">{s.comparison}</dd>}
        </div>
      ))}
    </dl>
  );
}
