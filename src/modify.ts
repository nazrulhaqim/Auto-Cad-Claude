import { P, TAU, angle, dist, distToSegment, normAngle, polar, rotatePt, segments, xform, type Pt, type Shape } from './geometry';

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


// ---------- EXTEND ----------
const RAY = 1e6;

/** Where a ray leaving `from` in unit direction `u` first hits an edge (beyond `from`), or null. */
function rayHit(from: Pt, u: Pt, edges: Prim[]): Pt | null {
  const ray: Prim = { k: 'seg', a: from, b: P(from.x + u.x * RAY, from.y + u.y * RAY) };
  let best: Pt | null = null;
  let bt = Infinity;
  for (const e of edges) {
    for (const h of intersect(ray, e)) {
      const t = (h.x - from.x) * u.x + (h.y - from.y) * u.y;
      if (t > 1e-7 && t < bt) {
        bt = t;
        best = h;
      }
    }
  }
  return best;
}

function extendEnd(a: Pt, b: Pt, click: Pt, edges: Prim[]): { a: Pt; b: Pt } | null {
  // extend whichever end is nearer the click, along the line's own direction
  const atB = dist(click, b) <= dist(click, a);
  const [far, end] = atB ? [a, b] : [b, a];
  const len = dist(far, end);
  if (len < EPS) return null;
  const hit = rayHit(end, P((end.x - far.x) / len, (end.y - far.y) / len), edges);
  if (!hit) return null;
  return atB ? { a, b: hit } : { a: hit, b };
}

/**
 * Extend the end of `e` nearest `click` until it meets another object (all others are
 * boundary edges). Supports lines, arcs and open polylines (its end segment is extended).
 * Returns the replacement shape, or null if there is nothing to extend to.
 */
