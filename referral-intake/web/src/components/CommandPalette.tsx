import * as RD from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessedReferral } from "../api";
import { cn } from "../lib/cn";
import { STATUS_LABELS, patientName } from "../lib/format";
import { Search } from "./ui/Icons";

type Command = {
  id: string;
  label: string;
  detail?: string;
  right?: string;
  run: () => void;
};

export default function CommandPalette({
  open,
  onOpenChange,
  referrals,
  onSelect,
  onUpload,
  onShortcuts,
  onCorrections,
  onToggleTheme,
  theme,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referrals: ProcessedReferral[];
  onSelect: (id: string) => void;
  onUpload: () => void;
  onShortcuts: () => void;
  onCorrections: () => void;
  onToggleTheme: () => void;
  theme: "light" | "dark";
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const close = (run: () => void) => () => {
    onOpenChange(false);
    // Let the dialog release focus before the app moves it somewhere else.
    setTimeout(run, 0);
  };

  const groups = useMemo(() => {
    const actions: Command[] = [
      { id: "upload", label: "Upload referrals", run: close(onUpload) },
      { id: "corrections", label: "Corrections log", run: close(onCorrections) },
      { id: "shortcuts", label: "Keyboard shortcuts", run: close(onShortcuts) },
      {
        id: "theme",
        label: theme === "dark" ? "Light theme" : "Dark theme",
        run: close(onToggleTheme),
      },
    ];
    const items: Command[] = referrals.map((r) => ({
      id: r.id,
      label: patientName(r.referral),
      detail: [r.referral.requested_study, r.referral.payor_name].filter(Boolean).join(" · "),
      right: STATUS_LABELS[r.status] ?? r.status,
      run: close(() => onSelect(r.id)),
    }));

    const q = query.trim().toLowerCase();
    const match = (c: Command) => !q || `${c.label} ${c.detail ?? ""}`.toLowerCase().includes(q);
    return [
      { title: "Referrals", items: items.filter(match) },
      { title: "Actions", items: actions.filter(match) },
    ].filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, referrals, theme]);

  const flat = groups.flatMap((g) => g.items);
  const active = flat[Math.min(index, flat.length - 1)];

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, query]);

  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="animate-fade fixed inset-0 z-40 bg-black/20" />
        <RD.Content
          aria-label="Command palette"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(flat.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              active?.run();
            }
          }}
          className="animate-panel fixed left-1/2 top-[15vh] z-50 w-[calc(100vw-2rem)] max-w-[520px]
                     -translate-x-1/2 -translate-y-0 overflow-hidden rounded-xl bg-panel ring-1 ring-border
                     shadow-[0_1px_2px_rgba(0,0,0,0.06),0_16px_48px_rgba(0,0,0,0.16)]"
          style={{ transform: "translate(-50%, 0)" }}
        >
          <RD.Title className="sr-only">Command palette</RD.Title>
          <RD.Description className="sr-only">Jump to a referral or run an action</RD.Description>

          <div className="flex items-center gap-2.5 px-4">
            <Search size={14} className="shrink-0 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              placeholder="Search referrals and actions"
              className="h-12 w-full bg-transparent text-[13.5px] placeholder:text-faint focus:outline-none"
            />
          </div>
          <div className="h-px bg-border" />

          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
            {groups.map((group, gi) => (
              <div key={group.title} className={cn(gi > 0 && "mt-1.5")}>
                <div className="px-2.5 pb-1 pt-1.5 text-[11.5px] text-faint">{group.title}</div>
                {group.items.map((item) => {
                  const isActive = item === active;
                  return (
                    <button
                      key={item.id}
                      data-active={isActive}
                      onMouseMove={() => setIndex(flat.indexOf(item))}
                      onClick={item.run}
                      className={cn(
                        "flex w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left",
                        isActive && "bg-subtle",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{item.label}</span>
                        {item.detail && (
                          <span className="block truncate text-[12px] text-faint">
                            {item.detail}
                          </span>
                        )}
                      </span>
                      {item.right && (
                        <span className="shrink-0 text-[12px] text-faint">{item.right}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {!flat.length && (
              <p className="px-2.5 py-8 text-center text-[12.5px] text-faint">No matches</p>
            )}
          </div>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
