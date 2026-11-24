import type { ReferralRecord, TraceEvent } from "@/contracts";
import { Code } from "@/components/Code";
import { EmptyState } from "@/components/States";
import { fmtMs } from "@/lib/format";
import { stepLabel } from "./labels";

/**
 * A v1-baseline referral has no graph: its stages, in order, with how long each
 * took (from its trace events, or the record's stage timings when there are none).
 */
export function V1Stages({ record, events, tech }: { record: ReferralRecord; events: TraceEvent[] | undefined; tech: boolean }) {
  const fromTrace = (events ?? [])
    .filter((e) => e.status !== "running")
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({ id: e.node, ms: e.duration_ms, error: e.error }));
  const stages = fromTrace.length
    ? fromTrace
    : Object.entries(record.stage_timings_ms).map(([id, ms]) => ({ id, ms, error: null as string | null }));
  if (!stages.length) return <EmptyState title="No stages were recorded for this referral." />;
  const max = Math.max(...stages.map((s) => s.ms), 1);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-6">
      <h2 className="text-body font-medium text-fg">v1 stages, in order</h2>
      <ol className="mt-2" data-testid="v1-stages">
        {stages.map((s, i) => (
          <li key={`${s.id}-${i}`} className="grid h-10 grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_5rem] items-center gap-3 border-b border-border">
            <span className="text-meta text-fg-faint tabular-nums">{i + 1}</span>
            <span className="min-w-0 truncate text-body text-fg">
              {stepLabel(s.id)}
              {tech && <Code className="ml-2 text-fg-faint">{s.id}</Code>}
              {s.error && <span className="ml-2 text-bad">{s.error}</span>}
            </span>
            <span className="h-1.5 rounded-full bg-chart-track" aria-hidden>
              <span className="block h-full rounded-full bg-chart-2" style={{ width: `${(s.ms / max) * 100}%` }} />
            </span>
            <span className="text-right text-meta text-fg-muted tabular-nums">{s.ms > 0 ? fmtMs(s.ms) : "not timed"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
