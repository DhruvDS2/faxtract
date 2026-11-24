import { Monitor, Moon, Sun } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Match system", Icon: Monitor },
];

/** Light / dark / system, persisted in localStorage "theme". */
export function ThemeToggle({ className, withLabels = false }: { className?: string; withLabels?: boolean }) {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex items-center gap-px rounded-md border border-border p-px", className)} data-testid="theme-toggle">
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = pref === value;
        const button = (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            data-theme-option={value}
            onClick={() => setPref(value)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded-sm text-meta transition-colors duration-fast ease-enter",
              withLabels ? "px-2" : "w-6",
              on ? "bg-selected text-fg" : "text-fg-faint hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {withLabels && label}
          </button>
        );
        return withLabels ? (
          button
        ) : (
          <Tip key={value} content={label}>
            {button}
          </Tip>
        );
      })}
    </div>
  );
}
