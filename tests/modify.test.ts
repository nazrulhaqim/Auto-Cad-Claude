import { describe, expect, it } from 'vitest';
import { P, normAngle, type Shape } from '../src/geometry';
import { extendEntity, intersect, offsetShape, primitives, trimEntity } from '../src/modify';

const line = (x1: number, y1: number, x2: number, y2: number): Shape => ({ type: 'line', a: P(x1, y1), b: P(x2, y2) });
const asLine = (s: Shape) => {
  if (s.type !== 'line') throw new Error('expected line, got ' + s.type);
  return s;
};

describe('intersect', () => {
  it('segment/segment', () => {
    const [p] = intersect(primitives(line(0, 0, 10, 10))[0], primitives(line(0, 10, 10, 0))[0]);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(5);
  });
  it('misses when segments do not reach each other', () => {
    expect(intersect(primitives(line(0, 0, 1, 0))[0], primitives(line(5, -1, 5, 1))[0])).toHaveLength(0);
  });
  it('segment/circle gives two points', () => {
    const pts = intersect(primitives(line(-10, 0, 10, 0))[0], primitives({ type: 'circle', c: P(0, 0), r: 5 })[0]);
    expect(pts.map((p) => p.x).sort((a, b) => a - b)).toEqual([expect.closeTo(-5), expect.closeTo(5)]);
  });
  it('respects arc range', () => {
    const arc: Shape = { type: 'arc', c: P(0, 0), r: 5, a0: 0, a1: Math.PI / 2 }; // first quadrant only
    expect(intersect(primitives(line(-10, 0, 10, 0))[0], primitives(arc)[0])).toHaveLength(1); // only (5,0)
  });
  it('circle/circle', () => {
    const a = primitives({ type: 'circle', c: P(0, 0), r: 5 })[0];
    const b = primitives({ type: 'circle', c: P(6, 0), r: 5 })[0];
    expect(intersect(a, b)).toHaveLength(2);
    expect(intersect(a, primitives({ type: 'circle', c: P(20, 0), r: 5 })[0])).toHaveLength(0);
  });
});

describe('trim', () => {
  it('removes the middle of a line between two cutters', () => {
    const res = trimEntity(line(0, 0, 10, 0), P(5, 0.1), [line(3, -1, 3, 1), line(7, -1, 7, 1)])!;
    expect(res).toHaveLength(2);
    expect(asLine(res[0]).b.x).toBeCloseTo(3);
    expect(asLine(res[1]).a.x).toBeCloseTo(7);
  });
  it('removes the end piece of a line', () => {
    const res = trimEntity(line(0, 0, 10, 0), P(9, 0), [line(3, -1, 3, 1), line(7, -1, 7, 1)])!;
    expect(res).toHaveLength(1);
    expect(asLine(res[0]).b.x).toBeCloseTo(7);
  });
  it('returns null when nothing crosses', () => {
    expect(trimEntity(line(0, 0, 10, 0), P(5, 0), [line(0, 5, 10, 5)])).toBeNull();
  });
  it('opens a circle into an arc and removes the clicked side', () => {
    // vertical line x=3 cuts the circle at two points; click the right-hand side
    const res = trimEntity({ type: 'circle', c: P(0, 0), r: 5 }, P(5, 0), [line(3, -10, 3, 10)])!;
    expect(res).toHaveLength(1);
    const arc = res[0];
    if (arc.type !== 'arc') throw new Error('expected arc');
    // the remaining arc must contain the left side (angle PI) and not the right side (angle 0)
    const span = normAngle(arc.a1 - arc.a0);
    expect(normAngle(Math.PI - arc.a0)).toBeLessThan(span);
    expect(normAngle(0 - arc.a0)).toBeGreaterThan(span);
  });
  it('refuses to trim a circle with a single crossing', () => {
    expect(trimEntity({ type: 'circle', c: P(0, 0), r: 5 }, P(5, 0), [line(5, -10, 5, 10)])).toBeNull(); // tangent
  });
  it('trims an arc', () => {
    const arc: Shape = { type: 'arc', c: P(0, 0), r: 5, a0: 0, a1: Math.PI };
    const res = trimEntity(arc, P(0, 5), [line(0, 0, 0, 10)])!; // cut at the top (90°), click right half? click at 90° -> exactly on cutter
    expect(res.length).toBeGreaterThan(0);
    const right = trimEntity(arc, P(4, 3), [line(0, 0, 0, 10)])!;
    expect(right).toHaveLength(1);
    if (right[0].type !== 'arc') throw new Error();
    expect(right[0].a0).toBeCloseTo(Math.PI / 2); // remaining piece starts at the cutter
  });
  it('explodes a polyline and trims only the clicked segment', () => {
    const poly: Shape = { type: 'poly', pts: [P(0, 0), P(10, 0), P(10, 10)], closed: false };
    const res = trimEntity(poly, P(8, 0), [line(5, -1, 5, 1)])!;
    expect(res.every((s) => s.type === 'line')).toBe(true);
    expect(res).toHaveLength(2); // trimmed first segment (0..5) + untouched second segment
    expect(asLine(res[0]).b.x).toBeCloseTo(5);
    expect(asLine(res[1]).a).toEqual(P(10, 0));
  });
});

