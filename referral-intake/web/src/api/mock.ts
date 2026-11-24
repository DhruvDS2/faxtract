/**
 * In-memory mock of the frozen API, for building the UI before the backend lanes
 * merge (VITE_MOCK=1 / npm run dev:mock). ORCHESTRATOR-OWNED.
 *
 * mockData.json was generated from real pipeline pieces -- replayed Claude
 * extraction, real validation, mock-payor 270/271, auth rules, HL7 and v1/v2
 * retrieval -- but the statuses, traces and benchmark numbers are synthetic.
 * The UI shows a "MOCK DATA" chip whenever this is active.
 */
import type {
  Correction,
  Flag,
  ReferralRecord,
  ReferralStatus,
  ReferralSummary,
  RisOrderRow,
  TraceEvent,
} from "@/contracts";
import raw from "./mockData.json";

type MockData = {
  records: ReferralRecord[];
  traces: Record<string, TraceEvent[]>;
  policies: Record<string, unknown>;
  compares: Record<string, unknown>;
  structure: unknown;
  benchmark: unknown;
  extraction: unknown;
};
const data = raw as unknown as MockData;

const db = {
  records: new Map<string, ReferralRecord>(data.records.map((r) => [r.id, structuredClone(r)])),
  traces: new Map<string, TraceEvent[]>(Object.entries(structuredClone(data.traces))),
  corrections: [] as Correction[],
};
const LATENCY = 180;
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fail = (status: number, detail: string, extra: Record<string, unknown> = {}) =>
  ok({ detail, errors: [], status: null, flags: [], ...extra }, status);

