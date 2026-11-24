import { useEffect, useMemo, useRef } from "react";
import { EdgeLabelRenderer, ReactFlow, useReactFlow, useViewportStore, type Viewport } from "@xyflow/react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { GraphStructure } from "@/contracts";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { DURATION_MS, EASE, useMotionPrefs } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { branchWords, stepLabel, TERMINAL_LABEL } from "./labels";
import { flowLayout, type Bounds, type FlowLayout } from "./layout";
import { FlowEdges, type DrawnEdge } from "./FlowEdges";
import { finding } from "./steps";
import {
  STEP_H,
  STEP_H_TECH,
  STEP_W,
  StepNode,
  TERMINAL_SIZE,
  TerminalNode,
  type StepFlowNode,
  type TerminalFlowNode,
} from "./StepNode";
import { edgeKey, NODE_STATE, type GraphRun } from "./trace";

const nodeTypes = { step: StepNode, terminal: TerminalNode };
/** Room kept around the map when it is fitted (flow units at zoom 1). */
const FIT_PAD = 24;
/** Approximate label widths: Inter 12 (plain words) or JetBrains Mono 12 (raw labels), plus padding. */
const labelWidth = (text: string | null, mono: boolean) => (text ? Math.ceil(text.length * (mono ? 7.3 : 6.3)) + 8 : 0);

