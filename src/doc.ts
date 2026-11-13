import type { Entity, Shape } from './geometry';

export interface Layer {
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export interface DocData {
  layers: Layer[];
  entities: Entity[];
  current: string;
  nextId: number;
}

export const LAYER_COLORS = ['#ffffff', '#ff5555', '#ffd33d', '#3fb950', '#39c5cf', '#4d8dff', '#d070ff'];

export class Doc {
  layers: Layer[] = [{ name: '0', color: '#ffffff', visible: true, locked: false }];
  entities: Entity[] = [];
  current = '0';
  nextId = 1;

  layer(name: string): Layer | undefined {
    return this.layers.find((l) => l.name === name);
  }

  ensureLayer(name: string, color?: string): Layer {
    let l = this.layer(name);
    if (!l) {
      l = { name, color: color ?? LAYER_COLORS[this.layers.length % LAYER_COLORS.length], visible: true, locked: false };
      this.layers.push(l);
    }
    return l;
  }

  add(s: Shape, layer = this.current): Entity {
    const e = { ...s, id: this.nextId++, layer } as Entity;
    this.entities.push(e);
    return e;
  }

  update(id: number, s: Shape): void {
    const i = this.entities.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.entities[i] = { ...s, id, layer: this.entities[i].layer } as Entity;
  }

  remove(ids: Set<number>): void {
    this.entities = this.entities.filter((e) => !ids.has(e.id));
  }

  byId(id: number): Entity | undefined {
    return this.entities.find((e) => e.id === id);
  }

  isVisible(e: Entity): boolean {
    return this.layer(e.layer)?.visible ?? true;
  }

  isLocked(e: Entity): boolean {
    return this.layer(e.layer)?.locked ?? false;
  }

  data(): DocData {
    return { layers: this.layers, entities: this.entities, current: this.current, nextId: this.nextId };
  }

  serialize(): string {
    return JSON.stringify({ v: 1, ...this.data() });
  }

  load(d: DocData): void {
    this.layers = d.layers.length ? d.layers : [{ name: '0', color: '#ffffff', visible: true, locked: false }];
    this.entities = d.entities;
    this.current = this.layer(d.current) ? d.current : this.layers[0].name;
    this.nextId = d.nextId || Math.max(0, ...d.entities.map((e) => e.id)) + 1;
    for (const e of this.entities) this.ensureLayer(e.layer);
  }

  loadJSON(text: string): void {
    const d = JSON.parse(text);
    if (!d || !Array.isArray(d.entities) || !Array.isArray(d.layers)) throw new Error('Not a valid drawing file');
    this.load(d);
  }

  reset(): void {
    this.load({ layers: [], entities: [], current: '0', nextId: 1 });
  }
}

/** Snapshot-based undo/redo. */
export class History {
  private past: string[];
  private future: string[] = [];

  constructor(private doc: Doc) {
    this.past = [doc.serialize()];
  }

  push(): void {
    this.past.push(this.doc.serialize());
    if (this.past.length > 200) this.past.shift();
    this.future = [];
  }

  reset(): void {
    this.past = [this.doc.serialize()];
    this.future = [];
  }

  undo(): boolean {
    if (this.past.length < 2) return false;
    this.future.push(this.past.pop()!);
    this.doc.loadJSON(this.past[this.past.length - 1]);
    return true;
  }

  redo(): boolean {
    const s = this.future.pop();
    if (!s) return false;
    this.past.push(s);
    this.doc.loadJSON(s);
    return true;
  }
}
