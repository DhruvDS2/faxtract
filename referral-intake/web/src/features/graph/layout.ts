/**
 * Left-to-right flow-map layout (n8n-like) for whatever GET /graph/structure
 * returns. Nothing here knows node names: it works from the structure alone.
 *
 * 1. Cycles are broken by a DFS from the start node(s): an edge into a node on
 *    the DFS stack is a back edge (the edit loop, the RIS retry). Ranks are the
 *    longest path over what is left.
 * 2. The spine is the longest start → end path, counted in real steps. A
 *    "satellite" (a node that only loops straight back to its parent, like a
 *    retry wait) never sits on it, and ties go to the path more routes run
 *    through (start→v paths × v→end paths). The spine is one row.
 * 3. Every other step goes in a row below the spine, as close as it can get to
 *    the mean x of the steps it connects to (half-column grid; the first row
 *    with room wins).
 * 4. Routing is orthogonal:
 *    - neighbours on the spine: a straight line;
 *    - other spine-to-spine edges (bypasses, loops back): arcs above the spine,
 *      packed into lanes (shorter spans lower);
 *    - edges to a lower row: down from the bottom, across in the gap above the
 *      target row, down into its top (straight when they line up);
 *    - neighbours in a row: side to side;
 *    - edges into an end that is not the spine's own end: a short stub with a
 *      terminal mark, so no line has to cross the map to reach one "end" node.
 *    Ports are spread along each side and ordered so nested arcs never cross
 *    at the node they share.
 */

export type Pt = { x: number; y: number };
export type Size = { width: number; height: number };
export type NodeKind = "start" | "end" | "node";
export type LayoutNodeIn = { id: string; kind: NodeKind } & Size;
/** `labelWidth`: room the edge's label needs (0 = no label). */
export type LayoutEdgeIn = { id: string; source: string; target: string; labelWidth: number };

export type RouteKind = "spine" | "arc" | "branch" | "stub";
export type Route = {
  kind: RouteKind;
  /** Orthogonal polyline in flow coordinates: the source port first, the target port (arrow tip) last. */
  points: Pt[];
  /** Unit direction at the tip. */
  dir: Pt;
  /** The centre of the label, or null when the edge has no label or no room for one. */
  label: Pt | null;
  /** A stub ends in a terminal mark (at its last point) instead of an arrow. */
  terminal: boolean;
};

export type Bounds = { x: number; y: number; width: number; height: number };

export type FlowLayout = {
  /** Top-left corners (React Flow's `position`) of every drawn node. */
  positions: Map<string, Pt>;
  /** Spine node ids, left to right. */
  spine: string[];
  /** 0 = the spine, 1… = rows below it. */
  rows: Map<string, number>;
  /** Terminals that aren't drawn: their edges are drawn as stubs. */
  hidden: Set<string>;
  routes: Map<string, Route>;
  bounds: Bounds;
};

export type FlowOptions = {
  /** Horizontal gap between steps. */
  gap?: number;
  /** Gap between a terminal mark and the first / last step. */
  terminalGap?: number;
  /** Vertical gap between rows. */
  rowGap?: number;
  /** Vertical distance between arc lanes above the spine. */
  laneGap?: number;
  /** Distance between ports on the top / bottom of a node. */
  port?: number;
  /** Length of a stub to a terminal. */
  stub?: number;
  /** Height reserved for an edge label. */
  labelHeight?: number;
};

type Side = "top" | "bottom" | "left" | "right";
type Attach = { edge: string; side: Side; key: number; tie: number };

const EMPTY: FlowLayout = {
  positions: new Map(),
  spine: [],
  rows: new Map(),
  hidden: new Set(),
  routes: new Map(),
  bounds: { x: 0, y: 0, width: 0, height: 0 },
};

