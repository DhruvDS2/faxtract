/**
 * A small layered (Sugiyama-style) top-to-bottom layout for whatever graph
 * GET /graph/structure returns. No dagre/elk: ranks by longest path from the
 * root, ignoring back edges; dummy nodes for long edges; barycenter sweeps to
 * cut crossings; isotonic-regression x placement so chains stay straight.
 *
 * Works for any directed graph: cycles are broken by a DFS from the root
 * (edges into a node on the DFS stack are back edges), self loops are kept
 * aside, unreachable nodes get their own roots.
 */

export type XY = { x: number; y: number };

export type LayoutNodeInput = { id: string; width: number; height: number };
/** `labelWidth`: room a long edge's lane needs for its label chip (0 = no label). */
export type LayoutEdgeInput = { id: string; source: string; target: string; labelWidth?: number };

export type EdgeRoute =
  /** Downward edge. `points`: one waypoint per rank it crosses (the centre of its dummy lane). */
  | { kind: "forward"; points: XY[]; labelAt: XY | null }
  /** Upward edge drawn as a curve on one side of the layers it spans. */
  | { kind: "back"; side: "left" | "right"; bulgeX: number }
  | { kind: "self"; side: "right" };

export type Layout = {
  positions: Map<string, XY>; // top-left corner, as React Flow wants it
  ranks: Map<string, number>;
  routes: Map<string, EdgeRoute>;
  width: number;
  height: number;
};

export type LayoutOptions = {
  root?: string;
  rankGap?: number; // vertical gap between ranks
  nodeGap?: number; // horizontal gap between real nodes
  laneGap?: number; // horizontal gap next to a dummy lane
  backEdgeOffset?: number; // how far back edges bulge past the layers they span
  sweeps?: number;
};

type Item = { id: string; dummy: boolean; width: number; height: number; edge?: string };

