import { describe, expect, it } from 'vitest';
import { Doc } from '../src/doc';
import { P, bboxOf, hitDistance, normAngle, xform, rotatePt, dist, type Shape } from '../src/geometry';
import { chamferLines, filletLines, mirrorShape, polarArray, rectArray } from '../src/modify';
import { fmt, linearDim, radialDim } from '../src/dim';
import { exportDXF, exportSVG, importDXF } from '../src/io';

type Line = Extract<Shape, { type: 'line' }>;
type Arc = Extract<Shape, { type: 'arc' }>;
const L = (x1: number, y1: number, x2: number, y2: number): Line => ({ type: 'line', a: P(x1, y1), b: P(x2, y2) });
const asLine = (s: Shape) => {
  if (s.type !== 'line') throw new Error('expected line');
  return s;
};

describe('mirror', () => {
  it('reflects a line across the y axis', () => {
    const m = asLine(mirrorShape(L(1, 1, 3, 2), P(0, 0), P(0, 10)));
    expect(m.a.x).toBeCloseTo(-1);
    expect(m.b.x).toBeCloseTo(-3);
    expect(m.a.y).toBeCloseTo(1);
  });
  it('reflects across a diagonal', () => {
    const m = asLine(mirrorShape(L(2, 0, 4, 0), P(0, 0), P(1, 1)));
    expect(m.a.x).toBeCloseTo(0);
    expect(m.a.y).toBeCloseTo(2);
  });
  it('keeps an arc occupying the mirrored angular range (CCW)', () => {
    const arc: Arc = { type: 'arc', c: P(0, 0), r: 5, a0: 0, a1: Math.PI / 2 }; // first quadrant
    const m = mirrorShape(arc, P(0, 0), P(0, 1)) as Arc; // mirror across y axis -> second quadrant
    const span = normAngle(m.a1 - m.a0);
    expect(span).toBeCloseTo(Math.PI / 2);
    expect(normAngle(Math.PI * 0.75 - m.a0)).toBeLessThan(span); // 135° inside
    expect(normAngle(Math.PI * 0.25 - m.a0)).toBeGreaterThan(span); // 45° outside
  });
  it('moves text but keeps its rotation', () => {
    const m = mirrorShape({ type: 'text', p: P(2, 1), text: 'A', h: 1, rot: 0.3 }, P(0, 0), P(0, 1));
    if (m.type !== 'text') throw new Error();
    expect(m.p.x).toBeCloseTo(-2);
    expect(m.rot).toBe(0.3);
  });
});

