/**
 * TanStack Query hooks over ./client. ORCHESTRATOR-OWNED; feature lanes may add
 * hooks local to their feature folder, but reuse these keys so invalidation works.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApproveBody, ReferralPatch, ReferralRecord, ReferralStatus, RejectBody } from "@/contracts";
import { api } from "./client";

export const keys = {
  health: ["health"] as const,
  referrals: (filters?: object) => ["referrals", filters ?? {}] as const,
  referral: (id: string) => ["referral", id] as const,
  trace: (id: string) => ["trace", id] as const,
  policy: (id: string) => ["policy", id] as const,
  orderPreview: (id: string) => ["orderPreview", id] as const,
  compare: (id: string) => ["compare", id] as const,
  corrections: (id: string) => ["corrections", id] as const,
  graph: ["graphStructure"] as const,
  orders: ["orders"] as const,
  benchmark: ["benchmark"] as const,
  extraction: ["extractionEval"] as const,
};

const LIVE = 1000; // ms between polls while something is running

export const isSettling = (status: ReferralStatus | undefined) =>
  status === "processing" || status === "approved" || status === "auto_approved";

export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 10_000 });

export const useReferrals = (filters: { status?: ReferralStatus; payor?: string } = {}) =>
  useQuery({
    queryKey: keys.referrals(filters),
    queryFn: () => api.listReferrals(filters),
    refetchInterval: (q) => (q.state.data?.some((r) => isSettling(r.status)) ? LIVE : 15_000),
  });

/** Polls while the pipeline is still working on this referral. */
export const useReferral = (id: string | undefined) =>
  useQuery({
    queryKey: keys.referral(id ?? ""),
    queryFn: () => api.getReferral(id!),
    enabled: !!id,
    refetchInterval: (q) => (isSettling(q.state.data?.status) ? LIVE : false),
  });

export const useTrace = (id: string | undefined, opts: { live?: boolean } = {}) =>
  useQuery({
    queryKey: keys.trace(id ?? ""),
    queryFn: () => api.trace(id!),
    enabled: !!id,
    refetchInterval: opts.live ? LIVE : false,
  });

export const usePolicy = (id: string | undefined, enabled = true) =>
  useQuery({ queryKey: keys.policy(id ?? ""), queryFn: () => api.policy(id!), enabled: !!id && enabled });

export const useOrderPreview = (id: string | undefined) =>
  useQuery({ queryKey: keys.orderPreview(id ?? ""), queryFn: () => api.orderPreview(id!), enabled: !!id });

/** Off until asked for: runs both retrievers on the server. */
export const useRetrievalCompare = (id: string | undefined, enabled: boolean) =>
  useQuery({ queryKey: keys.compare(id ?? ""), queryFn: () => api.retrievalCompare(id!), enabled: !!id && enabled });

export const useCorrections = (id: string | undefined) =>
  useQuery({ queryKey: keys.corrections(id ?? ""), queryFn: () => api.corrections(id!), enabled: !!id });

export const useGraphStructure = () =>
  useQuery({ queryKey: keys.graph, queryFn: api.graphStructure, staleTime: Infinity });

export const useOrders = () => useQuery({ queryKey: keys.orders, queryFn: api.orders, refetchInterval: 10_000 });

export const useBenchmark = () => useQuery({ queryKey: keys.benchmark, queryFn: api.benchmark, retry: false });
export const useExtractionEval = () => useQuery({ queryKey: keys.extraction, queryFn: api.extractionEval, retry: false });

// ---------- mutations: every one refreshes the record, the queue, the trace and the orders ----------

function useRefresh() {
  const qc = useQueryClient();
  return (record: ReferralRecord) => {
    qc.setQueryData(keys.referral(record.id), record);
    void qc.invalidateQueries({ queryKey: ["referrals"] });
    void qc.invalidateQueries({ queryKey: keys.trace(record.id) });
    void qc.invalidateQueries({ queryKey: keys.orderPreview(record.id) });
    void qc.invalidateQueries({ queryKey: keys.corrections(record.id) });
    void qc.invalidateQueries({ queryKey: keys.orders });
  };
}

export const useUpload = () => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (v: { file: File; paceS?: number }) => api.upload(v.file, { paceS: v.paceS }), onSuccess: refresh });
};

export const usePatch = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: ReferralPatch) => api.patch(id, body), onSuccess: refresh });
};

export const useApprove = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: ApproveBody = {}) => api.approve(id, body), onSuccess: refresh });
};

export const useReject = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: RejectBody) => api.reject(id, body), onSuccess: refresh });
};

export const useRetrySend = (id: string) => {
  const refresh = useRefresh();
  return useMutation({ mutationFn: () => api.retrySend(id), onSuccess: refresh });
};