export function flowLayout(nodesIn: LayoutNodeIn[], edgesIn: LayoutEdgeIn[], opts: FlowOptions = {}): FlowLayout {
  const GAP = opts.gap ?? 16;
  const TGAP = opts.terminalGap ?? 16;
  const ROW_GAP = opts.rowGap ?? 56;
  const LANE = opts.laneGap ?? 20;
  const PORT = opts.port ?? 12;
  const STUB = opts.stub ?? 24;
  const LABEL_H = opts.labelHeight ?? 16;
  if (nodesIn.length === 0) return EMPTY;

  const byId = new Map(nodesIn.map((n) => [n.id, n]));
  const order = new Map(nodesIn.map((n, i) => [n.id, i]));
  const edges = edgesIn.filter((e) => byId.has(e.source) && byId.has(e.target));
  const edgeIndex = new Map(edges.map((e, i) => [e.id, i]));
  const kind = (id: string) => byId.get(id)!.kind;

  const out = new Map<string, LayoutEdgeIn[]>(nodesIn.map((n) => [n.id, []]));
  for (const e of edges) out.get(e.source)!.push(e);

  // ---- 1. back edges (DFS from the starts, then sources, then anything left) ----
  const indeg = new Map(nodesIn.map((n) => [n.id, 0]));
  for (const e of edges) if (e.source !== e.target) indeg.set(e.target, indeg.get(e.target)! + 1);
  const starts = nodesIn.filter((n) => n.kind === "start").map((n) => n.id);
  const sources = nodesIn.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const back = new Set<string>();
  const self = new Set<string>();
  const seen = new Map<string, 1 | 2>();
  const dfs = (u: string) => {
    seen.set(u, 1);
    for (const e of out.get(u)!) {
      if (e.source === e.target) self.add(e.id);
      else if (seen.get(e.target) === 1) back.add(e.id);
      else if (!seen.has(e.target)) dfs(e.target);
    }
    seen.set(u, 2);
  };
  for (const r of [...starts, ...sources, ...nodesIn.map((n) => n.id)]) if (!seen.has(r)) dfs(r);

  const dag = edges.filter((e) => !back.has(e.id) && !self.has(e.id));
  const succ = new Map<string, string[]>(nodesIn.map((n) => [n.id, []]));
  const pred = new Map<string, string[]>(nodesIn.map((n) => [n.id, []]));
  for (const e of dag) {
    succ.get(e.source)!.push(e.target);
    pred.get(e.target)!.push(e.source);
  }

  // ---- 2. topological order and ranks (longest path) ----
  const topo: string[] = [];
  const rank = new Map<string, number>();
  const remaining = new Map(nodesIn.map((n) => [n.id, pred.get(n.id)!.length]));
  const queue = nodesIn.filter((n) => remaining.get(n.id) === 0).map((n) => n.id);
  while (queue.length) {
    const u = queue.shift()!;
    topo.push(u);
    rank.set(u, Math.max(0, ...pred.get(u)!.map((p) => rank.get(p)! + 1)));
    for (const v of succ.get(u)!) {
      remaining.set(v, remaining.get(v)! - 1);
      if (remaining.get(v) === 0) queue.push(v);
    }
  }

  // ---- 3. how many start→end routes run through each node ----
  const ends = nodesIn.filter((n) => n.kind === "end").map((n) => n.id);
  const sinks = nodesIn.filter((n) => succ.get(n.id)!.length === 0).map((n) => n.id);
  const begin = starts.length ? starts : sources.length ? sources : [nodesIn[0].id];
  const finish = ends.length ? ends : sinks;
  const fromStart = new Map<string, number>(nodesIn.map((n) => [n.id, 0]));
  for (const s of begin) fromStart.set(s, 1);
  for (const u of topo) for (const v of succ.get(u)!) fromStart.set(v, fromStart.get(v)! + fromStart.get(u)!);
  const toEnd = new Map<string, number>(nodesIn.map((n) => [n.id, 0]));
  for (const t of finish) toEnd.set(t, 1);
  for (const u of [...topo].reverse()) for (const v of succ.get(u)!) toEnd.set(u, toEnd.get(u)! + toEnd.get(v)!);
  const through = (id: string) => fromStart.get(id)! * toEnd.get(id)!;

  // A satellite loops straight back to the node that feeds it (order → ris_wait → order).
  const satellite = new Set<string>();
  for (const e of edges)
    if (back.has(e.id) && dag.some((d) => d.source === e.target && d.target === e.source)) satellite.add(e.source);

  // ---- 4. the spine: the longest start → end path in real steps ----
  type Best = { count: number; weight: number; prev: string | null };
  const better = (a: Best, b: Best | undefined) => !b || a.count > b.count || (a.count === b.count && a.weight > b.weight);
  let best = new Map<string, Best>();
  const search = (allowSatellites: boolean) => {
    best = new Map(begin.map((s) => [s, { count: kind(s) === "node" ? 1 : 0, weight: through(s), prev: null }]));
    for (const u of topo) {
      const bu = best.get(u);
      if (!bu || (kind(u) === "end" && ends.length)) continue;
      for (const v of succ.get(u)!) {
        if (kind(v) === "start" || (!allowSatellites && satellite.has(v))) continue;
        const cand = { count: bu.count + (kind(v) === "node" ? 1 : 0), weight: bu.weight + through(v), prev: u };
        if (better(cand, best.get(v))) best.set(v, cand);
      }
    }
    let pick: string | null = null;
    for (const t of finish) if (best.has(t) && (pick === null || better(best.get(t)!, best.get(pick)!))) pick = t;
    return pick;
  };
  let last = search(false) ?? search(true);
  if (!last) for (const [id, b] of best) if (!last || better(b, best.get(last)!)) last = id;
  const spine: string[] = [];
  for (let c: string | null = last; c; c = best.get(c)?.prev ?? null) spine.unshift(c);
  const spineSet = new Set(spine);
  const spineIndex = new Map(spine.map((id, i) => [id, i]));

  // ---- 5. place the spine ----
  const positions = new Map<string, Pt>();
  const rows = new Map<string, number>();
  const real = nodesIn.filter((n) => n.kind === "node");
  const W = Math.max(0, ...real.map((n) => n.width));
  const H = Math.max(0, ...real.map((n) => n.height));
  const pitch = W + GAP;
  const spineH = Math.max(H, ...spine.map((id) => byId.get(id)!.height));
  const midY = spineH / 2;
  let x = 0;
  spine.forEach((id, i) => {
    const n = byId.get(id)!;
    if (i > 0) x += n.kind === "node" && kind(spine[i - 1]) === "node" ? GAP : TGAP;
    positions.set(id, { x, y: midY - n.height / 2 });
    rows.set(id, 0);
    x += n.width;
  });
  const cx = (id: string) => positions.get(id)!.x + byId.get(id)!.width / 2;
  const cy = (id: string) => positions.get(id)!.y + byId.get(id)!.height / 2;
  const top = (id: string) => positions.get(id)!.y;
  const bottom = (id: string) => positions.get(id)!.y + byId.get(id)!.height;

  // ---- 6. everything else: rows below, near what it connects to ----
  const hidden = new Set(nodesIn.filter((n) => n.kind !== "node" && !spineSet.has(n.id)).map((n) => n.id));
  const firstReal = spine.find((id) => kind(id) === "node");
  const origin = firstReal ? cx(firstReal) : W / 2;
  const half = pitch / 2;
  const snap = (v: number) => origin + Math.round((v - origin) / half) * half;
  const rankX = (id: string) => {
    const r = rank.get(id) ?? 0;
    let anchor: string | undefined;
    for (const s of spine) if (kind(s) === "node" && (rank.get(s) ?? 0) <= r) anchor = s;
    return anchor ? cx(anchor) + (r - (rank.get(anchor) ?? 0)) * pitch : origin;
  };
  const rowTop = (r: number) => spineH + ROW_GAP + (r - 1) * (H + ROW_GAP);
  const occupied = new Map<number, number[]>();
  const rest = real
    .filter((n) => !spineSet.has(n.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || order.get(a.id)! - order.get(b.id)!);
  for (const n of rest) {
    const placedNeighbours = edges
      .filter((e) => e.source !== e.target && (e.source === n.id || e.target === n.id))
      .map((e) => (e.source === n.id ? e.target : e.source))
      .filter((o) => positions.has(o) && kind(o) === "node");
    const ideal = snap(
      placedNeighbours.length ? placedNeighbours.reduce((s, o) => s + cx(o), 0) / placedNeighbours.length : rankX(n.id),
    );
    for (let r = 1; r < 64; r++) {
      const taken = occupied.get(r) ?? [];
      const c = [0, -0.5, 0.5, -1, 1].map((d) => ideal + d * pitch).find((v) => taken.every((t) => Math.abs(t - v) >= pitch - 0.5));
      if (c === undefined) continue;
      occupied.set(r, [...taken, c]);
      positions.set(n.id, { x: c - n.width / 2, y: rowTop(r) + (H - n.height) / 2 });
      rows.set(n.id, r);
      break;
    }
  }

  // ---- 7. classify edges and collect ports ----
  type Plan =
    | { kind: "spine" | "arc"; s: Side; t: Side; lane?: number }
    | { kind: "branch"; s: Side; t: Side; mode: "vertical" | "side" | "around" }
    | { kind: "stub"; at: string; s: Side; inward: boolean };
  const plans = new Map<string, Plan>();
  const attach = new Map<string, Attach[]>(); // `${node}|${side}`
  const add = (node: string, a: Attach) => {
    const k = `${node}|${a.side}`;
    attach.set(k, [...(attach.get(k) ?? []), a]);
  };
  const isSpineEnd = (e: LayoutEdgeIn) =>
    spineSet.has(e.source) && spineSet.has(e.target) && spineIndex.get(e.target)! - spineIndex.get(e.source)! === 1;

  const arcs: LayoutEdgeIn[] = [];
  for (const e of edges) {
    const terminalTarget = kind(e.target) !== "node" && !(isSpineEnd(e) && kind(e.target) === "end");
    const terminalSource = kind(e.source) !== "node" && !(isSpineEnd(e) && kind(e.source) === "start");
    if (hidden.has(e.target) || (terminalTarget && kind(e.target) === "end")) {
      if (!positions.has(e.source)) continue;
      plans.set(e.id, { kind: "stub", at: e.source, s: "bottom", inward: false });
      // Stubs take the leftmost bottom ports, so their labels have the left side to themselves.
      add(e.source, { edge: e.id, side: "bottom", key: -1e6, tie: edgeIndex.get(e.id)! });
      continue;
    }
    if (hidden.has(e.source) || terminalSource) {
      if (!positions.has(e.target)) continue;
      plans.set(e.id, { kind: "stub", at: e.target, s: "bottom", inward: true });
      add(e.target, { edge: e.id, side: "bottom", key: -1e6, tie: edgeIndex.get(e.id)! });
      continue;
    }
    if (!positions.has(e.source) || !positions.has(e.target)) continue;
    const rs = rows.get(e.source)!;
    const rt = rows.get(e.target)!;
    if (rs === 0 && rt === 0) {
      if (isSpineEnd(e)) {
        plans.set(e.id, { kind: "spine", s: "right", t: "left" });
        add(e.source, { edge: e.id, side: "right", key: 0, tie: edgeIndex.get(e.id)! });
        add(e.target, { edge: e.id, side: "left", key: 0, tie: edgeIndex.get(e.id)! });
      } else arcs.push(e);
      continue;
    }
    if (rs !== rt) {
      const down = rs < rt;
      plans.set(e.id, { kind: "branch", s: down ? "bottom" : "top", t: down ? "top" : "bottom", mode: "vertical" });
      add(e.source, { edge: e.id, side: down ? "bottom" : "top", key: cx(e.target), tie: edgeIndex.get(e.id)! });
      add(e.target, { edge: e.id, side: down ? "top" : "bottom", key: cx(e.source), tie: edgeIndex.get(e.id)! });
      continue;
    }
    // same row below the spine
    const [a, b] = [cx(e.source), cx(e.target)].sort((p, q) => p - q);
    const between = (occupied.get(rs) ?? []).some((c) => c > a + 0.5 && c < b - 0.5);
    if (!between && e.source !== e.target) {
      const right = cx(e.target) > cx(e.source);
      plans.set(e.id, { kind: "branch", s: right ? "right" : "left", t: right ? "left" : "right", mode: "side" });
      add(e.source, { edge: e.id, side: right ? "right" : "left", key: cy(e.target), tie: edgeIndex.get(e.id)! });
      add(e.target, { edge: e.id, side: right ? "left" : "right", key: cy(e.source), tie: edgeIndex.get(e.id)! });
    } else {
      plans.set(e.id, { kind: "branch", s: "bottom", t: "bottom", mode: "around" });
      add(e.source, { edge: e.id, side: "bottom", key: cx(e.target), tie: edgeIndex.get(e.id)! });
      add(e.target, { edge: e.id, side: "bottom", key: cx(e.source), tie: edgeIndex.get(e.id)! });
    }
  }

  // Arcs between spine steps. A loop back (a back edge) runs in the one lane below the spine
  // when nothing hangs from the steps it passes under; everything else (bypasses, crowded
  // loops) runs above, shortest spans in the lowest lanes.
  const span = (e: LayoutEdgeIn) => {
    const [i, j] = [spineIndex.get(e.source)!, spineIndex.get(e.target)!].sort((p, q) => p - q);
    return [i, Math.max(j, i + 1)] as const;
  };
  const hangs = new Set([...attach.keys()].filter((k) => k.endsWith("|bottom")).map((k) => k.split("|")[0]));
  const laneOf = new Map<string, number>(); // > 0 above, < 0 below
  const placedArcs: { lo: number; hi: number; lane: number }[] = [];
  const free = (lo: number, hi: number, lane: number) => !placedArcs.some((p) => p.lane === lane && lo < p.hi && p.lo < hi);
  for (const e of [...arcs].sort((p, q) => span(p)[1] - span(p)[0] - (span(q)[1] - span(q)[0]) || span(p)[0] - span(q)[0])) {
    const [lo, hi] = span(e);
    const clearBelow = spine.slice(lo + 1, hi).every((id) => !hangs.has(id));
    let lane = back.has(e.id) && clearBelow && free(lo, hi, -1) ? -1 : 1;
    while (lane > 0 && !free(lo, hi, lane)) lane++;
    placedArcs.push({ lo, hi, lane });
    laneOf.set(e.id, lane);
    const side: Side = lane > 0 ? "top" : "bottom";
    plans.set(e.id, { kind: "arc", s: side, t: side, lane });
    if (side === "bottom") {
      add(e.source, { edge: e.id, side, key: cx(e.target), tie: edgeIndex.get(e.id)! });
      add(e.target, { edge: e.id, side, key: cx(e.source), tie: edgeIndex.get(e.id)! + 0.5 });
      continue;
    }
    // Port order on top, left to right: arcs heading left (lowest lane first), then arcs heading right (highest lane first).
    const dirS = Math.sign(cx(e.target) - cx(e.source)) || 1;
    add(e.source, { edge: e.id, side, key: dirS < 0 ? lane : 1000 - lane, tie: edgeIndex.get(e.id)! });
    const dirT = Math.sign(cx(e.source) - cx(e.target)) || -1;
    add(e.target, { edge: e.id, side, key: dirT < 0 ? lane : 1000 - lane, tie: edgeIndex.get(e.id)! + 0.5 });
  }

  // ---- 8. ports ----
  const port = new Map<string, Pt>(); // `${edge}|s` / `${edge}|t`
  for (const [k, list] of attach) {
    const [node, side] = k.split("|") as [string, Side];
    list.sort((p, q) => p.key - q.key || p.tie - q.tie);
    list.forEach((a, i) => {
      const off = (i - (list.length - 1) / 2) * (side === "top" || side === "bottom" ? PORT : PORT / 1.5);
      const p =
        side === "top"
          ? { x: cx(node) + off, y: top(node) }
          : side === "bottom"
            ? { x: cx(node) + off, y: bottom(node) }
            : side === "left"
              ? { x: positions.get(node)!.x, y: cy(node) + off }
              : { x: positions.get(node)!.x + byId.get(node)!.width, y: cy(node) + off };
      // An edge can attach to the same node twice (a self loop): source first, then target.
      const end = port.has(`${a.edge}|s`) || !isSourceSide(a.edge, node, side) ? "t" : "s";
      port.set(`${a.edge}|${end}`, p);
    });
  }
  // A vertical branch whose ends got different offsets would jog by a few px: the end that
  // has its side to itself moves in line with the other (if it stays on the node).
  for (const e of edges) {
    const plan = plans.get(e.id);
    if (plan?.kind !== "branch" || plan.mode !== "vertical") continue;
    const s = port.get(`${e.id}|s`)!;
    const t = port.get(`${e.id}|t`)!;
    if (Math.abs(s.x - t.x) < 0.5) continue;
    const alone = (node: string, side: Side) => (attach.get(`${node}|${side}`)?.length ?? 0) === 1;
    const fits = (node: string, x: number) => Math.abs(x - cx(node)) <= byId.get(node)!.width / 2 - 8;
    if (alone(e.target, plan.t) && fits(e.target, s.x)) port.set(`${e.id}|t`, { x: s.x, y: t.y });
    else if (alone(e.source, plan.s) && fits(e.source, t.x)) port.set(`${e.id}|s`, { x: t.x, y: s.y });
  }
  function isSourceSide(edgeId: string, node: string, side: Side) {
    const e = edges[edgeIndex.get(edgeId)!];
    const plan = plans.get(edgeId)!;
    if (plan.kind === "stub") return !plan.inward;
    return e.source === node && plan.s === side;
  }

  // ---- 9. routes ----
  const spineTop = midY - H / 2;
  const routes = new Map<string, Route>();
  const labelAt = (w: number, room: number, at: Pt) => (w > 0 && room >= w + 8 ? at : null);
  for (const e of edges) {
    const plan = plans.get(e.id);
    if (!plan) continue;
    const w = e.labelWidth;
    if (plan.kind === "stub") {
      const p = port.get(`${e.id}|${plan.inward ? "t" : "s"}`)!;
      const q = { x: p.x, y: p.y + STUB };
      // Label to the right when nothing else hangs there, else to the left.
      const lean = (attach.get(`${plan.at}|bottom`)?.length ?? 1) > 1 ? -1 : 1;
      routes.set(e.id, {
        kind: "stub",
        points: plan.inward ? [q, p] : [p, q],
        dir: plan.inward ? { x: 0, y: -1 } : { x: 0, y: 1 },
        label: w > 0 ? { x: p.x + lean * (6 + w / 2), y: p.y + STUB / 2 } : null,
        terminal: !plan.inward,
      });
      continue;
    }
    const s = port.get(`${e.id}|s`)!;
    const t = port.get(`${e.id}|t`)!;
    if (plan.kind === "spine") {
      const mx = (s.x + t.x) / 2;
      routes.set(e.id, {
        kind: "spine",
        points: Math.abs(s.y - t.y) < 0.5 ? [s, t] : [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t],
        dir: { x: 1, y: 0 },
        label: labelAt(w, t.x - s.x, { x: mx, y: s.y - LABEL_H / 2 - 2 }),
        terminal: false,
      });
      continue;
    }
    if (plan.kind === "arc") {
      const lane = laneOf.get(e.id)!;
      const y = lane > 0 ? spineTop - LANE * lane : spineTop + H - LANE * lane;
      routes.set(e.id, {
        kind: "arc",
        points: [s, { x: s.x, y }, { x: t.x, y }, t],
        dir: { x: 0, y: lane > 0 ? 1 : -1 },
        label: labelAt(w, Math.abs(t.x - s.x), { x: (s.x + t.x) / 2, y }),
        terminal: false,
      });
      continue;
    }
    if (plan.kind !== "branch") continue;
    if (plan.mode === "side") {
      const mx = (s.x + t.x) / 2;
      routes.set(e.id, {
        kind: "branch",
        points: Math.abs(s.y - t.y) < 0.5 ? [s, t] : [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t],
        dir: { x: Math.sign(t.x - s.x), y: 0 },
        label: labelAt(w, Math.abs(t.x - s.x), { x: mx, y: s.y - LABEL_H / 2 - 2 }),
        terminal: false,
      });
      continue;
    }
    if (plan.mode === "around") {
      const y = Math.max(s.y, t.y) + ROW_GAP / 2;
      routes.set(e.id, {
        kind: "branch",
        points: [s, { x: s.x, y }, { x: t.x, y }, t],
        dir: { x: 0, y: -1 },
        label: labelAt(w, Math.abs(t.x - s.x), { x: (s.x + t.x) / 2, y }),
        terminal: false,
      });
      continue;
    }
    // vertical: down (or up) through the gap next to the target's row
    const down = t.y > s.y;
    const channel = down ? t.y - ROW_GAP / 2 : t.y + ROW_GAP / 2;
    const straight = Math.abs(s.x - t.x) < 0.5;
    const points = straight ? [s, t] : [s, { x: s.x, y: channel }, { x: t.x, y: channel }, t];
    // The label sits beside the longest vertical run, on the side its port leans to.
    const runTop = straight ? Math.min(s.y, t.y) : down ? s.y : channel;
    const runBottom = straight ? Math.max(s.y, t.y) : down ? channel : s.y;
    const lean = s.x < cx(e.source) - 0.5 ? -1 : 1;
    routes.set(e.id, {
      kind: "branch",
      points,
      dir: { x: 0, y: down ? 1 : -1 },
      label: w > 0 && runBottom - runTop >= LABEL_H ? { x: s.x + lean * (6 + w / 2), y: (runTop + runBottom) / 2 } : null,
      terminal: false,
    });
  }

  // Labels on a horizontal run slide along it, off any vertical line that crosses there.
  const verticals: { x: number; y0: number; y1: number; edge: string }[] = [];
  for (const [id, r] of routes)
    for (let i = 1; i < r.points.length; i++) {
      const [a, b] = [r.points[i - 1], r.points[i]];
      if (Math.abs(a.x - b.x) < 0.5) verticals.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), edge: id });
    }
  for (const [id, r] of routes) {
    if (!r.label || r.points.length !== 4 || Math.abs(r.points[1].y - r.points[2].y) > 0.5) continue;
    const y = r.points[1].y;
    if (Math.abs(r.label.y - y) > 0.5) continue; // this label sits beside a vertical run
    const w = edges[edgeIndex.get(id)!].labelWidth;
    const [x0, x1] = [r.points[1].x, r.points[2].x].sort((p, q) => p - q);
    const blocked = verticals.filter((v) => v.edge !== id && v.y0 < y + LABEL_H / 2 && v.y1 > y - LABEL_H / 2).map((v) => v.x);
    const clear = (c: number) => blocked.every((bx) => Math.abs(bx - c) > w / 2 + 4);
    const mid = (x0 + x1) / 2;
    const lo = x0 + w / 2 + 8;
    const hi = x1 - w / 2 - 8;
    let pick: number | null = clear(mid) ? mid : null;
    for (let d = 4; pick === null && d <= (x1 - x0) / 2; d += 4)
      pick = [mid - d, mid + d].find((c) => c >= lo && c <= hi && clear(c)) ?? null;
    r.label = { x: pick ?? mid, y };
  }

  // ---- 10. bounds: nodes, routes and labels ----
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const [id, p] of positions) grow(p.x, p.y, p.x + byId.get(id)!.width, p.y + byId.get(id)!.height);
  for (const [id, r] of routes) {
    for (const p of r.points) grow(p.x - 4, p.y - 4, p.x + 4, p.y + 4);
    const w = edges[edgeIndex.get(id)!].labelWidth;
    if (r.label) grow(r.label.x - w / 2, r.label.y - LABEL_H / 2, r.label.x + w / 2, r.label.y + LABEL_H / 2);
  }
  if (!Number.isFinite(minX)) return { ...EMPTY, positions, spine, rows, hidden };

  return { positions, spine, rows, hidden, routes, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

/** An SVG path through orthogonal points with rounded corners (radius capped by the segments). */
export function roundedPath(points: Pt[], radius = 6): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const next = points[i + 1];
    if (!next) {
      d += ` L ${p.x} ${p.y}`;
      break;
    }
    const prev = points[i - 1];
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L ${p.x} ${p.y}`;
      continue;
    }
    const a = { x: p.x - ((p.x - prev.x) / inLen) * r, y: p.y - ((p.y - prev.y) / inLen) * r };
    const b = { x: p.x + ((next.x - p.x) / outLen) * r, y: p.y + ((next.y - p.y) / outLen) * r };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  return d;
}

/** A small filled arrowhead with its tip at `p`, pointing along `dir`. */
export function arrowPath(p: Pt, dir: Pt, length = 5, half = 3.5): string {
  const bx = p.x - dir.x * length;
  const by = p.y - dir.y * length;
  const px = -dir.y * half;
  const py = dir.x * half;
  return `M ${p.x} ${p.y} L ${bx + px} ${by + py} L ${bx - px} ${by - py} Z`;
}
