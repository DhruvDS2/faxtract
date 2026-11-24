/**
 * Frozen API contract: a hand-kept mirror of referral-intake/app/contracts.py and
 * app/models.py. See docs/CONTRACTS.md. ORCHESTRATOR-OWNED: ask before changing.
 * Datetimes arrive as ISO strings.
 */

// ---------- extraction (app/models.py) ----------

export type Laterality = "left" | "right" | "bilateral" | "n/a";
export type Urgency = "routine" | "urgent" | "stat";
export type Severity = "error" | "warning";

/** Fractions (0-1) of the page's width/height from its top-left corner. */
export type Box = { page: number; left: number; top: number; width: number; height: number };

export type Referral = {
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_dob: string | null; // YYYY-MM-DD
  patient_sex: "M" | "F" | "U" | null;
  patient_phone: string | null;
  patient_address: string | null;
  referring_provider_name: string | null;
  referring_provider_npi: string | null;
  referring_practice: string | null;
  requested_study: string | null;
  laterality: Laterality | null;
  cpt_code: string | null;
  icd10_codes: string[];
  clinical_indication: string | null;
  urgency: Urgency;
  payor_name: string | null;
  member_id: string | null;
  group_id: string | null;
  order_date: string | null; // YYYY-MM-DD
  confidence: Record<string, number>;
  boxes: Record<string, Box[]>;
};

export type ReferralField = Exclude<keyof Referral, "confidence" | "boxes">;

export const EDITABLE_FIELDS: ReferralField[] = [
  "patient_first_name", "patient_last_name", "patient_dob", "patient_sex", "patient_phone",
  "patient_address", "referring_provider_name", "referring_provider_npi", "referring_practice",
  "requested_study", "laterality", "cpt_code", "icd10_codes", "clinical_indication", "urgency",
  "payor_name", "member_id", "group_id", "order_date",
];

export type Flag = { field: string; severity: Severity; message: string };

export type Eligibility = {
  status: "active_in_network" | "active_out_of_network" | "terminated" | "not_found";
  payor_name: string | null;
  plan_name: string | null;
  deductible_remaining: number | null;
  coinsurance_percent: number | null;
  raw_271: string | null;
};

export type AuthRequirement = {
  required: boolean;
  missing_elements: string[];
  submission_channel: string | null;
  turnaround_days: number | null;
};

export type Correction = {
  referral_id: string;
  field: string;
  original_value: string | null;
  corrected_value: string | null;
  original_confidence: number | null;
  corrected_at: string;
};

// ---------- lifecycle (app/contracts.py) ----------

export type PipelineName = "graph" | "v1";

export type ReferralStatus =
  | "processing"
  | "needs_review"
  | "auto_approved"
  | "approved"
  | "sent_to_ris"
  | "ris_error"
  | "rejected"
  | "failed";

export const REVIEWABLE: ReferralStatus[] = ["needs_review"];
export const RETRYABLE: ReferralStatus[] = ["ris_error"];
export const REJECTABLE: ReferralStatus[] = ["needs_review", "ris_error"];

export type AckCode = "AA" | "AE" | "AR";

export type PolicyCitation = { source: string; payor: string | null; cpt: string | null; score: number; text: string };

export type OrderInfo = {
  order_id: string | null;
  message: string | null; // HL7 ORM^O01, segments separated by "\r"
  ack_code: AckCode | null;
  ack_raw: string | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
};

export type ReviewEvent = {
  action: "edit" | "approve" | "reject" | "retry_send";
  reviewer: string | null;
  note: string | null;
  fields: string[];
  at: string;
};

