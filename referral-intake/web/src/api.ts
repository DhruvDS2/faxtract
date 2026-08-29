export type Flag = { field: string; severity: "error" | "warning"; message: string };

/** A region of a page, normalized 0-1. Maps straight onto CSS percentages. */
export type Box = { page: number; left: number; top: number; width: number; height: number };

export type Referral = {
  [key: string]: any;
  confidence: Record<string, number>;
  boxes?: Record<string, Box[]>;
};

export type Eligibility = {
  status: "active_in_network" | "active_out_of_network" | "terminated" | "not_found";
  payor_name?: string | null;
  plan_name?: string | null;
  deductible_remaining?: number | null;
  coinsurance_percent?: number | null;
  raw_271?: string | null;
};

export type AuthRequirement = {
  required: boolean;
  missing_elements: string[];
  submission_channel?: string | null;
  turnaround_days?: number | null;
};

export type Status = "needs_review" | "auto_approved" | "approved" | "rejected" | "sent_to_ris";

export type ProcessedReferral = {
  id: string;
  source_file: string;
  referral: Referral;
  flags: Flag[];
  eligibility: Eligibility | null;
  auth: AuthRequirement | null;
  status: Status;
  created_at?: string;
  stage_timings_ms?: Record<string, number>;
  token_usage?: Record<string, number>;
};

const base = "/api";

/** fetch + JSON, with a non-2xx turned into a thrown error the caller can toast. */
const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
};

export const listReferrals = () => request<ProcessedReferral[]>(`${base}/referrals`);
export const getReferral = (id: string) =>
  request<ProcessedReferral>(`${base}/referrals/${id}`);

export const correct = (id: string, updates: Record<string, unknown>) =>
  request<ProcessedReferral>(`${base}/referrals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

export const approve = (id: string) =>
  request<{ sent: boolean; referral: ProcessedReferral }>(
    `${base}/referrals/${id}/approve`,
    { method: "POST" },
  );
export const reject = (id: string) =>
  request<ProcessedReferral>(`${base}/referrals/${id}/reject`, { method: "POST" });

export const uploadReferral = (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return request<ProcessedReferral>(`${base}/referrals`, { method: "POST", body: fd });
};

export const pageUrl = (id: string, page: number) => `${base}/referrals/${id}/pages/${page}`;
export const pageCount = (id: string) =>
  request<{ count: number }>(`${base}/referrals/${id}/pagecount`);

export type Citation = { source: string; score: number; text: string };
export type PolicyResult = { required?: boolean; keywords: string[]; citations: Citation[] };
export const getPolicy = (id: string) =>
  request<PolicyResult>(`${base}/referrals/${id}/policy`);

export const packetUrl = (id: string) => `${base}/referrals/${id}/packet`;
export const getOrder = (id: string) =>
  request<{ message: string }>(`${base}/referrals/${id}/order`);

export type CorrectionRecord = {
  referral_id: string;
  field: string;
  original_value: string | null;
  corrected_value: string | null;
  original_confidence: number | null;
  corrected_at: string;
};
export const getCorrections = () => request<CorrectionRecord[]>(`${base}/corrections`);
