import type { App } from './app';
import { extendEntity, offsetShape, trimEntity } from './modify';
import { P, angle, arcFrom3, dist, polar, rotatePt, toDeg, toRad, xform, type Pt, type Shape } from './geometry';

export interface Tool {
  id: string;
  /** true: canvas clicks / drag boxes select objects instead of calling click() */
  selecting(): boolean;
  /** true: typed text is free text (not a command) */
  awaitingText(): boolean;
  begin(): void;
  click(p: Pt): void;
  /** Enter / Space / right click */
  enter(): void;
  /** Typed input. Return true if consumed. */
  input(s: string): boolean;
  /** Reference point for ortho / relative input / rubber-band info */
  base(): Pt | null;
  preview(): Shape[];
  prompt(): string;
}

const NUM = '-?\\d*\\.?\\d+';

/** Accepts `x,y`, `@dx,dy`, `dist<angle` and a bare distance (towards the cursor). */
export function parsePoint(s: string, base: Pt | null, cursor: Pt): Pt | null {
  s = s.trim();
  let m = s.match(new RegExp(`^(@)?\\s*(${NUM})\\s*,\\s*(${NUM})$`));
  if (m) {
    const x = +m[2];
    const y = +m[3];
    return m[1] ? P((base?.x ?? 0) + x, (base?.y ?? 0) + y) : P(x, y);
  }
  m = s.match(new RegExp(`^@?\\s*(${NUM})\\s*<\\s*(${NUM})$`));
  if (m) return polar(base ?? P(0, 0), toRad(+m[2]), +m[1]);
  m = s.match(new RegExp(`^(${NUM})$`));
  if (m && base && dist(base, cursor) > 1e-9) return polar(base, angle(base, cursor), +m[1]);
  return null;
}

export function parseNumber(s: string): number | null {
  const m = s.trim().match(new RegExp(`^(${NUM})$`));
  return m ? +m[1] : null;
}

abstract class BaseTool implements Tool {
  abstract id: string;
  constructor(protected app: App) {}
  selecting() {
    return false;
  }
  awaitingText() {
    return false;
  }
  begin() {}
  abstract click(p: Pt): void;
  enter() {
    this.app.setTool('select');
  }
  input(_s: string) {
    return false;
  }
  base(): Pt | null {
    return null;
  }
  preview(): Shape[] {
    return [];
  }
  abstract prompt(): string;
  protected get cur() {
    return this.app.cursor;
  }
}

class SelectTool extends BaseTool {
  id = 'select';
  selecting() {
    return true;
  }
  click() {}
  enter() {}
  prompt() {
    return 'Click or drag to select. Type a command: L, PL, REC, C, A, T, M, CO, RO, SC, TR, EX, O, E, DI';
  }
}

class LineTool extends BaseTool {
  id = 'line';
  first: Pt | null = null;
  last: Pt | null = null;
  count = 0;
  begin() {
    this.first = this.last = null;
    this.count = 0;
  }
  click(p: Pt) {
    if (this.last) {
      this.app.addShape({ type: 'line', a: this.last, b: p });
      this.count++;
    } else this.first = p;
    this.last = p;
    this.app.changed();
  }
  enter() {
    if (!this.last) return this.app.setTool('select');
    this.begin();
    this.app.changed();
  }
  input(s: string) {
    if (s.toLowerCase() === 'c' && this.last && this.first && this.count >= 2) {
      this.app.addShape({ type: 'line', a: this.last, b: this.first });
      this.begin();
      this.app.changed();
      return true;
    }
    const p = parsePoint(s, this.last, this.cur);
    if (!p) return false;
    this.click(p);
    return true;
  }
  base() {
    return this.last;
  }
  preview(): Shape[] {
    return this.last ? [{ type: 'line', a: this.last, b: this.cur }] : [];
  }
  prompt() {
    return this.last ? 'LINE  Next point or [C]lose (Enter to finish):' : 'LINE  First point:';
  }
}