export function extendEntity(e: Shape, click: Pt, others: Shape[]): Shape | null {
  const edges = others.flatMap(primitives);
  switch (e.type) {
    case 'line': {
      const r = extendEnd(e.a, e.b, click, edges);
      return r ? { ...e, a: r.a, b: r.b } : null;
    }
    case 'poly': {
      if (e.closed || e.pts.length < 2) return null;
      const n = e.pts.length;
      const atEnd = dist(click, e.pts[n - 1]) <= dist(click, e.pts[0]);
      const [i, j] = atEnd ? [n - 2, n - 1] : [1, 0]; // j is the vertex that moves
      // pass the moving vertex as the click so extendEnd always lengthens its `b` end
      const r = extendEnd(e.pts[i], e.pts[j], e.pts[j], edges);
      if (!r) return null;
      const pts = e.pts.slice();
      pts[j] = r.b;
      return { ...e, pts };
    }
    case 'arc': {
      const span = normAngle(e.a1 - e.a0);
      const atEnd = dist(click, polar(e.c, e.a1, e.r)) <= dist(click, polar(e.c, e.a0, e.r));
      const full: Prim = { k: 'circ', c: e.c, r: e.r };
      let best = Infinity;
      for (const o of edges) {
        for (const h of intersect(full, o)) {
          const ha = angle(e.c, h);
          const delta = atEnd ? normAngle(ha - e.a1) : normAngle(e.a0 - ha);
          // must lie beyond the end, and not wrap back into the existing arc
          if (delta > 1e-7 && delta < TAU - span - 1e-7 && delta < best) best = delta;
        }
      }
      if (!isFinite(best)) return null;
      return atEnd ? { ...e, a1: e.a1 + best } : { ...e, a0: e.a0 - best };
    }
    default:
      return null;
  }
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

// ---------- MIRROR ----------
/** Reflect a shape across the line through p1 and p2. Text keeps its orientation (like MIRRTEXT=0). */
export function mirrorShape(e: Shape, p1: Pt, p2: Pt): Shape {
  const th = angle(p1, p2);
  const c = Math.cos(2 * th);
  const s = Math.sin(2 * th);
  const r = (p: Pt) => P(p1.x + (p.x - p1.x) * c + (p.y - p1.y) * s, p1.y + (p.x - p1.x) * s - (p.y - p1.y) * c);
  switch (e.type) {
    case 'line': return { ...e, a: r(e.a), b: r(e.b) };
    case 'circle': return { ...e, c: r(e.c) };
    // reflection reverses direction, so the start/end angles swap to stay CCW
    case 'arc': return { ...e, c: r(e.c), a0: 2 * th - e.a1, a1: 2 * th - e.a0 };
    case 'poly': return { ...e, pts: e.pts.map(r) };
    case 'text': return { ...e, p: r(e.p) };
  }
}

// ---------- FILLET / CHAMFER (line to line) ----------
type LineShape = Extract<Shape, { type: 'line' }>;
export interface CornerResult {
  a: Shape;
  b: Shape;
  extra?: Shape;
}

interface Corner {
  I: Pt;
  u1: Pt;
  u2: Pt;
  E1: Pt;
  E2: Pt;
  theta: number;
}

function cornerOf(l1: LineShape, c1: Pt, l2: LineShape, c2: Pt): Corner | string {
  const I = lineLine(l1.a, l1.b, l2.a, l2.b);
  if (!I) return 'The two lines are parallel.';
  const side = (l: LineShape, c: Pt): { u: Pt; E: Pt } | null => {
    const len = dist(l.a, l.b);
    if (len < EPS) return null;
    const dir = P((l.b.x - l.a.x) / len, (l.b.y - l.a.y) / len);
    let s = (c.x - I.x) * dir.x + (c.y - I.y) * dir.y;
    if (Math.abs(s) < 1e-9) s = dist(l.b, I) >= dist(l.a, I) ? 1 : -1; // click on the corner itself: keep the longer side
    const u = P(dir.x * Math.sign(s), dir.y * Math.sign(s));
    const da = (l.a.x - I.x) * u.x + (l.a.y - I.y) * u.y;
    const db = (l.b.x - I.x) * u.x + (l.b.y - I.y) * u.y;
    return { u, E: da >= db ? l.a : l.b };
  };
  const s1 = side(l1, c1);
  const s2 = side(l2, c2);
  if (!s1 || !s2) return 'A line has zero length.';
  const along = (E: Pt, u: Pt) => (E.x - I.x) * u.x + (E.y - I.y) * u.y;
  if (along(s1.E, s1.u) <= EPS || along(s2.E, s2.u) <= EPS) return 'Pick the side of each line that faces the corner.';
  const dot = Math.max(-1, Math.min(1, s1.u.x * s2.u.x + s1.u.y * s2.u.y));
  const theta = Math.acos(dot);
  if (theta < 1e-6 || theta > Math.PI - 1e-6) return 'The lines are collinear.';
  return { I, u1: s1.u, u2: s2.u, E1: s1.E, E2: s2.E, theta };
}

const at = (I: Pt, u: Pt, t: number) => P(I.x + u.x * t, I.y + u.y * t);

/** Round the corner of two lines with an arc of radius r (r = 0 just trims/extends them to meet). */
export function filletLines(l1: LineShape, c1: Pt, l2: LineShape, c2: Pt, r: number): CornerResult | { error: string } {
  const k = cornerOf(l1, c1, l2, c2);
  if (typeof k === 'string') return { error: k };
  const { I, u1, u2, E1, E2, theta } = k;
  if (r <= 0) return { a: line(I, E1), b: line(I, E2) };
  const t = r / Math.tan(theta / 2);
  const along = (E: Pt, u: Pt) => (E.x - I.x) * u.x + (E.y - I.y) * u.y;
  if (along(E1, u1) < t - 1e-9 || along(E2, u2) < t - 1e-9) return { error: 'Radius is too large for these lines.' };
  const T1 = at(I, u1, t);
  const T2 = at(I, u2, t);
  const bl = Math.hypot(u1.x + u2.x, u1.y + u2.y);
  const bis = P((u1.x + u2.x) / bl, (u1.y + u2.y) / bl);
  const C = at(I, bis, r / Math.sin(theta / 2));
  const ccw = cross(sub(T1, C), sub(T2, C)) > 0; // the short way round
  const a1 = angle(C, T1);
  const a2 = angle(C, T2);
  const arc: Shape = ccw ? { type: 'arc', c: C, r, a0: a1, a1: a2 } : { type: 'arc', c: C, r, a0: a2, a1: a1 };
  return { a: line(T1, E1), b: line(T2, E2), extra: arc };
}

/** Cut the corner of two lines: d1 along the first, d2 along the second. */
export function chamferLines(l1: LineShape, c1: Pt, l2: LineShape, c2: Pt, d1: number, d2: number): CornerResult | { error: string } {
  const k = cornerOf(l1, c1, l2, c2);
  if (typeof k === 'string') return { error: k };
  const { I, u1, u2, E1, E2 } = k;
  if (d1 <= 0 && d2 <= 0) return { a: line(I, E1), b: line(I, E2) };
  const along = (E: Pt, u: Pt) => (E.x - I.x) * u.x + (E.y - I.y) * u.y;
  if (along(E1, u1) < d1 - 1e-9 || along(E2, u2) < d2 - 1e-9) return { error: 'Distance is too large for these lines.' };
  const T1 = at(I, u1, d1);
  const T2 = at(I, u2, d2);
  return { a: line(T1, E1), b: line(T2, E2), extra: line(T1, T2) };
}

// ---------- ARRAY ----------
export type MapFn = (s: Shape) => Shape;
const mover = (dx: number, dy: number): MapFn => (s) => xform(s, (p) => P(p.x + dx, p.y + dy), 0, 1);

/** Copies for a rows x cols grid (the original occupies cell 0,0). Spacings: +dy up, +dx right. */
export function rectArray(rows: number, cols: number, dy: number, dx: number): MapFn[] {
  const out: MapFn[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (r || c) out.push(mover(c * dx, r * dy));
  return out;
}

/** Copies for `count` items around `center`; a 360° fill spaces them evenly, otherwise the last lands on the end angle. */
export function polarArray(center: Pt, count: number, fillRad: number): MapFn[] {
  const full = Math.abs(Math.abs(fillRad) - TAU) < 1e-6;
  const step = full ? fillRad / count : fillRad / (count - 1);
  const out: MapFn[] = [];
  for (let i = 1; i < count; i++) {
    const a = step * i;
    out.push((s) => xform(s, (p) => rotatePt(p, center, a), a, 1));
  }
  return out;
}
