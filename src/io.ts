import { Doc, type DocData, type Layer } from './doc';
import { bboxOf, normAngle, toDeg, toRad, unionBBox, type BBox, type Entity, type Pt, type Shape, P, polar } from './geometry';

// ---------- AutoCAD colour index helpers ----------
const ACI: Record<number, string> = {
  1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0',
};

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearestAci(hex: string): number {
  const c = hexToRgb(hex);
  let best = 7;
  let bd = Infinity;
  for (let i = 1; i <= 7; i++) {
    const a = hexToRgb(ACI[i]);
    const d = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

const num = (n: number) => String(+n.toFixed(6));

// ---------- DXF export (R12 ASCII: widest compatibility) ----------
export function exportDXF(doc: Doc): string {
  const o: (string | number)[] = [];
  const g = (code: number, v: string | number) => o.push(code, v);

  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, doc.layers.length);
  for (const l of doc.layers) {
    g(0, 'LAYER'); g(2, l.name); g(70, l.locked ? 4 : 0);
    g(62, (l.visible ? 1 : -1) * nearestAci(l.color)); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of doc.entities) {
    switch (e.type) {
      case 'line':
        g(0, 'LINE'); g(8, e.layer); g(10, num(e.a.x)); g(20, num(e.a.y)); g(30, 0); g(11, num(e.b.x)); g(21, num(e.b.y)); g(31, 0);
        break;
      case 'circle':
        g(0, 'CIRCLE'); g(8, e.layer); g(10, num(e.c.x)); g(20, num(e.c.y)); g(30, 0); g(40, num(e.r));
        break;
      case 'arc':
        g(0, 'ARC'); g(8, e.layer); g(10, num(e.c.x)); g(20, num(e.c.y)); g(30, 0); g(40, num(e.r));
        g(50, num(toDeg(normAngle(e.a0)))); g(51, num(toDeg(normAngle(e.a1))));
        break;
      case 'poly':
        g(0, 'POLYLINE'); g(8, e.layer); g(66, 1); g(70, e.closed ? 1 : 0);
        for (const p of e.pts) { g(0, 'VERTEX'); g(8, e.layer); g(10, num(p.x)); g(20, num(p.y)); g(30, 0); }
        g(0, 'SEQEND'); g(8, e.layer);
        break;
      case 'text':
        g(0, 'TEXT'); g(8, e.layer); g(10, num(e.p.x)); g(20, num(e.p.y)); g(30, 0); g(40, num(e.h)); g(1, e.text);
        break;
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');

  let s = '';
  for (let i = 0; i < o.length; i += 2) s += `${o[i]}\n${o[i + 1]}\n`;
  return s;
}

// ---------- DXF import ----------
interface Rec {
  type: string;
  section: string;
  g: [number, string][];
}

export interface DxfResult {
  data: DocData;
  skipped: Record<string, number>;
}

export function importDXF(text: string): DxfResult {
  const lines = text.split(/\r?\n/);
  const recs: Rec[] = [];
  let section = '';
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i + 1].trim();
    if (Number.isNaN(code)) continue;
    if (code === 0) {
      if (val === 'ENDSEC') section = '';
      recs.push({ type: val, section, g: [] });
    } else if (code === 2 && recs.length && recs[recs.length - 1].type === 'SECTION') {
      section = val;
      recs[recs.length - 1].g.push([code, val]);
    } else if (recs.length) {
      recs[recs.length - 1].g.push([code, val]);
    }
  }

  const get = (r: Rec, c: number) => r.g.find(([k]) => k === c)?.[1];
  const n = (r: Rec, c: number, d = 0) => {
    const v = get(r, c);
    const f = v === undefined ? NaN : parseFloat(v);
    return Number.isNaN(f) ? d : f;
  };

  const doc = new Doc();
  doc.layers = [];
  const skipped: Record<string, number> = {};
  const skip = (t: string) => (skipped[t] = (skipped[t] ?? 0) + 1);

  // layers table
  for (const r of recs) {
    if (r.type === 'LAYER' && r.section === 'TABLES') {
      const name = get(r, 2);
      if (!name) continue;
      const c = n(r, 62, 7);
      const layer: Layer = { name, color: ACI[Math.abs(c)] ?? '#ffffff', visible: c >= 0, locked: (n(r, 70, 0) & 4) !== 0 };
      if (!doc.layer(name)) doc.layers.push(layer);
    }
  }

  const add = (s: Shape, r: Rec) => {
    const layer = get(r, 8) ?? '0';
    doc.ensureLayer(layer, '#ffffff');
    doc.add(s, layer);
  };

  let pl: { rec: Rec; pts: Pt[]; closed: boolean } | null = null;
  for (const r of recs) {
    if (r.section !== 'ENTITIES') continue;
    switch (r.type) {
      case 'LINE':
        add({ type: 'line', a: P(n(r, 10), n(r, 20)), b: P(n(r, 11), n(r, 21)) }, r);
        break;
      case 'CIRCLE':
        add({ type: 'circle', c: P(n(r, 10), n(r, 20)), r: n(r, 40) }, r);
        break;
      case 'ARC':
        add({ type: 'arc', c: P(n(r, 10), n(r, 20)), r: n(r, 40), a0: toRad(n(r, 50)), a1: toRad(n(r, 51)) }, r);
        break;
      case 'LWPOLYLINE': {
        const pts: Pt[] = [];
        for (const [k, v] of r.g) {
          if (k === 10) pts.push(P(parseFloat(v), 0));
          else if (k === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v);
        }
        add({ type: 'poly', pts, closed: (n(r, 70, 0) & 1) === 1 }, r);
        break;
      }
      case 'POLYLINE':
        pl = { rec: r, pts: [], closed: (n(r, 70, 0) & 1) === 1 };
        break;
      case 'VERTEX':
        if (pl) pl.pts.push(P(n(r, 10), n(r, 20)));
        break;
      case 'SEQEND':
        if (pl) {
          add({ type: 'poly', pts: pl.pts, closed: pl.closed }, pl.rec);
          pl = null;
        }
        break;
      case 'TEXT':
      case 'MTEXT': {
        const raw = get(r, 1) ?? '';
        const text = raw.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
        add({ type: 'text', p: P(n(r, 10), n(r, 20)), text, h: n(r, 40, 2.5) || 2.5 }, r);
        break;
      }
      default:
        skip(r.type);
    }
  }
  if (!doc.layers.length) doc.ensureLayer('0', '#ffffff');
  doc.current = doc.layers[0].name;
  return { data: doc.data(), skipped };
}

// ---------- SVG export ----------
export function drawingBBox(entities: Entity[]): BBox | null {
  let bb: BBox | null = null;
  for (const e of entities) bb = unionBBox(bb, bboxOf(e));
  return bb;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function exportSVG(doc: Doc): string {
  const ents = doc.entities.filter((e) => doc.isVisible(e));
  const bb = drawingBBox(ents) ?? { minx: 0, miny: 0, maxx: 100, maxy: 100 };
  const pad = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny, 1) * 0.04;
  const x = bb.minx - pad;
  const w = bb.maxx - bb.minx + 2 * pad;
  const h = bb.maxy - bb.miny + 2 * pad;
  const y = -(bb.maxy + pad); // flipped y
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}" width="${Math.min(1600, Math.round(w * 4))}">`);
  out.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="#1b1e24"/>`);
  out.push('<g fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round">');
  const style = (e: Entity) => `stroke="${doc.layer(e.layer)?.color ?? '#fff'}" vector-effect="non-scaling-stroke"`;
  for (const e of ents) {
    switch (e.type) {
      case 'line':
        out.push(`<line x1="${num(e.a.x)}" y1="${num(-e.a.y)}" x2="${num(e.b.x)}" y2="${num(-e.b.y)}" ${style(e)}/>`);
        break;
      case 'circle':
        out.push(`<circle cx="${num(e.c.x)}" cy="${num(-e.c.y)}" r="${num(e.r)}" ${style(e)}/>`);
        break;
      case 'arc': {
        const s = polar(e.c, e.a0, e.r);
        const t = polar(e.c, e.a1, e.r);
        const span = normAngle(e.a1 - e.a0);
        // y is negated, so CCW in world == sweep-flag 0 here
        out.push(`<path d="M ${num(s.x)} ${num(-s.y)} A ${num(e.r)} ${num(e.r)} 0 ${span > Math.PI ? 1 : 0} 0 ${num(t.x)} ${num(-t.y)}" ${style(e)}/>`);
        break;
      }
      case 'poly':
        out.push(`<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map((p) => `${num(p.x)},${num(-p.y)}`).join(' ')}" ${style(e)}/>`);
        break;
      case 'text':
        out.push(`<text x="${num(e.p.x)}" y="${num(-e.p.y)}" font-size="${num(e.h)}" font-family="sans-serif" fill="${doc.layer(e.layer)?.color ?? '#fff'}" stroke="none">${esc(e.text)}</text>`);
        break;
    }
  }
  out.push('</g></svg>');
  return out.join('\n');
}

// ---------- browser helpers ----------
export function download(name: string, data: string | Blob, mime = 'text/plain'): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
