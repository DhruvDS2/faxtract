import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { EdgeRoute, XY } from "./layout";

export type PipelineEdgeData = {
  route: EdgeRoute;
  conditional: boolean;
  label: string | null;
  taken: boolean;
};
export type PipelineFlowEdge = Edge<PipelineEdgeData, "pipeline">;

/** Vertical-tangent cubic between two points (the downward flow). */
const down = (a: XY, b: XY) => {
  const my = (a.y + b.y) / 2;
  return `C ${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`;
};

function forwardPath(s: XY, t: XY, points: XY[]) {
  // Through each dummy lane's centre with vertical tangents: straight down a lane, S-curves between lanes.
  let d = `M ${s.x} ${s.y}`;
  let cur = s;
  for (const p of points) {
    d += ` ${cur.x === p.x ? `L ${p.x} ${p.y}` : down(cur, p)}`;
    cur = p;
  }
  d += ` ${cur.x === t.x ? `L ${t.x} ${t.y}` : down(cur, t)}`;
  const first = points[0] ?? t;
  const mid = { x: (s.x + first.x) / 2, y: (s.y + first.y) / 2 };
  return { d, mid, tip: t, dir: { x: 0, y: 1 } };
}

function backPath(s: XY, t: XY, bulgeX: number) {
  const d = `M ${s.x} ${s.y} C ${bulgeX} ${s.y} ${bulgeX} ${t.y} ${t.x} ${t.y}`;
  // Cubic at t=0.5 with both control points at bulgeX.
  const mid = { x: (s.x + t.x) / 8 + (bulgeX * 3) / 4, y: (s.y + t.y) / 2 };
  return { d, mid, tip: t, dir: { x: Math.sign(t.x - bulgeX) || -1, y: 0 } };
}

function selfPath(s: XY, t: XY) {
  const r = 28;
  const d = `M ${s.x} ${s.y - 6} C ${s.x + r} ${s.y - r} ${t.x + r} ${t.y + r} ${t.x} ${t.y + 6}`;
  return { d, mid: { x: s.x + r * 0.75, y: s.y }, tip: { x: t.x, y: t.y + 6 }, dir: { x: -1, y: 0 } };
}

/** A small filled arrowhead pointing along `dir`, tip at `p`. */
function arrow(p: XY, dir: XY) {
  const len = 6;
  const half = 3.5;
  const bx = p.x - dir.x * len;
  const by = p.y - dir.y * len;
  const px = -dir.y * half;
  const py = dir.x * half;
  return `M ${p.x} ${p.y} L ${bx + px} ${by + py} L ${bx - px} ${by - py} Z`;
}

function PipelineEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<PipelineFlowEdge>) {
  if (!data) return null;
  const { route, conditional, label, taken } = data;
  const s = { x: sourceX, y: sourceY };
  const t = { x: targetX, y: targetY };
  const geo =
    route.kind === "forward" ? forwardPath(s, t, route.points) : route.kind === "back" ? backPath(s, t, route.bulgeX) : selfPath(s, t);
  const labelAt = route.kind === "forward" && route.labelAt ? route.labelAt : geo.mid;
  const stroke = taken ? "var(--accent)" : "var(--border-strong)";

  return (
    <>
      <BaseEdge
        id={id}
        path={geo.d}
        style={{
          stroke,
          strokeWidth: taken ? 2 : 1,
          strokeDasharray: conditional && !taken ? "4 3" : undefined,
        }}
      />
      <path d={arrow(geo.tip, geo.dir)} fill={stroke} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "nodrag nopan pointer-events-none absolute rounded-sm border px-1 text-xs leading-4 whitespace-nowrap",
              taken ? "border-accent-border bg-accent-subtle text-accent" : "border-border bg-bg text-fg-muted",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PipelineEdge = memo(PipelineEdgeView);
