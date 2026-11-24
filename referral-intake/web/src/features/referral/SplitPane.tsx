import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MIN = 30;
const MAX = 70;
const KEY = "laneD.detail.split";

const read = () => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= MIN && v <= MAX ? v : 50;
  } catch {
    return 50;
  }
};
const write = (v: number) => {
  try {
    localStorage.setItem(KEY, String(Math.round(v)));
  } catch {
    /* storage unavailable: keep it in memory */
  }
};

/** Two panes with a draggable (and keyboard-adjustable) divider; defaults to 50/50. */
export function SplitPane({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(read);
  const [dragging, setDragging] = useState(false);

  const set = (v: number) => {
    const next = Math.min(MAX, Math.max(MIN, v));
    setPct(next);
    write(next);
  };

  return (
    <div ref={root} className={cn("flex h-full min-h-0", dragging && "cursor-col-resize select-none")}>
      <div className="min-w-0 shrink-0" style={{ width: `${pct}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the fax and details panes"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={Math.round(pct)}
        tabIndex={0}
        className={cn(
          "group relative w-px shrink-0 cursor-col-resize bg-border transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
          dragging && "bg-accent",
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
        onDoubleClick={() => set(50)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") set(pct - 2);
          else if (e.key === "ArrowRight") set(pct + 2);
          else if (e.key === "Home") set(MIN);
          else if (e.key === "End") set(MAX);
          else return;
          e.preventDefault();
        }}
      >
        <span className="absolute inset-y-0 -right-1.5 -left-1.5 z-10" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">{right}</div>
    </div>
  );
}