class PolyTool extends BaseTool {
  id = 'polyline';
  pts: Pt[] = [];
  begin() {
    this.pts = [];
  }
  click(p: Pt) {
    this.pts.push(p);
    this.app.changed();
  }
  private commit(closed: boolean) {
    if (this.pts.length >= 2) this.app.addShape({ type: 'poly', pts: this.pts, closed });
    this.pts = [];
    this.app.changed();
  }
  enter() {
    if (!this.pts.length) return this.app.setTool('select');
    this.commit(false);
  }
  input(s: string) {
    if (s.toLowerCase() === 'c' && this.pts.length >= 3) {
      this.commit(true);
      return true;
    }
    const p = parsePoint(s, this.base(), this.cur);
    if (!p) return false;
    this.click(p);
    return true;
  }
  base() {
    return this.pts.length ? this.pts[this.pts.length - 1] : null;
  }
  preview(): Shape[] {
    return this.pts.length ? [{ type: 'poly', pts: [...this.pts, this.cur], closed: false }] : [];
  }
  prompt() {
    return this.pts.length ? 'POLYLINE  Next point or [C]lose (Enter to finish):' : 'POLYLINE  First point:';
  }
}

function rectPts(a: Pt, b: Pt): Pt[] {
  return [a, P(b.x, a.y), b, P(a.x, b.y)];
}

class RectTool extends BaseTool {
  id = 'rect';
  a: Pt | null = null;
  begin() {
    this.a = null;
  }
  click(p: Pt) {
    if (!this.a) this.a = p;
    else {
      if (p.x !== this.a.x && p.y !== this.a.y) this.app.addShape({ type: 'poly', pts: rectPts(this.a, p), closed: true });
      this.a = null;
    }
    this.app.changed();
  }
  input(s: string) {
    const p = parsePoint(s, this.a, this.cur);
    if (!p) return false;
    this.click(p);
    return true;
  }
  base() {
    return this.a;
  }
  preview(): Shape[] {
    return this.a ? [{ type: 'poly', pts: rectPts(this.a, this.cur), closed: true }] : [];
  }
  prompt() {
    return this.a ? 'RECTANGLE  Opposite corner (or @width,height):' : 'RECTANGLE  First corner:';
  }
}

class CircleTool extends BaseTool {
  id = 'circle';
  c: Pt | null = null;
  begin() {
    this.c = null;
  }
  click(p: Pt) {
    if (!this.c) this.c = p;
    else {
      const r = dist(this.c, p);
      if (r > 0) this.app.addShape({ type: 'circle', c: this.c, r });
      this.c = null;
    }
    this.app.changed();
  }
  input(s: string) {
    if (this.c) {
      const r = parseNumber(s);
      if (r !== null && r > 0) {
        this.app.addShape({ type: 'circle', c: this.c, r });
        this.c = null;
        this.app.changed();
        return true;
      }
    }
    const p = parsePoint(s, this.c, this.cur);
    if (!p) return false;
    this.click(p);
    return true;
  }
  base() {
    return this.c;
  }
  preview(): Shape[] {
    return this.c ? [{ type: 'circle', c: this.c, r: dist(this.c, this.cur) }] : [];
  }
  prompt() {
    return this.c ? 'CIRCLE  Radius (click or type a number):' : 'CIRCLE  Center point:';
  }
}

class ArcTool extends BaseTool {
  id = 'arc';
  pts: Pt[] = [];
  begin() {
    this.pts = [];
  }
  click(p: Pt) {
    this.pts.push(p);
    if (this.pts.length === 3) {
      const s = arcFrom3(this.pts[0], this.pts[1], this.pts[2]);
      if (s) this.app.addShape(s);
      else this.app.log('Points are collinear: cannot make an arc.');
      this.pts = [];
    }
    this.app.changed();
  }
  input(s: string) {
    const p = parsePoint(s, this.base(), this.cur);
    if (!p) return false;
    this.click(p);
    return true;
  }
  base() {
    return this.pts.length ? this.pts[this.pts.length - 1] : null;
  }
  preview(): Shape[] {
    if (this.pts.length === 1) return [{ type: 'line', a: this.pts[0], b: this.cur }];
    if (this.pts.length === 2) {
      const s = arcFrom3(this.pts[0], this.pts[1], this.cur);
      return s ? [s] : [{ type: 'poly', pts: [...this.pts, this.cur], closed: false }];
    }
    return [];
  }
  prompt() {
    return ['ARC  Start point:', 'ARC  Second point (on the arc):', 'ARC  End point:'][this.pts.length];
  }
}

