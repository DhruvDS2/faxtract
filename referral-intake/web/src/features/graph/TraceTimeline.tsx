import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Code } from "@/components/Code";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useGraphInteraction } from "./context";
import { stepLabel } from "./labels";
import { elapsedMs, TRACE_LABEL, type Execution } from "./trace";

type Bar = { ex: Execution; start: number; ms: number; running: boolean };
type Row = { runId: string; index: number; startedAt: number; bars: Bar[]; firstNode: string };

/** 1, 2 or 5 × 10^k: a tick step that gives about `target` ticks over `span`. */
function niceStep(span: number, target = 6) {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}
/** Tick text: "0", "200 ms", "1.5 s". */
const tick = (t: number, step: number) =>
  t === 0 ? "0" : step >= 1000 ? `${+(t / 1000).toFixed(2)} s` : `${+t.toFixed(step < 1 ? 2 : 0)} ms`;
const clock = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour12: false });
/** Narrowest bar drawn, in px (a step of a few µs still gets a visible mark). */
const MIN_BAR = 3;
/** Inter 12 at about 6.3 px a character, plus the bar's padding. */
const fits = (text: string, px: number) => px >= text.length * 6.3 + 12;

/**
 * The trace on a time axis (Ario's axis-with-ticks layout): one row per run
 * (each `start` or `resume` of the graph), each row measured from its own start
 * on one shared axis, bars as long as each step took. Hovering a bar lights its
 * step on the map, and hovering a step lights its bars; clicking opens the step.
 */
