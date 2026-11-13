import { Doc, History } from './doc';
import { View, gridStep, type DrawState } from './render';
import { bboxOf, dist, hitDistance, snapPoints, unionBBox, xform, P, type BBox, type Entity, type Pt, type Shape, type SnapPoint } from './geometry';
import { createTool, type Tool } from './tools';

const STORAGE_KEY = 'auto-cad-claude:drawing';

export class App {
  doc = new Doc();
  history = new History(this.doc);
  view = new View();
  sel = new Set<number>();
  tool!: Tool;

  raw: Pt = P(0, 0);
  cursor: Pt = P(0, 0);
  snap: DrawState['snap'] = null;
  selBox: { a: Pt; b: Pt } | null = null;

  grid = true;
  gridSnap = false;
  osnap = true;
  ortho = false;
  textH = 10;
  offsetDist = 10;

  /** UI refresh hook (panels, prompt, toggles) */
  onChange: () => void = () => {};
  onLog: (msg: string) => void = () => {};
  onInvalidate: () => void = () => {};

  constructor() {
    this.setTool('select');
    this.restore();
  }

  // ---------- tools ----------
  setTool(id: string): void {
    const t = createTool(id, this);
    this.tool = t;
    t.begin();
    this.refreshSnap();
    this.changed();
  }

  cancel(): void {
    if (this.tool.id === 'select') this.sel.clear();
    else this.setTool('select');
    this.changed();
  }

  // ---------- change notification ----------
  changed(): void {
    this.onChange();
    this.onInvalidate();
  }

  log(msg: string): void {
    this.onLog(msg);
  }

  // ---------- document mutation ----------
  addShape(s: Shape, layer?: string): Entity {
    const e = this.doc.add(s, layer);
    this.history.push();
    this.save();
    return e;
  }

  /** Replace one entity by zero or more shapes on the same layer (used by TRIM). */
  replaceEntity(id: number, shapes: Shape[]): void {
    const old = this.doc.byId(id);
    if (!old) return;
    this.doc.remove(new Set([id]));
    this.sel.delete(id);
    for (const s of shapes) {
      const { id: _i, layer: _l, ...rest } = s as Entity;
      this.doc.add(rest as Shape, old.layer);
    }
    this.commit();
  }

  commit(): void {
    this.history.push();
    this.save();
    this.changed();
  }

  selected(): Entity[] {
    return this.doc.entities.filter((e) => this.sel.has(e.id));
  }

  deleteSelection(): void {
    if (!this.sel.size) return;
    const n = this.sel.size;
    this.doc.remove(this.sel);
    this.sel.clear();
    this.log(`${n} object(s) erased.`);
    this.commit();
  }

  transformSelected(f: (p: Pt) => Pt, rot: number, k: number, copy: boolean): void {
    const next = new Set<number>();
    for (const e of this.selected()) {
      const s = xform(e, f, rot, k);
      if (copy) {
        const { id: _id, layer: _layer, ...rest } = s as Entity;
        next.add(this.doc.add(rest as Shape, e.layer).id);
      } else this.doc.update(e.id, s);
    }
    if (copy) this.sel = next;
    this.commit();
  }

  setSelectionLayer(name: string): void {
    for (const e of this.selected()) e.layer = name;
    this.commit();
  }

  undo(): void {
    if (this.history.undo()) this.afterHistory();
  }

  redo(): void {
    if (this.history.redo()) this.afterHistory();
  }

  private afterHistory(): void {
    const ids = new Set(this.doc.entities.map((e) => e.id));
    this.sel = new Set([...this.sel].filter((i) => ids.has(i)));
    this.save();
    this.changed();
  }

  newDrawing(): void {
    this.doc.reset();
    this.sel.clear();
    this.history.reset();
    this.view.fit(null);
    this.setTool('select');
    this.save();
  }

  replaceDocument(data: Parameters<Doc['load']>[0]): void {
    this.doc.load(data);
    this.sel.clear();
    this.history.reset();
    this.setTool('select');
    this.zoomExtents();
    this.save();
  }

