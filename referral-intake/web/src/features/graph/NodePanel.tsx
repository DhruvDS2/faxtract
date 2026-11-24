import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { GraphNode, GraphStructure } from "@/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Code } from "@/components/Code";
import { KeyValue } from "@/components/PageHeader";
import { fmtDateTime, fmtMs, fmtUsd } from "@/lib/format";
import { traceTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { StateDiff } from "./StateDiff";
import { NODE_STATE, TRACE_LABEL, type Execution, type GraphRun } from "./trace";

const fmtTokens = (n: number) => n.toLocaleString("en-US");

function ExecutionRow({ ex, defaultOpen, multipleRuns }: { ex: Execution; defaultOpen: boolean; multipleRuns: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const ev = ex.close;
  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 px-4 text-left hover:bg-surface-2"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-fg-faint transition-transform duration-150", open && "rotate-90")} />
        <span className="text-sm font-medium tabular-nums">Attempt {ex.attempt}</span>
        <Badge tone={traceTone(ex.status)}>{TRACE_LABEL[ex.status]}</Badge>
        {multipleRuns && <span className="text-xs text-fg-muted">run {ex.runIndex}</span>}
        <span className="ml-auto text-xs text-fg-muted tabular-nums">{ev ? fmtMs(ev.duration_ms) : "…"}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-fg-muted">Started</span>
            <span className="tabular-nums">{fmtDateTime((ex.open ?? ex.close)?.started_at)}</span>
            <span className="text-fg-muted">Run</span>
            <Code className="truncate text-xs" title={ex.runId}>{ex.runId}</Code>
            {ev?.branch && (
              <>
                <span className="text-fg-muted">Branch taken</span>
                <Code className="text-xs">{ev.branch}</Code>
              </>
            )}
            {ev && (ev.cost_usd > 0 || ev.tokens_in > 0) && (
              <>
                <span className="text-fg-muted">Cost · tokens</span>
                <span className="tabular-nums">
                  {fmtUsd(ev.cost_usd)} · {fmtTokens(ev.tokens_in)} in / {fmtTokens(ev.tokens_out)} out
                </span>
              </>
            )}
          </div>
          {ev?.error && (
            <div className="rounded-md border border-bad-border bg-bad-bg px-2 py-1.5 text-xs text-bad" role="alert">
              {ev.error}
            </div>
          )}
          {ev ? (
            <div>
              <div className="mb-1.5 text-xs font-medium text-fg-muted">State diff</div>
              <StateDiff stateIn={ev.state_in} delta={ev.delta} />
            </div>
          ) : (
            <div className="text-xs text-fg-muted">Still running: the state diff arrives when the node finishes.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function NodePanel({
  nodeId,
  structure,
  run,
  onClose,
}: {
  nodeId: string;
  structure: GraphStructure;
  run: GraphRun | null;
  onClose: () => void;
}) {
  const node: GraphNode | undefined = structure.nodes.find((n) => n.id === nodeId);
  const execs = run?.byNode.get(nodeId) ?? [];
  const state = run?.states.get(nodeId) ?? "idle";
  const closed = execs.filter((e) => e.close);
  const latest = closed.at(-1)?.close ?? null;
  const cost = closed.reduce((s, e) => s + (e.close?.cost_usd ?? 0), 0);
  const tin = closed.reduce((s, e) => s + (e.close?.tokens_in ?? 0), 0);
  const tout = closed.reduce((s, e) => s + (e.close?.tokens_out ?? 0), 0);
  const totalMs = closed.reduce((s, e) => s + (e.close?.duration_ms ?? 0), 0);
  const runs = new Set(execs.map((e) => e.runId)).size;
  const retries = Math.max(0, ...execs.map((e) => e.attempt - 1));
  const lastError = [...closed].reverse().find((e) => e.close?.error)?.close?.error ?? null;
  const outs = structure.edges.filter((e) => e.source === nodeId);
  const meta = NODE_STATE[state];

  return (
    <aside data-testid="node-panel" className="flex h-full w-md shrink-0 flex-col border-l border-border bg-bg" aria-label={`Node ${nodeId}`}>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{node?.label ?? nodeId}</div>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
        <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={onClose} aria-label="Close node panel">
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          <KeyValue label="Node">
            <Code>{nodeId}</Code>
            {node?.interrupts && <span className="ml-2 text-xs text-fg-muted">can pause for a human</span>}
          </KeyValue>
          <KeyValue label="Duration">
            <span className="tabular-nums">
              {latest ? fmtMs(latest.duration_ms) : "-"}
              {closed.length > 1 && <span className="text-fg-muted"> latest · {fmtMs(totalMs)} total</span>}
            </span>
          </KeyValue>
          <KeyValue label="Cost">
            <span className="tabular-nums">{closed.length ? fmtUsd(cost) : "-"}</span>
          </KeyValue>
          <KeyValue label="Tokens">
            <span className="tabular-nums">{closed.length ? `${fmtTokens(tin)} in / ${fmtTokens(tout)} out` : "-"}</span>
          </KeyValue>
          <KeyValue label="Executions">
            <span className="tabular-nums">
              {execs.length === 0 ? "none" : `${execs.length} across ${runs} run${runs === 1 ? "" : "s"}`}
              {retries > 0 && (
                <span className="text-fg-muted">
                  {" "}
                  · {retries} retr{retries === 1 ? "y" : "ies"}
                </span>
              )}
            </span>
          </KeyValue>
          <KeyValue label="Branch taken">{latest?.branch ? <Code>{latest.branch}</Code> : <span className="text-fg-faint">-</span>}</KeyValue>
          {lastError && (
            <KeyValue label="Error">
              <span className="text-bad">{lastError}</span>
            </KeyValue>
          )}
          {outs.length > 0 && (
            <KeyValue label="Routes to">
              <span className="flex flex-wrap gap-1">
                {outs.map((e) => (
                  <Code
                    key={`${e.target}-${e.label}`}
                    className={cn(
                      "rounded-md border px-1",
                      run?.taken.has(`${e.source}->${e.target}`) ? "border-accent-border text-accent" : "border-border text-fg-muted",
                    )}
                  >
                    {e.label ? `${e.label} → ${e.target}` : e.target}
                  </Code>
                ))}
              </span>
            </KeyValue>
          )}
        </div>
        <div className="border-t border-border px-4 pt-3 pb-2 text-sm font-semibold">
          Attempts and retries <span className="font-normal text-fg-muted tabular-nums">{execs.length}</span>
        </div>
        {execs.length === 0 ? (
          <div className="px-4 pb-4 text-xs text-fg-muted">
            {run ? "This node did not run for this referral." : "Pick a referral to see what this node did."}
          </div>
        ) : (
          execs.map((ex, i) => <ExecutionRow key={ex.key} ex={ex} defaultOpen={i === execs.length - 1} multipleRuns={(run?.runCount ?? 1) > 1} />)
        )}
      </div>
    </aside>
  );
}
