import { useRef } from "react";
import { cn } from "@/lib/utils";

export type StatusTab = { value: string; label: string; count?: number };

/**
 * The queue's status filter as text tabs with counts (they replace the status
 * select). Styled like the base <Tabs> (neutral fg underline, never teal), but
 * built as a horizontal single-select listbox: each tab is a filter value, and
 * the e2e specs pick one by role "option" (docs/CONTRACTS.md §15, filter-status).
 *
 * Keyboard: one tab stop; ←/→, Home/End move and select. A mouse click doesn't
 * take focus, so j/k keep driving the table straight after picking a tab.
 */
export function StatusTabs({
  value,
  onChange,
  tabs,
  label,
  testId,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  tabs: StatusTab[];
  label: string;
  testId?: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = tabs.length;
    const next = ((i % n) + n) % n;
    refs.current[next]?.focus();
    onChange(tabs[next].value);
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const to =
      e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    go(to);
  };

  return (
    <div role="listbox" aria-orientation="horizontal" aria-label={label} data-testid={testId} className={cn("flex items-end gap-6", className)}>
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="option"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-value={t.value}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px inline-flex h-10 cursor-pointer items-center gap-1.5 border-b-2 border-transparent text-body font-medium whitespace-nowrap text-fg-muted",
              "transition-[color,border-color] duration-fast ease-enter hover:text-fg",
              "aria-selected:border-fg aria-selected:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="font-normal text-fg-faint tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
