import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  useViewportStore,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { GraphStructure } from "@/contracts";
import { cn } from "@/lib/utils";
import { layeredLayout } from "./layout";
import { NODE_H, NODE_W, PipelineNode, TERMINAL_H, TERMINAL_W, type PipelineFlowNode } from "./PipelineNode";
import { PipelineEdge, type PipelineFlowEdge } from "./PipelineEdge";
import { edgeKey, type GraphRun } from "./trace";

const nodeTypes = { pipeline: PipelineNode };
const edgeTypes = { pipeline: PipelineEdge };
// Extra side room for back edges that bulge past the nodes.
const FIT = { padding: { x: "56px", y: "16px" }, maxZoom: 1 } as const;

// Approximate chip width (12 px Inter) so a labelled long edge gets a lane wide enough for it.
const chipWidth = (label: string | null) => (label ? Math.ceil(label.length * 6.6) + 12 : 0);

export function GraphCanvas({
  structure,
  run,
  selected,
  onSelect,
  dimmed = false,
}: {
  structure: GraphStructure;
  run: GraphRun | null;
  selected: string | null;
  onSelect: (node: string | null) => void;
  dimmed?: boolean;
}) {
  const layout = useMemo(() => {
    const root = structure.nodes.find((n) => n.kind === "start")?.id;
    return layeredLayout(
      structure.nodes.map((n) => ({
        id: n.id,
        width: n.kind === "node" ? NODE_W : TERMINAL_W,
        height: n.kind === "node" ? NODE_H : TERMINAL_H,
      })),
      structure.edges.map((e, i) => ({ id: `e${i}`, source: e.source, target: e.target, labelWidth: chipWidth(e.label) })),
      { root, rankGap: 28 },
    );
  }, [structure]);

  const nodes = useMemo<PipelineFlowNode[]>(
    () =>
      structure.nodes.map((n) => {
        const execs = run?.byNode.get(n.id) ?? [];
        const lastClosed = [...execs].reverse().find((e) => e.close);
        const terminal = n.kind !== "node";
        return {
          id: n.id,
          type: "pipeline",
          position: layout.positions.get(n.id) ?? { x: 0, y: 0 },
          width: terminal ? TERMINAL_W : NODE_W,
          height: terminal ? TERMINAL_H : NODE_H,
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: !terminal,
          ariaLabel: `${n.label}: ${run?.states.get(n.id) ?? "idle"}`,
          data: {
            node: n,
            state: (!dimmed && run?.states.get(n.id)) || "idle",
            durationMs: dimmed ? null : (lastClosed?.close?.duration_ms ?? null),
            executions: dimmed ? 0 : execs.length,
            selected: selected === n.id,
            pending: !dimmed && !!run && run.executions.length > 0,
          },
        };
      }),
    [structure, layout, run, selected, dimmed],
  );

  const edges = useMemo<PipelineFlowEdge[]>(
    () =>
      structure.edges.flatMap<PipelineFlowEdge>((e, i) => {
        const route = layout.routes.get(`e${i}`);
        if (!route) return [];
        const taken = !dimmed && !!run?.taken.has(edgeKey(e));
        const side = route.kind === "back" ? (route.side === "right" ? "r" : "l") : route.kind === "self" ? "r" : null;
        return [
          {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            type: "pipeline",
            sourceHandle: side ? `${side}s` : "b",
            targetHandle: side ? `${side}t` : "t",
            selectable: false,
            focusable: false,
            data: { route, conditional: e.conditional, label: e.label, taken },
          },
        ];
      })
      // Taken edges last, so the path draws over crossing edges but stays under the label chips.
      .sort((a, b) => Number(a.data!.taken) - Number(b.data!.taken)),
    [structure, layout, run, dimmed],
  );

  const onNodeClick: NodeMouseHandler<PipelineFlowNode> = (_, n) => {
    if (!dimmed && n.data.node.kind === "node") onSelect(n.id === selected ? null : n.id);
  };

  return (
    <div
      data-testid="graph-canvas"
      className={cn("relative size-full bg-bg transition-opacity duration-150", dimmed && "opacity-50")}
    >
      <ReactFlow<PipelineFlowNode, PipelineFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={FIT}
        minZoom={0.3}
        maxZoom={1.75}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelect(null)}
        attributionPosition="bottom-left"
        style={{ "--xy-controls-box-shadow": "none" } as React.CSSProperties}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
        <Controls
          position="bottom-right"
          showInteractive={false}
          fitViewOptions={FIT}
          className="overflow-hidden rounded-md border border-border [&_button]:!border-border [&_button]:!text-fg-muted [&_button:hover]:!bg-surface-2"
        />
        <RefitOnResize />
      </ReactFlow>
    </div>
  );
}

/** Keep the whole graph in view when the canvas changes size (a banner, the node panel). */
function RefitOnResize() {
  const { fitView } = useReactFlow();
  const width = useViewportStore((s) => s.width);
  const height = useViewportStore((s) => s.height);
  useEffect(() => {
    if (!width || !height) return;
    const t = setTimeout(() => void fitView(FIT), 40);
    return () => clearTimeout(t);
  }, [width, height, fitView]);
  return null;
}
