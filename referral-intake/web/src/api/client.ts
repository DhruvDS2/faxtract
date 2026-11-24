/**
 * Typed client for every frozen endpoint (docs/CONTRACTS.md). ORCHESTRATOR-OWNED.
 * Feature code calls these (usually through ./queries) and never builds URLs itself.
 * VITE_MOCK=1 swaps the network for the in-memory mock in ./mock.
 */
import type {
  ApproveBody,
  ArtifactEnvelope,
  BenchmarkReport,
  Correction,
  ErrorBody,
  ExtractionEval,
  GraphStructure,
  Health,
  OrderPreview,
  PolicyResult,
  ReferralPatch,
  ReferralRecord,
  ReferralStatus,
  ReferralSummary,
  RejectBody,
  RetrievalCompare,
  RisOrderRow,
  TraceEvent,
} from "@/contracts";

export const IS_MOCK = import.meta.env.VITE_MOCK === "1";
const BASE = "/api";

export class ApiError extends Error {
  status: number;
  body: ErrorBody | null;
  constructor(status: number, message: string, body: ErrorBody | null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Loaded only in mock mode, so production bundles never carry the mock data.
let mockModule: Promise<typeof import("./mock")> | null = null;
const loadMock = () => (mockModule ??= import("./mock"));

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = IS_MOCK ? await (await loadMock()).mockFetch(path, init) : await fetch(BASE + path, init);
  const type = res.headers.get("content-type") ?? "";
  const payload = type.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const body = payload && typeof payload === "object" && "detail" in payload ? normalizeError(payload) : null;
    throw new ApiError(res.status, body?.detail ?? `${res.status} ${res.statusText}`, body);
  }
  return payload as T;
}

function normalizeError(raw: Record<string, unknown>): ErrorBody {
  const detail = typeof raw.detail === "string" ? raw.detail : JSON.stringify(raw.detail);
  return {
    detail,
    errors: Array.isArray(raw.errors) ? (raw.errors as ErrorBody["errors"]) : [],
    status: (raw.status as ReferralStatus | undefined) ?? null,
    flags: Array.isArray(raw.flags) ? (raw.flags as ErrorBody["flags"]) : [],
  };
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return entries.length ? "?" + new URLSearchParams(entries as [string, string][]).toString() : "";
};

export const api = {
  health: () => request<Health>("/health"),

  listReferrals: (filters: { status?: ReferralStatus; payor?: string } = {}) =>
    request<ReferralSummary[]>("/referrals" + qs(filters)),
  getReferral: (id: string) => request<ReferralRecord>(`/referrals/${id}`),

  /** 202 + record in `processing`; poll getReferral/getTrace until it settles. */
  upload: (file: File, opts: { paceS?: number } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.paceS !== undefined) form.append("pace_s", String(opts.paceS));
    return request<ReferralRecord>("/referrals", { method: "POST", body: form });
  },

  patch: (id: string, body: ReferralPatch) => request<ReferralRecord>(`/referrals/${id}`, json("PATCH", body)),
  approve: (id: string, body: ApproveBody = {}) => request<ReferralRecord>(`/referrals/${id}/approve`, json("POST", body)),
  reject: (id: string, body: RejectBody) => request<ReferralRecord>(`/referrals/${id}/reject`, json("POST", body)),
  retrySend: (id: string) => request<ReferralRecord>(`/referrals/${id}/retry-send`, json("POST", {})),

  trace: (id: string) => request<TraceEvent[]>(`/referrals/${id}/trace`),
  policy: (id: string) => request<PolicyResult>(`/referrals/${id}/policy`),
  orderPreview: (id: string) => request<OrderPreview>(`/referrals/${id}/order`),
  retrievalCompare: (id: string, k = 5) => request<RetrievalCompare>(`/referrals/${id}/retrieval-compare?k=${k}`),
  corrections: (id: string) => request<Correction[]>(`/referrals/${id}/corrections`),
  allCorrections: () => request<Correction[]>("/corrections"),

  graphStructure: () => request<GraphStructure>("/graph/structure"),
  orders: () => request<RisOrderRow[]>("/orders"),

  benchmark: () => request<ArtifactEnvelope<BenchmarkReport>>("/evals/benchmark"),
  extractionEval: () => request<ArtifactEnvelope<ExtractionEval>>("/evals/extraction"),
};

/** URLs handed straight to react-pdf (it fetches them itself). */
const mockPdf = (id: string) => `/mock/${id.startsWith("u") ? "upload" : id}.pdf`;
export const faxUrl = (id: string) => (IS_MOCK ? mockPdf(id) : `${BASE}/referrals/${id}/fax.pdf`);
export const packetUrl = (id: string) => (IS_MOCK ? mockPdf(id) : `${BASE}/referrals/${id}/packet`);
