import { P, TAU, angle, dist, distToSegment, normAngle, segments, type Pt, type Shape } from './geometry';

/** A geometric primitive: a straight segment, or a circle optionally limited to a CCW arc range. */
export type Prim =
  | { k: 'seg'; a: Pt; b: Pt }
  | { k: 'circ'; c: Pt; r: number; a0?: number; a1?: number };

const EPS = 1e-9;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const sub = (a: Pt, b: Pt) => P(a.x - b.x, a.y - b.y);

export function primitives(e: Shape): Prim[] {
  switch (e.type) {
    case 'line': return [{ k: 'seg', a: e.a, b: e.b }];
    case 'circle': return [{ k: 'circ', c: e.c, r: e.r }];
    case 'arc': return [{ k: 'circ', c: e.c, r: e.r, a0: e.a0, a1: e.a1 }];
    case 'poly': return segments(e.pts, e.closed).map(([a, b]): Prim => ({ k: 'seg', a, b }));
    case 'text': return [];
  }
}

function onArc(p: Prim, q: Pt): boolean {
  if (p.k !== 'circ' || p.a0 === undefined || p.a1 === undefined) return true;
  const span = normAngle(p.a1 - p.a0);
  const t = normAngle(angle(p.c, q) - p.a0);
  return t <= span + 1e-9 || TAU - t <= 1e-9;
}