export type ReferralRecord = {
  id: string;
  pipeline: PipelineName;
  source_name: string;
  source_file: string;
  status: ReferralStatus;
  referral: Referral;
  flags: Flag[];
  eligibility: Eligibility | null;
  auth: AuthRequirement | null;
  review_reasons: string[];
  citations: PolicyCitation[];
  keywords: string[];
  packet_available: boolean;
  order: OrderInfo;
  reviews: ReviewEvent[];
  stage_timings_ms: Record<string, number>;
  token_usage: Record<string, number>;
  cost_usd: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderPreview = { order_id: string; message: string; sent: boolean };

export type ReferralSummary = {
  id: string;
  pipeline: PipelineName;
  source_name: string;
  status: ReferralStatus;
  patient_name: string | null;
  patient_dob: string | null;
  cpt_code: string | null;
  requested_study: string | null;
  payor_name: string | null;
  member_id: string | null;
  min_confidence: number | null;
  error_count: number;
  warning_count: number;
  ack_code: AckCode | null;
  created_at: string;
  updated_at: string;
};

// ---------- request bodies ----------

export type ReferralPatch = { fields: Partial<Record<ReferralField, unknown>>; reviewer?: string | null };
export type ApproveBody = { reviewer?: string | null; note?: string | null };
export type RejectBody = { reason: string; reviewer?: string | null };

export type FieldError = { field: string; message: string };
/** Body of every 4xx from the review API. 422 carries `errors`; 409 carries `status` + `flags`. */
export type ErrorBody = { detail: string; errors: FieldError[]; status: ReferralStatus | null; flags: Flag[] };

// ---------- trace ----------

export type TraceStatus = "running" | "ok" | "error" | "interrupted" | "skipped";

export type TraceEvent = {
  referral_id: string;
  run_id: string;
  seq: number;
  pipeline: PipelineName;
  node: string;
  status: TraceStatus;
  started_at: string;
  duration_ms: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  attempt: number;
  branch: string | null;
  detail: Record<string, unknown>;
  error: string | null;
  state_in: Record<string, unknown> | null;
  delta: Record<string, unknown> | null;
};

// ---------- pipeline graph ----------

export type GraphNode = { id: string; label: string; kind: "start" | "end" | "node"; interrupts: boolean };
export type GraphEdge = { source: string; target: string; conditional: boolean; label: string | null };
export type GraphStructure = { active_pipeline: PipelineName; nodes: GraphNode[]; edges: GraphEdge[] };

// ---------- retrieval compare ----------

export type RetrievedChunk = { rank: number; source: string; payor: string | null; cpt: string | null; score: number; text: string };
export type RetrieverRun = { name: string; impl: string; latency_ms: number; keywords: string[]; chunks: RetrievedChunk[] };
export type RetrievalCompare = {
  referral_id: string;
  query: { indication?: string; codes?: string[]; payor?: string | null; [k: string]: unknown };
  expected_source: string | null;
  v1: RetrieverRun;
  v2: RetrieverRun;
};

export type PolicyResult = { required: boolean; keywords: string[]; citations: PolicyCitation[] };

// ---------- RIS orders ----------

export type RisOrderRow = {
  referral_id: string;
  order_id: string | null;
  patient_name: string | null;
  cpt_code: string | null;
  status: ReferralStatus;
  ack_code: AckCode | null;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  in_ris: boolean;
  retryable: boolean;
};

// ---------- evals ----------

export type Count = { hits: number; n: number };
export type Percentiles = { p50: number; p95: number; mean: number | null; n: number | null };

export type PipelineBenchmark = {
  pipeline: PipelineName;
  retriever: string;
  retrieval_hit_at_1_with_cpt: Count;
  retrieval_hit_at_1_without_cpt: Count;
  auto_approved: number;
  false_approvals: number;
  false_approval_files: string[];
  latency_ms: Percentiles;
  extraction_latency_ms: Percentiles | null;
  cost_per_referral_usd: number;
  node_timings_ms: Record<string, Percentiles>;
};

export type FalseApprovalCase = {
  file: string;
  pipelines: PipelineName[];
  field: string;
  predicted: unknown;
  truth: unknown;
  confidence: number | null;
  explanation: string;
};

export type BenchmarkReport = {
  schema_version: 1;
  generated_at: string;
  git_commit: string | null;
  threshold: number;
  corpus: Record<string, unknown>;
  extraction: Record<string, unknown>;
  critical_fields: string[];
  v1: PipelineBenchmark;
  v2: PipelineBenchmark;
  false_approval_cases: FalseApprovalCase[];
  notes: string[];
};

/** evals/extraction_eval.json (committed artifact) */
export type ExtractionEval = {
  summary: {
    engine: string;
    model?: string | null;
    run_at?: string | null;
    n_files: number;
    overall_accuracy: number;
    fields_correct: number;
    fields_total: number;
    per_field: Record<string, { correct: number; total: number; accuracy: number }>;
    cost: { input_tokens: number; output_tokens: number; total_dollars: number; dollars_per_referral: number };
    latency_ms: { p50: number; p95: number };
    pricing_note?: string;
  };
  records: Array<{
    file: string;
    template: string | null;
    degradation: string | null;
    pages: number | null;
    latency_ms: number;
    error: string | null;
    correct: number;
    total: number;
    accuracy: number;
    fields: Array<{ field: string; predicted: unknown; truth: unknown; match: boolean; confidence: number | null }>;
  }>;
};

export type ArtifactEnvelope<T> = {
  source: string;
  run_at: string | null;
  run_at_source: "artifact" | "git" | "unknown";
  data: T;
};

export type Health = { ok: boolean; db: boolean; ris: "up" | "down"; pipeline: PipelineName; extractor: string; threshold: number };
