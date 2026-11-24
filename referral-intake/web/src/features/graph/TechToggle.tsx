import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

const KEY = "graph.technical";

/** "Technical details" on or off, remembered per viewer (a convenience: it works without storage). */
export function useTechDetails(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback((v: boolean) => {
    setOn(v);
    try {
      window.localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // private window or blocked storage: the toggle still works for this visit
    }
  }, []);
  return [on, set];
}

/** A small neutral switch with its label: "Technical details". */
export function TechToggle({ on, onChange, className }: { on: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      data-testid="tech-toggle"
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-md px-2 text-meta text-fg-muted transition-colors duration-fast ease-enter hover:bg-surface-2 hover:text-fg",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full border transition-colors duration-fast ease-enter",
          on ? "border-fg-muted bg-fg-muted" : "border-control bg-bg",
        )}
      >
        <span
          className={cn(
            "absolute size-2 rounded-full transition-[left,background-color] duration-fast ease-enter motion-reduce:transition-none",
            on ? "left-3 bg-bg" : "left-0.5 bg-fg-faint",
          )}
        />
      </span>
      Technical details
    </button>
  );
}
