/**
 * The extraction schema in the coordinator's order rather than the model's.
 * `app/models.py` returns one flat Referral; a reviewer reads it as four
 * blocks, and getting the identity block wrong matters more than the rest.
 */
export type FieldGroup = { title: string; fields: string[] };

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Patient",
    fields: [
      "patient_last_name",
      "patient_first_name",
      "patient_dob",
      "patient_sex",
      "patient_phone",
      "patient_address",
    ],
  },
  {
    title: "Referring provider",
    fields: ["referring_provider_name", "referring_provider_npi", "referring_practice"],
  },
  {
    title: "Study",
    fields: [
      "requested_study",
      "cpt_code",
      "laterality",
      "icd10_codes",
      "clinical_indication",
      "urgency",
      "order_date",
    ],
  },
  { title: "Insurance", fields: ["payor_name", "member_id", "group_id"] },
];

const LABELS: Record<string, string> = {
  patient_first_name: "First name",
  patient_last_name: "Last name",
  patient_dob: "Date of birth",
  patient_sex: "Sex",
  patient_phone: "Phone",
  patient_address: "Address",
  referring_provider_name: "Provider",
  referring_provider_npi: "NPI",
  referring_practice: "Practice",
  requested_study: "Requested study",
  laterality: "Laterality",
  cpt_code: "CPT",
  icd10_codes: "ICD-10",
  clinical_indication: "Indication",
  urgency: "Urgency",
  payor_name: "Payor",
  member_id: "Member ID",
  group_id: "Group ID",
  order_date: "Order date",
};

export const labelFor = (field: string) =>
  LABELS[field] ?? field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Codes and identifiers are compared character by character — give them mono. */
const MONO = new Set([
  "referring_provider_npi",
  "cpt_code",
  "icd10_codes",
  "member_id",
  "group_id",
  "patient_dob",
  "patient_phone",
  "order_date",
]);
export const isMono = (field: string) => MONO.has(field);

const MULTILINE = new Set(["clinical_indication", "patient_address"]);
export const isMultiline = (field: string) => MULTILINE.has(field);

export const toInputValue = (value: unknown): string =>
  Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);

/** Fields the schema knows about, in display order. */
export const ORDERED_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields);

/** Anything the extractor returned that isn't in a group still has to be shown. */
export const extraFields = (referral: Record<string, unknown>) =>
  Object.keys(referral).filter(
    (k) => k !== "confidence" && k !== "boxes" && !ORDERED_FIELDS.includes(k),
  );