class TextTool extends BaseTool {
  id = 'text';
  p: Pt | null = null;
  begin() {
    this.p = null;
  }
  awaitingText() {
    return this.p !== null;
  }
  click(p: Pt) {
    if (!this.p) {
      this.p = p;
      this.app.changed();
    }
  }
  enter() {
    if (this.p) {
      this.p = null;
      this.app.changed();
    } else this.app.setTool('select');
  }
  input(s: string) {
    if (!this.p) {
      const p = parsePoint(s, null, this.cur);
      if (!p) return false;
      this.click(p);
      return true;
    }
    if (s.trim()) this.app.addShape({ type: 'text', p: this.p, text: s, h: this.app.textH });
    this.p = null;
    this.app.changed();
    return true;
  }
  preview(): Shape[] {
    return this.p ? [{ type: 'text', p: this.p, text: '▌', h: this.app.textH }] : [];
  }
  prompt() {
    return this.p ? `TEXT  Type the text (height ${this.app.textH}) and press Enter:` : 'TEXT  Insertion point (use "TH 5" to set height):';
  }
}

class MeasureTool extends BaseTool {
  id = 'measure';
  a: Pt | null = null;
  begin() {
    this.a = null;
  }
  click(p: Pt) {
    if (!this.a) this.a = p;
    else {
      const dx = p.x - this.a.x;
      const dy = p.y - this.a.y;
      this.app.log(`Distance = ${dist(this.a, p).toFixed(4)}   Angle = ${toDeg(angle(this.a, p)).toFixed(2)}°   ΔX = ${dx.toFixed(4)}   ΔY = ${dy.toFixed(4)}`);
      this.a = null;
    }
    this.app.changed();
  }
  input(s: string) {
    const p = parsePoint(s, this.a, this.cur);
    if (!p) return false;
    this.click(p);
    return true;
  }
  base() {
    return this.a;
  }
  preview(): Shape[] {
    return this.a ? [{ type: 'line', a: this.a, b: this.cur }] : [];
  }
  prompt() {
    return this.a ? 'DIST  Second point:' : 'DIST  First point:';
  }
}

// ---------- modify tools ----------
interface Xf {
  f: (p: Pt) => Pt;
  rot: number;
  k: number;
}

abstract class ModTool extends BaseTool {
  stage = 0; // 0 = choose objects, 1 = base point, 2 = target
  bp: Pt | null = null;
  protected copy = false;
  abstract label: string;
  abstract xfFor(target: Pt): Xf | null;
  abstract targetPrompt(): string;

  begin() {
    this.stage = this.app.sel.size ? 1 : 0;
    this.bp = null;
  }
  selecting() {
    return this.stage === 0;
  }
  click(p: Pt) {
    if (this.stage === 1) {
      this.bp = p;
      this.stage = 2;
      this.app.changed();
    } else if (this.stage === 2) this.apply(this.xfFor(p));
  }
  protected apply(x: Xf | null) {
    if (!x) return;
    this.app.transformSelected(x.f, x.rot, x.k, this.copy);
    if (!this.copy) this.app.setTool('select');
    else this.app.changed();
  }
  enter() {
    if (this.stage === 0 && this.app.sel.size) {
      this.stage = 1;
      this.app.changed();
    } else this.app.setTool('select');
  }
  input(s: string) {
    if (this.stage === 1) {
      const p = parsePoint(s, null, this.cur);
      if (!p) return false;
      this.click(p);
      return true;
    }
    if (this.stage === 2) return this.typed(s);
    return false;
  }
  protected typed(s: string): boolean {
    const p = parsePoint(s, this.bp, this.cur);
    if (!p) return false;
    this.click(p);
    return true;
  }
  base() {
    return this.stage === 2 ? this.bp : null;
  }
  preview(): Shape[] {
    if (this.stage !== 2) return [];
    const x = this.xfFor(this.cur);
    if (!x) return [];
    return this.app.selected().map((e) => xform(e, x.f, x.rot, x.k));
  }
  prompt() {
    if (this.stage === 0) return `${this.label}  Select objects, then press Enter:`;
    if (this.stage === 1) return `${this.label}  Base point:`;
    return `${this.label}  ${this.targetPrompt()}`;
  }
}