/** The enter curve (EASE.enter) as a function, for React Flow's viewport animations. */
function bezier([x1, y1, x2, y2]: readonly number[]) {
  const at = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (at(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return at(y1, y2, t);
  };
}
const easeEnter = bezier(EASE.enter);

export type FlowMapProps = {
  structure: GraphStructure;
  /** Null: no referral picked (the bare map). */
  run: GraphRun | null;
  tech: boolean;
  /** Width the side panel covers on the right, so the selected step can be kept clear of it. */
  coveredRight: number;
  selected: string | null;
  onReady: () => void;
  className?: string;
};

/** Edge text: plain words (dropped when they only repeat the next step's name), or the raw label. */
function edgeText(label: string | null, target: string, tech: boolean) {
  if (!label) return null;
  if (tech) return label;
  const words = branchWords(label);
  return words && words.toLowerCase() !== stepLabel(target).toLowerCase() ? words : null;
}

export function FlowMap({ structure, run, tech, coveredRight, selected, onReady, className }: FlowMapProps) {
  const layout = useMemo<FlowLayout>(
    () =>
      flowLayout(
        structure.nodes.map((n) => ({
          id: n.id,
          kind: n.kind,
          width: n.kind === "node" ? STEP_W : TERMINAL_SIZE,
          height: n.kind === "node" ? (tech ? STEP_H_TECH : STEP_H) : TERMINAL_SIZE,
        })),
        structure.edges.map((e, i) => ({
          id: `e${i}`,
          source: e.source,
          target: e.target,
          labelWidth: labelWidth(edgeText(e.label, e.target, tech), tech),
        })),
      ),
    [structure, tech],
  );

  const nodes = useMemo(() => {
    const out: (StepFlowNode | TerminalFlowNode)[] = [];
    // Tab order follows the flow: the spine left to right, then the rows below.
    const ids = [...layout.positions.keys()].sort(
      (a, b) =>
        (layout.rows.get(a) ?? 0) - (layout.rows.get(b) ?? 0) || layout.positions.get(a)!.x - layout.positions.get(b)!.x,
    );
    for (const id of ids) {
      const n = structure.nodes.find((x) => x.id === id)!;
      const position = layout.positions.get(id)!;
      const state = run?.states.get(id) ?? "idle";
      if (n.kind !== "node") {
        // The mark is filled only when the path reaches it here (not through a stub elsewhere).
        const reached =
          state === "done" &&
          structure.edges.some(
            (e, i) => (e.target === id || e.source === id) && !!run?.taken.has(edgeKey(e)) && layout.routes.get(`e${i}`)?.kind !== "stub",
          );
        out.push({
          id,
          type: "terminal",
          position,
          width: TERMINAL_SIZE,
          height: TERMINAL_SIZE,
          draggable: false,
          selectable: false,
          focusable: false,
          data: { id, kind: n.kind, label: TERMINAL_LABEL[n.kind], state, reached, tech },
        });
        continue;
      }
      const execs = run?.byNode.get(id) ?? [];
      const latest = execs.at(-1);
      const latestClosed = [...execs].reverse().find((e) => e.close);
      const f = latest && latest.status !== "running" ? finding(latest) : null;
      const stoppedHere = state === "error" && latest?.status === "running";
      const result = stoppedHere ? "Stopped here" : (f?.short ?? null);
      const durationMs = latestClosed?.close?.duration_ms ?? null;
      out.push({
        id,
        type: "step",
        position,
        width: STEP_W,
        height: tech ? STEP_H_TECH : STEP_H,
        // React Flow turns pointer events off on nodes it doesn't handle itself; the step handles its own.
        style: { pointerEvents: "all" },
        draggable: false,
        selectable: false,
        focusable: false,
        data: {
          id,
          label: stepLabel(id),
          state,
          bare: !run,
          result,
          resultTone: stoppedHere ? "bad" : f?.tone,
          durationMs,
          runs: execs.length,
          startedAt: latest?.status === "running" ? (latest.open?.started_at ?? null) : null,
          tech,
          stateLabel: run ? [NODE_STATE[state].label, result].filter(Boolean).join(", ") : "not run",
        },
      });
    }
    return out;
  }, [layout, structure, run, tech]);

  const edges = useMemo<DrawnEdge[]>(
    () =>
      structure.edges.flatMap((e, i) => {
        const route = layout.routes.get(`e${i}`);
        if (!route) return [];
        return [{ id: `e${i}`, source: e.source, target: e.target, route, taken: !!run?.taken.has(edgeKey(e)), label: edgeText(e.label, e.target, tech) }];
      }),
    [structure, layout, run, tech],
  );

  return (
    <div data-testid="graph-canvas" className={cn("relative size-full", className)}>
      <ReactFlow<StepFlowNode | TerminalFlowNode>
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        disableKeyboardA11y
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        minZoom={0.4}
        maxZoom={1.5}
        attributionPosition="bottom-right"
        aria-label="Pipeline map"
      >
        <EdgeLabelRenderer>
          <FlowEdges edges={edges} />
        </EdgeLabelRenderer>
        <Fitter bounds={layout.bounds} positions={layout.positions} selected={selected} coveredRight={coveredRight} onReady={onReady} />
      </ReactFlow>
    </div>
  );
}

/** The viewport that shows the whole map, centred, never above 100 %. */
function fitViewport(b: Bounds, width: number, height: number): Viewport {
  const zoom = Math.max(0.4, Math.min(1, (width - 2 * FIT_PAD) / b.width, (height - 2 * FIT_PAD) / b.height));
  return { x: (width - b.width * zoom) / 2 - b.x * zoom, y: (height - b.height * zoom) / 2 - b.y * zoom, zoom };
}

/**
 * Keeps the map fitted to its box (and refits when the box changes size), keeps the
 * selected step clear of the side panel (a 320 ms pan), and renders the zoom controls.
 */
function Fitter({
  bounds,
  positions,
  selected,
  coveredRight,
  onReady,
}: {
  bounds: Bounds;
  positions: FlowLayout["positions"];
  selected: string | null;
  coveredRight: number;
  onReady: () => void;
}) {
  const flow = useReactFlow();
  const width = useViewportStore((s) => s.width);
  const height = useViewportStore((s) => s.height);
  const { reduce } = useMotionPrefs();
  const ready = useRef(false);
  const moved = useRef(false); // panned to clear the panel

  // Fit on first size and on every resize / layout change.
  useEffect(() => {
    if (!width || !height || !bounds.width) return;
    void flow.setViewport(fitViewport(bounds, width, height));
    moved.current = false;
    if (!ready.current) {
      ready.current = true;
      onReady();
    }
  }, [width, height, bounds, flow, onReady]);

  // Keep the selected step out from under the panel; slide back when it closes.
  useEffect(() => {
    if (!width || !bounds.width) return;
    const opts = { duration: reduce ? 0 : DURATION_MS.panel, ease: easeEnter };
    const vp = flow.getViewport();
    const p = selected ? positions.get(selected) : undefined;
    if (!p || !coveredRight) {
      if (moved.current) {
        moved.current = false;
        void flow.setViewport(fitViewport(bounds, width, height), opts);
      }
      return;
    }
    const left = p.x * vp.zoom + vp.x;
    const right = (p.x + STEP_W) * vp.zoom + vp.x;
    const limit = width - coveredRight - FIT_PAD;
    if (right <= limit && left >= FIT_PAD) return;
    const dx = right > limit ? limit - right : FIT_PAD - left;
    moved.current = true;
    void flow.setViewport({ ...vp, x: vp.x + dx }, opts);
    // positions/bounds change only with the layout, which refits anyway
  }, [selected, coveredRight, width, height, positions, bounds, flow, reduce]);

  const fit = () => {
    moved.current = false;
    void flow.setViewport(fitViewport(bounds, width, height), { duration: reduce ? 0 : DURATION_MS.state, ease: easeEnter });
  };
  const zoom = (by: number) => {
    const vp = flow.getViewport();
    const z = Math.min(1.5, Math.max(0.4, vp.zoom * by));
    // zoom about the centre of the box
    const cx = width / 2;
    const cy = height / 2;
    void flow.setViewport(
      { zoom: z, x: cx - ((cx - vp.x) / vp.zoom) * z, y: cy - ((cy - vp.y) / vp.zoom) * z },
      { duration: reduce ? 0 : DURATION_MS.state, ease: easeEnter },
    );
  };

  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center rounded-md border border-border bg-bg">
      <Tip content="Zoom out">
        <Button variant="ghost" size="icon" className="size-7 rounded-r-none" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus />
        </Button>
      </Tip>
      <Tip content="Zoom in">
        <Button variant="ghost" size="icon" className="size-7 rounded-none border-x border-border" aria-label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus />
        </Button>
      </Tip>
      <Tip content="Fit the map">
        <Button variant="ghost" size="icon" className="size-7 rounded-l-none" aria-label="Fit the map" onClick={fit}>
          <Maximize2 />
        </Button>
      </Tip>
    </div>
  );
}