describe('fillet / chamfer', () => {
  // corner at origin: horizontal line from x=10 to 0 (overshooting), vertical line from 0,10 down to 0,0
  const h = L(10, 0, 0, 0);
  const v = L(0, 10, 0, 0);
  it('radius 0 joins the lines at the corner', () => {
    const r = filletLines(L(10, 0, 1, 0), P(8, 0), L(0, 10, 0, 1), P(0, 8), 0) as { a: Line; b: Line };
    expect(asLine(r.a).a.x).toBeCloseTo(0);
    expect(asLine(r.a).a.y).toBeCloseTo(0);
    expect(asLine(r.b).a.y).toBeCloseTo(0);
  });
  it('makes a tangent arc of the requested radius', () => {
    const r = filletLines(h, P(8, 0), v, P(0, 8), 3) as { a: Line; b: Line; extra: Arc };
    expect(r.extra.r).toBeCloseTo(3);
    expect(r.extra.c.x).toBeCloseTo(3);
    expect(r.extra.c.y).toBeCloseTo(3);
    expect(r.a.a.x).toBeCloseTo(3); // trimmed back to the tangent point
    expect(r.a.a.y).toBeCloseTo(0);
    expect(r.b.a.y).toBeCloseTo(3);
    // the arc is the short quarter: from (3,0) to (0,3) around (3,3) = angles -90° .. 180°; midpoint must be on the corner side
    const span = normAngle(r.extra.a1 - r.extra.a0);
    expect(span).toBeCloseTo(Math.PI / 2);
    const mid = r.extra.a0 + span / 2;
    expect(r.extra.c.x + Math.cos(mid) * 3).toBeLessThan(3);
    expect(r.extra.c.y + Math.sin(mid) * 3).toBeLessThan(3);
  });
  it('works for lines that must be extended to reach the corner', () => {
    const r = filletLines(L(10, 0, 5, 0), P(7, 0), L(0, 10, 0, 6), P(0, 8), 2) as { a: Line; b: Line; extra: Arc };
    expect(r.extra.r).toBeCloseTo(2);
    expect(r.a.a.x).toBeCloseTo(2);
    expect(r.b.a.y).toBeCloseTo(2);
  });
  it('works at an acute angle and the tangent points are on the circle', () => {
    const a = L(0, 0, 20, 0);
    const b = L(0, 0, 20 * Math.cos(Math.PI / 3), 20 * Math.sin(Math.PI / 3));
    const r = filletLines(a, P(15, 0), b, P(8, 8 * Math.tan(Math.PI / 3)), 2) as { a: Line; b: Line; extra: Arc };
    expect(dist(r.extra.c, r.a.a)).toBeCloseTo(2);
    expect(dist(r.extra.c, r.b.a)).toBeCloseTo(2);
  });
  it('rejects parallel lines and a radius that is too large', () => {
    expect(filletLines(L(0, 0, 10, 0), P(5, 0), L(0, 5, 10, 5), P(5, 5), 1)).toHaveProperty('error');
    expect(filletLines(L(3, 0, 0, 0), P(2, 0), L(0, 3, 0, 0), P(0, 2), 10)).toHaveProperty('error');
  });
  it('rejects clicking the side that faces away from the corner', () => {
    // second line sits on the far side of the corner; clicking beyond it would need to grow away
    expect(filletLines(L(10, 0, 5, 0), P(7, 0), L(0, 10, 0, 6), P(0, -5), 1)).toHaveProperty('error');
  });
  it('chamfer cuts the corner with a straight line', () => {
    const r = chamferLines(h, P(8, 0), v, P(0, 8), 2, 3) as { a: Line; b: Line; extra: Line };
    expect(r.extra.a).toEqual(expect.objectContaining({ x: expect.closeTo(2), y: expect.closeTo(0) }));
    expect(r.extra.b).toEqual(expect.objectContaining({ x: expect.closeTo(0), y: expect.closeTo(3) }));
    expect(chamferLines(h, P(8, 0), v, P(0, 8), 50, 1)).toHaveProperty('error');
  });
});

describe('array', () => {
  it('builds a rectangular grid without the original cell', () => {
    const fns = rectArray(2, 3, 10, 5);
    expect(fns).toHaveLength(5);
    const moved = fns.map((f) => (f({ type: 'circle', c: P(0, 0), r: 1 }) as { c: { x: number; y: number } }).c);
    expect(moved).toContainEqual(P(5, 0));
    expect(moved).toContainEqual(P(10, 10));
    expect(moved).not.toContainEqual(P(0, 0));
  });
  it('spaces a full polar array evenly', () => {
    const fns = polarArray(P(0, 0), 4, 2 * Math.PI);
    expect(fns).toHaveLength(3);
    const pts = fns.map((f) => (f({ type: 'circle', c: P(10, 0), r: 1 }) as { c: { x: number; y: number } }).c);
    expect(pts[0].x).toBeCloseTo(0);
    expect(pts[0].y).toBeCloseTo(10);
    expect(pts[1].x).toBeCloseTo(-10);
    expect(pts[2].y).toBeCloseTo(-10);
  });
  it('a partial polar array lands the last copy on the end angle', () => {
    const fns = polarArray(P(0, 0), 3, Math.PI);
    const last = fns[fns.length - 1]({ type: 'circle', c: P(10, 0), r: 1 }) as { c: { x: number; y: number } };
    expect(last.c.x).toBeCloseTo(-10);
  });
});

