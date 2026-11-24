import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { usePatch } from "@/api/queries";
import type { ReferralRecord } from "@/contracts";
import { toast } from "@/components/ui/sonner";
import { STATUS } from "@/lib/status";
import { FIELD_ORDER, fieldMeta, fromDraft, toDraft } from "./fields";
import { plural } from "./format";

export type FieldEditor = ReturnType<typeof useFieldEditor>;

/** Inline edit mode for the extracted fields: draft, changed-only PATCH, 422 → per-field errors. */
export function useFieldEditor(record: ReferralRecord) {
  const patch = usePatch(record.id);
  const [editing, setEditing] = useState(false);
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Bumped on every save attempt that came back with field errors, so the panel can refocus. */
  const [errorRound, setErrorRound] = useState(0);

  const changed = useMemo(
    () => FIELD_ORDER.filter((f) => (draft[f] ?? "").trim() !== (initial[f] ?? "").trim()),
    [draft, initial],
  );

  const start = () => {
    const d = toDraft(record.referral);
    setInitial(d);
    setDraft(d);
    setErrors({});
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setErrors({});
  };

  const setValue = (field: string, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setErrors((e) => {
      if (!(field in e)) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  };

  const save = () => {
    if (patch.isPending) return;
    if (!changed.length) {
      setEditing(false);
      toast("No changes to save");
      return;
    }
    const fields = Object.fromEntries(changed.map((f) => [f, fromDraft(f, draft[f])]));
    patch.mutate(
      { fields },
      {
        onSuccess: (rec) => {
          setEditing(false);
          setErrors({});
          toast.success(`Saved ${plural(changed.length, "correction")}`, {
            description:
              rec.status === "needs_review"
                ? `Validation re-ran${rec.pipeline === "graph" ? " and the graph paused again for approval" : ""}.`
                : `Status is now ${STATUS[rec.status].label.toLowerCase()}.`,
          });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 422) {
            const byField: Record<string, string> = {};
            const other: string[] = [];
            for (const e of err.body?.errors ?? []) {
              if (FIELD_ORDER.includes(e.field as never)) byField[e.field] = e.message;
              else other.push(`${fieldMeta(e.field).label}: ${e.message}`);
            }
            setErrors(byField);
            setErrorRound((n) => n + 1);
            toast.error("Some fields need fixing", {
              description: other.length ? other.join("; ") : `${plural(Object.keys(byField).length || 1, "field")} could not be saved.`,
            });
          } else if (err instanceof ApiError && err.status === 409) {
            toast.error("Can't save these edits", { description: err.message });
          } else {
            toast.error("Save failed", { description: err instanceof Error ? err.message : String(err) });
          }
        },
      },
    );
  };

  return { editing, draft, errors, errorRound, changed, saving: patch.isPending, start, cancel, setValue, save };
}
