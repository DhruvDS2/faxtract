import { memo } from "react";
import { cn } from "@/lib/utils";
import { useGraphInteraction } from "./context";
import { arrowPath, roundedPath, type Route } from "./layout";
import { revealDelay } from "./reveal";

export type DrawnEdge = {
  id: string;
  source: string;
  target: string;
  route: Route;
  /** On the path this referral took: 2 px teal (the logged accent exception). */
  taken: boolean;
  /** Shown text (plain words or, with technical details on, the raw branch label). */
  label: string | null;
};

/**
 * Every edge, drawn in flow coordinates inside React Flow's viewport (rendered
 * through its edge-label layer, so it sits under the nodes and pans/zooms with
 * them). Untaken branches are faint 1 px lines; the taken path is a 2 px teal
 * line laid over them that fades in, in reveal order.
 */
function FlowEdgesView({ edges }: { edges: DrawnEdge[] }) {
  const { reveal } = useGraphInteraction();
  // Taken edges draw last, over anything they cross.
  const ordered = [...edges].sort((a, b) => Number(a.taken) - Number(b.taken));
  return (
    <>
      <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" aria-hidden>
        {ordered.map((e) => {
          const d = roundedPath(e.route.points);
          const tip = e.route.points[e.route.points.length - 1];
          const lit = e.taken && !(reveal.pending && reveal.order.has(e.target));
          const delay = revealDelay(reveal, reveal.order.get(e.target) ?? reveal.order.get(e.source));
          return (
            <g key={e.id} data-edge={`${e.source}->${e.target}`} data-taken={e.taken || undefined}>
              <path d={d} fill="none" stroke="var(--border-strong)" strokeWidth={1} />
              {e.route.terminal ? (
                <circle cx={tip.x} cy={tip.y} r={2.5} fill="var(--border-strong)" />
              ) : (
                <path d={arrowPath(tip, e.route.dir)} fill="var(--border-strong)" />
              )}
              {e.taken && (
                <g
                  className="transition-opacity duration-state ease-enter"
                  style={{ opacity: lit ? 1 : 0, transitionDelay: `${delay}s` }}
                >
                  <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
                  {e.route.terminal ? (
                    <circle cx={tip.x} cy={tip.y} r={3} fill="var(--accent)" />
                  ) : (
                    <path d={arrowPath(tip, e.route.dir, 6, 4)} fill="var(--accent)" />
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {edges.map((e) =>
        e.label && e.route.label ? (
          <span
            key={e.id}
            className={cn(
              "absolute top-0 left-0 rounded-sm bg-bg px-1 text-meta whitespace-nowrap",
              e.taken ? "text-fg-muted" : "text-fg-faint",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${e.route.label.x}px, ${e.route.label.y}px)` }}
          >
            {e.label}
          </span>
        ) : null,
      )}
    </>
  );
}

export const FlowEdges = memo(FlowEdgesView);
