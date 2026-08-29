import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listReferrals, uploadReferral, type ProcessedReferral } from "./api";
import CommandPalette from "./components/CommandPalette";
import { CorrectionsDialog, ShortcutsDialog } from "./components/Dialogs";
import QueueRail, { type PendingUpload } from "./components/QueueRail";
import ReviewPane from "./components/ReviewPane";
import WelcomePane from "./components/WelcomePane";
import { IconButton } from "./components/ui/Button";
import { Moon, Sun } from "./components/ui/Icons";
import { Kbd } from "./components/ui/Kbd";
import { Toaster, toast } from "./components/ui/Toast";
import { TooltipProvider } from "./components/ui/Tooltip";
import { MOD, useHotkeys } from "./lib/useHotkeys";
import { useTheme } from "./lib/useTheme";

export default function App() {
  const [referrals, setReferrals] = useState<ProcessedReferral[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { theme, toggle } = useTheme();

  const refresh = useCallback(
    () => listReferrals().then(setReferrals).catch(() => toast("Cannot reach the API", "bad")),
    [],
  );
  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Uploads run one at a time: extraction is the expensive stage, and a serial
   * queue keeps each file's elapsed timer honest instead of showing five faxes
   * all apparently taking as long as the slowest.
   */
  const onFiles = async (files: File[]) => {
    for (const file of files) {
      const entry = { name: file.name, startedAt: Date.now() };
      setPending((p) => [...p, entry]);
      try {
        const processed = await uploadReferral(file);
        await refresh();
        setSelected((current) => current ?? processed.id);
        if (processed.status === "auto_approved") {
          toast(`${file.name} cleared automatically`, "good");
        }
      } catch {
        toast(`Could not process ${file.name}`, "bad");
      } finally {
        setPending((p) => p.filter((x) => x !== entry));
      }
    }
  };

  /** The queue as the rail shows it, so J/K move exactly as the eye expects. */
  const ordered = useMemo(() => {
    const rank = (r: ProcessedReferral) =>
      r.status === "needs_review"
        ? 0
        : r.status === "auto_approved"
          ? 1
          : r.status === "rejected"
            ? 3
            : 2;
    return [...referrals].sort((a, b) => rank(a) - rank(b));
  }, [referrals]);

  const step = (delta: number) => {
    if (!ordered.length) return;
    const index = ordered.findIndex((r) => r.id === selected);
    const next = index === -1 ? 0 : Math.min(ordered.length - 1, Math.max(0, index + delta));
    setSelected(ordered[next].id);
  };

  /** After a decision, land on the next thing that still needs a human. */
  const advance = async () => {
    const remaining = ordered.filter((r) => r.id !== selected && r.status === "needs_review");
    setSelected(remaining[0]?.id ?? null);
    await refresh();
  };

  useHotkeys([
    { key: "k", meta: true, whileTyping: true, run: () => setPaletteOpen((o) => !o) },
    { key: "j", run: () => step(1) },
    { key: "k", run: () => step(-1) },
    // shift:false so a layout reporting shift+/ as "/" still reaches "?" below.
    { key: "/", shift: false, run: () => searchRef.current?.focus() },
    { key: "?", shift: true, run: () => setShortcutsOpen(true) },
    { key: "u", run: () => fileRef.current?.click() },
  ]);

  const needsReview = referrals.filter((r) => r.status === "needs_review").length;

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <h1 className="text-[13px] font-semibold tracking-[-0.01em]">Referral Intake</h1>
          <span className="hidden text-[12px] text-faint sm:inline">Synthetic data</span>

          <div className="flex-1" />

          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-7 items-center gap-2 rounded-md px-2 text-[12px] text-faint
                       transition-colors hover:bg-subtle hover:text-muted"
          >
            Search
            <span className="flex items-center gap-0.5">
              <Kbd>{MOD}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <IconButton label="Toggle theme" onClick={toggle}>
            {theme === "dark" ? <Sun /> : <Moon />}
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1">
          <QueueRail
            referrals={ordered}
            pending={pending}
            selectedId={selected}
            onSelect={setSelected}
            onFiles={onFiles}
            searchRef={searchRef}
          />
          {selected ? (
            <ReviewPane
              key={selected}
              id={selected}
              onDecided={advance}
              onChanged={(updated) =>
                setReferrals((list) => list.map((r) => (r.id === updated.id ? updated : r)))
              }
            />
          ) : (
            <WelcomePane
              hasReferrals={referrals.length > 0}
              onUpload={() => fileRef.current?.click()}
            />
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        referrals={ordered}
        onSelect={setSelected}
        onUpload={() => fileRef.current?.click()}
        onShortcuts={() => setShortcutsOpen(true)}
        onCorrections={() => setCorrectionsOpen(true)}
        onToggleTheme={toggle}
        theme={theme}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CorrectionsDialog open={correctionsOpen} onOpenChange={setCorrectionsOpen} />
      <Toaster />

      <span className="sr-only" role="status" aria-live="polite">
        {needsReview} referrals awaiting review
      </span>
    </TooltipProvider>
  );
}
