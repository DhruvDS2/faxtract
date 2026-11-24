import { forwardRef, useState } from "react";
import { m, transition, useMotionPrefs, useTransitionMarker } from "@/lib/motion";
import { cn } from "@/lib/utils";

const TAGS = { div: m.div, span: m.span, h1: m.h1, h2: m.h2, h3: m.h3, p: m.p } as const;
let instances = 0;

export type MorphProps = {
  /** Same id on the source and the target, e.g. referralLayoutId(id). */
  layoutId: string;
  as?: keyof typeof TAGS;
  /**
   * When to re-measure on re-render. Default: never (a stable per-instance value), so
   * sorting or filtering a list doesn't animate its items. The morph itself doesn't
   * need it: the outgoing element is measured when the incoming one takes over.
   * Never give the source and target the same value: motion skips the morph then.
   */
  layoutDependency?: unknown;
  children?: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd" | "style">;

/**
 * Shared-element transition (ONTO, 320 ms): wrap the source (a queue row's patient
 * block) and the target (the detail header) in <Morph layoutId={...}>. When one
 * unmounts as the other mounts, the target grows from the source's box.
 * Under reduced motion the morph is off; the route crossfade still runs.
 */
export const Morph = forwardRef<HTMLElement, MorphProps>(({ layoutId, as = "div", layoutDependency, className, children, ...rest }, ref) => {
  const Tag = TAGS[as] as typeof m.div;
  const [own] = useState(() => `morph-${++instances}`);
  // reduced motion: no layoutId at all, so no projection transform is ever applied
  const { reduce } = useMotionPrefs();
  const marker = useTransitionMarker();
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      layoutId={reduce ? undefined : layoutId}
      layoutDependency={layoutDependency ?? own}
      data-morph={layoutId}
      transition={{ layout: transition.panel }}
      onLayoutAnimationStart={marker.onLayoutAnimationStart}
      onLayoutAnimationComplete={marker.onLayoutAnimationComplete}
      className={cn(as === "span" && "inline-block", className)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Tag>
  );
});
Morph.displayName = "Morph";
