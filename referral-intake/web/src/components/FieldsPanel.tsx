import { useEffect, useRef } from "react";
import type { Flag, ProcessedReferral } from "../api";
import { cn } from "../lib/cn";
import {
  FIELD_GROUPS,
  extraFields,
  isMono,
  isMultiline,
  labelFor,
  toInputValue,
} from "../lib/fields";
import { estimateCost, formatMs, isLow, validationFlags } from "../lib/format";
import { Button, IconButton } from "./ui/Button";
import { Check, Spinner, Target } from "./ui/Icons";
import { Confidence } from "./ui/Signal";
import { Tooltip } from "./ui/Tooltip";

export type FocusRequest = { field: string; nonce: number } | null;

function Field({
  field,
  value,
  confidence,
  flags,
  hasSource,
  active,
  edited,
  focusRequest,
  onChange,
  onActive,
  onReveal,
}: {
  field: string;
  value: unknown;
  confidence?: number;
  flags: Flag[];
  hasSource: boolean;
  active: boolean;
  edited: boolean;
  focusRequest: FocusRequest;
  onChange: (value: string) => void;
  onActive: (field: string | null) => void;
  onReveal: () => void;
}) {
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const low = isLow(confidence);
  const hasError = flags.some((f) => f.severity === "error");
  const verified = confidence === 1;

  // The parent drives focus when walking unresolved fields.
  useEffect(() => {
    if (focusRequest?.field === field) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusRequest, field]);

  const Control = isMultiline(field) ? "textarea" : "input";

  return (
    <div
      className="group/field py-1.5"
      onMouseEnter={() => onActive(field)}
      onMouseLeave={() => onActive(null)}
    >
      <div className="mb-1 flex items-center gap-2">
        <label htmlFor={`f-${field}`} className="text-[12px] text-muted">
          {labelFor(field)}
        </label>
        <div className="flex-1" />
        {edited ? (
          <span className="text-[11.5px] text-muted">edited</span>
        ) : verified ? (
          <Tooltip label="Corrected by a reviewer">
            <Check size={12} className="text-green" />
          </Tooltip>
        ) : (
          // Only an unverified read earns a number; a confident field says nothing.
          low && confidence !== undefined && <Confidence value={confidence} />
        )}
        {hasSource && (
          <Tooltip label="Show on the fax">
            <IconButton
              label={`Show source of ${labelFor(field)}`}
              onClick={onReveal}
              className={cn(
                "h-5 w-5 transition-opacity",
                active
                  ? "text-amber opacity-100"
                  : "opacity-0 group-focus-within/field:opacity-100 group-hover/field:opacity-100",
              )}
            >
              <Target size={12} />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <Control
        id={`f-${field}`}
        ref={inputRef as never}
        rows={isMultiline(field) ? 2 : undefined}
        value={toInputValue(value)}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        onFocus={() => onActive(field)}
        onBlur={() => onActive(null)}
        className={cn(
          "w-full resize-none rounded-md border border-border bg-panel px-2.5 py-1.5",
          "text-[13px] transition-colors duration-100",
          "focus:border-fg focus:outline-none",
          isMono(field) && "font-mono text-[12.5px]",
          // A thin edge is enough to find unverified fields when scanning.
          hasError ? "border-l-2 border-l-red" : low ? "border-l-2 border-l-amber" : "",
        )}
      />

      {flags.map((f, i) => (
        <p
          key={i}
          className={cn(
            "mt-1 text-[12px] leading-snug",
            f.severity === "error" ? "text-red" : "text-amber",
          )}
        >
          {f.message}
        </p>
      ))}
    </div>
  );
}

function Pipeline({ data }: { data: ProcessedReferral }) {
  const timings = Object.entries(data.stage_timings_ms ?? {});
  const total = timings.reduce((sum, [, ms]) => sum + ms, 0);
  const cost = estimateCost(data.token_usage);
  if (!timings.length && cost === null) return null;

  return (
    <details className="group mt-6">
      <summary className="cursor-pointer list-none text-[11.5px] text-faint hover:text-muted">
        <span className="group-open:hidden">How this was processed</span>
        <span className="hidden group-open:inline">How this was processed</span>
      </summary>
      <dl className="mt-2 space-y-1">
        {timings.map(([stage, ms]) => (
          <div key={stage} className="flex items-baseline justify-between gap-3">
            <dt className="text-[12px] capitalize text-muted">{stage}</dt>
            <dd className="nums text-[12px] text-faint">{formatMs(ms)}</dd>
          </div>
        ))}
        {total > 0 && (
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1">
            <dt className="text-[12px] text-muted">Total</dt>
            <dd className="nums text-[12px] text-faint">{formatMs(total)}</dd>
          </div>
        )}
        {cost !== null && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[12px] text-muted">Cost</dt>
            <dd className="nums text-[12px] text-faint">${cost.toFixed(4)}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}

export default function FieldsPanel({
  data,
  edits,
  activeField,
  focusRequest,
  saving,
  deciding,
  onEdit,
  onActiveField,
  onReveal,
  onSave,
  onApprove,
  onReject,
}: {
  data: ProcessedReferral;
  edits: Record<string, string>;
  activeField: string | null;
  focusRequest: FocusRequest;
  saving: boolean;
  deciding: boolean;
  onEdit: (field: string, value: string) => void;
  onActiveField: (field: string | null) => void;
  onReveal: (field: string) => void;
  onSave: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const referral = data.referral;
  const dirty = Object.keys(edits).length;
  const flags = validationFlags(data.flags, referral.confidence);

  const groups = [
    ...FIELD_GROUPS,
    ...(extraFields(referral).length ? [{ title: "Other", fields: extraFields(referral) }] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {groups.map((group, i) => (
          <section key={group.title} className={cn(i > 0 && "mt-6")}>
            <h3 className="mb-1 text-[11.5px] text-faint">{group.title}</h3>
            {group.fields
              .filter((f) => f in referral)
              .map((field) => (
                <Field
                  key={field}
                  field={field}
                  value={edits[field] ?? referral[field]}
                  confidence={referral.confidence?.[field]}
                  flags={flags.filter((f) => f.field === field)}
                  hasSource={(referral.boxes?.[field] ?? []).length > 0}
                  active={activeField === field}
                  edited={field in edits}
                  focusRequest={focusRequest}
                  onChange={(v) => onEdit(field, v)}
                  onActive={onActiveField}
                  onReveal={() => onReveal(field)}
                />
              ))}
          </section>
        ))}
        <Pipeline data={data} />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
        {dirty > 0 && (
          <Button variant="quiet" onClick={onSave} disabled={saving} className="px-0">
            {saving && <Spinner size={12} />}
            Save {dirty}
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="quiet" onClick={onReject} disabled={deciding}>
          Reject
        </Button>
        <Button variant="primary" onClick={onApprove} disabled={deciding}>
          {deciding && <Spinner size={12} />}
          Approve
        </Button>
      </div>
    </div>
  );
}
