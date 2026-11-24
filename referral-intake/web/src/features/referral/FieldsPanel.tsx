import { useEffect } from "react";
import { CircleX, TriangleAlert } from "lucide-react";
import type { Correction, Flag, ReferralRecord } from "@/contracts";
import { useHealth } from "@/api/queries";
import { Code } from "@/components/Code";
import { Confidence } from "@/components/Confidence";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { fmtConfidence, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FIELD_GROUPS, FIELD_ORDER, displayValue, fieldMeta, flagsFor, isFieldFlag } from "./fields";
import { plural } from "./format";
import { Section } from "./Section";
import type { FieldEditor } from "./useFieldEditor";

const inputId = (f: string) => `input-${f}`;
const errorId = (f: string) => `field-error-${f}`;

type Props = {
  record: ReferralRecord;
  editor: FieldEditor;
  selected: string | null;
  hovered: string | null;
  onSelect: (field: string | null) => void;
  onHover: (field: string | null) => void;
  corrections: Correction[] | undefined;
};

export function FieldsPanel({ record, editor, selected, hovered, onSelect, onHover, corrections }: Props) {
  const threshold = useHealth().data?.threshold ?? 0.85;
  const { referral, flags } = record;
  const conf = referral.confidence ?? {};
  const boxes = referral.boxes ?? {};
  const otherFlags = flags.filter((f) => !isFieldFlag(f));
  const low = FIELD_ORDER.filter((f) => conf[f] != null && conf[f] < threshold);
  const lastCorrection = new Map<string, Correction>();
  for (const c of corrections ?? []) lastCorrection.set(c.field, c);

  // Entering edit mode: focus the selected field, else the first one that needs attention.
  useEffect(() => {
    if (!editor.editing) return;
    const target =
      (selected && FIELD_ORDER.includes(selected as never) ? selected : null) ??
      FIELD_ORDER.find((f) => flagsFor(flags, f).length > 0 || (conf[f] != null && conf[f] < threshold)) ??
      FIELD_ORDER[0];
    requestAnimationFrame(() => document.getElementById(inputId(target))?.focus());
    // Only on the transition into edit mode.
  }, [editor.editing]);

  // A 422 came back: focus the first field with an error.
  useEffect(() => {
    const first = FIELD_ORDER.find((f) => editor.errors[f]);
    if (first) requestAnimationFrame(() => document.getElementById(inputId(first))?.focus());
  }, [editor.errorRound]);

  const meta = editor.editing ? (
    <span>
      Editing · only changed fields are sent, then validation re-runs
    </span>
  ) : (
    <span className="tabular-nums">
      {plural(FIELD_ORDER.length, "field")}
      {low.length > 0 && ` · ${low.length} below ${fmtConfidence(threshold)}`}
      {flags.length > 0 && ` · ${plural(flags.length, "flag")}`}
    </span>
  );

  return (
    <Section id="fields" title="Extracted fields" meta={meta}>
      {otherFlags.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1 px-2" aria-label="Other validation flags">
          {otherFlags.map((f, i) => (
            <FlagLine key={i} flag={f} prefix={f.field} />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-3">
        {FIELD_GROUPS.map((g) => (
          <div key={g.title} role="group" aria-labelledby={`group-${g.title}`}>
            <h3 id={`group-${g.title}`} className="px-2 pb-1 text-sm font-medium">
              {g.title}
            </h3>
            <div className="flex flex-col">
              {g.fields.map((f) => (
                <FieldRow
                  key={f}
                  field={f}
                  record={record}
                  editor={editor}
                  flags={flagsFor(flags, f)}
                  confidence={conf[f]}
                  hasBox={(boxes[f]?.length ?? 0) > 0}
                  selected={selected === f}
                  hovered={hovered === f}
                  correction={lastCorrection.get(f)}
                  onSelect={onSelect}
                  onHover={onHover}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FlagLine({ flag, prefix }: { flag: Flag; prefix?: string }) {
  const Icon = flag.severity === "error" ? CircleX : TriangleAlert;
  return (
    <li className={cn("flex items-start gap-1.5 text-xs", flag.severity === "error" ? "text-bad" : "text-warn")}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="sr-only">{flag.severity}: </span>
        {prefix && <span className="font-medium">{fieldMeta(prefix).label}: </span>}
        {flag.message}
      </span>
    </li>
  );
}

type RowProps = {
  field: string;
  record: ReferralRecord;
  editor: FieldEditor;
  flags: Flag[];
  confidence: number | undefined;
  hasBox: boolean;
  selected: boolean;
  hovered: boolean;
  correction: Correction | undefined;
  onSelect: (field: string | null) => void;
  onHover: (field: string | null) => void;
};

function FieldRow({ field, record, editor, flags, confidence, hasBox, selected, hovered, correction, onSelect, onHover }: RowProps) {
  const meta = fieldMeta(field);
  const editing = editor.editing;
  const error = editor.errors[field];
  const changed = editing && editor.changed.includes(field as never);
  const clickable = !editing && hasBox;
  const toggle = () => onSelect(selected ? null : field);

  return (
    <div
      id={`row-${field}`}
      data-state={selected ? "selected" : undefined}
      className={cn(
        "grid grid-cols-[8.5rem_minmax(0,1fr)_4.5rem] items-start gap-3 rounded-md px-2 py-1.5 transition-colors duration-150",
        clickable && "cursor-pointer",
        hovered && !selected && "bg-surface-2",
        selected && "bg-accent-subtle shadow-[inset_2px_0_0_var(--accent)]",
      )}
      onMouseEnter={() => onHover(field)}
      onMouseLeave={() => onHover(null)}
      onClick={clickable ? toggle : undefined}
      onFocus={editing ? () => onSelect(field) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? selected : undefined}
      title={clickable ? "Show on the fax" : undefined}
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
      <div className={cn("flex items-center gap-1.5", editing ? "pt-1.5" : "pt-0.5")}>
        {editing ? (
          <Label htmlFor={inputId(field)}>{meta.label}</Label>
        ) : (
          <span className="text-xs text-fg-muted">{meta.label}</span>
        )}
        {changed && <span className="size-1.5 rounded-full bg-accent" title="Changed" aria-label="changed" />}
      </div>

      <div className="min-w-0">
        {editing ? (
          <FieldInput field={field} editor={editor} invalid={!!error} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ValueView field={field} value={record.referral[field as keyof typeof record.referral]} />
            {correction && (
              <Tip
                content={`Corrected ${fmtDateTime(correction.corrected_at)}. Was ${correction.original_value ?? "empty"}${
                  correction.original_confidence != null ? ` (confidence ${fmtConfidence(correction.original_confidence)})` : ""
                }`}
              >
                <Badge tone="outline">Corrected</Badge>
              </Tip>
            )}
          </div>
        )}
        {error && (
          <p id={errorId(field)} data-testid={errorId(field)} className="mt-1 text-xs text-bad" role="alert">
            {error}
          </p>
        )}
        {flags.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5">
            {flags.map((f, i) => (
              <FlagLine key={i} flag={f} />
            ))}
          </ul>
        )}
      </div>

      <div className={cn("flex justify-end", editing ? "pt-1.5" : "pt-0.5")}>
        {confidence == null ? <span className="text-xs text-fg-faint">-</span> : <Confidence value={confidence} />}
      </div>
    </div>
  );
}

function ValueView({ field, value }: { field: string; value: unknown }) {
  const kind = fieldMeta(field).kind;
  const testid = `field-${field}`;
  if (kind === "codes" && Array.isArray(value) && value.length) {
    return (
      <span data-testid={testid}>
        {value.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="text-fg-faint">, </span>}
            <Code>{String(c)}</Code>
          </span>
        ))}
      </span>
    );
  }
  const text = displayValue(field, Array.isArray(value) ? value.join(", ") : value);
  if (text == null)
    return (
      <span data-testid={testid} className="text-fg-faint">
        Not extracted
      </span>
    );
  if (kind === "code") return <Code data-testid={testid}>{text}</Code>;
  return (
    <span data-testid={testid} className={cn("break-words", kind === "date" && "tabular-nums")}>
      {text}
    </span>
  );
}

function FieldInput({ field, editor, invalid }: { field: string; editor: FieldEditor; invalid: boolean }) {
  const meta = fieldMeta(field);
  const value = editor.draft[field] ?? "";
  const common = {
    id: inputId(field),
    "data-testid": `field-${field}`,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId(field) : undefined,
  };

  if (meta.kind === "select") {
    return (
      <Select value={value} onValueChange={(v) => editor.setValue(field, v)}>
        <SelectTrigger {...common} className="w-full aria-[invalid=true]:border-bad">
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
    return <Textarea {...common} rows={2} value={value} onChange={(e) => editor.setValue(field, e.target.value)} />;
  }
  return (
    <Input
      {...common}
      value={value}
      placeholder={meta.placeholder}
      inputMode={meta.kind === "date" ? "numeric" : undefined}
      autoComplete="off"
      spellCheck={meta.kind === "text"}
      className={cn((meta.kind === "code" || meta.kind === "codes") && "font-mono text-[12.5px]", meta.kind === "date" && "tabular-nums")}
      onChange={(e) => editor.setValue(field, e.target.value)}
    />
  );
}