function segSeg(p: Extract<Prim, { k: 'seg' }>, q: Extract<Prim, { k: 'seg' }>): Pt[] {
  const r = sub(p.b, p.a);
  const s = sub(q.b, q.a);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return []; // parallel / collinear: no single crossing point
  const qp = sub(q.a, p.a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  const lo = -EPS, hi = 1 + EPS;
  if (t < lo || t > hi || u < lo || u > hi) return [];
  return [P(p.a.x + t * r.x, p.a.y + t * r.y)];
}

function segCirc(s: Extract<Prim, { k: 'seg' }>, c: Extract<Prim, { k: 'circ' }>): Pt[] {
  const d = sub(s.b, s.a);
  const f = sub(s.a, c.c);
  const A = d.x * d.x + d.y * d.y;
  if (A < 1e-18) return [];
  const B = 2 * (f.x * d.x + f.y * d.y);
  const C = f.x * f.x + f.y * f.y - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const ts = sq < 1e-9 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  const out: Pt[] = [];
  for (const t of ts) {
    if (t < -EPS || t > 1 + EPS) continue;
    const pt = P(s.a.x + t * d.x, s.a.y + t * d.y);
    if (onArc(c, pt)) out.push(pt);
  }
  return out;
}

function circCirc(p: Extract<Prim, { k: 'circ' }>, q: Extract<Prim, { k: 'circ' }>): Pt[] {
  const d = dist(p.c, q.c);
  if (d < EPS || d > p.r + q.r + EPS || d < Math.abs(p.r - q.r) - EPS) return [];
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
  const ux = (q.c.x - p.c.x) / d;
  const uy = (q.c.y - p.c.y) / d;
  const m = P(p.c.x + a * ux, p.c.y + a * uy);
  const pts = h < 1e-9 ? [m] : [P(m.x - h * uy, m.y + h * ux), P(m.x + h * uy, m.y - h * ux)];
  return pts.filter((pt) => onArc(p, pt) && onArc(q, pt));
}

export function intersect(p: Prim, q: Prim): Pt[] {
  if (p.k === 'seg' && q.k === 'seg') return segSeg(p, q);
  if (p.k === 'seg' && q.k === 'circ') return segCirc(p, q);
  if (p.k === 'circ' && q.k === 'seg') return segCirc(q, p);
  if (p.k === 'circ' && q.k === 'circ') return circCirc(p, q);
  return [];
}

// ---------- TRIM ----------
const line = (a: Pt, b: Pt): Shape => ({ type: 'line', a, b });
const lerp = (a: Pt, b: Pt, t: number) => P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

function uniqueSorted(v: number[], tol = 1e-9): number[] {
  v.sort((x, y) => x - y);
  return v.filter((x, i) => i === 0 || x - v[i - 1] > tol);
}

function trimSimple(target: Shape, click: Pt, edges: Prim[]): Shape[] | null {
  const [tp] = primitives(target);
  if (!tp) return null;
  const hits = edges.flatMap((e) => intersect(tp, e));

  if (target.type === 'line') {
    const { a, b } = target;
    const d = sub(b, a);
    const l2 = d.x * d.x + d.y * d.y;
    if (l2 === 0) return null;
    const param = (p: Pt) => ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2;
    const ts = uniqueSorted(hits.map(param).filter((t) => t > 1e-7 && t < 1 - 1e-7));
    if (!ts.length) return null;
    const tc = Math.max(0, Math.min(1, param(click)));
    const bounds = [0, ...ts, 1];
    let i = 0;
    while (i < bounds.length - 2 && tc > bounds[i + 1]) i++;
    const lo = bounds[i], hi = bounds[i + 1];
    const out: Shape[] = [];
    if (lo > 1e-7) out.push(line(a, lerp(a, b, lo)));
    if (hi < 1 - 1e-7) out.push(line(lerp(a, b, hi), b));
    return out;
  }

  if (target.type === 'arc') {
    const span = normAngle(target.a1 - target.a0);
    const ts = uniqueSorted(hits.map((p) => normAngle(angle(target.c, p) - target.a0)).filter((t) => t > 1e-7 && t < span - 1e-7));
    if (!ts.length) return null;
    const tc = Math.max(0, Math.min(span, normAngle(angle(target.c, click) - target.a0)));
    const bounds = [0, ...ts, span];
    let i = 0;
    while (i < bounds.length - 2 && tc > bounds[i + 1]) i++;
    const lo = bounds[i], hi = bounds[i + 1];
    const out: Shape[] = [];
    if (lo > 1e-7) out.push({ ...target, a1: target.a0 + lo });
    if (hi < span - 1e-7) out.push({ ...target, a0: target.a0 + hi });
    return out;
  }

  if (target.type === 'circle') {
    const as = uniqueSorted(hits.map((p) => normAngle(angle(target.c, p))));
    if (as.length < 2) return null; // a full circle needs two cut points to open up
    let tc = normAngle(angle(target.c, click));
    if (tc < as[0]) tc += TAU;
    let lo = as[as.length - 1], hi = as[0] + TAU; // wrap-around interval by default
    for (let i = 0; i + 1 < as.length; i++) {
      if (tc >= as[i] && tc <= as[i + 1]) {
        lo = as[i];
        hi = as[i + 1];
        break;
      }
    }
    // what remains runs CCW from the end of the removed piece back to its start
    return [{ type: 'arc', c: target.c, r: target.r, a0: hi, a1: lo }];
  }
  return null;
}

/**
 * Trim the part of `e` under `click` back to the nearest crossing objects (all other
 * objects act as cutting edges). Returns the shapes that replace `e`, or null if nothing
 * can be trimmed there. A polyline is exploded into lines (the clicked segment gets trimmed).
 */
export function trimEntity(e: Shape, click: Pt, others: Shape[]): Shape[] | null {
  const edges = others.flatMap(primitives);
  if (e.type === 'text') return null;
  if (e.type !== 'poly') return trimSimple(e, click, edges);

  const segs = segments(e.pts, e.closed);
  if (!segs.length) return null;
  let best = 0;
  let bd = Infinity;
  segs.forEach(([a, b], i) => {
    const d = distToSegment(click, a, b);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  const selfEdges = segs.filter((_, i) => i !== best).map(([a, b]): Prim => ({ k: 'seg', a, b }));
  const pieces = trimSimple(line(segs[best][0], segs[best][1]), click, [...edges, ...selfEdges]);
  if (!pieces) return null;
  return segs.flatMap(([a, b], i) => (i === best ? pieces : [line(a, b)]));
}

// ---------- OFFSET ----------
function lineLine(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(p3, p1), s) / den;
  return P(p1.x + t * r.x, p1.y + t * r.y);
}

/**
 * Parallel copy of `e` at distance `d`, on the side of the point `side`.
 * Polylines use mitred corners. Returns null if the result is degenerate.
 */
export function offsetShape(e: Shape, d: number, side: Pt): Shape | null {
  if (!(d > 0)) return null;
  switch (e.type) {
    case 'line': {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const len = Math.hypot(dx, dy);
      if (len < EPS) return null;
      const n = P(-dy / len, dx / len);
      const s = (side.x - e.a.x) * n.x + (side.y - e.a.y) * n.y >= 0 ? 1 : -1;
      const o = P(n.x * d * s, n.y * d * s);
      return line(P(e.a.x + o.x, e.a.y + o.y), P(e.b.x + o.x, e.b.y + o.y));
    }
    case 'circle': {
      const r = dist(side, e.c) > e.r ? e.r + d : e.r - d;
      return r > EPS ? { ...e, r } : null;
    }
    case 'arc': {
      const r = dist(side, e.c) > e.r ? e.r + d : e.r - d;
      return r > EPS ? { ...e, r } : null;
    }
    case 'poly': {
      const pts = e.pts.filter((p, i) => i === 0 || dist(p, e.pts[i - 1]) > EPS);
      const segs = segments(pts, e.closed);
      if (!segs.length) return null;
      const normals = segs.map(([a, b]) => {
        const l = dist(a, b);
        return P(-(b.y - a.y) / l, (b.x - a.x) / l);
      });
      let best = 0;
      let bd = Infinity;
      segs.forEach(([a, b], i) => {
        const dd = distToSegment(side, a, b);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      const s = (side.x - segs[best][0].x) * normals[best].x + (side.y - segs[best][0].y) * normals[best].y >= 0 ? 1 : -1;
      const off = segs.map(([a, b], i): [Pt, Pt] => {
        const o = P(normals[i].x * d * s, normals[i].y * d * s);
        return [P(a.x + o.x, a.y + o.y), P(b.x + o.x, b.y + o.y)];
      });
      const n = pts.length;
      const out: Pt[] = [];
      for (let i = 0; i < n; i++) {
        if (!e.closed && i === 0) out.push(off[0][0]);
        else if (!e.closed && i === n - 1) out.push(off[off.length - 1][1]);
        else {
          const prev = off[(i - 1 + off.length) % off.length];
          const next = off[i % off.length];
          out.push(lineLine(prev[0], prev[1], next[0], next[1]) ?? prev[1]);
        }
      }
      return { type: 'poly', pts: out, closed: e.closed };
    }
    case 'text':
      return null;
  }
}
