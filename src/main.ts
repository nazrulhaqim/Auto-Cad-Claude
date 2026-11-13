import { App } from './app';
import { exportDXF, exportSVG, importDXF, download } from './io';
import { render } from './render';
import { dist, entityLength, toDeg, angle } from './geometry';
import { LAYER_COLORS } from './doc';
import { parseNumber } from './tools';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cv');
const stage = $('stage');
const cmd = $<HTMLInputElement>('cmd');
const ctx = canvas.getContext('2d')!;
const app = new App();

// ---------- tool palette ----------
const ICONS: Record<string, string> = {
  select: '<path d="M5 3l12 8-5 1.5L9.5 18z"/>',
  line: '<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.4"/><circle cx="20" cy="4" r="1.4"/>',
  polyline: '<path d="M3 18l6-10 5 7 7-11"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  arc: '<path d="M4 18a10 10 0 0 1 16 0"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/>',
  scale: '<path d="M4 20L20 4M14 4h6v6M10 20H4v-6"/>',
  trim: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>',
  extend: '<path d="M20 4v16"/><path d="M4 12h12M12 8l4 4-4 4"/>',
  offset: '<path d="M4 20A16 16 0 0 1 20 4"/><path d="M4 14A10 10 0 0 1 14 4"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7L3 17h6zM15 7l6 10h-6z"/>',
  array: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>',
  fillet: '<path d="M5 4v9a7 7 0 0 0 7 7h8"/>',
  chamfer: '<path d="M5 4v8l8 8h7"/>',
  dim: '<path d="M4 7v11M20 7v11M4 14h16M8 12l-4 2 4 2M16 12l4 2-4 2"/>',
  dimal: '<path d="M5 6l-1 5M17 18l1-5M5 9l13 5M8 15l-2.5-1M16 15.5l2.5 1"/><path d="M5 8l13 5"/>',
  dimrad: '<circle cx="10" cy="14" r="6"/><path d="M10 14l8-8M14.5 6H18v3.5"/>',
  erase: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
};
const TOOL_TITLES: Record<string, string> = {
  select: 'Select', line: 'Line (L)', polyline: 'Polyline (PL)', rect: 'Rectangle (REC)', circle: 'Circle (C)', arc: 'Arc, 3 points (A)',
  text: 'Text (T)', move: 'Move (M)', copy: 'Copy (CO)', rotate: 'Rotate (RO)', scale: 'Scale (SC)', mirror: 'Mirror (MI)', array: 'Array (AR)', fillet: 'Fillet (F)', chamfer: 'Chamfer (CHA)', dim: 'Linear dimension (DLI)', dimal: 'Aligned dimension (DAL)', dimrad: 'Radius / diameter dimension (DRA)', trim: 'Trim (TR)', extend: 'Extend (EX)', offset: 'Offset (O)', erase: 'Erase (E)', measure: 'Distance (DI)',
};
const GROUPS = [
  ['select'],
  ['line', 'polyline', 'rect', 'circle', 'arc', 'text'],
  ['move', 'copy', 'rotate', 'scale', 'mirror', 'array', 'trim', 'extend', 'offset', 'fillet', 'chamfer', 'erase'],
  ['dim', 'dimal', 'dimrad', 'measure'],
];
const toolsEl = $('tools');
GROUPS.forEach((g, i) => {
  if (i) toolsEl.appendChild(document.createElement('hr'));
  for (const id of g) {
    const b = document.createElement('button');
    b.dataset.tool = id;
    b.title = TOOL_TITLES[id];
    b.setAttribute('aria-label', TOOL_TITLES[id]);
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[id]}</svg>`;
    b.onclick = () => app.setTool(id);
    toolsEl.appendChild(b);
  }
});

// ---------- command line ----------
const ALIASES: Record<string, string> = {
  L: 'line', LINE: 'line', PL: 'polyline', PLINE: 'polyline', POLYLINE: 'polyline',
  REC: 'rect', RECT: 'rect', RECTANG: 'rect', RECTANGLE: 'rect', C: 'circle', CIRCLE: 'circle', A: 'arc', ARC: 'arc',
  T: 'text', TEXT: 'text', DT: 'text', M: 'move', MOVE: 'move', CO: 'copy', CP: 'copy', COPY: 'copy',
  RO: 'rotate', ROTATE: 'rotate', SC: 'scale', SCALE: 'scale', MI: 'mirror', MIRROR: 'mirror', AR: 'array', ARRAY: 'array', F: 'fillet', FILLET: 'fillet', CHA: 'chamfer', CHAMFER: 'chamfer',
  DLI: 'dim', DIM: 'dim', DIMLINEAR: 'dim', DAL: 'dimal', DIMALIGNED: 'dimal', DRA: 'dimrad', DDI: 'dimrad', DIMRADIUS: 'dimrad', DIMDIAMETER: 'dimrad',
  TR: 'trim', TRIM: 'trim', EX: 'extend', EXTEND: 'extend', O: 'offset', OFFSET: 'offset', E: 'erase', ERASE: 'erase', DEL: 'erase',
  DI: 'measure', DIST: 'measure', MEASURE: 'measure', SEL: 'select', SELECT: 'select',
};

const logEl = $('log');
app.onLog = (msg) => {
  const d = document.createElement('div');
  d.textContent = msg;
  logEl.appendChild(d);
  while (logEl.children.length > 40) logEl.firstChild!.remove();
  logEl.scrollTop = logEl.scrollHeight;
};

function runCommand(text: string): void {
  const t = app.tool;
  if (t.awaitingText()) {
    t.input(text);
    return;
  }
  if (t.input(text)) return;

  const [head, ...rest] = text.trim().split(/\s+/);
  const key = head.toUpperCase();
  const arg = rest.join(' ');
  if (ALIASES[key]) return app.setTool(ALIASES[key]);
  switch (key) {
    case 'U': case 'UNDO': return app.undo();
    case 'REDO': return app.redo();
    case 'ZE': case 'ZOOM': case 'Z': return app.zoomExtents();
    case 'GRID': return toggle('grid');
    case 'ORTHO': return toggle('ortho');
    case 'SNAP': return toggle('gridSnap');
    case 'OSNAP': return toggle('osnap');
    case 'TH': {
      const h = parseNumber(arg);
      if (h && h > 0) {
        app.textH = h;
        app.log(`Text height = ${h}`);
      } else app.log(`Text height is ${app.textH}. Use: TH <number>`);
      return;
    }
    case 'LAYER': case 'LA': {
      if (!arg) return app.log(`Current layer: ${app.doc.current}`);
      app.doc.ensureLayer(arg);
      app.doc.current = arg;
      app.commit();
      return app.log(`Current layer: ${arg}`);
    }
    case 'X': case 'EXPLODE': return app.explodeSelection();
    case 'ALL': return app.selectAll();
    default:
      app.log(`Unknown command or input: "${text}"`);
  }
}

cmd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const v = cmd.value.trim();
    cmd.value = '';
    if (v) {
      app.log(`> ${v}`);
      runCommand(v);
    } else app.tool.enter();
  } else if (e.key === ' ' && cmd.value === '' && !app.tool.awaitingText()) {
    e.preventDefault();
    app.tool.enter();
  } else if (e.key === 'Escape') {
    cmd.value = '';
    app.cancel();
  } else if (e.key === 'Delete' && cmd.value === '') {
    app.deleteSelection();
  }
});

// Typing anywhere sends characters to the command line (AutoCAD-style dynamic input).
window.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); }
    else if (k === 'y') { e.preventDefault(); app.redo(); }
    else if (k === 's') { e.preventDefault(); act('save'); }
    else if (k === 'a' && e.target !== cmd) { e.preventDefault(); app.selectAll(); }
    return;
  }
  if (e.key === 'F3') { e.preventDefault(); toggle('osnap'); }
  else if (e.key === 'F7') { e.preventDefault(); toggle('grid'); }
  else if (e.key === 'F8') { e.preventDefault(); toggle('ortho'); }
  else if (e.key === 'F9') { e.preventDefault(); toggle('gridSnap'); }
  if (e.target === cmd) return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.key === 'Escape') app.cancel();
  else if (e.key === 'Delete' || e.key === 'Backspace') app.deleteSelection();
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.tool.enter(); }
  else if (e.key.length === 1 && !e.altKey) cmd.focus();
});

// ---------- toggles ----------
type Tog = 'grid' | 'gridSnap' | 'osnap' | 'ortho';
function toggle(k: Tog): void {
  app[k] = !app[k];
  app.refreshSnap();
  app.changed();
}
document.querySelectorAll<HTMLButtonElement>('[data-tog]').forEach((b) => {
  b.onclick = () => toggle(b.dataset.tog as Tog);
});

// ---------- top bar actions ----------
const fileInput = $<HTMLInputElement>('file');
function act(name: string): void {
  switch (name) {
    case 'new':
      if (!app.doc.entities.length || confirm('Discard the current drawing?')) app.newDrawing();
      break;
    case 'open': fileInput.click(); break;
    case 'save': download('drawing.json', app.doc.serialize(), 'application/json'); break;
    case 'dxf': download('drawing.dxf', exportDXF(app.doc), 'application/dxf'); break;
    case 'svg': download('drawing.svg', exportSVG(app.doc), 'image/svg+xml'); break;
    case 'png':
      drawNow();
      canvas.toBlob((b) => b && download('drawing.png', b), 'image/png');
      break;
    case 'undo': app.undo(); break;
    case 'redo': app.redo(); break;
    case 'zoomext': app.zoomExtents(); break;
  }
}
document.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
  b.onclick = () => act(b.dataset.act!);
});

fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const text = await f.text();
    if (f.name.toLowerCase().endsWith('.dxf')) {
      const { data, skipped } = importDXF(text);
      app.replaceDocument(data);
      const sk = Object.entries(skipped).map(([k, v]) => `${k}×${v}`).join(', ');
      app.log(`Imported ${data.entities.length} objects from ${f.name}.${sk ? ` Skipped unsupported: ${sk}` : ''}`);
    } else {
      app.doc.loadJSON(text);
      app.replaceDocument(app.doc.data());
      app.log(`Opened ${f.name}.`);
    }
  } catch (err) {
    app.log(`Could not open ${f.name}: ${(err as Error).message}`);
  }
});

// ---------- canvas input ----------
let panning: { x: number; y: number } | null = null;
let drag: { sx: number; sy: number; start: ReturnType<typeof app.view.toWorld>; moved: boolean } | null = null;

const pos = (e: PointerEvent | WheelEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

canvas.addEventListener('pointerdown', (e) => {
  const p = pos(e);
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    panning = p;
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  app.setRaw(app.view.toWorld(p.x, p.y));
  if (app.tool.selecting()) drag = { sx: p.x, sy: p.y, start: app.view.toWorld(p.x, p.y), moved: false };
  else app.tool.click(app.cursor);
});

canvas.addEventListener('pointermove', (e) => {
  const p = pos(e);
  if (panning) {
    app.view.panBy(p.x - panning.x, p.y - panning.y);
    panning = p;
  }
  app.setRaw(app.view.toWorld(p.x, p.y));
  if (drag) {
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) drag.moved = true;
    if (drag.moved) app.selBox = { a: drag.start, b: app.view.toWorld(p.x, p.y) };
  }
  updateStatus();
  app.onInvalidate();
});

canvas.addEventListener('pointerup', (e) => {
  panning = null;
  if (!drag) return;
  const p = pos(e);
  const w = app.view.toWorld(p.x, p.y);
  if (drag.moved) app.selectWindow(drag.start, w, e.shiftKey);
  else app.selectAt(w, e.shiftKey);
  drag = null;
  app.selBox = null;
  app.changed();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  app.tool.enter();
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = pos(e);
  app.view.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  app.setRaw(app.view.toWorld(p.x, p.y));
  updateStatus();
  app.onInvalidate();
}, { passive: false });

// ---------- panels ----------
const layersEl = $('layers');
function renderLayers(): void {
  layersEl.innerHTML = '';
  for (const l of app.doc.layers) {
    const li = document.createElement('li');
    li.className = l.name === app.doc.current ? 'current' : '';
    li.title = 'Click to make current';
    const color = document.createElement('input');
    color.type = 'color';
    color.value = l.color;
    color.onclick = (e) => e.stopPropagation();
    color.onchange = () => { l.color = color.value; app.commit(); };
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = l.name;
    const vis = document.createElement('button');
    vis.className = `ico${l.visible ? ' on' : ''}`;
    vis.textContent = l.visible ? '👁' : '—';
    vis.title = l.visible ? 'Hide layer' : 'Show layer';
    vis.onclick = (e) => { e.stopPropagation(); l.visible = !l.visible; app.commit(); };
    const lock = document.createElement('button');
    lock.className = `ico${l.locked ? ' on' : ''}`;
    lock.textContent = l.locked ? '🔒' : '🔓';
    lock.title = l.locked ? 'Unlock layer' : 'Lock layer';
    lock.onclick = (e) => { e.stopPropagation(); l.locked = !l.locked; app.commit(); };
    li.append(color, name, vis, lock);
    li.onclick = () => { app.doc.current = l.name; app.changed(); };
    layersEl.appendChild(li);
  }
}

$('addLayer').onclick = () => {
  let i = app.doc.layers.length;
  while (app.doc.layer(`Layer${i}`)) i++;
  const l = app.doc.ensureLayer(`Layer${i}`, LAYER_COLORS[i % LAYER_COLORS.length]);
  app.doc.current = l.name;
  app.commit();
};

const propsEl = $('props');
function renderProps(): void {
  const sel = app.selected();
  if (!sel.length) {
    propsEl.textContent = 'Nothing selected.';
    return;
  }
  let html = `<b>${sel.length}</b> selected`;
  if (sel.length === 1) {
    const e = sel[0];
    const len = entityLength(e);
    const parts = [`<b>${e.type}</b>`];
    if (e.type === 'circle' || e.type === 'arc') parts.push(`r = ${e.r.toFixed(3)}`);
    if (len !== null) parts.push(`length = ${len.toFixed(3)}`);
    if (e.type === 'line') parts.push(`angle = ${toDeg(angle(e.a, e.b)).toFixed(2)}°`);
    html += `<br>${parts.join(' · ')}`;
  }
  html += '<select id="selLayer" aria-label="Move selection to layer">';
  const layers = new Set(sel.map((e) => e.layer));
  for (const l of app.doc.layers) html += `<option value="${l.name}"${layers.size === 1 && layers.has(l.name) ? ' selected' : ''}>${l.name}</option>`;
  if (layers.size > 1) html = html.replace('<select', '<select data-mixed').replace('</select>', '<option value="" selected disabled>(mixed layers)</option></select>');
  html += '</select>';
  propsEl.innerHTML = html;
  const sl = propsEl.querySelector<HTMLSelectElement>('#selLayer')!;
  sl.onchange = () => { if (sl.value) app.setSelectionLayer(sl.value); };
}

// ---------- status + refresh ----------
const coordsEl = $('coords');
const deltaEl = $('delta');
const promptEl = $('prompt');

function updateStatus(): void {
  const c = app.cursor;
  coordsEl.textContent = `${c.x.toFixed(4)}, ${c.y.toFixed(4)}`;
  const b = app.tool.base();
  deltaEl.textContent = b ? `d=${dist(b, c).toFixed(3)} ∠${toDeg(angle(b, c)).toFixed(1)}°` : '';
}

function refreshUI(): void {
  renderLayers();
  renderProps();
  promptEl.textContent = app.tool.prompt();
  promptEl.title = app.tool.prompt();
  toolsEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('active', b.dataset.tool === app.tool.id));
  document.querySelectorAll<HTMLButtonElement>('[data-tog]').forEach((b) => b.classList.toggle('on', app[b.dataset.tog as Tog]));
  updateStatus();
}
app.onChange = refreshUI;

// ---------- render loop ----------
let dirty = true;
app.onInvalidate = () => { dirty = true; };
let dpr = 1;

let sized = false;
function resize(): void {
  const r = stage.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  // keep the drawing from jumping when the stage height changes: pin the view's top edge
  if (sized) app.view.oy += (app.view.h - r.height) / app.view.scale;
  sized = true;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  app.view.w = r.width;
  app.view.h = r.height;
  dirty = true;
}
new ResizeObserver(resize).observe(stage);

function drawNow(): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render(ctx, app.drawState());
  dirty = false;
}

function frame(): void {
  if (dirty) drawNow();
  requestAnimationFrame(frame);
}

resize();
if (app.doc.entities.length) app.zoomExtents();
refreshUI();
app.log('Ready. Pick a tool on the left, or type a command (L, PL, REC, C, A, T, M, CO, RO, SC, MI, AR, TR, EX, O, F, CHA, DLI, DI).');
requestAnimationFrame(frame);

// expose for debugging / tests
(window as unknown as { cad: App }).cad = app;
