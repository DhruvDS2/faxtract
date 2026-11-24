import { memo, useEffect, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Check, CircleAlert, Pause } from "lucide-react";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useGraphInteraction } from "./context";
import { revealDelay } from "./reveal";
import type { NodeState } from "./trace";

/** Node sizes in React Flow's flow units (it positions nodes numerically). */
export const STEP_W = 124;
export const STEP_H = 88; // 8 + two label lines (40) + result (16) + footer (16) + 8
export const STEP_H_TECH = 106; // + one line of mono (18)
export const STEP_H_BARE = 56; // no referral: the label only
export const TERMINAL_SIZE = 12;

export type StepNodeData = {
  id: string;
  label: string;
  state: NodeState;
  /** No result to show: no referral picked, or its trace hasn't arrived yet. */
  bare: boolean;
  /** The referral's trace is still loading: drawn unlit until the reveal. */
  awaiting: boolean;
  /** One line from the trace: "Member not found", "ACK AA". */
  result: string | null;
  resultTone?: "bad" | "warn";
  /** Latest finished attempt, in ms. */
  durationMs: number | null;
  /** How many times the step ran (attempts, passes). */
  runs: number;
  /** When the running attempt started (for the elapsed time). */
  startedAt: string | null;
  tech: boolean;
  /** Plain-language one-liner for the accessible name. */
  stateLabel: string;
};
export type StepFlowNode = Node<StepNodeData, "step">;

export type TerminalNodeData = {
  id: string;
  kind: "start" | "end";
  label: string;
  state: NodeState;
  /** The path taken reaches this mark (not just an end stub elsewhere). */
  reached: boolean;
  awaiting: boolean;
  tech: boolean;
};
export type TerminalFlowNode = Node<TerminalNodeData, "terminal">;

/** Ticks once a second while mounted (a clock for the running step, not an animation). */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

const CARD: Record<NodeState, string> = {
  done: "border-border-strong bg-bg",
  running: "border-border-strong bg-bg",
  paused: "border-warn-border bg-warn-bg",
  error: "border-bad-border bg-bg",
  skipped: "border-dashed border-border-strong bg-bg",
  idle: "border-dashed border-border-strong bg-bg",
};

function Footer({ data, now }: { data: StepNodeData; now: number }) {
  const { state, durationMs, runs, startedAt } = data;
  const times = runs > 1 ? <span aria-label={`ran ${runs} times`}>· ×{runs}</span> : null;
  if (state === "done")
    return (
      <>
        <Check className="size-3 shrink-0 text-fg-muted" aria-hidden />
        <span>{fmtMs(durationMs)}</span>
        {times}
      </>
    );
  if (state === "running") {
    const ms = startedAt ? Math.max(0, now - new Date(startedAt).getTime()) : null;
    return (
      <span className="text-fg-muted">
        Running{ms != null && ms >= 1000 ? ` · ${Math.floor(ms / 1000)} s` : ""}
      </span>
    );
  }
  if (state === "paused")
    return (
      <>
        <Pause className="size-3 shrink-0 text-warn" aria-hidden />
        <span className="font-medium text-warn">Paused</span>
        {times}
      </>
    );
  if (state === "error")
    return (
      <>
        <CircleAlert className="size-3 shrink-0 text-bad" aria-hidden />
        <span className="font-medium text-bad">Failed</span>
        {durationMs != null && <span>· {fmtMs(durationMs)}</span>}
      </>
    );
  if (state === "skipped") return <span>Not reached</span>;
  return <span>Not run yet</span>;
}

function StepNodeView({ data }: NodeProps<StepFlowNode>) {
  const { selected, hovered, select, hover, reveal } = useGraphInteraction();
  const now = useNow(data.state === "running");
  const isSelected = selected === data.id;
  const isHovered = hovered === data.id;
  const quiet = data.state === "skipped" || (data.state === "idle" && !data.bare);
  const unlit = data.awaiting || (reveal.pending && reveal.order.has(data.id));
  const delay = revealDelay(reveal, reveal.order.get(data.id));
  const open = () => select(isSelected ? null : data.id);

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="graph-node"
      data-node={data.id}
      data-state={data.state}
      aria-pressed={isSelected}
      aria-label={`${data.label}: ${data.stateLabel}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onMouseEnter={() => hover(data.id)}
      onMouseLeave={() => hover(null)}
      onFocus={() => hover(data.id)}
      onBlur={() => hover(null)}
      className={cn(
        "group relative flex size-full cursor-pointer flex-col rounded-md border px-2 py-2 text-left select-none",
        "transition-[border-color,background-color,opacity] duration-state ease-enter",
        CARD[data.state],
        data.bare && !data.awaiting && "border-solid",
        isHovered && data.state !== "paused" && data.state !== "error" && "border-control bg-surface-2",
        // Selection is a neutral fill; a paused step keeps its amber and darkens its edge instead.
        isSelected && (data.state === "paused" ? "border-warn" : data.state === "error" ? "border-bad bg-selected" : "border-control bg-selected"),
        unlit && "opacity-40",
      )}
      style={{ transitionDelay: `${delay}s` }}
    >
      {data.state === "running" && (
        <span aria-hidden className="pointer-events-none absolute -inset-px animate-breathe rounded-md border-2 border-accent" />
      )}
      <div className={cn("line-clamp-2 min-h-10 text-body font-medium", quiet ? "font-normal text-fg-faint" : "text-fg")}>
        {data.label}
      </div>
      {!data.bare && (
        <>
          <div
            className={cn(
              "mt-auto h-4 truncate text-meta",
              data.resultTone === "bad" ? "text-bad" : quiet ? "text-fg-faint" : "text-fg-muted",
            )}
            title={data.result ?? undefined}
          >
            {data.result}
          </div>
          <div className="flex h-4 min-w-0 items-center gap-1 text-meta whitespace-nowrap text-fg-faint tabular-nums">
            <Footer data={data} now={now} />
          </div>
        </>
      )}
      {data.tech && <code className="mt-0.5 truncate font-mono text-code text-fg-faint">{data.id}</code>}
    </div>
  );
}

function TerminalNodeView({ data }: NodeProps<TerminalFlowNode>) {
  const { reveal } = useGraphInteraction();
  const reached = data.reached;
  const unlit = data.awaiting || (reveal.pending && reveal.order.has(data.id));
  return (
    <div
      data-testid="graph-node"
      data-node={data.id}
      data-state={data.state}
      aria-label={`${data.label}${reached ? ", reached" : ""}`}
      role="img"
      className={cn(
        "relative size-full rounded-full border transition-[background-color,border-color,opacity] duration-state ease-enter",
        reached ? "border-fg-muted bg-fg-muted" : "border-control bg-bg",
        data.kind === "start" && "bg-bg",
        unlit && "opacity-40",
      )}
      style={{ transitionDelay: `${revealDelay(reveal, reveal.order.get(data.id))}s` }}
    >
      <span className="absolute top-full left-1/2 mt-1 -translate-x-1/2 text-meta whitespace-nowrap text-fg-faint">
        {data.tech ? <code className="font-mono text-code">{data.id}</code> : data.label}
      </span>
    </div>
  );
}

export const StepNode = memo(StepNodeView);
export const TerminalNode = memo(TerminalNodeView);
