import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcessedReferral, Status } from "../api";
import { cn } from "../lib/cn";
import { minConfidence, patientName, validationFlags } from "../lib/format";
import { Button, IconButton } from "./ui/Button";
import { Search, Spinner, Upload, X } from "./ui/Icons";
import { Confidence, Dot } from "./ui/Signal";

export type PendingUpload = { name: string; startedAt: number };

/** Sections in the order a coordinator works them: unfinished business first. */
const SECTIONS: { key: string; title: string; statuses: Status[] }[] = [
  { key: "review", title: "Needs review", statuses: ["needs_review"] },
  { key: "auto", title: "Auto-approved", statuses: ["auto_approved"] },
  { key: "done", title: "Completed", statuses: ["approved", "sent_to_ris"] },
  { key: "rejected", title: "Rejected", statuses: ["rejected"] },
];

const searchText = (r: ProcessedReferral) =>
  [
    patientName(r.referral),
    r.referral.requested_study,
    r.referral.cpt_code,
    r.referral.payor_name,
    r.referral.member_id,
    r.referral.referring_provider_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

function Elapsed({ since }: { since: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  return <span className="nums">{((Date.now() - since) / 1000).toFixed(0)}s</span>;
}

function Row({
  referral,
  selected,
  onSelect,
}: {
  referral: ProcessedReferral;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const r = referral.referral;
  const flags = validationFlags(referral.flags, r.confidence);
  const errors = flags.filter((f) => f.severity === "error").length;
  const urgent = r.urgency === "stat" || r.urgency === "urgent";

  // Keyboard navigation moves the selection; the list has to follow it.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <button
      ref={ref}
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        "w-full rounded-lg px-2.5 py-2 text-left transition-colors duration-75",
        selected ? "bg-subtle" : "hover:bg-subtle/60",
      )}
    >
      <div className="flex items-baseline gap-2">
        {flags.length > 0 && <Dot tone={errors ? "bad" : "warn"} className="relative -top-px" />}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{patientName(r)}</span>
        <Confidence value={minConfidence(r.confidence)} />
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5 text-[12px] text-muted">
        <span className="min-w-0 flex-1 truncate">{r.requested_study || "Study not read"}</span>
        {urgent && (
          <span className={cn("shrink-0", r.urgency === "stat" ? "text-red" : "text-amber")}>
            {r.urgency === "stat" ? "Stat" : "Urgent"}
          </span>
        )}
      </div>
    </button>
  );
}

export default function QueueRail({
  referrals,
  pending,
  selectedId,
  onSelect,
  onFiles,
  searchRef,
}: {
  referrals: ProcessedReferral[];
  pending: PendingUpload[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFiles: (files: File[]) => void;
  searchRef: React.RefObject<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [onlyReview, setOnlyReview] = useState(true);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const needsReview = referrals.filter((r) => r.status === "needs_review").length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = referrals;
    if (onlyReview) list = list.filter((r) => r.status === "needs_review");
    if (q) list = list.filter((r) => searchText(r).includes(q));
    return list;
  }, [referrals, query, onlyReview]);

  const sections = SECTIONS.map((s) => ({
    ...s,
    rows: visible.filter((r) => s.statuses.includes(r.status)),
  })).filter((s) => s.rows.length > 0);

  const pickFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type === "application/pdf");
    if (files.length) onFiles(files);
  };

  return (
    <aside
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pickFiles(e.dataTransfer.files);
      }}
      className="relative flex h-full w-[212px] shrink-0 flex-col border-r border-border bg-panel lg:w-[276px]"
    >
      <div className="shrink-0 px-3 pb-1 pt-3">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Search"
            className="h-8 w-full rounded-md bg-subtle pl-7 pr-7 text-[12.5px]
                       placeholder:text-faint focus:outline-none"
          />
          {query && (
            <IconButton
              label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2"
            >
              <X size={12} />
            </IconButton>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-3 px-0.5">
          {(
            [
              ["Needs review", true, needsReview],
              ["All", false, referrals.length],
            ] as const
          ).map(([label, value, count]) => (
            <button
              key={label}
              onClick={() => setOnlyReview(value)}
              className={cn(
                "text-[12px] transition-colors duration-75",
                onlyReview === value ? "font-medium text-fg" : "text-faint hover:text-muted",
              )}
            >
              {label} <span className="nums">{count}</span>
            </button>
          ))}
          <div className="flex-1" />
          <IconButton
            label="Upload referrals"
            onClick={() => inputRef.current?.click()}
            className="-mr-1 h-6 w-6"
          >
            <Upload size={13} />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {pending.map((p) => (
          <div key={p.name + p.startedAt} className="px-2.5 py-2">
            <div className="flex items-center gap-2 text-[13px]">
              <Spinner size={12} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="text-[12px] text-faint">
                <Elapsed since={p.startedAt} />
              </span>
            </div>
            <div className="mt-1.5 h-px overflow-hidden bg-border">
              <div className="animate-sweep h-full w-1/4 bg-fg" />
            </div>
          </div>
        ))}

        {sections.map((s, i) => (
          <div key={s.key} className={cn(i > 0 && "mt-4")}>
            {(!onlyReview || sections.length > 1) && (
              <div className="px-2.5 pb-1 pt-1 text-[11.5px] text-faint">{s.title}</div>
            )}
            {s.rows.map((r) => (
              <Row
                key={r.id}
                referral={r}
                selected={r.id === selectedId}
                onSelect={() => onSelect(r.id)}
              />
            ))}
          </div>
        ))}

        {!sections.length && !pending.length && (
          <div className="px-3 py-12 text-center">
            <p className="text-[13px] font-medium">
              {query ? "No match" : referrals.length ? "All clear" : "No referrals"}
            </p>
            <p className="mx-auto mt-1 max-w-[190px] text-[12px] leading-relaxed text-muted">
              {query
                ? "Nothing matches that search."
                : referrals.length
                  ? "Everything has been reviewed."
                  : "Drop a faxed referral PDF here to begin."}
            </p>
            {!query && !referrals.length && (
              <Button
                variant="plain"
                className="mx-auto mt-3"
                onClick={() => inputRef.current?.click()}
              >
                Upload a fax
              </Button>
            )}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          pickFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {dragging && (
        <div className="animate-fade pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-bg/85">
          <span className="text-[12.5px] font-medium">Drop to process</span>
        </div>
      )}
    </aside>
  );
}