describe('offset', () => {
  it('offsets a line to the clicked side', () => {
    const up = asLine(offsetShape(line(0, 0, 10, 0), 2, P(5, 7))!);
    expect(up.a.y).toBeCloseTo(2);
    expect(up.b.y).toBeCloseTo(2);
    const down = asLine(offsetShape(line(0, 0, 10, 0), 2, P(5, -7))!);
    expect(down.a.y).toBeCloseTo(-2);
  });
  it('grows or shrinks a circle depending on side, and rejects collapse', () => {
    const c: Shape = { type: 'circle', c: P(0, 0), r: 5 };
    expect((offsetShape(c, 2, P(10, 0)) as { r: number }).r).toBeCloseTo(7);
    expect((offsetShape(c, 2, P(1, 0)) as { r: number }).r).toBeCloseTo(3);
    expect(offsetShape(c, 5, P(1, 0))).toBeNull();
  });
  it('keeps arc angles', () => {
    const a: Shape = { type: 'arc', c: P(0, 0), r: 5, a0: 0.2, a1: 1.1 };
    const o = offsetShape(a, 1, P(20, 20))! as Extract<Shape, { type: 'arc' }>;
    expect(o.r).toBeCloseTo(6);
    expect(o.a0).toBe(0.2);
    expect(o.a1).toBe(1.1);
  });
  it('offsets a closed rectangle outward/inward with mitred corners', () => {
    const rect: Shape = { type: 'poly', pts: [P(0, 0), P(10, 0), P(10, 6), P(0, 6)], closed: true };
    const inner = offsetShape(rect, 1, P(5, 3))! as Extract<Shape, { type: 'poly' }>;
    expect(inner.pts.map((p) => [p.x, p.y])).toEqual([[1, 1], [9, 1], [9, 5], [1, 5]].map(([x, y]) => [expect.closeTo(x), expect.closeTo(y)]));
    const outer = offsetShape(rect, 1, P(-5, 3))! as Extract<Shape, { type: 'poly' }>;
    expect(outer.pts[0].x).toBeCloseTo(-1);
    expect(outer.pts[2].y).toBeCloseTo(7);
  });
  it('offsets an open polyline keeping its end points square', () => {
    const pl: Shape = { type: 'poly', pts: [P(0, 0), P(10, 0), P(10, 10)], closed: false };
    const o = offsetShape(pl, 2, P(5, 5))! as Extract<Shape, { type: 'poly' }>;
    expect(o.pts[0].x).toBeCloseTo(0);
    expect(o.pts[0].y).toBeCloseTo(2);
    expect(o.pts[1].x).toBeCloseTo(8);
    expect(o.pts[1].y).toBeCloseTo(2);
    expect(o.pts[2].x).toBeCloseTo(8);
    expect(o.pts[2].y).toBeCloseTo(10);
  });
  it('rejects zero distance and text', () => {
    expect(offsetShape(line(0, 0, 1, 0), 0, P(0, 1))).toBeNull();
    expect(offsetShape({ type: 'text', p: P(0, 0), text: 'x', h: 1 }, 1, P(0, 1))).toBeNull();
  });
});

describe('extend', () => {
  it('extends the nearer end of a line to the first boundary', () => {
    const r = asLine(extendEntity(line(0, 0, 4, 0), P(3.5, 0), [line(10, -5, 10, 5), line(7, -5, 7, 5)])!);
    expect(r.a.x).toBeCloseTo(0);
    expect(r.b.x).toBeCloseTo(7); // nearest boundary, not the one at x=10
  });
  it('extends the start when that end is clicked', () => {
    const r = asLine(extendEntity(line(0, 0, 4, 0), P(0.2, 0), [line(-3, -5, -3, 5)])!);
    expect(r.a.x).toBeCloseTo(-3);
    expect(r.b.x).toBeCloseTo(4);
  });
  it('ignores boundaries behind the end and returns null', () => {
    expect(extendEntity(line(0, 0, 4, 0), P(4, 0), [line(-3, -5, -3, 5)])).toBeNull();
    expect(extendEntity(line(0, 0, 4, 0), P(4, 0), [line(10, 1, 10, 5)])).toBeNull(); // boundary doesn't reach the line's axis
  });
  it('extends to a circle', () => {
    const r = asLine(extendEntity(line(0, 0, 1, 0), P(1, 0), [{ type: 'circle', c: P(10, 0), r: 3 }])!);
    expect(r.b.x).toBeCloseTo(7);
  });
  it('extends an arc along its circle', () => {
    const arc: Shape = { type: 'arc', c: P(0, 0), r: 5, a0: 0, a1: Math.PI / 4 };
    const r = extendEntity(arc, P(3.5, 3.5), [line(0, 0, 0, 10)])!;
    if (r.type !== 'arc') throw new Error();
    expect(r.a1).toBeCloseTo(Math.PI / 2);
    expect(r.a0).toBe(0);
    expect(extendEntity(arc, P(3.5, 3.5), [line(20, 0, 20, 10)])).toBeNull();
  });
  it('moves the end vertex of an open polyline', () => {
    const pl: Shape = { type: 'poly', pts: [P(0, 0), P(5, 0), P(5, 3)], closed: false };
    const r = extendEntity(pl, P(5, 3), [line(0, 8, 10, 8)])!;
    if (r.type !== 'poly') throw new Error();
    expect(r.pts[2].x).toBeCloseTo(5);
    expect(r.pts[2].y).toBeCloseTo(8);
    expect(r.pts).toHaveLength(3);
    const start = extendEntity(pl, P(0, 0), [line(-4, -3, -4, 3)])!;
    if (start.type !== 'poly') throw new Error();
    expect(start.pts[0].x).toBeCloseTo(-4);
  });
  it('does not extend closed polylines, circles or text', () => {
    const edge = line(-50, 20, 50, 20);
    expect(extendEntity({ type: 'poly', pts: [P(0, 0), P(1, 0), P(1, 1)], closed: true }, P(1, 1), [edge])).toBeNull();
    expect(extendEntity({ type: 'circle', c: P(0, 0), r: 1 }, P(1, 0), [edge])).toBeNull();
  });
});