const translateXf = (bp: Pt, t: Pt): Xf => ({ f: (p) => P(p.x + t.x - bp.x, p.y + t.y - bp.y), rot: 0, k: 1 });

class MoveTool extends ModTool {
  id = 'move';
  label = 'MOVE';
  xfFor(t: Pt) {
    return this.bp ? translateXf(this.bp, t) : null;
  }
  targetPrompt() {
    return 'Second point (or @dx,dy):';
  }
}

class CopyTool extends ModTool {
  id = 'copy';
  label = 'COPY';
  protected copy = true;
  xfFor(t: Pt) {
    return this.bp ? translateXf(this.bp, t) : null;
  }
  targetPrompt() {
    return 'Second point (repeat; Enter to finish):';
  }
}

class RotateTool extends ModTool {
  id = 'rotate';
  label = 'ROTATE';
  private rotXf(a: number): Xf | null {
    const c = this.bp;
    return c ? { f: (p) => rotatePt(p, c, a), rot: a, k: 1 } : null;
  }
  xfFor(t: Pt) {
    return this.bp ? this.rotXf(angle(this.bp, t)) : null;
  }
  protected typed(s: string) {
    const d = parseNumber(s);
    if (d === null) return false;
    this.apply(this.rotXf(toRad(d)));
    return true;
  }
  targetPrompt() {
    return 'Rotation angle (click or type degrees):';
  }
}

class ScaleTool extends ModTool {
  id = 'scale';
  label = 'SCALE';
  private scaleXf(k: number): Xf | null {
    const c = this.bp;
    return c && k > 0 ? { f: (p) => P(c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k), rot: 0, k } : null;
  }
  xfFor(t: Pt) {
    // clicking: factor = distance from base point / 50 px-less reference of 1 unit per 10 world units
    return this.bp ? this.scaleXf(Math.max(dist(this.bp, t) / 10, 0.01)) : null;
  }
  protected typed(s: string) {
    const k = parseNumber(s);
    if (k === null || k <= 0) return false;
    this.apply(this.scaleXf(k));
    return true;
  }
  targetPrompt() {
    return 'Scale factor (type a number, or click: 10 units = ×1):';
  }
}

class EraseTool extends BaseTool {
  id = 'erase';
  stage = 0;
  begin() {
    if (this.app.sel.size) {
      this.app.deleteSelection();
      this.app.setTool('select');
    } else this.stage = 0;
  }
  selecting() {
    return true;
  }
  click() {}
  enter() {
    if (this.app.sel.size) this.app.deleteSelection();
    this.app.setTool('select');
  }
  prompt() {
    return 'ERASE  Select objects, then press Enter:';
  }
}


class TrimTool extends BaseTool {
  id = 'trim';
  click() {
    // use the raw (unsnapped) cursor: the click must land on the part to remove
    const raw = this.app.raw;
    const e = this.app.pickEntity(raw);
    if (!e) return;
    const others = this.app.doc.entities.filter((o) => o.id !== e.id && this.app.doc.isVisible(o));
    const res = trimEntity(e, raw, others);
    if (!res) {
      this.app.log('Nothing to trim there: no other object crosses it (a full circle needs two crossings).');
      return;
    }
    this.app.replaceEntity(e.id, res);
  }
  prompt() {
    return 'TRIM  Click the part of an object to remove (all objects are cutting edges). Enter to finish:';
  }
}

