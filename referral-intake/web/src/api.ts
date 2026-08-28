export type Flag = { field: string; severity: "error" | "warning"; message: string };

/** A region of a page, normalized 0-1. Maps straight onto CSS percentages. */
export type Box = { page: number; left: number; top: number; width: number; height: number };

export type Referral = {
  [key: string]: any;
  confidence: Record<string, number>;
  boxes?: Record<string, Box[]>;
};

export type ProcessedReferral = {
  id: string;
  source_file: string;
  referral: Referral;
  flags: Flag[];
  eligibility: { status: string; plan_name?: string } | null;
  auth: { required: boolean; missing_elements: string[] } | null;
  status: string;
};

const base = "/api";

export const listReferrals = () => fetch(`${base}/referrals`).then((r) => r.json());
export const getReferral = (id: string) => fetch(`${base}/referrals/${id}`).then((r) => r.json());
export const correct = (id: string, updates: Record<string, unknown>) =>
  fetch(`${base}/referrals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }).then((r) => r.json());
export const approve = (id: string) =>
  fetch(`${base}/referrals/${id}/approve`, { method: "POST" }).then((r) => r.json());
export const reject = (id: string) =>
  fetch(`${base}/referrals/${id}/reject`, { method: "POST" }).then((r) => r.json());

export const uploadReferral = (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return fetch(`${base}/referrals`, { method: "POST", body: fd }).then((r) => r.json());
};

export const pageUrl = (id: string, page: number) => `${base}/referrals/${id}/pages/${page}`;
export const pageCount = (id: string) =>
  fetch(`${base}/referrals/${id}/pagecount`).then((r) => r.json());

export type Citation = { source: string; score: number; text: string };
export const getPolicy = (
  id: string
): Promise<{ required?: boolean; keywords: string[]; citations: Citation[] }> =>
  fetch(`${base}/referrals/${id}/policy`).then((r) => r.json());
export const packetUrl = (id: string) => `${base}/referrals/${id}/packet`;
export const getOrder = (id: string): Promise<{ message: string }> =>
  fetch(`${base}/referrals/${id}/order`).then((r) => r.json());
