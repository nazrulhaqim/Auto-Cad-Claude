import { describe, expect, it } from 'vitest';
import { Doc } from '../src/doc';
import { arcFrom3, bboxOf, hitDistance, P, xform, rotatePt, normAngle } from '../src/geometry';
import { exportDXF, exportSVG, importDXF } from '../src/io';
import { parsePoint } from '../src/tools';

describe('geometry', () => {
  it('builds a CCW arc through three points', () => {
    const a = arcFrom3(P(10, 0), P(0, 10), P(-10, 0))!;
    expect(a.type).toBe('arc');
    if (a.type !== 'arc') return;
    expect(a.r).toBeCloseTo(10);
    expect(a.c.x).toBeCloseTo(0);
    expect(normAngle(a.a0)).toBeCloseTo(0);
    expect(normAngle(a.a1)).toBeCloseTo(Math.PI);
  });
  it('flips arc direction when points run clockwise', () => {
    const a = arcFrom3(P(-10, 0), P(0, 10), P(10, 0))!;
    if (a.type !== 'arc') throw new Error('not arc');
    expect(normAngle(a.a0)).toBeCloseTo(0);
    expect(normAngle(a.a1)).toBeCloseTo(Math.PI);
  });
  it('returns null for collinear points', () => {
    expect(arcFrom3(P(0, 0), P(1, 1), P(2, 2))).toBeNull();
  });
  it('hit-tests lines, circles and arcs', () => {
    expect(hitDistance({ type: 'line', a: P(0, 0), b: P(10, 0) }, P(5, 3))).toBeCloseTo(3);
    expect(hitDistance({ type: 'circle', c: P(0, 0), r: 5 }, P(8, 0))).toBeCloseTo(3);
    const arc = { type: 'arc' as const, c: P(0, 0), r: 5, a0: 0, a1: Math.PI / 2 };
    expect(hitDistance(arc, P(0, -5))).toBeGreaterThan(4); // outside the arc span
    expect(hitDistance(arc, P(0, 5.5))).toBeCloseTo(0.5);
  });
  it('bbox of an arc includes quadrant extremes', () => {
    const bb = bboxOf({ type: 'arc', c: P(0, 0), r: 5, a0: 0.1, a1: Math.PI - 0.1 });
    expect(bb.maxy).toBeCloseTo(5);
  });
  it('rotates entities around a point', () => {
    const c = P(0, 0);
    const r = xform({ type: 'line', a: P(1, 0), b: P(2, 0) }, (p) => rotatePt(p, c, Math.PI / 2), Math.PI / 2, 1);
    if (r.type !== 'line') throw new Error();
    expect(r.a.y).toBeCloseTo(1);
    expect(r.b.y).toBeCloseTo(2);
  });
});

describe('command input', () => {
  it('parses absolute, relative and polar points', () => {
    expect(parsePoint('10,20', null, P(0, 0))).toEqual(P(10, 20));
    expect(parsePoint('@5,-3', P(1, 1), P(0, 0))).toEqual(P(6, -2));
    const p = parsePoint('10<90', P(0, 0), P(0, 0))!;
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
  it('bare distance goes towards the cursor', () => {
    const p = parsePoint('5', P(0, 0), P(100, 0))!;
    expect(p.x).toBeCloseTo(5);
    expect(parsePoint('5', null, P(1, 1))).toBeNull();
  });
});

function sample(): Doc {
  const d = new Doc();
  d.ensureLayer('Walls', '#ff0000');
  d.add({ type: 'line', a: P(0, 0), b: P(10, 5) }, 'Walls');
  d.add({ type: 'circle', c: P(3, 4), r: 2.5 });
  d.add({ type: 'arc', c: P(0, 0), r: 5, a0: 0.5, a1: 2 }, 'Walls');
  d.add({ type: 'poly', pts: [P(0, 0), P(4, 0), P(4, 3)], closed: true });
  d.add({ type: 'text', p: P(1, 1), text: 'Hello', h: 2 });
  return d;
}

describe('DXF', () => {
  it('round-trips every entity type and layer', () => {
    const d = sample();
    const { data, skipped } = importDXF(exportDXF(d));
    expect(skipped).toEqual({});
    expect(data.entities.map((e) => e.type)).toEqual(['line', 'circle', 'arc', 'poly', 'text']);
    expect(data.entities.map((e) => e.layer)).toEqual(['Walls', '0', 'Walls', '0', '0']);
    const arc = data.entities[2];
    if (arc.type !== 'arc') throw new Error();
    expect(arc.a0).toBeCloseTo(0.5, 5);
    expect(arc.a1).toBeCloseTo(2, 5);
    const poly = data.entities[3];
    if (poly.type !== 'poly') throw new Error();
    expect(poly.closed).toBe(true);
    expect(poly.pts).toHaveLength(3);
    expect(data.layers.find((l) => l.name === 'Walls')?.color).toBe('#ff0000');
  });
  it('imports LWPOLYLINE and counts unsupported entities', () => {
    const dxf = ['0','SECTION','2','ENTITIES','0','LWPOLYLINE','8','A','70','1','10','0','20','0','10','5','20','0','10','5','20','5','0','HATCH','8','A','0','ENDSEC','0','EOF'].join('\n');
    const { data, skipped } = importDXF(dxf);
    expect(data.entities).toHaveLength(1);
    expect(skipped).toEqual({ HATCH: 1 });
    expect(data.layers.map((l) => l.name)).toContain('A');
  });
});

describe('SVG / JSON', () => {
  it('exports SVG with all shapes', () => {
    const svg = exportSVG(sample());
    for (const tag of ['<line', '<circle', '<path', '<polygon', '<text']) expect(svg).toContain(tag);
  });
  it('serializes and reloads a drawing', () => {
    const d = sample();
    const e = new Doc();
    e.loadJSON(d.serialize());
    expect(e.entities).toHaveLength(5);
    expect(e.layer('Walls')).toBeTruthy();
  });
});
