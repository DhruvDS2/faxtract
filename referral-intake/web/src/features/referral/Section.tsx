import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title" | "id">;

/** A panel in the detail scroll column: a section title, then content, then a 1px rule. */
export const Section = forwardRef<HTMLElement, Props>(({ id, title, meta, actions, children, className, ...rest }, ref) => (
  <section ref={ref} id={id} aria-labelledby={`${id}-title`} className={cn("border-b border-border px-4 py-3", className)} {...rest}>
    <div className="mb-2 flex min-h-7 items-center gap-2">
      <h2 id={`${id}-title`} className="shrink-0 text-base font-semibold">
        {title}
      </h2>
      {meta && <div className="min-w-0 truncate text-xs text-fg-muted">{meta}</div>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
    {children}
  </section>
));
Section.displayName = "Section";
