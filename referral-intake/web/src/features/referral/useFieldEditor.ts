import { useMemo, useState } from "react";
import { ApiError } from "@/api/client";
import { usePatch } from "@/api/queries";
import type { ReferralRecord } from "@/contracts";
import { STATUS } from "@/lib/status";
import { FIELD_ORDER, fieldMeta, fromDraft, parses, toDraft } from "./fields";
import { plural } from "./format";
import { notify } from "./notify";

export type FieldEditor = ReturnType<typeof useFieldEditor>;

/** What the server said about a value it rejected (422), and the value it rejected. */
type Rejection = { value: string; message: string };

/**
 * Inline edit mode for the extracted fields: a draft, a changed-only PATCH, and a 422
 * mapped onto each field. A rejected field stays in its error state until its value
 * parses; then it shows as corrected (the server re-validates on save).
 */
export function useFieldEditor(id: string, record: ReferralRecord | undefined) {
  const patch = usePatch(id);
  const [editing, setEditing] = useState(false);
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<Record<string, Rejection>>({});
  /** Fields that were rejected and whose value now parses. */
  const [corrected, setCorrected] = useState<Record<string, true>>({});
  /** Bumped on every save that came back with field errors, so the panel can refocus. */
  const [errorRound, setErrorRound] = useState(0);
  /** Errors the server raised for fields this screen doesn't show. */
  const [otherErrors, setOtherErrors] = useState<string[]>([]);

  const changed = useMemo(() => FIELD_ORDER.filter((f) => (draft[f] ?? "").trim() !== (initial[f] ?? "").trim()), [draft, initial]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [f, r] of Object.entries(rejected)) if (!corrected[f]) out[f] = r.message;
    return out;
  }, [rejected, corrected]);

  const reset = () => {
    setRejected({});
    setCorrected({});
    setOtherErrors([]);
  };

  const start = () => {
    if (!record) return;
    const d = toDraft(record.referral);
    setInitial(d);
    setDraft(d);
    reset();
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    reset();
  };

  const setValue = (field: string, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    const r = rejected[field];
    if (!r) return;
    const fixed = value.trim() !== r.value.trim() && parses(field, value);
    setCorrected((c) => {
      if (fixed === !!c[field]) return c;
      const next = { ...c };
      if (fixed) next[field] = true;
      else delete next[field];
      return next;
    });
  };

  const save = () => {
    if (patch.isPending) return;
    if (!changed.length) {
      setEditing(false);
      reset();
      notify.info("No changes to save");
      return;
    }
    const fields = Object.fromEntries(changed.map((f) => [f, fromDraft(f, draft[f])]));
    patch.mutate(
      { fields },
      {
        onSuccess: (rec) => {
          setEditing(false);
          reset();
          notify.success(`Saved ${plural(changed.length, "correction")}`, {
            description:
              rec.status === "needs_review"
                ? `Validation re-ran${rec.pipeline === "graph" ? ". The graph is paused for your approval." : "."}`
                : `It's now ${STATUS[rec.status].label.toLowerCase()}.`,
          });
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 422) {
            const byField: Record<string, Rejection> = {};
            const other: string[] = [];
            for (const e of err.body?.errors ?? []) {
              if (FIELD_ORDER.includes(e.field as never)) byField[e.field] = { value: draft[e.field] ?? "", message: e.message };
              else other.push(`${fieldMeta(e.field).label}: ${e.message}`);
            }
            setRejected(byField);
            setCorrected({});
            setOtherErrors(other.length || Object.keys(byField).length ? other : [err.message]);
            setErrorRound((n) => n + 1);
          } else if (err instanceof ApiError && err.status === 409) {
            notify.error("Couldn't save these edits", { description: err.message });
          } else {
            notify.error("Couldn't save", { description: err instanceof Error ? err.message : String(err) });
          }
        },
      },
    );
  };

  return {
    editing,
    draft,
    errors,
    corrected,
    otherErrors,
    errorRound,
    changed,
    saving: patch.isPending,
    start,
    cancel,
    setValue,
    save,
  };
}
