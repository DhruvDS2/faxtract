import { createContext, useContext, useState } from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, m, transition, useMotionPrefs, useTransitionMarker } from "@/lib/motion";
import { cn } from "@/lib/utils";

const OpenValue = createContext<string>("");

export type AccordionProps = {
  /** Controlled open item ("" = all closed). */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
};

/**
 * Detail panels (Calendly): one open at a time, the rest collapse to their headers.
 * Hairline dividers between items, no boxes. Height + opacity over 320 ms; under
 * reduced motion the content only fades.
 */
export function Accordion({ value, defaultValue = "", onValueChange, children, className }: AccordionProps) {
  const [inner, setInner] = useState(defaultValue);
  const open = value ?? inner;
  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      value={open}
      onValueChange={(v) => {
        if (value === undefined) setInner(v);
        onValueChange?.(v);
      }}
      className={cn("border-t border-border", className)}
    >
      <OpenValue.Provider value={open}>{children}</OpenValue.Provider>
    </AccordionPrimitive.Root>
  );
}

export type AccordionItemProps = {
  value: string;
  title: React.ReactNode;
  /** Right-aligned one-line summary that stays visible when collapsed ("Member not found"). */
  summary?: React.ReactNode;
  /** One control beside the header, outside the trigger (clicking it doesn't toggle the panel). */
  action?: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children">;

export function AccordionItem({ value, title, summary, action, children, disabled, className, contentClassName, ...rest }: AccordionItemProps) {
  const open = useContext(OpenValue) === value;
  const { reduce } = useMotionPrefs();
  const marker = useTransitionMarker();
  const closed = reduce ? { opacity: 0 } : { height: 0, opacity: 0 };
  return (
    <AccordionPrimitive.Item value={value} disabled={disabled} className={cn("border-b border-border", className)} {...rest}>
      <AccordionPrimitive.Header asChild>
        <h3 className="flex items-center">
          <AccordionPrimitive.Trigger
            className={cn(
              "group flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 pl-6 text-left text-body",
              action ? "pr-3" : "pr-6",
              "transition-colors duration-fast ease-enter hover:bg-surface disabled:cursor-not-allowed disabled:opacity-45",
              "focus-visible:-outline-offset-2",
            )}
          >
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 text-fg-faint transition-transform duration-state ease-enter group-data-[state=open]:rotate-90 motion-reduce:transition-none"
            />
            <span className="min-w-0 truncate font-medium text-fg">{title}</span>
            {summary && <span className="ml-auto min-w-0 shrink truncate pl-4 text-right text-fg-muted">{summary}</span>}
          </AccordionPrimitive.Trigger>
          {action && <div className="flex shrink-0 items-center pr-6">{action}</div>}
        </h3>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content forceMount className="overflow-hidden">
        <AnimatePresence initial={false}>
          {open && (
            <m.div
              key="content"
              initial={closed}
              animate={{ height: "auto", opacity: 1, transition: transition.panel }}
              exit={{ ...closed, transition: transition.exitPanel }}
              {...marker}
            >
              <div className={cn("px-6 pt-1 pb-6 pl-11", contentClassName)}>{children}</div>
            </m.div>
          )}
        </AnimatePresence>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}