export function TraceTimeline({
  executions,
  live,
  tech,
}: {
  executions: Execution[];
  live: boolean;
  tech: boolean;
}) {
  const { hovered, hover, select, selected } = useGraphInteraction();
  const anyRunning = executions.some((e) => e.status === "running");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyRunning]);

  const rows = useMemo<Row[]>(() => {
    const byRun = new Map<string, Execution[]>();
    for (const ex of executions) byRun.set(ex.runId, [...(byRun.get(ex.runId) ?? []), ex]);
    return [...byRun.entries()].map(([runId, list]) => {
      const startOf = (ex: Execution) => new Date((ex.open ?? ex.close)!.started_at).getTime();
      const t0 = Math.min(...list.map(startOf));
      return {
        runId,
        index: list[0].runIndex,
        startedAt: t0,
        firstNode: list[0].node,
        bars: list.map((ex) => {
          const running = ex.status === "running";
          return { ex, start: startOf(ex) - t0, ms: running ? elapsedMs(ex, now) : (ex.close?.duration_ms ?? 0), running };
        }),
      };
    });
  }, [executions, now]);

  const span = Math.max(1, ...rows.flatMap((r) => r.bars.map((b) => b.start + b.ms)));
  const step = niceStep(span);
  const ticks: number[] = [];
  for (let t = 0; t <= span + step * 0.001; t += step) ticks.push(t);
  const axisMax = Math.max(span, ticks.at(-1)!);
  const total = executions.reduce((s, e) => s + (e.close?.duration_ms ?? 0), 0);

  // Bar labels need the track's width in pixels.
  const track = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(0);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth));
    ro.observe(el);
    setTrackW(el.clientWidth);
    return () => ro.disconnect();
  }, [rows.length]);

  const pct = (v: number) => `${(v / axisMax) * 100}%`;
  // Bars in pixels: true to scale, except that each is at least MIN_BAR wide and starts
  // after the one before it, so steps of a few microseconds don't pile onto one pixel.
  const placed = useMemo(
    () =>
      rows.map((r) => {
        let edge = -Infinity;
        return r.bars.map((b) => {
          const w = Math.max((b.ms / axisMax) * trackW, b.ex.status === "interrupted" ? MIN_BAR + 1 : MIN_BAR);
          const x = Math.min(Math.max((b.start / axisMax) * trackW, edge + 1), Math.max(0, trackW - w));
          edge = x + w;
          return { x, w };
        });
      }),
    [rows, axisMax, trackW],
  );

  return (
    <section aria-label="Trace timeline" data-testid="graph-timeline" className="shrink-0 border-t border-border px-6 pt-3 pb-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-body font-medium text-fg">Trace</h2>
        <span className="text-meta text-fg-faint tabular-nums">
          {rows.length} run{rows.length === 1 ? "" : "s"}
          {total > 0 && ` · ${fmtMs(total)} in steps`}
          {live && " · updating live"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-body text-fg-faint">{live ? "Waiting for the first step to start." : "No steps have run for this referral."}</p>
      ) : (
        <div className="mt-2 grid grid-cols-[var(--kv-label)_minmax(0,1fr)] gap-x-4">
          {/* axis */}
          <div />
          <div ref={track} className="relative h-5 border-b border-border" aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="absolute bottom-0 flex -translate-x-1/2 flex-col items-center" style={{ left: pct(t) }}>
                <span className="text-meta whitespace-nowrap text-fg-faint tabular-nums">{tick(t, step)}</span>
                <span className="h-1 w-px bg-border-strong" />
              </span>
            ))}
          </div>
          {rows.map((r, i) => (
            <RowView
              key={r.runId}
              row={r}
              boxes={placed[i]}
              tech={tech}
              hovered={hovered}
              selected={selected}
              hover={hover}
              select={select}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RowView({
  row,
  boxes,
  tech,
  hovered,
  selected,
  hover,
  select,
}: {
  row: Row;
  boxes: { x: number; w: number }[];
  tech: boolean;
  hovered: string | null;
  selected: string | null;
  hover: (id: string | null) => void;
  select: (id: string | null) => void;
}) {
  const from = row.index > 1 ? `from ${stepLabel(row.firstNode)}` : "from the fax";
  return (
    <>
      <div className="flex h-9 min-w-0 flex-col justify-center">
        <span className="text-body text-fg">
          Run {row.index} <span className="text-meta text-fg-faint tabular-nums">{clock(row.startedAt)}</span>
        </span>
        <span className="truncate text-meta text-fg-faint" title={`${from} · run ${row.runId}`}>
          {tech ? <Code className="text-fg-faint">{row.runId.slice(0, 8)}</Code> : from}
        </span>
      </div>
      <div className="relative h-9 border-b border-border" role="list" aria-label={`Run ${row.index}`}>
        {row.bars.map((b, i) => {
          const box = boxes[i];
          const label = stepLabel(b.ex.node);
          const t = TRACE_LABEL[b.ex.status];
          const lit = hovered === b.ex.node || selected === b.ex.node;
          const neutral = b.ex.status === "ok";
          return (
            <button
              key={b.ex.key}
              type="button"
              role="listitem"
              tabIndex={-1}
              data-node={b.ex.node}
              data-hovered={lit || undefined}
              aria-label={`${label}: ${t.label}, ${b.running ? "running" : fmtMs(b.ms)}`}
              title={`${label} · ${t.label} · ${b.running ? "running" : fmtMs(b.ms)}`}
              onMouseEnter={() => hover(b.ex.node)}
              onMouseLeave={() => hover(null)}
              onClick={() => select(b.ex.node)}
              className={cn(
                "absolute top-2 h-5 cursor-pointer overflow-hidden rounded-sm px-1 text-left text-meta whitespace-nowrap",
                "transition-[background-color,outline-color] duration-fast ease-enter",
                "outline-2 outline-offset-1 outline-transparent",
                neutral && (lit ? "bg-fg-faint text-bg" : "bg-border-strong text-fg"),
                b.ex.status === "error" && "bg-bad text-bg",
                b.ex.status === "interrupted" && "bg-warn text-bg",
                b.running && "animate-breathe bg-accent text-accent-fg",
                lit && !neutral && "outline-fg-muted",
              )}
              style={{ left: `${box?.x ?? 0}px`, width: `${box?.w ?? MIN_BAR}px` }}
            >
              {box && fits(label, box.w) ? label : ""}
            </button>
          );
        })}
      </div>
    </>
  );
}