export function layeredLayout(
  nodesIn: LayoutNodeInput[],
  edgesIn: LayoutEdgeInput[],
  opts: LayoutOptions = {},
): Layout {
  const rankGap = opts.rankGap ?? 36;
  const nodeGap = opts.nodeGap ?? 32;
  const laneGap = opts.laneGap ?? 20;
  const backOffset = opts.backEdgeOffset ?? 36;
  const sweeps = opts.sweeps ?? 12;
  if (nodesIn.length === 0) return { positions: new Map(), ranks: new Map(), routes: new Map(), width: 0, height: 0 };

  const nodeById = new Map(nodesIn.map((n) => [n.id, n]));
  const edges = edgesIn.filter((e) => nodeById.has(e.source) && nodeById.has(e.target));

  const out = new Map<string, LayoutEdgeInput[]>();
  for (const n of nodesIn) out.set(n.id, []);
  for (const e of edges) out.get(e.source)!.push(e);

  // ---- 1. break cycles: DFS from the root, then from any remaining source, then anything left ----
  const back = new Set<string>();
  const self = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>(); // 0 new, 1 on stack, 2 done
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const e of out.get(u)!) {
      if (e.source === e.target) {
        self.add(e.id);
        continue;
      }
      const s = state.get(e.target) ?? 0;
      if (s === 1) back.add(e.id);
      else if (s === 0) dfs(e.target);
    }
    state.set(u, 2);
  };
  const indeg = new Map(nodesIn.map((n) => [n.id, 0]));
  for (const e of edges) if (e.source !== e.target) indeg.set(e.target, indeg.get(e.target)! + 1);
  const roots = [
    ...(opts.root && nodeById.has(opts.root) ? [opts.root] : []),
    ...nodesIn.filter((n) => indeg.get(n.id) === 0).map((n) => n.id),
    ...nodesIn.map((n) => n.id),
  ];
  for (const r of roots) if (!state.get(r)) dfs(r);

  const dag = edges.filter((e) => !back.has(e.id) && !self.has(e.id));
  const preds = new Map<string, string[]>(nodesIn.map((n) => [n.id, []]));
  const succs = new Map<string, string[]>(nodesIn.map((n) => [n.id, []]));
  for (const e of dag) {
    succs.get(e.source)!.push(e.target);
    preds.get(e.target)!.push(e.source);
  }

  // ---- 2. ranks: longest path over the DAG (Kahn order) ----
  const rank = new Map<string, number>();
  const remaining = new Map(nodesIn.map((n) => [n.id, preds.get(n.id)!.length]));
  const queue = nodesIn.filter((n) => remaining.get(n.id) === 0).map((n) => n.id);
  const topo: string[] = [];
  while (queue.length) {
    const u = queue.shift()!;
    topo.push(u);
    rank.set(u, Math.max(0, ...preds.get(u)!.map((p) => rank.get(p)! + 1)));
    for (const v of succs.get(u)!) {
      remaining.set(v, remaining.get(v)! - 1);
      if (remaining.get(v) === 0) queue.push(v);
    }
  }
  // Sources other than the root sit just above their first successor, not up at rank 0.
  for (const u of [...topo].reverse()) {
    if (u === opts.root || preds.get(u)!.length > 0 || succs.get(u)!.length === 0) continue;
    rank.set(u, Math.max(0, Math.min(...succs.get(u)!.map((v) => rank.get(v)!)) - 1));
  }
  const maxRank = Math.max(0, ...rank.values());

  // ---- 3. layers with dummy nodes for edges spanning more than one rank ----
  const layers: Item[][] = Array.from({ length: maxRank + 1 }, () => []);
  const itemById = new Map<string, Item>();
  const up = new Map<string, string[]>(); // item -> items in the layer above
  const down = new Map<string, string[]>(); // item -> items in the layer below
  const link = (a: string, b: string) => {
    down.get(a)!.push(b);
    up.get(b)!.push(a);
  };
  const addItem = (it: Item, r: number) => {
    layers[r].push(it);
    itemById.set(it.id, it);
    up.set(it.id, []);
    down.set(it.id, []);
  };
  // Initial order inside a layer: DFS pre-order from the root, so the main chain comes first.
  const pre = new Map<string, number>();
  const visit = (u: string) => {
    if (pre.has(u)) return;
    pre.set(u, pre.size);
    for (const v of succs.get(u)!) visit(v);
  };
  for (const r of roots) visit(r);
  for (const id of [...nodesIn.map((n) => n.id)].sort((a, b) => pre.get(a)! - pre.get(b)!)) {
    const n = nodeById.get(id)!;
    addItem({ id, dummy: false, width: n.width, height: n.height }, rank.get(id)!);
  }
  const chains = new Map<string, string[]>(); // edge id -> dummy ids, top to bottom
  for (const e of dag) {
    const r0 = rank.get(e.source)!;
    const r1 = rank.get(e.target)!;
    let prev = e.source;
    const dummies: string[] = [];
    for (let r = r0 + 1; r < r1; r++) {
      const id = `\u0000${e.id}#${r}`;
      addItem({ id, dummy: true, width: e.labelWidth ?? 0, height: 0, edge: e.id }, r);
      link(prev, id);
      dummies.push(id);
      prev = id;
    }
    link(prev, e.target);
    chains.set(e.id, dummies);
  }

  // ---- 4. ordering: barycenter sweeps, keep the arrangement with the fewest crossings ----
  const pos = new Map<string, number>();
  const reindex = () => layers.forEach((l) => l.forEach((it, i) => pos.set(it.id, i)));
  reindex();
  const crossings = () => {
    let c = 0;
    for (let r = 0; r < maxRank; r++) {
      const segs: [number, number][] = [];
      for (const it of layers[r]) for (const b of down.get(it.id)!) segs.push([pos.get(it.id)!, pos.get(b)!]);
      for (let i = 0; i < segs.length; i++)
        for (let j = i + 1; j < segs.length; j++) {
          const [a1, b1] = segs[i];
          const [a2, b2] = segs[j];
          if ((a1 - a2) * (b1 - b2) < 0) c++;
        }
    }
    return c;
  };
  const sortLayer = (r: number, neighbours: Map<string, string[]>) => {
    const bary = new Map<string, number>();
    for (const it of layers[r]) {
      const ns = neighbours.get(it.id)!;
      bary.set(it.id, ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(it.id)!);
    }
    layers[r].sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || pos.get(a.id)! - pos.get(b.id)!);
    layers[r].forEach((it, i) => pos.set(it.id, i));
  };
  let best = layers.map((l) => [...l]);
  let bestCross = crossings();
  for (let s = 0; s < sweeps && bestCross > 0; s++) {
    if (s % 2 === 0) for (let r = 1; r <= maxRank; r++) sortLayer(r, up);
    else for (let r = maxRank - 1; r >= 0; r--) sortLayer(r, down);
    const c = crossings();
    if (c < bestCross) {
      bestCross = c;
      best = layers.map((l) => [...l]);
    }
  }
  best.forEach((l, r) => (layers[r] = l));
  reindex();

  // ---- 5. x: pull each item toward its neighbours, keeping order and minimum gaps ----
  const cx = new Map<string, number>();
  const sep = (a: Item, b: Item) => a.width / 2 + b.width / 2 + (a.dummy || b.dummy ? laneGap : nodeGap);
  for (const l of layers) {
    let x = 0;
    l.forEach((it, i) => {
      if (i > 0) x += sep(l[i - 1], it);
      cx.set(it.id, x);
    });
    const mid = x / 2;
    l.forEach((it) => cx.set(it.id, cx.get(it.id)! - mid));
  }
  const place = (r: number, neighbours: Array<Map<string, string[]>>) => {
    const l = layers[r];
    const target = l.map((it) => {
      const ns = neighbours.flatMap((m) => m.get(it.id)!);
      return ns.length ? ns.reduce((s, n) => s + cx.get(n)!, 0) / ns.length : cx.get(it.id)!;
    });
    // Real nodes hold their ground; long-edge lanes move aside (they stay straight anyway,
    // since each dummy follows a single neighbour).
    const weight = l.map((it) => (it.dummy ? 1 : 8));
    const gaps = l.map((it, i) => (i === 0 ? 0 : sep(l[i - 1], it)));
    isotonicPlace(target, weight, gaps).forEach((x, i) => cx.set(l[i].id, x));
  };
  for (let pass = 0; pass < 8; pass++) {
    for (let r = 1; r <= maxRank; r++) place(r, [up]);
    for (let r = maxRank - 1; r >= 0; r--) place(r, [down]);
  }
  // Finish top-down: the graph reads downward, so each node settles under what feeds it.
  for (let r = 1; r <= maxRank; r++) place(r, [up]);

  // ---- 6. y: one band per rank ----
  const bandTop: number[] = [];
  const bandH: number[] = [];
  let y = 0;
  for (let r = 0; r <= maxRank; r++) {
    const h = Math.max(0, ...layers[r].map((it) => it.height));
    bandTop.push(y);
    bandH.push(h);
    y += h + rankGap;
  }
  const height = y - rankGap;

  const minX = Math.min(...[...itemById.values()].map((it) => cx.get(it.id)! - it.width / 2));
  const maxX = Math.max(...[...itemById.values()].map((it) => cx.get(it.id)! + it.width / 2));
  const shift = -minX;

  const positions = new Map<string, XY>();
  for (const n of nodesIn) {
    const r = rank.get(n.id)!;
    // Whole pixels keep 1 px borders crisp.
    positions.set(n.id, {
      x: Math.round(cx.get(n.id)! + shift - n.width / 2),
      y: Math.round(bandTop[r] + (bandH[r] - n.height) / 2),
    });
  }

  // ---- 7. edge routes ----
  const routes = new Map<string, EdgeRoute>();
  for (const e of dag) {
    const points: XY[] = chains.get(e.id)!.map((d, i) => {
      const r = rank.get(e.source)! + i + 1;
      return { x: Math.round(cx.get(d)! + shift), y: bandTop[r] + bandH[r] / 2 };
    });
    // A label on a long edge sits in its first dummy lane, clear of the nodes beside it.
    const labelAt = points[0] ?? null;
    routes.set(e.id, { kind: "forward", points, labelAt });
  }
  const span = (a: string, b: string) => {
    const [r0, r1] = [rank.get(a)!, rank.get(b)!].sort((p, q) => p - q);
    const its = layers.slice(r0, r1 + 1).flat();
    return {
      left: Math.min(...its.map((it) => cx.get(it.id)! - it.width / 2)) + shift,
      right: Math.max(...its.map((it) => cx.get(it.id)! + it.width / 2)) + shift,
    };
  };
  const stack = { left: 0, right: 0 };
  const backs = edges.filter((e) => back.has(e.id));
  for (const e of backs) {
    const s = nodeById.get(e.source)!;
    const t = nodeById.get(e.target)!;
    const ps = positions.get(e.source)!;
    const pt = positions.get(e.target)!;
    const { left, right } = span(e.source, e.target);
    const rightNeed = right - Math.max(ps.x + s.width, pt.x + t.width);
    const leftNeed = Math.min(ps.x, pt.x) - left;
    const side = rightNeed <= leftNeed ? "right" : "left";
    const k = stack[side]++;
    const bulgeX = Math.round(side === "right" ? right + backOffset + k * 24 : left - backOffset - k * 24);
    routes.set(e.id, { kind: "back", side, bulgeX });
  }
  for (const id of self) routes.set(id, { kind: "self", side: "right" });

  const extraRight = stack.right ? backOffset + (stack.right - 1) * 24 : 0;
  const extraLeft = stack.left ? backOffset + (stack.left - 1) * 24 : 0;
  return { positions, ranks: rank, routes, width: maxX - minX + extraLeft + extraRight, height };
}

/**
 * Positions closest (weighted least squares) to `target`, in the same order,
 * with x[i] - x[i-1] >= gaps[i]. Pool-adjacent-violators on the shifted targets.
 */
function isotonicPlace(target: number[], weight: number[], gaps: number[]): number[] {
  const offset: number[] = [];
  let acc = 0;
  for (let i = 0; i < target.length; i++) {
    acc += gaps[i];
    offset.push(acc);
  }
  type Block = { sum: number; w: number; n: number };
  const blocks: Block[] = [];
  for (let i = 0; i < target.length; i++) {
    blocks.push({ sum: (target[i] - offset[i]) * weight[i], w: weight[i], n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, w: a.w + b.w, n: a.n + b.n });
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let j = 0; j < b.n; j++) out.push(b.sum / b.w + offset[out.length]);
  return out;
}
