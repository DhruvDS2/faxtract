import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type SplitPaneProps = {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Left pane width in % (default 50). */
  defaultPct?: number;
  min?: number;
  max?: number;
  /** Remember the split across visits (localStorage key). */
  storageKey?: string;
  /** Accessible name of the divider. */
  label?: string;
  className?: string;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function read(key: string | undefined, fallback: number, min: number, max: number) {
  if (!key) return fallback;
  try {
    const v = Number(localStorage.getItem(key));
    return v >= min && v <= max ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Two panes with a hairline divider you can drag, or move with ← → (Home / End for
 * the limits). Double-click resets. Hover thickens the line; focus shows the ring.
 */
export function SplitPane({ left, right, defaultPct = 50, min = 30, max = 70, storageKey, label = "Resize panes", className }: SplitPaneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(() => read(storageKey, defaultPct, min, max));
  const [dragging, setDragging] = useState(false);

  const set = (v: number) => {
    const next = clamp(v, min, max);
    setPct(next);
    if (storageKey)
      try {
        localStorage.setItem(storageKey, String(Math.round(next)));
      } catch {
        /* storage unavailable: keep it in memory */
      }
  };

  return (
    <div ref={root} className={cn("flex h-full min-h-0", dragging && "cursor-col-resize select-none", className)}>
      <div className="min-h-0 min-w-0 shrink-0" style={{ width: `${pct}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(pct)}
        tabIndex={0}
        data-dragging={dragging || undefined}
        className={cn(
          "group relative w-px shrink-0 cursor-col-resize bg-border outline-none",
          "transition-colors duration-fast ease-enter hover:bg-control data-[dragging]:bg-fg-faint",
          "focus-visible:bg-focus",
        )}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging || !root.current) return;
          const r = root.current.getBoundingClientRect();
          set(((e.clientX - r.left) / r.width) * 100);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => set(defaultPct)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") set(pct - 2);
          else if (e.key === "ArrowRight") set(pct + 2);
          else if (e.key === "Home") set(min);
          else if (e.key === "End") set(max);
          else return;
          e.preventDefault();
        }}
      >
        {/* a wider hit area and a 3px hover rail, centred on the hairline */}
        <span aria-hidden className="absolute inset-y-0 -right-1.5 -left-1.5 z-10" />
        <span
          aria-hidden
          className="absolute inset-y-0 -left-px w-0.75 bg-control opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:bg-focus group-focus-visible:opacity-100 group-data-[dragging]:opacity-100"
        />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{right}</div>
    </div>
  );
}
