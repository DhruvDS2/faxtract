import { useEffect, useState } from "react";
import { getCorrections, type CorrectionRecord } from "../api";
import { labelFor } from "../lib/fields";
import { MOD } from "../lib/useHotkeys";
import { Dialog } from "./ui/Dialog";
import { Spinner } from "./ui/Icons";
import { Kbd } from "./ui/Kbd";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Queue",
    keys: [
      [["J"], "Next referral"],
      [["K"], "Previous referral"],
      [["/"], "Search"],
      [[MOD, "K"], "Command palette"],
      [["U"], "Upload"],
    ],
  },
  {
    title: "Review",
    keys: [
      [["F"], "Next unresolved field"],
      [["1"], "Fax"],
      [["2"], "Policy"],
      [["3"], "Packet"],
      [["4"], "Order"],
      [["["], "Previous page"],
      [["]"], "Next page"],
    ],
  },
  {
    title: "Decisions",
    keys: [
      [[MOD, "S"], "Save corrections"],
      [[MOD, "↵"], "Approve and send"],
      [[MOD, "⌫"], "Reject"],
    ],
  },
  {
    title: "Elsewhere",
    keys: [
      [["?"], "This list"],
      [["Esc"], "Close or clear"],
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Shortcuts"
      description="The review loop runs without the mouse."
      width="max-w-xl"
    >
      <div className="grid grid-cols-2 gap-x-10 gap-y-6">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h4 className="mb-2 text-[11.5px] text-faint">{group.title}</h4>
            <dl className="space-y-1.5">
              {group.keys.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-[12.5px] text-muted">{label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * The audit trail. Every field a human changed, with the confidence the model
 * had when it got it wrong — the signal worth reading here.
 */
export function CorrectionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [records, setRecords] = useState<CorrectionRecord[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setRecords(null);
    getCorrections()
      .then((r) => setRecords([...r].reverse()))
      .catch(() => setRecords([]));
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Corrections"
      description="Every field a reviewer changed, newest first."
      width="max-w-xl"
    >
      {!records ? (
        <div className="flex justify-center py-10">
          <Spinner size={16} className="text-faint" />
        </div>
      ) : records.length === 0 ? (
        <p className="py-10 text-center text-[12.5px] text-muted">
          Nothing yet. Fields you edit and save during review appear here.
        </p>
      ) : (
        <div className="space-y-4">
          {records.map((c, i) => (
            <div key={i}>
              <div className="flex items-baseline gap-2">
                <span className="text-[12.5px] font-medium">{labelFor(c.field)}</span>
                <span className="text-[12px] text-faint">
                  {c.original_confidence != null &&
                    `${Math.round(c.original_confidence * 100)}% confident`}
                </span>
                <div className="flex-1" />
                <span className="nums text-[12px] text-faint">
                  {new Date(c.corrected_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted">
                <span className="line-through decoration-faint">{c.original_value || "—"}</span>
                <span className="mx-1.5 text-faint">→</span>
                <span className="text-fg">{c.corrected_value || "—"}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