function summary(r: ReferralRecord): ReferralSummary {
  const ref = r.referral;
  const conf = Object.values(ref.confidence ?? {});
  return {
    id: r.id,
    pipeline: r.pipeline,
    source_name: r.source_name,
    status: r.status,
    patient_name: ref.patient_last_name ? `${ref.patient_last_name}, ${ref.patient_first_name ?? ""}`.trim() : null,
    patient_dob: ref.patient_dob,
    cpt_code: ref.cpt_code,
    requested_study: ref.requested_study,
    payor_name: ref.payor_name,
    member_id: ref.member_id,
    min_confidence: conf.length ? Math.min(...conf) : null,
    error_count: r.flags.filter((f) => f.severity === "error").length,
    warning_count: r.flags.filter((f) => f.severity === "warning").length,
    ack_code: r.order.ack_code,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function trace(id: string, node: string, status: TraceEvent["status"], extra: Partial<TraceEvent> = {}) {
  const list = db.traces.get(id) ?? [];
  const run = extra.run_id ?? list.at(-1)?.run_id ?? `${id}-run-1`;
  list.push({
    referral_id: id, run_id: run, seq: list.length + 1, pipeline: "graph", node, status,
    started_at: now(), duration_ms: status === "running" ? 0 : 1 + Math.random() * 4, cost_usd: 0,
    tokens_in: 0, tokens_out: 0, attempt: 1, branch: null, detail: {}, error: null,
    state_in: status === "running" ? null : {}, delta: status === "running" ? null : {}, ...extra,
  });
  db.traces.set(id, list);
}

function touch(r: ReferralRecord, patch: Partial<ReferralRecord>) {
  Object.assign(r, patch, { updated_at: now() });
}

function send(r: ReferralRecord, run: string) {
  trace(r.id, "order", "running", { run_id: run });
  touch(r, {
    status: "sent_to_ris",
    order: {
      ...r.order,
      order_id: r.order.order_id ?? `ORD${r.id.toUpperCase()}`,
      message: r.order.message ?? `MSH|^~\\&|REFERRAL_INTAKE|HOLLISPARK|RIS|HOLLISPARK|20261123150000||ORM^O01|MSG${r.id.toUpperCase()}|P|2.5.1\rPID|1||MRN${r.id.toUpperCase()}||${r.referral.patient_last_name}^${r.referral.patient_first_name}`,
      ack_code: "AA",
      ack_raw: `MSA|AA|MSG${r.id.toUpperCase()}|`,
      attempts: r.order.attempts + 1,
      last_error: null,
      sent_at: now(),
    },
  });
  trace(r.id, "order", "ok", { run_id: run, branch: "AA", attempt: r.order.attempts, delta: { status: "sent_to_ris" } });
}

/** A new upload walks the graph a node per ~700 ms, then pauses at human review. */
async function runUpload(r: ReferralRecord) {
  const run = `${r.id}-run-1`;
  const template = data.records.find((x) => x.source_name === "referral_054.pdf")!;
  for (const node of ["extract", "validate", "eligibility", "auth"]) {
    trace(r.id, node, "running", { run_id: run });
    await sleep(node === "extract" ? 2500 : 600);
    trace(r.id, node, "ok", { run_id: run, branch: node === "auth" ? "human_review" : null });
  }
  touch(r, {
    status: "needs_review",
    referral: structuredClone(template.referral),
    eligibility: template.eligibility ?? { status: "active_in_network", payor_name: template.referral.payor_name, plan_name: "PPO", deductible_remaining: 250, coinsurance_percent: 20, raw_271: null },
    auth: template.auth ?? { required: false, missing_elements: [], submission_channel: null, turnaround_days: null },
    flags: [{ field: "patient_dob", severity: "warning", message: "low extraction confidence (0.71)" }],
    review_reasons: ["patient_dob: low extraction confidence (0.71)"],
  });
  r.referral.confidence.patient_dob = 0.71;
  trace(r.id, "human_review", "running", { run_id: run });
  trace(r.id, "human_review", "interrupted", { run_id: run, delta: { status: "needs_review" } });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function mockFetch(path: string, init: RequestInit = {}): Promise<Response> {
  await sleep(LATENCY);
  const method = (init.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://mock");
  const parts = url.pathname.split("/").filter(Boolean);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;

  if (parts[0] === "health")
    return ok({ ok: true, db: true, ris: "up", pipeline: "graph", extractor: "replay (mock)", threshold: 0.85 });
  if (parts[0] === "graph" && parts[1] === "structure") return ok(data.structure);
  if (parts[0] === "orders") {
    const rows: RisOrderRow[] = [...db.records.values()]
      .filter((r) => r.order.attempts > 0)
      .map((r) => ({
        referral_id: r.id, order_id: r.order.order_id, cpt_code: r.referral.cpt_code,
        patient_name: `${r.referral.patient_last_name}, ${r.referral.patient_first_name}`,
        status: r.status, ack_code: r.order.ack_code, attempts: r.order.attempts, last_error: r.order.last_error,
        sent_at: r.order.sent_at, in_ris: r.order.ack_code === "AA", retryable: r.status === "ris_error",
      }));
    return ok(rows);
  }
  if (parts[0] === "evals") {
    const which = parts[1] === "benchmark" ? data.benchmark : data.extraction;
    const source = parts[1] === "benchmark" ? "MOCK (evals/benchmark_v1_v2.json not generated yet)" : "MOCK (subset of evals/extraction_eval.json)";
    return ok({ source, run_at: "2026-11-23T15:00:00Z", run_at_source: "artifact", data: which });
  }
  if (parts[0] === "corrections") return ok(db.corrections);
  if (parts[0] !== "referrals") return fail(404, `mock: no route for ${method} ${path}`);

  // /referrals
  if (parts.length === 1 && method === "GET") {
    const status = url.searchParams.get("status") as ReferralStatus | null;
    const payor = url.searchParams.get("payor");
    const rows = [...db.records.values()]
      .filter((r) => !status || r.status === status)
      .filter((r) => !payor || r.referral.payor_name === payor)
      .map(summary);
    return ok(rows);
  }
  if (parts.length === 1 && method === "POST") {
    const file = init.body instanceof FormData ? (init.body.get("file") as File | null) : null;
    const id = `u${Math.random().toString(36).slice(2, 8)}`;
    const template = data.records.find((x) => x.source_name === "referral_054.pdf")!;
    const rec: ReferralRecord = {
      ...structuredClone(template), id, source_name: file?.name ?? "upload.pdf", source_file: `uploads/${id}/upload.pdf`,
      status: "processing", flags: [], eligibility: null, auth: null, review_reasons: [], reviews: [],
      referral: { ...structuredClone(template.referral), confidence: {}, boxes: {} },
      order: { order_id: null, message: null, ack_code: null, ack_raw: null, attempts: 0, last_error: null, sent_at: null },
      created_at: now(), updated_at: now(),
    };
    db.records.set(id, rec);
    db.traces.set(id, []);
    void runUpload(rec);
    return ok(rec, 202);
  }

  const id = parts[1];
  const r = db.records.get(id);
  if (!r) return fail(404, `referral ${id} not found`);
  const sub = parts[2];

  if (!sub && method === "GET") return ok(r);
  if (sub === "trace") return ok(db.traces.get(id) ?? []);
  if (sub === "policy") return ok(data.policies[id] ?? { required: false, keywords: [], citations: [] });
  if (sub === "corrections") return ok(db.corrections.filter((c) => c.referral_id === id));
  if (sub === "retrieval-compare")
    return data.compares[id] ? ok(data.compares[id]) : fail(409, "no prior authorization needed, so no policy retrieval for this referral");
  if (sub === "order")
    return ok({ order_id: r.order.order_id ?? `ORD${id.toUpperCase()}`, message: r.order.message ?? "MSH|^~\\&|REFERRAL_INTAKE|...(mock preview)", sent: r.order.attempts > 0 });

  if (!sub && method === "PATCH") {
    if (r.status !== "needs_review") return fail(409, `cannot edit a referral that is ${r.status}`, { status: r.status });
    const fields = (body?.fields ?? {}) as Record<string, unknown>;
    const errors = Object.entries(fields).flatMap(([f, v]) => {
      if (!(f in r.referral) || f === "confidence" || f === "boxes") return [{ field: f, message: "not an editable field" }];
      if ((f === "patient_dob" || f === "order_date") && v !== null && !DATE.test(String(v)))
        return [{ field: f, message: "expected a date as YYYY-MM-DD" }];
      return [];
    });
    if (errors.length) return fail(422, "validation failed", { errors });
    const run = `${id}-run-${new Set((db.traces.get(id) ?? []).map((e) => e.run_id)).size + 1}`;
    for (const [f, v] of Object.entries(fields)) {
      const before = (r.referral as Record<string, unknown>)[f];
      const value = f === "icd10_codes" && typeof v === "string" ? v.split(/[\s,;]+/).filter(Boolean) : v;
      (r.referral as Record<string, unknown>)[f] = value;
      r.referral.confidence[f] = 1;
      db.corrections.push({ referral_id: id, field: f, original_value: before == null ? null : String(before), corrected_value: value == null ? null : String(value), original_confidence: null, corrected_at: now() });
    }
    const flags: Flag[] = r.flags.filter((fl) => !(fl.field in fields));
    touch(r, { flags, review_reasons: r.review_reasons.filter((x) => !Object.keys(fields).some((f) => x.startsWith(f))), reviews: [...r.reviews, { action: "edit", reviewer: body?.reviewer ?? null, note: null, fields: Object.keys(fields), at: now() }] });
    for (const node of ["human_review", "validate", "eligibility", "auth", "human_review"]) {
      trace(id, node, "running", { run_id: run });
      trace(id, node, node === "human_review" && r.reviews.length ? "interrupted" : "ok", { run_id: run, branch: node === "human_review" ? "edit" : null });
    }
    return ok(r);
  }
  if (sub === "approve" && method === "POST") {
    if (r.status !== "needs_review") return fail(409, `cannot approve a referral that is ${r.status}`, { status: r.status });
    const blocking = r.flags.filter((f) => f.severity === "error");
    if (blocking.length) return fail(409, "fix the validation errors before approving", { status: r.status, flags: blocking });
    const run = `${id}-run-${new Set((db.traces.get(id) ?? []).map((e) => e.run_id)).size + 1}`;
    trace(id, "human_review", "running", { run_id: run });
    trace(id, "human_review", "ok", { run_id: run, branch: "approve" });
    touch(r, { status: "approved", reviews: [...r.reviews, { action: "approve", reviewer: body?.reviewer ?? null, note: body?.note ?? null, fields: [], at: now() }] });
    send(r, run);
    return ok(r);
  }
  if (sub === "reject" && method === "POST") {
    if (!body?.reason) return fail(422, "validation failed", { errors: [{ field: "reason", message: "a reason is required" }] });
    if (!["needs_review", "ris_error"].includes(r.status)) return fail(409, `cannot reject a referral that is ${r.status}`, { status: r.status });
    touch(r, { status: "rejected", reviews: [...r.reviews, { action: "reject", reviewer: body.reviewer ?? null, note: body.reason, fields: [], at: now() }] });
    trace(id, "reject", "ok", { branch: "reject" });
    return ok(r);
  }
  if (sub === "retry-send" && method === "POST") {
    if (r.status !== "ris_error") return fail(409, `nothing to retry: referral is ${r.status}`, { status: r.status });
    send(r, `${id}-retry-${r.order.attempts + 1}`);
    return ok(r);
  }
  return fail(404, `mock: no route for ${method} ${path}`);
}
