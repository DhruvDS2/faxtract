import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Box = { x: number; y: number; w: number; h: number };

/**
 * One highlight that glides between hovered items (Linear). Spread `container`
 * onto a `position: relative` parent and `item` onto each item, then render
 * <TravelingHighlight state={...} /> as the parent's first child. Items must have
 * a transparent background; content scrolls with the box.
 */
export function useTravelingHighlight<C extends HTMLElement = HTMLElement>() {
  const ref = useRef<C>(null);
  const [box, setBox] = useState<Box | null>(null);
  // the first placement after hiding is instant (fade in place), later moves glide
  const [glide, setGlide] = useState(false);
  const shown = useRef(false);

  const moveTo = useCallback((el: Element) => {
    const c = ref.current;
    if (!c) return;
    const r = el.getBoundingClientRect();
    const cr = c.getBoundingClientRect();
    setGlide(shown.current);
    shown.current = true;
    setBox({ x: r.left - cr.left + c.scrollLeft, y: r.top - cr.top + c.scrollTop, w: r.width, h: r.height });
  }, []);
  const hide = useCallback(() => {
    shown.current = false;
    setBox(null);
  }, []);

  return {
    container: { ref, onPointerLeave: hide },
    item: { onPointerEnter: (e: React.PointerEvent<Element>) => moveTo(e.currentTarget) },
    /** Move the highlight from code, e.g. to the keyboard-selected row. */
    moveTo,
    hide,
    state: { box, glide },
  };
}

export function TravelingHighlight({ state, className }: { state: { box: Box | null; glide: boolean }; className?: string }) {
  const { box, glide } = state;
  const last = useRef<Box>({ x: 0, y: 0, w: 0, h: 0 });
  if (box) last.current = box;
  const b = box ?? last.current;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-0 left-0 bg-surface-2 ease-enter",
        glide
          ? "transition-[transform,width,height,opacity] duration-state motion-reduce:transition-opacity"
          : "transition-opacity duration-fast",
        box ? "opacity-100" : "opacity-0",
        className,
      )}
      style={{ transform: `translate3d(${b.x}px, ${b.y}px, 0)`, width: b.w, height: b.h }}
    />
  );
}
