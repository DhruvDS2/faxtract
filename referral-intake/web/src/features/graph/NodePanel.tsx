import { forwardRef, useState } from "react";
import { X } from "lucide-react";
import type { GraphStructure } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Code } from "@/components/Code";
import { KeyValue } from "@/components/PageHeader";
import { StatusDot, StatusPill } from "@/components/StatusPill";
import { m, useMotionPrefs, useTransitionMarker } from "@/lib/motion";
import { fmtDateTime, fmtMs, fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { branchWords, stepDoes, stepLabel } from "./labels";
import { finding } from "./steps";
import { StateDiff } from "./StateDiff";
import { TechToggle } from "./TechToggle";
import { NODE_STATE, stepTotals, TRACE_LABEL, type Execution, type GraphRun } from "./trace";

const tokens = (n: number) => n.toLocaleString("en-US");
const time = (iso: string | undefined) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour12: false }) : "");

export type NodePanelProps = {
  nodeId: string;
  structure: GraphStructure;
  /** Null: no referral picked. */
  run: GraphRun | null;
  tech: boolean;
  onTech: (on: boolean) => void;
  onClose: () => void;
};

/**
 * One step, in plain words first: what it does, what it found, how long it took,
 * what it cost and every attempt. "Technical details" adds the node id, branch
 * labels, tokens and the input/output state diff. Slides in over 320 ms.
 */