class ExtendTool extends BaseTool {
  id = 'extend';
  click() {
    const raw = this.app.raw;
    const e = this.app.pickEntity(raw);
    if (!e) return;
    const others = this.app.doc.entities.filter((o) => o.id !== e.id && this.app.doc.isVisible(o));
    const res = extendEntity(e, raw, others);
    if (!res) {
      this.app.log('Nothing to extend to: no object lies beyond that end (only lines, arcs and open polylines extend).');
      return;
    }
    this.app.replaceEntity(e.id, [res]);
  }
  prompt() {
    return 'EXTEND  Click an object near the end to extend (all objects are boundaries). Enter to finish:';
  }
}

class OffsetTool extends BaseTool {
  id = 'offset';
  stage = 0; // 0 = distance, 1 = pick object, 2 = pick side
  dp: Pt | null = null;
  entId = 0;
  begin() {
    this.stage = 0;
    this.dp = null;
    this.entId = 0;
    this.app.sel.clear();
  }
  private setDistance(d: number) {
    this.app.offsetDist = d;
    this.dp = null;
    this.stage = 1;
    this.app.log(`Offset distance = ${d}`);
    this.app.changed();
  }
  click(p: Pt) {
    if (this.stage === 0) {
      if (!this.dp) {
        this.dp = p;
        this.app.changed();
      } else if (dist(this.dp, p) > 0) this.setDistance(dist(this.dp, p));
    } else if (this.stage === 1) {
      const e = this.app.pickEntity(this.app.raw);
      if (!e) return;
      if (e.type === 'text') return this.app.log('Text cannot be offset.');
      this.entId = e.id;
      this.app.sel = new Set([e.id]);
      this.stage = 2;
      this.app.changed();
    } else {
      const e = this.app.doc.byId(this.entId);
      const s = e && offsetShape(e, this.app.offsetDist, this.app.raw);
      if (!s) this.app.log('Cannot offset that way (result would be empty).');
      else {
        this.app.addShape(s, e!.layer);
      }
      this.app.sel.clear();
      this.stage = 1;
      this.app.changed();
    }
  }
  enter() {
    if (this.stage === 0) this.setDistance(this.app.offsetDist);
    else this.app.setTool('select');
  }
  input(s: string) {
    if (this.stage === 2) return false;
    const d = parseNumber(s);
    if (d !== null && d > 0) {
      this.setDistance(d);
      return true;
    }
    return false;
  }
  base() {
    return this.stage === 0 ? this.dp : null;
  }
  preview(): Shape[] {
    if (this.stage === 0 && this.dp) return [{ type: 'line', a: this.dp, b: this.cur }];
    if (this.stage !== 2) return [];
    const e = this.app.doc.byId(this.entId);
    const s = e && offsetShape(e, this.app.offsetDist, this.app.raw);
    return s ? [s] : [];
  }
  prompt() {
    if (this.stage === 0) return `OFFSET  Distance <${this.app.offsetDist}> (type a number, click two points, or Enter):`;
    if (this.stage === 1) return `OFFSET  Click the object to offset (distance ${this.app.offsetDist}; type a number to change):`;
    return 'OFFSET  Click the side to offset towards:';
  }
}

export const TOOL_IDS = ['select', 'line', 'polyline', 'rect', 'circle', 'arc', 'text', 'move', 'copy', 'rotate', 'scale', 'trim', 'extend', 'offset', 'erase', 'measure'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export function createTool(id: string, app: App): Tool {
  switch (id) {
    case 'line': return new LineTool(app);
    case 'polyline': return new PolyTool(app);
    case 'rect': return new RectTool(app);
    case 'circle': return new CircleTool(app);
    case 'arc': return new ArcTool(app);
    case 'text': return new TextTool(app);
    case 'move': return new MoveTool(app);
    case 'copy': return new CopyTool(app);
    case 'rotate': return new RotateTool(app);
    case 'scale': return new ScaleTool(app);
    case 'trim': return new TrimTool(app);
    case 'extend': return new ExtendTool(app);
    case 'offset': return new OffsetTool(app);
    case 'erase': return new EraseTool(app);
    case 'measure': return new MeasureTool(app);
    default: return new SelectTool(app);
  }
}
