export interface Pt {
  x: number;
  y: number;
}

export type Shape =
  | { type: 'line'; a: Pt; b: Pt }
  | { type: 'circle'; c: Pt; r: number }
  | { type: 'arc'; c: Pt; r: number; a0: number; a1: number } // CCW from a0 to a1, radians
  | { type: 'poly'; pts: Pt[]; closed: boolean }
  | { type: 'text'; p: Pt; text: string; h: number };

export type Entity = Shape & { id: number; layer: string };

export interface BBox {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

export interface SnapPoint {
  p: Pt;
  kind: 'end' | 'mid' | 'cen' | 'quad' | 'ins';
}

export const TAU = Math.PI * 2;
export const P = (x: number, y: number): Pt => ({ x, y });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const angle = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
export const midpoint = (a: Pt, b: Pt) => P((a.x + b.x) / 2, (a.y + b.y) / 2);
export const normAngle = (a: number) => ((a % TAU) + TAU) % TAU;
export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;
export const polar = (c: Pt, a: number, d: number) => P(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d);

export function rotatePt(p: Pt, c: Pt, a: number): Pt {
  const s = Math.sin(a);
  const co = Math.cos(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return P(c.x + dx * co - dy * s, c.y + dx * s + dy * co);
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, P(a.x + t * dx, a.y + t * dy));
}

export function angleInArc(a: number, a0: number, a1: number): boolean {
  const span = normAngle(a1 - a0);
  return normAngle(a - a0) <= span;
}

export function circleFrom3(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = P(ux, uy);
  return { c: center, r: dist(center, a) };
}

/** Arc passing through three points (start, any point on the arc, end). */
export function arcFrom3(p1: Pt, p2: Pt, p3: Pt): Shape | null {
  const cc = circleFrom3(p1, p2, p3);
  if (!cc) return null;
  const cross = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const s = angle(cc.c, p1);
  const e = angle(cc.c, p3);
  return cross > 0
    ? { type: 'arc', c: cc.c, r: cc.r, a0: s, a1: e }
    : { type: 'arc', c: cc.c, r: cc.r, a0: e, a1: s };
}

export function segments(pts: Pt[], closed: boolean): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
  return out;
}

export const textWidth = (e: { text: string; h: number }) => e.h * 0.6 * e.text.length;

export function bboxOf(e: Shape): BBox {
  switch (e.type) {
    case 'line':
      return { minx: Math.min(e.a.x, e.b.x), miny: Math.min(e.a.y, e.b.y), maxx: Math.max(e.a.x, e.b.x), maxy: Math.max(e.a.y, e.b.y) };
    case 'circle':
      return { minx: e.c.x - e.r, miny: e.c.y - e.r, maxx: e.c.x + e.r, maxy: e.c.y + e.r };
    case 'arc': {
      const pts = [polar(e.c, e.a0, e.r), polar(e.c, e.a1, e.r)];
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        if (angleInArc(a, e.a0, e.a1)) pts.push(polar(e.c, a, e.r));
      }
      return ptsBBox(pts);
    }
    case 'poly':
      return ptsBBox(e.pts);
    case 'text':
      return { minx: e.p.x, miny: e.p.y, maxx: e.p.x + textWidth(e), maxy: e.p.y + e.h };
  }
}

function ptsBBox(pts: Pt[]): BBox {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of pts) {
    minx = Math.min(minx, p.x);
    miny = Math.min(miny, p.y);
    maxx = Math.max(maxx, p.x);
    maxy = Math.max(maxy, p.y);
  }
  return { minx, miny, maxx, maxy };
}

export function unionBBox(a: BBox | null, b: BBox): BBox {
  if (!a) return { ...b };
  return { minx: Math.min(a.minx, b.minx), miny: Math.min(a.miny, b.miny), maxx: Math.max(a.maxx, b.maxx), maxy: Math.max(a.maxy, b.maxy) };
}

/** Distance (world units) from point p to the entity outline. */
export function hitDistance(e: Shape, p: Pt): number {
  switch (e.type) {
    case 'line':
      return distToSegment(p, e.a, e.b);
    case 'circle':
      return Math.abs(dist(p, e.c) - e.r);
    case 'arc':
      if (angleInArc(angle(e.c, p), e.a0, e.a1)) return Math.abs(dist(p, e.c) - e.r);
      return Math.min(dist(p, polar(e.c, e.a0, e.r)), dist(p, polar(e.c, e.a1, e.r)));
    case 'poly': {
      if (e.pts.length === 1) return dist(p, e.pts[0]);
      return Math.min(...segments(e.pts, e.closed).map(([a, b]) => distToSegment(p, a, b)));
    }
    case 'text': {
      const b = bboxOf(e);
      const dx = Math.max(b.minx - p.x, 0, p.x - b.maxx);
      const dy = Math.max(b.miny - p.y, 0, p.y - b.maxy);
      return Math.hypot(dx, dy);
    }
  }
}

export function snapPoints(e: Shape): SnapPoint[] {
  switch (e.type) {
    case 'line':
      return [
        { p: e.a, kind: 'end' },
        { p: e.b, kind: 'end' },
        { p: midpoint(e.a, e.b), kind: 'mid' },
      ];
    case 'circle':
      return [
        { p: e.c, kind: 'cen' },
        ...[0, 1, 2, 3].map((k): SnapPoint => ({ p: polar(e.c, (k * Math.PI) / 2, e.r), kind: 'quad' })),
      ];
    case 'arc': {
      const am = e.a0 + normAngle(e.a1 - e.a0) / 2;
      return [
        { p: e.c, kind: 'cen' },
        { p: polar(e.c, e.a0, e.r), kind: 'end' },
        { p: polar(e.c, e.a1, e.r), kind: 'end' },
        { p: polar(e.c, am, e.r), kind: 'mid' },
      ];
    }
    case 'poly':
      return [
        ...e.pts.map((p): SnapPoint => ({ p, kind: 'end' })),
        ...segments(e.pts, e.closed).map(([a, b]): SnapPoint => ({ p: midpoint(a, b), kind: 'mid' })),
      ];
    case 'text':
      return [{ p: e.p, kind: 'ins' }];
  }
}

/**
 * Apply a rigid/similarity transform. `f` maps points, `rot` is the rotation
 * (radians) it applies, `k` the uniform scale factor. Text keeps its orientation.
 */
export function xform(e: Shape, f: (p: Pt) => Pt, rot: number, k: number): Shape {
  switch (e.type) {
    case 'line':
      return { ...e, a: f(e.a), b: f(e.b) };
    case 'circle':
      return { ...e, c: f(e.c), r: e.r * k };
    case 'arc':
      return { ...e, c: f(e.c), r: e.r * k, a0: e.a0 + rot, a1: e.a1 + rot };
    case 'poly':
      return { ...e, pts: e.pts.map(f) };
    case 'text':
      return { ...e, p: f(e.p), h: e.h * k };
  }
}

export function entityLength(e: Shape): number | null {
  switch (e.type) {
    case 'line':
      return dist(e.a, e.b);
    case 'circle':
      return TAU * e.r;
    case 'arc':
      return e.r * normAngle(e.a1 - e.a0);
    case 'poly':
      return segments(e.pts, e.closed).reduce((s, [a, b]) => s + dist(a, b), 0);
    case 'text':
      return null;
  }
}
