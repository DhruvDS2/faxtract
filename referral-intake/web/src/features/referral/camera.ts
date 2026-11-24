/**
 * The fax viewer's camera. Pages are stacked in a scroll container; a page at zoom z
 * occupies W·z × W·aspect·z, centred horizontally when narrower than the viewport.
 * A point on the document is (u, g): u is the x fraction of the page width, g is the
 * page index plus the y fraction of that page, so a flight can cross pages smoothly.
 */

export type Layout = {
  /** Page width at zoom 1 (fit width), CSS px. */
  W: number;
  /** height / width per page. */
  aspects: number[];
  /** Content padding and the gap between pages, CSS px. */
  pad: number;
  gap: number;
  clientW: number;
  clientH: number;
};

export type DocPoint = { u: number; g: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const pageHeight = (L: Layout, i: number, z: number) => L.W * (L.aspects[i] ?? L.aspects[0] ?? 1) * z;
export const pageLeft = (L: Layout, z: number) => Math.max(L.pad, (L.clientW - L.W * z) / 2);

export function pageTop(L: Layout, i: number, z: number) {
  let y = L.pad;
  for (let j = 0; j < i; j++) y += pageHeight(L, j, z) + L.gap;
  return y;
}

/** Document point → content coordinates at zoom z. */
export function toContent(L: Layout, p: DocPoint, z: number) {
  const last = Math.max(0, L.aspects.length - 1);
  const i = clamp(Math.floor(p.g), 0, last);
  const v = p.g - i;
  return { x: pageLeft(L, z) + p.u * L.W * z, y: pageTop(L, i, z) + v * pageHeight(L, i, z) };
}

/** Content coordinates at zoom z → document point (clamped onto the nearest page). */
export function fromContent(L: Layout, x: number, y: number, z: number): DocPoint {
  const n = Math.max(1, L.aspects.length);
  let i = 0;
  while (i < n - 1 && y > pageTop(L, i + 1, z) - L.gap / 2) i++;
  const v = clamp((y - pageTop(L, i, z)) / pageHeight(L, i, z), 0, 1);
  const u = clamp((x - pageLeft(L, z)) / (L.W * z), 0, 1);
  return { u, g: i + v };
}

/** Scroll position that puts document point p at the viewport centre. */
export function scrollFor(L: Layout, p: DocPoint, z: number) {
  const c = toContent(L, p, z);
  return { left: c.x - L.clientW / 2, top: c.y - L.clientH / 2 };
}

/** The page whose top third holds the viewport probe. */
export function pageAt(L: Layout, scrollTop: number, z: number) {
  const probe = scrollTop + L.clientH / 3;
  let page = 0;
  for (let i = 0; i < L.aspects.length; i++) if (pageTop(L, i, z) <= probe) page = i;
  return page;
}

/**
 * Zoom that frames a box: it fills a bit under half the viewport width, between fit
 * (1) and 2×, and never so far that a wide box (a clinical indication) overflows.
 */
export function focusZoom(L: Layout, boxWidth: number, max = 2) {
  const w = Math.max(boxWidth * L.W, 1);
  const framed = (L.clientW * 0.45) / w;
  const fits = (L.clientW * 0.9) / w;
  return clamp(Math.min(framed, fits), 1, max);
}

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of t (Newton, then bisection). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (target: number) => {
    let t = target;
    for (let k = 0; k < 8; k++) {
      const err = x(t) - target;
      if (Math.abs(err) < 1e-5) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = target;
    for (let k = 0; k < 20; k++) {
      const v = x(t);
      if (Math.abs(v - target) < 1e-5) break;
      if (v < target) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : y(solve(t)));
}