describe('rotated text', () => {
  it('rotates with the Rotate transform and affects bbox / hit-testing', () => {
    const t: Shape = { type: 'text', p: P(0, 0), text: 'AAAA', h: 10 }; // 24 wide, 10 tall
    const r = xform(t, (p) => rotatePt(p, P(0, 0), Math.PI / 2), Math.PI / 2, 1);
    if (r.type !== 'text') throw new Error();
    expect(r.rot).toBeCloseTo(Math.PI / 2);
    const bb = bboxOf(r);
    expect(bb.maxy).toBeCloseTo(24); // now extends upward
    expect(bb.minx).toBeCloseTo(-10);
    expect(hitDistance(r, P(-5, 12))).toBeCloseTo(0); // inside the rotated box
    expect(hitDistance(r, P(12, 0))).toBeGreaterThan(5); // where unrotated text used to be
  });
  it('round-trips through DXF and appears in SVG', () => {
    const d = new Doc();
    d.add({ type: 'text', p: P(1, 2), text: 'Ø20', h: 3, rot: Math.PI / 4 });
    const dxf = exportDXF(d);
    expect(dxf).toContain('%%c20');
    const t = importDXF(dxf).data.entities[0];
    if (t.type !== 'text') throw new Error();
    expect(t.text).toBe('Ø20');
    expect(t.rot).toBeCloseTo(Math.PI / 4, 5);
    expect(exportSVG(d)).toContain('rotate(-45');
  });
});

describe('dimensions', () => {
  const kinds = (s: Shape[]) => s.map((x) => x.type).sort().join(',');
  it('horizontal dimension reads the x distance', () => {
    const s = linearDim(P(0, 0), P(30, 10), P(15, 25), false, 2)!;
    const text = s.find((x) => x.type === 'text');
    if (text?.type !== 'text') throw new Error();
    expect(text.text).toBe('30');
    expect(kinds(s)).toBe('line,line,line,poly,poly,text');
    expect(text.rot).toBeCloseTo(0);
  });
  it('vertical when the cursor is beside the points', () => {
    const s = linearDim(P(0, 0), P(30, 10), P(50, 5), false, 2)!;
    const text = s.find((x) => x.type === 'text');
    if (text?.type !== 'text') throw new Error();
    expect(text.text).toBe('10');
    expect(Math.abs(text.rot ?? 0)).toBeCloseTo(Math.PI / 2, 1);
  });
  it('aligned dimension measures the true length and keeps text readable', () => {
    const s = linearDim(P(0, 0), P(3, 4), P(-2, 5), true, 1)!;
    const text = s.find((x) => x.type === 'text');
    if (text?.type !== 'text') throw new Error();
    expect(text.text).toBe('5');
    expect(Math.abs(text.rot ?? 0)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });
  it('rejects coincident points', () => {
    expect(linearDim(P(1, 1), P(1, 1), P(5, 5), true, 2)).toBeNull();
  });
  it('radius and diameter labels', () => {
    const txt = (s: Shape[]) => (s.find((x) => x.type === 'text') as { text: string }).text;
    expect(txt(radialDim(P(0, 0), 12.5, P(30, 10), false, 2))).toBe('R12.5');
    expect(txt(radialDim(P(0, 0), 12.5, P(30, 10), true, 2))).toBe('Ø25');
    expect(fmt(3.14159)).toBe('3.14');
    expect(radialDim(P(0, 0), 5, P(0, 0), true, 2).length).toBeGreaterThan(2); // click on the centre must not blow up
  });
});

describe('fillet corner click', () => {
  it('clicking exactly on the corner keeps the longer side instead of failing', () => {
    const r = filletLines(L(10, 0, 5, 0), P(0, 0), L(0, 10, 0, 6), P(0, 0), 2);
    expect('error' in r).toBe(false);
  });
});