  // ---------- persistence ----------
  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, this.doc.serialize());
    } catch {
      /* storage unavailable: ignore */
    }
  }

  private restore(): void {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        this.doc.loadJSON(s);
        this.history.reset();
      }
    } catch {
      /* ignore corrupt / missing storage */
    }
  }

  // ---------- view ----------
  extents(): BBox | null {
    let bb: BBox | null = null;
    for (const e of this.doc.entities) if (this.doc.isVisible(e)) bb = unionBBox(bb, bboxOf(e));
    return bb;
  }

  zoomExtents(): void {
    this.view.fit(this.extents());
    this.changed();
  }

  // ---------- cursor + snapping ----------
  setRaw(p: Pt): void {
    this.raw = p;
    this.refreshSnap();
  }

  refreshSnap(): void {
    const raw = this.raw;
    const tol = 12 / this.view.scale;
    if (this.osnap) {
      let best: (SnapPoint & { d: number }) | null = null;
      for (const e of this.doc.entities) {
        if (!this.doc.isVisible(e)) continue;
        for (const sp of snapPoints(e)) {
          const d = dist(sp.p, raw);
          if (d < tol && (!best || d < best.d)) best = { ...sp, d };
        }
      }
      if (best) {
        this.cursor = best.p;
        this.snap = best;
        return;
      }
    }
    let p = raw;
    let kind: 'grid' | null = null;
    if (this.gridSnap) {
      const step = gridStep(this.view.scale);
      p = P(Math.round(p.x / step) * step, Math.round(p.y / step) * step);
      kind = 'grid';
    }
    const b = this.tool.base();
    if (this.ortho && b) p = Math.abs(p.x - b.x) >= Math.abs(p.y - b.y) ? P(p.x, b.y) : P(b.x, p.y);
    this.cursor = p;
    this.snap = kind ? { p, kind } : null;
  }

  // ---------- selection ----------
  private selectable(e: Entity): boolean {
    return this.doc.isVisible(e) && !this.doc.isLocked(e);
  }

  /** Nearest selectable entity within a few pixels of p. */
  pickEntity(p: Pt): Entity | null {
    let best: Entity | null = null;
    let bd = 8 / this.view.scale;
    for (const e of this.doc.entities) {
      if (!this.selectable(e)) continue;
      const d = hitDistance(e, p);
      if (d <= bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  selectAt(p: Pt, additive: boolean): void {
    const best = this.pickEntity(p);
    if (!additive) this.sel.clear();
    if (best) {
      if (additive && this.sel.has(best.id)) this.sel.delete(best.id);
      else this.sel.add(best.id);
    }
    this.changed();
  }

  /** Left→right box selects fully-enclosed objects; right→left selects anything touched. */
  selectWindow(a: Pt, b: Pt, additive: boolean): void {
    const crossing = b.x < a.x;
    const minx = Math.min(a.x, b.x), maxx = Math.max(a.x, b.x);
    const miny = Math.min(a.y, b.y), maxy = Math.max(a.y, b.y);
    if (!additive) this.sel.clear();
    for (const e of this.doc.entities) {
      if (!this.selectable(e)) continue;
      const bb = bboxOf(e);
      const inside = bb.minx >= minx && bb.maxx <= maxx && bb.miny >= miny && bb.maxy <= maxy;
      const touches = bb.maxx >= minx && bb.minx <= maxx && bb.maxy >= miny && bb.miny <= maxy;
      if (crossing ? touches : inside) this.sel.add(e.id);
    }
    this.changed();
  }

  selectAll(): void {
    this.sel = new Set(this.doc.entities.filter((e) => this.selectable(e)).map((e) => e.id));
    this.changed();
  }

  // ---------- draw state ----------
  drawState(): DrawState {
    return {
      doc: this.doc,
      view: this.view,
      sel: this.sel,
      ghost: this.tool.preview(),
      snap: this.snap,
      grid: this.grid,
      selBox: this.selBox,
    };
  }
}
