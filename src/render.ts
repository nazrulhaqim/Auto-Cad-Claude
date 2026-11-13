import type { Doc } from './doc';
import { snapPoints, type BBox, type Pt, type Shape, type SnapPoint, P, TAU } from './geometry';

export class View {
  scale = 2;
  ox = -20;
  oy = -20;
  w = 800;
  h = 600;

  sx(x: number) {
    return (x - this.ox) * this.scale;
  }
  sy(y: number) {
    return this.h - (y - this.oy) * this.scale;
  }
  toWorld(sx: number, sy: number): Pt {
    return P(sx / this.scale + this.ox, (this.h - sy) / this.scale + this.oy);
  }
  zoomAt(sx: number, sy: number, factor: number) {
    const w = this.toWorld(sx, sy);
    this.scale = Math.max(1e-4, Math.min(1e6, this.scale * factor));
    this.ox = w.x - sx / this.scale;
    this.oy = w.y - (this.h - sy) / this.scale;
  }
  panBy(dx: number, dy: number) {
    this.ox -= dx / this.scale;
    this.oy += dy / this.scale;
  }
  fit(bb: BBox | null, pad = 48) {
    if (!bb) {
      this.scale = 2;
      this.ox = -20;
      this.oy = -20;
      return;
    }
    const W = bb.maxx - bb.minx || 100;
    const H = bb.maxy - bb.miny || 100;
    this.scale = Math.max(1e-4, Math.min(1e6, Math.min((this.w - 2 * pad) / W, (this.h - 2 * pad) / H)));
    const cx = (bb.minx + bb.maxx) / 2;
    const cy = (bb.miny + bb.maxy) / 2;
    this.ox = cx - this.w / 2 / this.scale;
    this.oy = cy - this.h / 2 / this.scale;
  }
}

export function gridStep(scale: number): number {
  return Math.pow(10, Math.ceil(Math.log10(14 / scale)));
}

export interface DrawState {
  doc: Doc;
  view: View;
  sel: Set<number>;
  ghost: Shape[];
  snap: SnapPoint | { p: Pt; kind: 'grid' } | null;
  grid: boolean;
  selBox: { a: Pt; b: Pt } | null;
}

const BG = '#1b1e24';

export function render(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const { view, doc } = st;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, view.w, view.h);
  if (st.grid) drawGrid(ctx, view);
  drawAxes(ctx, view);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const e of doc.entities) {
    const layer = doc.layer(e.layer);
    if (layer && !layer.visible) continue;
    const selected = st.sel.has(e.id);
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.strokeStyle = ctx.fillStyle = selected ? '#4da3ff' : layer?.color ?? '#ffffff';
    ctx.setLineDash(selected ? [6, 4] : []);
    drawShape(ctx, view, e);
  }
  ctx.setLineDash([]);

  // grips for selected entities
  ctx.fillStyle = '#4da3ff';
  for (const id of st.sel) {
    const e = doc.byId(id);
    if (!e) continue;
    for (const sp of snapPoints(e)) {
      if (sp.kind === 'mid' || sp.kind === 'quad') continue;
      ctx.fillRect(view.sx(sp.p.x) - 3, view.sy(sp.p.y) - 3, 6, 6);
    }
  }

  // ghost / rubber-band preview
  ctx.strokeStyle = ctx.fillStyle = '#7ee787';
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 4]);
  for (const g of st.ghost) drawShape(ctx, view, g);
  ctx.setLineDash([]);

  if (st.selBox) {
    const { a, b } = st.selBox;
    const crossing = b.x < a.x;
    const x = view.sx(Math.min(a.x, b.x));
    const y = view.sy(Math.max(a.y, b.y));
    const w = Math.abs(a.x - b.x) * view.scale;
    const h = Math.abs(a.y - b.y) * view.scale;
    ctx.fillStyle = crossing ? 'rgba(63,185,80,0.12)' : 'rgba(77,163,255,0.12)';
    ctx.strokeStyle = crossing ? '#3fb950' : '#4da3ff';
    ctx.lineWidth = 1;
    ctx.setLineDash(crossing ? [5, 3] : []);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  if (st.snap) drawSnap(ctx, view, st.snap);
}

export function drawShape(ctx: CanvasRenderingContext2D, view: View, e: Shape): void {
  switch (e.type) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(view.sx(e.a.x), view.sy(e.a.y));
      ctx.lineTo(view.sx(e.b.x), view.sy(e.b.y));
      ctx.stroke();
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(view.sx(e.c.x), view.sy(e.c.y), Math.max(e.r * view.scale, 0.5), 0, TAU);
      ctx.stroke();
      break;
    case 'arc':
      ctx.beginPath();
      // screen y is flipped, so CCW in world == anticlockwise with negated angles
      ctx.arc(view.sx(e.c.x), view.sy(e.c.y), Math.max(e.r * view.scale, 0.5), -e.a0, -e.a1, true);
      ctx.stroke();
      break;
    case 'poly': {
      if (!e.pts.length) break;
      ctx.beginPath();
      ctx.moveTo(view.sx(e.pts[0].x), view.sy(e.pts[0].y));
      for (let i = 1; i < e.pts.length; i++) ctx.lineTo(view.sx(e.pts[i].x), view.sy(e.pts[i].y));
      if (e.closed && e.pts.length > 2) ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'text':
      ctx.font = `${Math.max(e.h * view.scale, 1)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.translate(view.sx(e.p.x), view.sy(e.p.y));
      if (e.rot) ctx.rotate(-e.rot); // screen y is flipped
      ctx.fillText(e.text, 0, 0);
      ctx.restore();
      break;
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, view: View): void {
  const step = gridStep(view.scale);
  const x0 = Math.floor(view.ox / step) * step;
  const x1 = view.ox + view.w / view.scale;
  const y0 = Math.floor(view.oy / step) * step;
  const y1 = view.oy + view.h / view.scale;
  ctx.lineWidth = 1;
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? '#30353d' : '#24282f';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      if ((Math.round(x / step) % 10 === 0) !== major) continue;
      const sx = Math.round(view.sx(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, view.h);
    }
    for (let y = y0; y <= y1; y += step) {
      if ((Math.round(y / step) % 10 === 0) !== major) continue;
      const sy = Math.round(view.sy(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(view.w, sy);
    }
    ctx.stroke();
  }
}

function drawAxes(ctx: CanvasRenderingContext2D, view: View): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#7a2f2f';
  const sy = view.sy(0);
  ctx.beginPath();
  ctx.moveTo(0, sy);
  ctx.lineTo(view.w, sy);
  ctx.stroke();
  ctx.strokeStyle = '#2f6a3a';
  const sx = view.sx(0);
  ctx.beginPath();
  ctx.moveTo(sx, 0);
  ctx.lineTo(sx, view.h);
  ctx.stroke();
}

function drawSnap(ctx: CanvasRenderingContext2D, view: View, s: { p: Pt; kind: string }): void {
  const x = view.sx(s.p.x);
  const y = view.sy(s.p.y);
  ctx.strokeStyle = '#ffd33d';
  ctx.lineWidth = 1.75;
  ctx.setLineDash([]);
  ctx.beginPath();
  switch (s.kind) {
    case 'end':
    case 'ins':
      ctx.rect(x - 6, y - 6, 12, 12);
      break;
    case 'mid':
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y + 6);
      ctx.lineTo(x - 7, y + 6);
      ctx.closePath();
      break;
    case 'cen':
      ctx.arc(x, y, 6, 0, TAU);
      break;
    case 'quad':
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 7, y);
      ctx.closePath();
      break;
    default:
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
  }
  ctx.stroke();
}
