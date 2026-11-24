import { EDITABLE_FIELDS, type Flag, type Referral, type ReferralField } from "@/contracts";
import { humanize } from "@/lib/format";

export type FieldKind = "text" | "longtext" | "date" | "code" | "codes" | "select";
export type Option = { value: string; label: string };

export type FieldMeta = { label: string; kind: FieldKind; options?: Option[]; placeholder?: string };

const SEX: Option[] = [
  { value: "F", label: "Female" },
  { value: "M", label: "Male" },
  { value: "U", label: "Unknown" },
];
const LATERALITY: Option[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bilateral", label: "Bilateral" },
  { value: "n/a", label: "n/a" },
];
const URGENCY: Option[] = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "stat", label: "STAT" },
];

const META: Partial<Record<ReferralField, FieldMeta>> = {
  patient_last_name: { label: "Last name", kind: "text" },
  patient_first_name: { label: "First name", kind: "text" },
  patient_dob: { label: "Date of birth", kind: "date", placeholder: "YYYY-MM-DD" },
  patient_sex: { label: "Sex", kind: "select", options: SEX },
  patient_phone: { label: "Phone", kind: "text" },
  patient_address: { label: "Address", kind: "text" },
  requested_study: { label: "Requested study", kind: "text" },
  cpt_code: { label: "CPT", kind: "code", placeholder: "e.g. 72148" },
  laterality: { label: "Laterality", kind: "select", options: LATERALITY },
  icd10_codes: { label: "ICD-10", kind: "codes", placeholder: "Comma-separated, e.g. M54.16, M51.26" },
  clinical_indication: { label: "Clinical indication", kind: "longtext" },
  urgency: { label: "Urgency", kind: "select", options: URGENCY },
  order_date: { label: "Order date", kind: "date", placeholder: "YYYY-MM-DD" },
  payor_name: { label: "Payor", kind: "text" },
  member_id: { label: "Member ID", kind: "code" },
  group_id: { label: "Group ID", kind: "code" },
  referring_provider_name: { label: "Provider", kind: "text" },
  referring_provider_npi: { label: "NPI", kind: "code", placeholder: "10 digits" },
  referring_practice: { label: "Practice", kind: "text" },
};

export const fieldMeta = (f: string): FieldMeta =>
  META[f as ReferralField] ?? { label: humanize(f).replace(/^./, (c) => c.toUpperCase()), kind: "text" };

const GROUPS: { title: string; fields: ReferralField[] }[] = [
  { title: "Patient", fields: ["patient_last_name", "patient_first_name", "patient_dob", "patient_sex", "patient_phone", "patient_address"] },
  { title: "Study", fields: ["requested_study", "cpt_code", "laterality", "icd10_codes", "clinical_indication", "urgency", "order_date"] },
  { title: "Coverage", fields: ["payor_name", "member_id", "group_id"] },
  { title: "Referring provider", fields: ["referring_provider_name", "referring_provider_npi", "referring_practice"] },
];

/** Every EDITABLE_FIELDS entry, grouped; anything new in the contract lands in "Other". */
export const FIELD_GROUPS = (() => {
  const listed = new Set(GROUPS.flatMap((g) => g.fields));
  const rest = EDITABLE_FIELDS.filter((f) => !listed.has(f));
  const groups = GROUPS.map((g) => ({ ...g, fields: g.fields.filter((f) => EDITABLE_FIELDS.includes(f)) }));
  return rest.length ? [...groups, { title: "Other", fields: rest }] : groups;
})();

export const FIELD_ORDER: ReferralField[] = FIELD_GROUPS.flatMap((g) => g.fields);

/** The string an input shows for a field. */
export function toDraft(referral: Referral): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of EDITABLE_FIELDS) {
    const v = referral[f];
    out[f] = v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/** Draft string → PATCH value. The server coerces too; this keeps the payload typed. */
export function fromDraft(field: string, value: string): unknown {
  const v = value.trim();
  if (fieldMeta(field).kind === "codes") return v ? v.split(/[\s,;]+/).filter(Boolean).map((c) => c.toUpperCase()) : [];
  return v === "" ? null : v;
}

/** Display text for a field value in read mode. */
export function displayValue(field: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  const meta = fieldMeta(field);
  if (meta.kind === "select") return meta.options?.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

/** Flags that belong to a field ("icd10_codes", "icd10_codes[1]", "icd10_codes.0" all match). */
export const flagsFor = (flags: Flag[], field: string) =>
  flags.filter((f) => f.field === field || f.field.startsWith(field + "[") || f.field.startsWith(field + "."));

export const isFieldFlag = (flag: Flag) => FIELD_ORDER.some((f) => flagsFor([flag], f).length > 0);