export const NodePanel = forwardRef<HTMLElement, NodePanelProps>(function NodePanel(
  { nodeId, structure, run, tech, onTech, onClose },
  ref,
) {
  const { panelSlide } = useMotionPrefs();
  const marker = useTransitionMarker();
  const node = structure.nodes.find((n) => n.id === nodeId);
  const execs = run?.byNode.get(nodeId) ?? [];
  const state = run?.states.get(nodeId) ?? "idle";
  const totals = stepTotals(execs);
  const latest = execs.at(-1);
  const latestClosed = [...execs].reverse().find((e) => e.close);
  const f = latestClosed ? finding(latestClosed) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const diffOf = execs.find((e) => e.key === picked) ?? latestClosed ?? latest;
  const outs = structure.edges.filter((e) => e.source === nodeId);
  const label = stepLabel(nodeId);
  const does = stepDoes(nodeId);
  const multiRun = (run?.runCount ?? 0) > 1;

  return (
    <m.aside
      ref={ref}
      data-testid="node-panel"
      aria-label={`${label}: details`}
      variants={panelSlide("right")}
      initial="initial"
      animate="animate"
      exit="exit"
      {...marker}
      className="absolute inset-y-0 right-0 z-20 flex w-sm max-w-full flex-col border-l border-border bg-bg shadow-float"
    >
      <header className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-title text-fg">{label}</h2>
          {run && (
            <StatusPill tone={NODE_STATE[state].tone} running={state === "running"} detail={execs.length > 1 ? `· ${execs.length} attempts` : undefined}>
              {NODE_STATE[state].label}
            </StatusPill>
          )}
        </div>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-7" onClick={onClose} aria-label="Close step details">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {does && <p className="text-body text-fg-muted">{does}</p>}

        {!run ? (
          <p className="mt-4 text-body text-fg-faint">Pick a referral to see what this step did for it.</p>
        ) : execs.length === 0 ? (
          <p className="mt-4 text-body text-fg-faint">
            {state === "idle" ? "This step hasn't run yet." : "This referral didn't reach this step."}
          </p>
        ) : (
          <>
            <section className="mt-4 border-t border-border pt-3" aria-label="Result">
              <p className={cn("text-body", f?.tone === "bad" ? "text-bad" : "text-fg")}>
                {latest?.status === "running" ? "Running now." : (f?.sentence ?? "No result recorded.")}
              </p>
              {f && f.facts.length > 0 && (
                <div className="mt-2">
                  {f.facts.map(([k, v], i) => (
                    <KeyValue key={`${k}-${i}`} label={k}>
                      {v}
                    </KeyValue>
                  ))}
                </div>
              )}
            </section>

            <section className="mt-3 border-t border-border pt-2" aria-label="Time and cost">
              <KeyValue label="Duration">
                <span className="tabular-nums">
                  {latestClosed ? fmtMs(latestClosed.close!.duration_ms) : "-"}
                  {execs.filter((e) => e.close).length > 1 && <span className="text-fg-muted"> latest · {fmtMs(totals.ms)} in all</span>}
                </span>
              </KeyValue>
              <KeyValue label="Cost">
                <span className="tabular-nums">{totals.cost > 0 ? fmtUsd(totals.cost) : <span className="text-fg-muted">No model cost</span>}</span>
              </KeyValue>
              <KeyValue label="Attempts">
                <span className="tabular-nums">{execs.length}</span>
              </KeyValue>
            </section>

            <section className="mt-3 border-t border-border pt-3" aria-label="Attempts">
              <h3 className="text-meta font-medium text-fg-muted">Every attempt</h3>
              <ol className="mt-1">
                {execs.map((ex, i) => (
                  <AttemptRow
                    key={ex.key}
                    ex={ex}
                    n={i + 1}
                    multiRun={multiRun}
                    tech={tech}
                    active={tech && diffOf?.key === ex.key}
                    onPick={tech ? () => setPicked(ex.key) : undefined}
                  />
                ))}
              </ol>
            </section>
          </>
        )}

        <section className="mt-3 border-t border-border pt-2" aria-label="Technical details">
          <TechToggle on={tech} onChange={onTech} className="-ml-2" />
          {tech && (
            <div className="mt-1">
              <KeyValue label="Node id">
                <Code>{nodeId}</Code>
                {node?.interrupts && <span className="ml-2 text-meta text-fg-muted">can pause for a person</span>}
              </KeyValue>
              {latestClosed?.close?.branch && (
                <KeyValue label="Branch taken">
                  <Code>
                    {outs.find((o) => o.target === latestClosed.close!.branch)?.label ?? "always"} → {latestClosed.close.branch}
                  </Code>
                </KeyValue>
              )}
              {outs.length > 0 && (
                <KeyValue label="Routes out">
                  <span className="flex flex-col">
                    {outs.map((o) => (
                      <Code key={`${o.target}-${o.label}`} className={run?.taken.has(`${o.source}->${o.target}`) ? "text-fg" : "text-fg-faint"}>
                        {o.label ?? "always"} → {o.target}
                      </Code>
                    ))}
                  </span>
                </KeyValue>
              )}
              {execs.length > 0 && (
                <>
                  <KeyValue label="Tokens">
                    <span className="tabular-nums">
                      {tokens(totals.tokensIn)} in · {tokens(totals.tokensOut)} out
                    </span>
                  </KeyValue>
                  <KeyValue label="Cost (exact)">
                    <span className="tabular-nums">{fmtUsd(totals.cost, 6)}</span>
                  </KeyValue>
                  {diffOf && (
                    <div className="mt-3">
                      <h3 className="text-meta font-medium text-fg-muted">
                        State diff · attempt {execs.indexOf(diffOf) + 1}
                        {execs.length > 1 && <span className="font-normal text-fg-faint"> (pick an attempt above)</span>}
                      </h3>
                      <div className="mt-1">
                        <StateDiff stateIn={diffOf.close?.state_in ?? null} delta={diffOf.close?.delta ?? null} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </m.aside>
  );
});

function AttemptRow({
  ex,
  n,
  multiRun,
  tech,
  active,
  onPick,
}: {
  ex: Execution;
  n: number;
  multiRun: boolean;
  tech: boolean;
  active: boolean;
  onPick?: () => void;
}) {
  const t = TRACE_LABEL[ex.status];
  const f = ex.status === "running" ? null : finding(ex);
  const started = (ex.open ?? ex.close)?.started_at;
  const body = (
    <>
      <span className="w-4 shrink-0 text-meta text-fg-faint tabular-nums">{n}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2 text-body">
          <StatusDot tone={t.tone} running={ex.status === "running"} />
          <span className={cn("shrink-0", t.tone === "bad" ? "text-bad" : "text-fg")}>{t.label}</span>
          {f && <span className={cn("truncate", f.tone === "bad" ? "text-bad" : "text-fg-muted")}>{f.short}</span>}
        </span>
        <span className="truncate text-meta text-fg-faint">
          {multiRun ? `Run ${ex.runIndex} · ` : ""}
          {time(started)}
          {ex.attempt > 1 ? ` · attempt ${ex.attempt}` : ""}
          {tech && ex.close?.branch ? ` · → ${branchWords(ex.close.branch) ?? ex.close.branch}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-meta text-fg-muted tabular-nums">{ex.close ? fmtMs(ex.close.duration_ms) : "…"}</span>
    </>
  );
  return (
    <li className="border-t border-border first:border-t-0" data-attempt={n} title={started ? fmtDateTime(started) : undefined}>
      {onPick ? (
        <button
          type="button"
          onClick={onPick}
          aria-pressed={active}
          className={cn("flex w-full items-start gap-2 py-2 text-left hover:bg-surface-2", active && "bg-selected hover:bg-selected")}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2 py-2">{body}</div>
      )}
    </li>
  );
}
