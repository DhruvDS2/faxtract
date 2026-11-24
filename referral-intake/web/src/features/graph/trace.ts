/**
 * Turns a referral's trace (TraceEvent[] from GET /referrals/{id}/trace) into
 * what the graph shows: per-node state, every execution of each node, and the
 * edges actually traversed. Nothing here knows node names: it works from the
 * structure the API returns.
 */
import type { GraphEdge, GraphStructure, ReferralStatus, TraceEvent, TraceStatus } from "@/contracts";
import { isSettling } from "@/api/queries";
import type { StatusTone } from "@/lib/status";

/** The frozen `data-state` values (docs/CONTRACTS.md §15). */
export type NodeState = "done" | "running" | "paused" | "skipped" | "error" | "idle";

/** Plain words and the status tone for each state (the tone drives a StatusDot). */
export const NODE_STATE: Record<NodeState, { label: string; tone: StatusTone }> = {
  done: { label: "Done", tone: "ok" },
  running: { label: "Running", tone: "idle" },
  paused: { label: "Paused", tone: "warn" },
  error: { label: "Failed", tone: "bad" },
  skipped: { label: "Not reached", tone: "rejected" },
  idle: { label: "Not run yet", tone: "idle" },
};

/** One attempt's outcome, in plain words. */
export const TRACE_LABEL: Record<TraceStatus, { label: string; tone: StatusTone }> = {
  running: { label: "Running", tone: "idle" },
  ok: { label: "Done", tone: "ok" },
  error: { label: "Failed", tone: "bad" },
  interrupted: { label: "Paused", tone: "warn" },
  skipped: { label: "Skipped", tone: "rejected" },
};

/** One run of one node: its `running` event plus the event that closed it. */
export type Execution = {
  key: string;
  node: string;
  runId: string;
  runIndex: number; // 1-based, in order of first appearance
  attempt: number;
  open: TraceEvent | null;
  close: TraceEvent | null;
  seq: number; // first seq, for ordering
  status: TraceStatus; // close?.status ?? "running"
};

export const edgeKey = (e: Pick<GraphEdge, "source" | "target">) => `${e.source}->${e.target}`;

export { isSettling };

export function executions(events: TraceEvent[]): Execution[] {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const runs = new Map<string, number>();
  const list: Execution[] = [];
  const openByKey = new Map<string, Execution>();
  for (const ev of sorted) {
    if (!runs.has(ev.run_id)) runs.set(ev.run_id, runs.size + 1);
    const k = `${ev.run_id}|${ev.node}`;
    if (ev.status === "running") {
      const ex: Execution = {
        key: `${ev.seq}`, node: ev.node, runId: ev.run_id, runIndex: runs.get(ev.run_id)!,
        attempt: ev.attempt, open: ev, close: null, seq: ev.seq, status: "running",
      };
      list.push(ex);
      openByKey.set(k, ex);
      continue;
    }
    const pending = openByKey.get(k);
    if (pending) {
      pending.close = ev;
      pending.status = ev.status;
      pending.attempt = ev.attempt;
      openByKey.delete(k);
    } else {
      list.push({
        key: `${ev.seq}`, node: ev.node, runId: ev.run_id, runIndex: runs.get(ev.run_id)!,
        attempt: ev.attempt, open: null, close: ev, seq: ev.seq, status: ev.status,
      });
    }
  }
  return list;
}

export type GraphRun = {
  states: Map<string, NodeState>;
  byNode: Map<string, Execution[]>;
  /** Traversed edges (edgeKey) mapped to the step at which they were first taken. */
  taken: Map<string, number>;
  executions: Execution[];
  runCount: number;
  live: boolean;
  /** The interrupted execution the graph is waiting on, if it is paused. */
  pausedAt: Execution | null;
};

const STATE_OF: Record<TraceStatus, NodeState> = {
  running: "running",
  ok: "done",
  error: "error",
  interrupted: "paused",
  skipped: "skipped",
};

