import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, Pause } from "lucide-react";
import type { GraphNode } from "@/contracts";
import { fmtMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { NodeState } from "./trace";

export const NODE_W = 184;
export const NODE_H = 40;
export const TERMINAL_W = 88;
export const TERMINAL_H = 24;

export type PipelineNodeData = {
  node: GraphNode;
  state: NodeState;
  durationMs: number | null;
  executions: number;
  selected: boolean;
  /** A referral is selected but this node hasn't run yet: draw it as "not reached". */
  pending: boolean;
};
export type PipelineFlowNode = Node<PipelineNodeData, "pipeline">;

// Handles are invisible anchors: top/bottom for the downward flow, sides for back edges.
const HANDLE = "!size-px !min-h-0 !min-w-0 !border-0 !bg-transparent";

const STATE_CLASS: Record<NodeState, string> = {
  done: "border-ok-border bg-bg text-ok",
  running: "border-accent bg-bg text-accent animate-pulse-ring",
  paused: "border-warn-border bg-warn-bg text-warn",
  error: "border-bad-border bg-bad-bg text-bad",
  skipped: "border-dashed border-idle-border bg-bg text-fg-faint",
  idle: "border-border-strong bg-bg text-fg",
};

function StateIcon({ state, interrupts }: { state: NodeState; interrupts: boolean }) {
  if (state === "done") return <Check className="size-3.5 shrink-0" aria-hidden />;
  if (state === "error") return <AlertTriangle className="size-3.5 shrink-0" aria-hidden />;
  if (state === "paused") return <Pause className="size-3.5 shrink-0" aria-hidden />;
  if (state === "running") return <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden />;
  if (interrupts) return <Pause className="size-3.5 shrink-0 text-fg-faint" aria-label="can pause" />;
  return null;
}

function PipelineNodeView({ data }: NodeProps<PipelineFlowNode>) {
  const { node, state, durationMs, executions, selected, pending } = data;
  const terminal = node.kind !== "node";
  const look: NodeState = state === "idle" && pending ? "skipped" : state;
  return (
    <div
      data-testid="graph-node"
      data-node={node.id}
      data-state={state}
      title={terminal ? undefined : node.id}
      className={cn(
        "flex size-full items-center gap-1.5 rounded-md border transition-colors duration-150",
        terminal ? "justify-center px-2 text-xs" : "cursor-pointer px-2.5 text-sm",
        terminal && look === "idle" ? "border-border bg-surface text-fg-muted" : STATE_CLASS[look],
        selected && "ring-2 ring-accent-border ring-offset-1 ring-offset-bg",
      )}
    >
      <Handle type="target" position={Position.Top} id="t" className={HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="b" className={HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="rs" className={HANDLE} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="rt" className={HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Left} id="ls" className={HANDLE} isConnectable={false} />
      <Handle type="target" position={Position.Left} id="lt" className={HANDLE} isConnectable={false} />
      {terminal ? (
        <span>{node.label}</span>
      ) : (
        <>
          <StateIcon state={state} interrupts={node.interrupts} />
          <span className={cn("min-w-0 flex-1 truncate", look !== "skipped" && "font-medium")}>{node.label}</span>
          {state === "running" ? (
            <span className="text-xs">running</span>
          ) : (
            durationMs != null && <span className="text-xs tabular-nums opacity-80">{fmtMs(durationMs)}</span>
          )}
          {executions > 1 && (
            <span
              className="rounded-full border border-current/30 px-1 text-xs leading-4 tabular-nums"
              title={`${executions} executions across runs`}
            >
              ×{executions}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export const PipelineNode = memo(PipelineNodeView);
