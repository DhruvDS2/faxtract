import { useEffect, useRef } from "react";
import type { Correction, Flag, ReferralRecord } from "@/contracts";
import { Code } from "@/components/Code";
import { ConfidenceMeter } from "@/components/Confidence";
import { StatusDot } from "@/components/StatusPill";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fmtConfidence } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD_GROUPS, FIELD_ORDER, displayValue, fieldMeta, flagsFor } from "./fields";
import { MOD_KEY, plural } from "./format";
import type { FieldEditor } from "./useFieldEditor";

const inputId = (f: string) => `input-${f}`;
const errorId = (f: string) => `field-error-${f}`;
export const rowId = (f: string) => `row-${f}`;

/** Referrals whose fields have already filled in once: refetches and revisits don't replay it. */
const revealed = new Set<string>();

const ROW = "grid grid-cols-[var(--kv-label)_minmax(0,1fr)_auto] gap-4 rounded-sm -mx-2 px-2";

type Props = {
  record: ReferralRecord;
  editor: FieldEditor;
  threshold: number | undefined;
  selected: string | null;
  hovered: string | null;
  onSelect: (field: string | null) => void;
  onHover: (field: string | null) => void;
  corrections: Correction[] | undefined;
};

/** The extracted fields, grouped (Patient, Study, Coverage, Referring), read or edit. */
export function FieldsPanel({ record, editor, threshold, selected, hovered, onSelect, onHover, corrections }: Props) {
  const { referral, flags } = record;
  const conf = referral.confidence ?? {};
  const boxes = referral.boxes ?? {};
  const low = threshold == null ? [] : FIELD_ORDER.filter((f) => conf[f] != null && conf[f] < threshold);
  const lastCorrection = new Map<string, Correction>();
  for (const c of corrections ?? []) lastCorrection.set(c.field, c);

  // Paradigm progressive fill: once per referral, never on a refetch.
  const reveal = useRef(!revealed.has(record.id)).current;
  useEffect(() => {
    revealed.add(record.id);
  }, [record.id]);

  // Entering edit mode: focus the selected field, else the first one that needs attention.
  useEffect(() => {
    if (!editor.editing) return;
    const target =
      (selected && FIELD_ORDER.includes(selected as never) ? selected : null) ??
      FIELD_ORDER.find((f) => flagsFor(flags, f).length > 0 || (threshold != null && conf[f] != null && conf[f] < threshold)) ??
      FIELD_ORDER[0];
    requestAnimationFrame(() => document.getElementById(inputId(target))?.focus());
    // Only on the transition into edit mode.
  }, [editor.editing]);

  // A 422 came back: focus the first field with an error.
  useEffect(() => {
    const first = FIELD_ORDER.find((f) => editor.errors[f]);
    if (first) requestAnimationFrame(() => document.getElementById(inputId(first))?.focus());
  }, [editor.errorRound]);

  const errorCount = Object.keys(editor.errors).length;
  const meta = editor.editing ? (
    <span className="flex items-center gap-3">
      {errorCount > 0 ? (
        <span className="text-bad">{plural(errorCount, "field needs", "fields need")} fixing</span>
      ) : (
        <span>{editor.changed.length ? plural(editor.changed.length, "unsaved change") : "No changes yet"}</span>
      )}
      <span className="inline-flex items-center gap-1">
        <Kbd>{MOD_KEY}</Kbd>
        <Kbd>↵</Kbd> save
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>esc</Kbd> cancel
      </span>
    </span>
  ) : (
    <span className="tabular-nums">
      {plural(FIELD_ORDER.length, "field")}
      {low.length > 0 && ` · ${low.length} below ${fmtConfidence(threshold)}`}
    </span>
  );

  let index = 0;
  return (
    <section aria-labelledby="fields-title" className="px-6 pt-5 pb-6">
      <div className="flex min-h-7 items-baseline gap-4">
        <h2 id="fields-title" className="text-title text-fg">
          Fields
        </h2>
        <div className="ml-auto text-meta text-fg-muted">{meta}</div>
      </div>
      {editor.editing && editor.otherErrors.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-meta text-bad" role="alert">
          {editor.otherErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="mt-1 flex flex-col">
        {FIELD_GROUPS.map((g) => (
          <div key={g.title} role="group" aria-labelledby={`group-${g.title}`} className="pt-4">
            <h3 id={`group-${g.title}`} className="pb-1 text-meta font-medium text-fg-muted">
              {g.title}
            </h3>
            {g.fields.map((f) => (
              <FieldRow
                key={f}
                index={reveal ? index++ : -1}
                field={f}
                record={record}
                editor={editor}
                flags={flagsFor(flags, f)}
                confidence={conf[f]}
                low={threshold != null && conf[f] != null && conf[f] < threshold}
                hasBox={(boxes[f]?.length ?? 0) > 0}
                selected={selected === f}
                hovered={hovered === f}
                correction={lastCorrection.get(f)}
                onSelect={onSelect}
                onHover={onHover}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

type RowProps = {
  index: number;
  field: string;
  record: ReferralRecord;
  editor: FieldEditor;
  flags: Flag[];
  confidence: number | undefined;
  low: boolean;
  hasBox: boolean;
  selected: boolean;
  hovered: boolean;
  correction: Correction | undefined;
  onSelect: (field: string | null) => void;
  onHover: (field: string | null) => void;
};

function FieldRow({ index, field, record, editor, flags, confidence, low, hasBox, selected, hovered, correction, onSelect, onHover }: RowProps) {
  const meta = fieldMeta(field);
  const editing = editor.editing;
  const error = editor.errors[field];
  const corrected = editing && !!editor.corrected[field];
  const changed = editing && editor.changed.includes(field as never);
  const clickable = !editing && hasBox;
  const toggle = () => onSelect(selected ? null : field);

  return (
    <div
      id={rowId(field)}
      data-state={selected ? "selected" : hovered ? "hovered" : undefined}
      className={cn(
        ROW,
        "group scroll-mt-4 transition-colors duration-fast ease-enter",
        editing ? "items-start py-1" : "items-baseline py-1.5",
        clickable && "cursor-pointer",
        hovered && !selected && "bg-surface-2",
        selected && (editing ? "bg-surface" : "bg-selected"),
        index >= 0 && "animate-field-in",
      )}
      style={index >= 0 ? ({ "--i": index } as React.CSSProperties) : undefined}
      onMouseEnter={() => onHover(field)}
      onMouseLeave={() => onHover(null)}
      onClick={clickable ? toggle : undefined}
      onFocus={editing && hasBox ? () => onSelect(field) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? selected : undefined}
      aria-label={clickable ? `${meta.label}: show on the fax` : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                toggle();
              }
            }
          : undefined
      }
    >
      <div className={cn("flex min-w-0 items-center gap-2", editing && "h-8")}>
        {editing ? (
          <Label htmlFor={inputId(field)} className="truncate font-normal">
            {meta.label}
          </Label>
        ) : (
          <span className="truncate text-meta text-fg-muted">{meta.label}</span>
        )}
        {changed && (
          <span className="size-1.5 shrink-0 rounded-full bg-fg-muted" aria-hidden title="Changed">
            <span className="sr-only">changed</span>
          </span>
        )}
      </div>

      <div className="min-w-0">
        {editing ? (
          <FieldInput field={field} editor={editor} invalid={!!error} corrected={corrected} />
        ) : (
          <>
            <ValueView field={field} value={record.referral[field as keyof typeof record.referral]} />
            {correction && (
              <div className="mt-0.5 animate-fade-in text-meta text-fg-faint">
                Corrected · was {correction.original_value ? `“${correction.original_value}”` : "empty"}
                {correction.original_confidence != null && ` (${fmtConfidence(correction.original_confidence)})`}
              </div>
            )}
          </>
        )}
        {error ? (
          <p key="error" id={errorId(field)} data-testid={errorId(field)} className="mt-1 animate-fade-in text-meta text-bad" role="alert">
            {error}
          </p>
        ) : corrected ? (
          <p key="corrected" className="mt-1 flex animate-fade-in items-center gap-2 text-meta text-fg-muted" aria-live="polite">
            <StatusDot tone="ok" />
            Corrected
          </p>
        ) : null}
        {flags.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5">
            {flags.map((f, i) => (
              <li key={i} className={cn("flex items-baseline gap-2 text-meta", f.severity === "error" ? "text-bad" : "text-fg-muted")}>
                <StatusDot tone={f.severity === "error" ? "bad" : "warn"} className="-translate-y-px" />
                <span>
                  <span className="sr-only">{f.severity}: </span>
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={cn(
          "flex w-10 justify-end transition-opacity duration-fast ease-enter",
          editing && "h-8 items-center",
          low ? "opacity-100" : editing ? "opacity-0" : "opacity-0 group-hover:opacity-100 group-data-[state=selected]:opacity-100",
        )}
      >
        {confidence != null && <ConfidenceMeter value={confidence} quiet className="text-meta" />}
      </div>
    </div>
  );
}

function ValueView({ field, value }: { field: string; value: unknown }) {
  const kind = fieldMeta(field).kind;
  const testid = `field-${field}`;
  if (kind === "codes" && Array.isArray(value) && value.length) {
    return (
      <span data-testid={testid} className="text-body">
        {value.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="text-fg-faint">, </span>}
            <Code className="text-fg">{String(c)}</Code>
          </span>
        ))}
      </span>
    );
  }
  const text = displayValue(field, Array.isArray(value) ? value.join(", ") : value);
  if (text == null)
    return (
      <span data-testid={testid} className="text-body text-fg-faint">
        Not extracted
      </span>
    );
  if (kind === "code")
    return (
      <Code data-testid={testid} className="text-fg wrap-anywhere">
        {text}
      </Code>
    );
  return (
    <span data-testid={testid} className={cn("text-body text-fg wrap-anywhere", kind === "date" && "tabular-nums")}>
      {text}
    </span>
  );
}

function FieldInput({ field, editor, invalid, corrected }: { field: string; editor: FieldEditor; invalid: boolean; corrected: boolean }) {
  const meta = fieldMeta(field);
  const value = editor.draft[field] ?? "";
  const state = cn(
    "transition-[border-color,background-color,box-shadow] duration-state ease-enter",
    invalid && "border-bad bg-bad-bg hover:border-bad",
    corrected && "border-ok hover:border-ok focus-visible:border-ok focus-visible:ring-ok",
  );
  const common = {
    id: inputId(field),
    "data-testid": `field-${field}`,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId(field) : undefined,
  };

  if (meta.kind === "select") {
    return (
      <Select value={value} onValueChange={(v) => editor.setValue(field, v)}>
        <SelectTrigger {...common} className={cn("w-full", state)}>
          <SelectValue placeholder="Select" />
        </SelectTrigger>
        <SelectContent>
          {meta.options?.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (meta.kind === "longtext") {
    return <Textarea {...common} rows={2} value={value} className={state} onChange={(e) => editor.setValue(field, e.target.value)} />;
  }
  return (
    <Input
      {...common}
      value={value}
      placeholder={meta.placeholder}
      inputMode={meta.kind === "date" ? "numeric" : undefined}
      autoComplete="off"
      spellCheck={meta.kind === "text"}
      className={cn((meta.kind === "code" || meta.kind === "codes") && "font-mono text-code", meta.kind === "date" && "tabular-nums", state)}
      onChange={(e) => editor.setValue(field, e.target.value)}
    />
  );
}

/** Field labels with placeholder values: loading, and while the fax is still being read. */
export function FieldsSkeleton({ label = "Loading fields" }: { label?: string }) {
  const widths = ["w-32", "w-20", "w-24", "w-16", "w-28", "w-40", "w-14"];
  let i = 0;
  return (
    <section aria-busy="true" aria-label={label} className="px-6 pt-5 pb-6">
      <div className="flex min-h-7 items-baseline">
        <h2 className="text-title text-fg">Fields</h2>
      </div>
      <div className="mt-1 flex flex-col">
        {FIELD_GROUPS.map((g) => (
          <div key={g.title} className="pt-4">
            <h3 className="pb-1 text-meta font-medium text-fg-muted">{g.title}</h3>
            {g.fields.map((f) => (
              <div key={f} className={cn(ROW, "items-center py-1.5")}>
                <span className="truncate text-meta text-fg-muted">{fieldMeta(f).label}</span>
                <span className="flex h-5 items-center">
                  <Skeleton className={cn("h-2.5", widths[i++ % widths.length])} />
                </span>
                <span className="w-10" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
