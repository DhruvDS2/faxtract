import { m, transition, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type BarSeries = { key: string; label: React.ReactNode };
export type BarRow = {
  id: string;
  label: React.ReactNode;
  values: Record<string, number | null | undefined>;
  /** Text shown for each value; defaults to `format(value)`. */
  display?: Record<string, React.ReactNode>;
  /** Scale for this row (default: the row's largest value). */
  max?: number;
};

const SHADE = ["bg-chart-1", "bg-chart-2"];

/**
 * v1 vs v2 labelled bars (Effortel): label left, one column per series with a bar
 * and its value. Two neutral shades, never good/bad colour. Bars grow once (600 ms)
 * when first in view; under reduced motion they fade in.
 */
export function BarComparison({
  series,
  rows,
  format = (v) => String(v),
  caption,
  className,
}: {
  series: BarSeries[];
  rows: BarRow[];
  format?: (v: number) => string;
  /** Accessible caption (visually hidden). */
  caption?: string;
  className?: string;
}) {
  const { reduce } = useMotionPrefs();
  const grow = reduce
    ? { initial: { opacity: 0 }, whileInView: { opacity: 1, transition: transition.reveal } }
    : { initial: { scaleX: 0 }, whileInView: { scaleX: 1, transition: transition.reveal } };

  return (
    <table className={cn("w-full table-fixed border-separate border-spacing-0 text-body", className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      <colgroup>
        <col className="w-2/5" />
        {series.map((s) => (
          <col key={s.key} />
        ))}
      </colgroup>
      <thead>
        <tr className="h-8 text-meta text-fg-muted">
          <th className="text-left font-normal">
            <span className="sr-only">Measure</span>
          </th>
          {series.map((s, i) => (
            <th key={s.key} scope="col" className="pl-4 text-left font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-xs", SHADE[i % SHADE.length])} />
                {s.label}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const vals = series.map((s) => r.values[s.key] ?? null);
          const max = r.max ?? Math.max(0, ...vals.map((v) => v ?? 0));
          return (
            <tr key={r.id} className="h-10" data-row={r.id}>
              <th scope="row" className="truncate pr-4 text-left font-normal text-fg">
                {r.label}
              </th>
              {series.map((s, i) => {
                const v = r.values[s.key];
                const pct = v == null || max <= 0 ? 0 : Math.max(0, Math.min(1, v / max)) * 100;
                return (
                  <td key={s.key} className="pl-4">
                    <div className="flex items-center gap-2" title={`${typeof s.label === "string" ? s.label : s.key}: ${v == null ? "no data" : format(v)}`}>
                      <div className="relative h-2 min-w-0 flex-1">
                        {v != null && (
                          <m.div
                            className={cn("absolute inset-y-0 left-0 origin-left rounded-r-sm", SHADE[i % SHADE.length])}
                            style={{ width: `${pct}%` }}
                            viewport={{ once: true, amount: 0.6 }}
                            {...grow}
                          />
                        )}
                      </div>
                      <span className="w-14 shrink-0 text-right text-fg tabular-nums">{r.display?.[s.key] ?? (v == null ? "-" : format(v))}</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