export function deriveRun(
  structure: GraphStructure,
  events: TraceEvent[] | undefined,
  status: ReferralStatus | undefined,
): GraphRun {
  const ex = executions(events ?? []);
  const byNode = new Map<string, Execution[]>();
  for (const e of ex) byNode.set(e.node, [...(byNode.get(e.node) ?? []), e]);
  const anyRunning = ex.some((e) => e.status === "running");
  const live = isSettling(status) || anyRunning;

  const out = new Map<string, GraphEdge[]>();
  for (const e of structure.edges) out.set(e.source, [...(out.get(e.source) ?? []), e]);
  const startIds = structure.nodes.filter((n) => n.kind === "start").map((n) => n.id);
  const endIds = new Set(structure.nodes.filter((n) => n.kind === "end").map((n) => n.id));

  // ---- path taken, in order across runs ----
  const taken = new Map<string, number>();
  const take = (e: GraphEdge | undefined) => {
    if (e && !taken.has(edgeKey(e))) taken.set(edgeKey(e), taken.size + 1);
  };
  const edgeBetween = (a: string, b: string) => out.get(a)?.find((e) => e.target === b);
  const first = ex[0];
  if (first) for (const s of startIds) take(edgeBetween(s, first.node));
  for (let i = 0; i < ex.length; i++) {
    const cur = ex[i];
    const prev = ex[i - 1];
    if (prev && prev.node !== cur.node) take(edgeBetween(prev.node, cur.node));
    // A routing node names the branch it chose: a node id or an edge label.
    const branch = cur.close?.branch;
    if (branch) {
      const outs = out.get(cur.node) ?? [];
      take(outs.find((e) => e.target === branch) ?? outs.find((e) => e.label === branch));
    }
  }
  const last = ex.at(-1);
  const reachedEnd = !!last && !live && last.status === "ok";
  if (reachedEnd) for (const e of out.get(last.node) ?? []) if (endIds.has(e.target)) take(e);

  // ---- node states: the latest execution of each node decides ----
  const states = new Map<string, NodeState>();
  const hasRun = ex.length > 0;
  for (const n of structure.nodes) {
    if (!hasRun) {
      states.set(n.id, status ? (live ? "idle" : "skipped") : "idle");
      continue;
    }
    if (n.kind === "start") {
      states.set(n.id, "done");
      continue;
    }
    if (n.kind === "end") {
      const reached = [...taken.keys()].some((k) => k.endsWith(`->${n.id}`));
      states.set(n.id, reached ? "done" : live ? "idle" : "skipped");
      continue;
    }
    const latest = byNode.get(n.id)?.at(-1);
    if (!latest) {
      states.set(n.id, live ? "idle" : "skipped");
      continue;
    }
    // A node left "running" on a referral that has failed is where it broke.
    if (latest.status === "running" && status === "failed") states.set(n.id, "error");
    else states.set(n.id, STATE_OF[latest.status]);
  }

  const pausedAt = last && last.status === "interrupted" ? last : null;
  return { states, byNode, taken, executions: ex, runCount: new Set(ex.map((e) => e.runId)).size, live, pausedAt };
}

// ---------- state diff ----------

export type DiffEntry = {
  key: string;
  kind: "added" | "changed" | "removed";
  before: unknown;
  after: unknown;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** For each key the node wrote (`delta`), before = state_in[key], after = delta[key]. Unchanged keys are split out. */
export function stateDiff(stateIn: Record<string, unknown> | null, delta: Record<string, unknown> | null) {
  const changed: DiffEntry[] = [];
  const unchanged: string[] = [];
  for (const [key, after] of Object.entries(delta ?? {})) {
    const has = !!stateIn && Object.prototype.hasOwnProperty.call(stateIn, key);
    const before = has ? stateIn![key] : undefined;
    if (has && sameJson(before, after)) unchanged.push(key);
    else changed.push({ key, before, after, kind: !has || before == null ? "added" : after == null ? "removed" : "changed" });
  }
  return { changed, unchanged };
}

/** When both sides are objects: the sub-keys the node actually changed, and how many it left alone. */
export function subDiff(before: unknown, after: unknown) {
  if (!isPlainObject(before) || !isPlainObject(after)) return null;
  const rows: DiffEntry[] = [];
  let same = 0;
  for (const [k, v] of Object.entries(after)) {
    const has = Object.prototype.hasOwnProperty.call(before, k);
    if (has && sameJson(before[k], v)) same++;
    else rows.push({ key: k, before: has ? before[k] : undefined, after: v, kind: !has ? "added" : "changed" });
  }
  return { rows, same };
}

// ---------- reveal order and per-step totals ----------

/**
 * The order steps first ran in (the path taken), with the start first and the end
 * last when reached. The Decimals reveal lights them in this order.
 */
export function revealSequence(structure: GraphStructure, run: GraphRun): string[] {
  const seq: string[] = [];
  const add = (id: string) => {
    if (!seq.includes(id)) seq.push(id);
  };
  if (run.executions.length) for (const n of structure.nodes) if (n.kind === "start" && run.states.get(n.id) === "done") add(n.id);
  for (const ex of run.executions) add(ex.node);
  for (const n of structure.nodes) if (n.kind === "end" && run.states.get(n.id) === "done") add(n.id);
  return seq;
}

export type StepTotals = { ms: number; cost: number; tokensIn: number; tokensOut: number; attempts: number };

export function stepTotals(execs: Execution[]): StepTotals {
  const closed = execs.filter((e) => e.close);
  return {
    ms: closed.reduce((s, e) => s + e.close!.duration_ms, 0),
    cost: closed.reduce((s, e) => s + e.close!.cost_usd, 0),
    tokensIn: closed.reduce((s, e) => s + e.close!.tokens_in, 0),
    tokensOut: closed.reduce((s, e) => s + e.close!.tokens_out, 0),
    attempts: execs.length,
  };
}

/** Milliseconds a running execution has been going (server clock, clamped at 0). */
export const elapsedMs = (ex: Execution, now = Date.now()) =>
  Math.max(0, now - new Date((ex.open ?? ex.close)!.started_at).getTime());
