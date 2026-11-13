import { P, dist, midpoint, type Pt, type Shape } from './geometry';

const EPS = 1e-9;
const line = (a: Pt, b: Pt): Shape => ({ type: 'line', a, b });
const unit = (a: Pt, b: Pt): Pt => {
  const l = dist(a, b);
  return P((b.x - a.x) / l, (b.y - a.y) / l);
};

export const fmt = (v: number) => String(Math.round(v * 100) / 100);

function arrow(tip: Pt, inward: Pt, len: number): Shape {
  const base = P(tip.x + inward.x * len, tip.y + inward.y * len);
  const w = len * 0.3;
  const n = P(-inward.y * w, inward.x * w);
  return { type: 'poly', pts: [tip, P(base.x + n.x, base.y + n.y), P(base.x - n.x, base.y - n.y)], closed: true };
}

/** Text placed above a line from q1 to q2, centred, reading left-to-right. */
function labelAlong(q1: Pt, q2: Pt, text: string, h: number): Shape {
  let a = Math.atan2(q2.y - q1.y, q2.x - q1.x);
  if (a > Math.PI / 2 + 1e-9) a -= Math.PI;
  else if (a <= -Math.PI / 2 + 1e-9) a += Math.PI;
  const w = h * 0.6 * text.length;
  const m = midpoint(q1, q2);
  const td = P(Math.cos(a), Math.sin(a));
  const tn = P(-td.y, td.x);
  return { type: 'text', p: P(m.x - (td.x * w) / 2 + tn.x * 0.4 * h, m.y - (td.y * w) / 2 + tn.y * 0.4 * h), text, h, rot: a };
}

/**
 * Linear dimension between p1 and p2 with the dimension line through `loc`.
 * aligned = parallel to p1-p2; otherwise horizontal or vertical depending on where `loc` is.
 * Built from ordinary lines, arrowheads and text, so it exports everywhere.
 */
export function linearDim(p1: Pt, p2: Pt, loc: Pt, aligned: boolean, h: number): Shape[] | null {
  let q1: Pt, q2: Pt, value: number;
  if (aligned) {
    const L = dist(p1, p2);
    if (L < EPS) return null;
    const d = unit(p1, p2);
    const n = P(-d.y, d.x);
    const s = (loc.x - p1.x) * n.x + (loc.y - p1.y) * n.y;
    q1 = P(p1.x + n.x * s, p1.y + n.y * s);
    q2 = P(p2.x + n.x * s, p2.y + n.y * s);
    value = L;
  } else {
    const m = midpoint(p1, p2);
    const ox = Math.abs(loc.x - m.x) - Math.abs(p2.x - p1.x) / 2;
    const oy = Math.abs(loc.y - m.y) - Math.abs(p2.y - p1.y) / 2;
    if (oy >= ox) {
      q1 = P(p1.x, loc.y);
      q2 = P(p2.x, loc.y);
      value = Math.abs(p2.x - p1.x);
    } else {
      q1 = P(loc.x, p1.y);
      q2 = P(loc.x, p2.y);
      value = Math.abs(p2.y - p1.y);
    }
  }
  const L = dist(q1, q2);
  if (L < EPS) return null;
  const out: Shape[] = [];
  for (const [p, q] of [[p1, q1], [p2, q2]] as const) {
    const l = dist(p, q);
    if (l < EPS) continue;
    const e = unit(p, q);
    const gap = Math.min(0.3 * h, l * 0.5);
    out.push(line(P(p.x + e.x * gap, p.y + e.y * gap), P(q.x + e.x * 0.5 * h, q.y + e.y * 0.5 * h)));
  }
  out.push(line(q1, q2));
  const dir = unit(q1, q2);
  const alen = Math.min(0.8 * h, L * 0.3);
  out.push(arrow(q1, dir, alen), arrow(q2, P(-dir.x, -dir.y), alen));
  out.push(labelAlong(q1, q2, fmt(value), h));
  return out;
}

/** Radius (or diameter) dimension for a circle/arc, with the label at `click`. */
export function radialDim(c: Pt, r: number, click: Pt, diameter: boolean, h: number): Shape[] {
  const d = dist(c, click);
  const u = d < EPS ? P(1, 0) : P((click.x - c.x) / d, (click.y - c.y) / d);
  const tip = P(c.x + u.x * r, c.y + u.y * r);
  const far = d > r ? click : P(tip.x + u.x * 3 * h, tip.y + u.y * 3 * h);
  const start = diameter ? P(c.x - u.x * r, c.y - u.y * r) : c;
  const alen = Math.min(0.8 * h, r * 0.5);
  const out: Shape[] = [line(start, far), arrow(tip, P(-u.x, -u.y), alen)];
  if (diameter) out.push(arrow(start, u, alen));
  const text = diameter ? `Ø${fmt(2 * r)}` : `R${fmt(r)}`;
  const w = h * 0.6 * text.length;
  const tx = u.x < 0 ? far.x - w - 0.3 * h : far.x + 0.3 * h;
  out.push({ type: 'text', p: P(tx, far.y - h / 2), text, h });
  return out;
}
