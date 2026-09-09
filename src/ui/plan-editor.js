// ---------------------------------------------------------------------------
//  Plantegninga.
//
//  Betongdelen tegnes ovenfra, med de tre verktoeyene ei plantegning trenger
//  og ikke flere: REKTANGEL, SIRKEL og LINJER. Alt snapper til rutenettet paa
//  100 mm, saa maala blir hele tall av seg selv.
//
//  Legger du flere former oppi hverandre, blir de skaaret der linjene moetes:
//  det som vises med tjukk strek er OMRISSET av betongen, ikke de enkelte
//  figurene. De indre linjene forsvinner fordi de ikke er ytterkant lenger.
//  Formene selv staar igjen som svake streker, saa du ser hva tegninga er
//  bygd av og kan ta tak i dem.
//
//  VISKELAERET sletter en form. Det er den ene maaten aa fjerne linjer paa som
//  ikke kan gjoere tegninga tvetydig: en strek som ikke hoerer til noen form,
//  finnes ikke - og da kan du heller ikke bli sittende med en aapen figur som
//  verken er betong eller hull.
//
//  MAALA staar ved sida av linjene og er redigerbare felt. Skriver du et nytt
//  tall, flytter geometrien seg:
//
//    rektangel   bredda endres om senteret, saa delen ikke sklir fra boltene
//    sirkel      diameteren endres om senteret
//    linjer      maalet flytter hjoernet i enden av linja
//
//  Plata og boltene ligger under som svak strek. De er ikke en del av
//  tegninga - de staar der for at du skal se hvor formen maa vaere.
// ---------------------------------------------------------------------------

import { GRID, planShapes, shapeLoop, shapeZ,
         outlineSegments } from '../engine/solid.js';
import { newShape, nextShapeId, anchorPositions } from '../core/model.js';
import { buildBars } from '../engine/reinforcement-geometry.js';

export const TOOLS = [
  ['select', 'Velg',       'Klikk en form for å velge den. Dra for å flytte.'],
  ['rect',   'Rektangel',  'Dra fra hjørne til hjørne.'],
  ['circle', 'Sirkel',     'Dra fra senter og ut.'],
  ['poly',   'Linjer',     'Klikk hjørnene. Lukk i startpunktet, eller trykk Enter.'],
  ['erase',  'Viskelær',   'Klikk en form for å slette den.'],
];

const COL = {
  grid: '#dedad2', grid10: '#cbc6bc', axis: '#b3aca0',
  outline: '#14120f', shape: '#8a857a', sel: '#2f6fb5', cut: '#c0524a',
  ghost: '#6d7a88', draw: '#2f6fb5', dim: '#14120f',
};

const snapTo = (v, step) => Math.round(v / step) * step;
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) &&
        x < a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

// Avstand fra et punkt til ei linjestykke, i verdensenheter.
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export class PlanEditor {
  // host      elementet tegninga skal fylle
  // opts      { model(), onChange(rebuild), onSelect(id), selected() }
  constructor(host, opts) {
    this.host = host;
    this.opts = opts;
    this.tool = 'select';
    this.cutMode = false;          // neste form blir en utsparing
    this.scale = 0.25;             // px pr. mm
    this.ox = 0; this.oy = 0;      // verdenskoordinat i midten av ruta
    this.draft = null;             // forma som tegnes akkurat naa
    this.hover = null;
    this.fitted = '';              // stoerrelsen tegninga sist ble passet inn i
    this.touched = false;          // har du panorert eller zoomet selv?
    this.dimNodes = new Map();

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'plan-canvas';
    this.layer = document.createElement('div');
    this.layer.className = 'plan-dims';
    host.append(this.canvas, this.layer);

    this.ctx = this.canvas.getContext('2d');
    this._bind();
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(host);
  }

  // --- koordinater -------------------------------------------------------
  //  Maalt paa ruta, ikke paa lerretet: et lerret er et erstattet element, og
  //  `inset:0` strekker det ikke foer bredde og hoeyde er satt i piksler. Det
  //  gjoer draw(), men fit() kan komme foerst.
  get w() { return this.host.clientWidth || 1; }
  get h() { return this.host.clientHeight || 1; }
  sx(x) { return this.w / 2 + (x - this.ox) * this.scale; }
  sy(y) { return this.h / 2 - (y - this.oy) * this.scale; }
  wx(px) { return this.ox + (px - this.w / 2) / this.scale; }
  wy(py) { return this.oy - (py - this.h / 2) / this.scale; }

  pointer(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: this.wx(e.clientX - r.left), y: this.wy(e.clientY - r.top) };
  }
  // Rutenettet er 100 mm. Med Alt nede snappes det til 10 mm i stedet, for de
  // gangene noe maa treffe et maal som ikke ligger paa rutenettet.
  snap(p, e) {
    const s = e && e.altKey ? GRID / 10 : GRID;
    return { x: snapTo(p.x, s), y: snapTo(p.y, s) };
  }

  fit() {
    const m = this.opts.model();
    const segs = outlineSegments(m);
    let x0 = -700, x1 = 700, y0 = -700, y1 = 700;
    if (segs.length) {
      const xs = segs.flatMap(s => [s.p.x, s.q.x]), ys = segs.flatMap(s => [s.p.y, s.q.y]);
      x0 = Math.min(...xs); x1 = Math.max(...xs);
      y0 = Math.min(...ys); y1 = Math.max(...ys);
    }
    const pad = 1.35;
    this.ox = (x0 + x1) / 2; this.oy = (y0 + y1) / 2;
    this.scale = Math.min(this.w / Math.max(1, (x1 - x0) * pad),
                          this.h / Math.max(1, (y1 - y0) * pad));
    this.fitted = `${this.w}x${this.h}`;
    this.touched = false;
  }

  // --- hendelser ---------------------------------------------------------
  _bind() {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointerleave', () => { this.hover = null; this.draw(); });
    c.addEventListener('dblclick', e => this.dbl(e));
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const before = { x: this.wx(px), y: this.wy(py) };
      this.touched = true;
      const f = Math.exp(-e.deltaY * 0.0016);
      this.scale = Math.max(0.02, Math.min(8, this.scale * f));
      this.ox += before.x - this.wx(px);
      this.oy += before.y - this.wy(py);
      this.draw();
    }, { passive: false });
    c.addEventListener('keydown', e => this.key(e));
  }

  // Uten peikerfangst mister draget taket når markøren går ut av lerretet.
  // Nettleseren avviser fangst for en peiker den ikke kjenner, og det er
  // ikke noe å gjøre med - draget virker uansett så lenge du er innafor.
  capture(e) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* uten peker */ }
  }

  setTool(t) {
    this.tool = t;
    this.draft = null;
    this.canvas.style.cursor = t === 'select' ? 'default'
      : t === 'erase' ? 'not-allowed' : 'crosshair';
    this.draw();
  }

  key(e) {
    if (e.key === 'Escape') { this.draft = null; this.draw(); return; }
    if (this.draft && this.draft.kind === 'poly') {
      if (e.key === 'Enter') { this.closePoly(); return; }
      if (e.key === 'Backspace') {
        this.draft.pts.pop();
        if (!this.draft.pts.length) this.draft = null;
        this.draw();
        e.preventDefault();
        return;
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.opts.selected()) {
      this.remove(this.opts.selected());
      e.preventDefault();
    }
  }

  down(e) {
    this.canvas.focus();
    // Midtre knapp, hoegre knapp eller mellomrom panorerer - uansett verktoey.
    if (e.button !== 0) {
      this.touched = true;
      this.pan = { px: e.clientX, py: e.clientY, ox: this.ox, oy: this.oy };
      this.capture(e);
      return;
    }
    const p = this.snap(this.pointer(e), e);
    if (this.tool === 'rect' || this.tool === 'circle') {
      this.draft = { kind: this.tool, a: p, b: p };
      this.capture(e);
    } else if (this.tool === 'poly') {
      if (!this.draft) this.draft = { kind: 'poly', pts: [p], at: p };
      else {
        const first = this.draft.pts[0];
        if (this.draft.pts.length >= 3 &&
            dist2(p, first) < (12 / this.scale) ** 2) { this.closePoly(); return; }
        this.draft.pts.push(p);
      }
    } else if (this.tool === 'erase') {
      const hit = this.pick(this.pointer(e));
      if (hit) this.remove(hit.id);
    } else {
      const hit = this.pick(this.pointer(e));
      this.opts.onSelect(hit ? hit.id : null);
      if (hit) {
        this.drag = { id: hit.id, from: p, moved: false,
                      base: JSON.parse(JSON.stringify(hit)) };
        this.capture(e);
      }
    }
    this.draw();
  }

  move(e) {
    if (this.pan) {
      this.ox = this.pan.ox - (e.clientX - this.pan.px) / this.scale;
      this.oy = this.pan.oy + (e.clientY - this.pan.py) / this.scale;
      this.draw();
      return;
    }
    const raw = this.pointer(e);
    const p = this.snap(raw, e);
    if (this.drag) {
      const dx = p.x - this.drag.from.x, dy = p.y - this.drag.from.y;
      if (dx || dy) this.drag.moved = true;
      this.translate(this.drag.id, this.drag.base, dx, dy);
      this.opts.onChange(false);
      this.draw();
      return;
    }
    if (this.draft) {
      if (this.draft.kind === 'poly') this.draft.at = p;
      else this.draft.b = p;
      this.draw();
      return;
    }
    const hit = this.tool === 'select' || this.tool === 'erase' ? this.pick(raw) : null;
    const id = hit ? hit.id : null;
    if (id !== this.hover) { this.hover = id; this.draw(); }
  }

  up(e) {
    if (this.pan) { this.pan = null; return; }
    if (this.drag) {
      const moved = this.drag.moved;
      this.drag = null;
      this.opts.onChange(moved);
      return;
    }
    if (!this.draft || this.draft.kind === 'poly') return;
    const { kind, a, b } = this.draft;
    this.draft = null;
    if (kind === 'rect') {
      const bx = Math.abs(b.x - a.x), by = Math.abs(b.y - a.y);
      if (bx >= GRID / 2 && by >= GRID / 2)
        this.add('rect', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, bx, by });
    } else {
      const r = snapTo(Math.hypot(b.x - a.x, b.y - a.y), GRID / 10);
      if (r >= GRID / 2) this.add('circle', { x: a.x, y: a.y, r });
    }
    this.draw();
  }

  // Dobbeltklikk lukker ei linjefigur, som i de fleste tegneprogram.
  dbl() {
    if (this.draft && this.draft.kind === 'poly') this.closePoly();
  }

  closePoly() {
    const pts = this.draft.pts;
    this.draft = null;
    if (pts.length >= 3) this.add('poly', { pts: pts.map(p => [p.x, p.y]) });
    this.draw();
  }

  // --- modellendringer ---------------------------------------------------
  add(kind, geom) {
    const m = this.opts.model();
    const s = newShape(nextShapeId(m), kind, geom, this.cutMode ? 'cut' : 'add');
    m.concrete.plan.push(s);
    this.opts.onSelect(s.id);
    this.opts.onChange(true);
  }

  remove(id) {
    const m = this.opts.model();
    const i = m.concrete.plan.findIndex(s => s.id === id);
    if (i < 0) return;
    m.concrete.plan.splice(i, 1);
    if (this.opts.selected() === id) this.opts.onSelect(null);
    this.opts.onChange(true);
    this.draw();
  }

  translate(id, base, dx, dy) {
    const s = this.opts.model().concrete.plan.find(q => q.id === id);
    if (!s) return;
    if (base.kind === 'poly') s.pts = base.pts.map(p => [p[0] + dx, p[1] + dy]);
    else { s.x = base.x + dx; s.y = base.y + dy; }
  }

  // Hvilken form ligger under peikaren? Den minste som treffer, saa en liten
  // form oppi en stor kan velges.
  pick(p) {
    const list = planShapes(this.opts.model());
    const near = 7 / this.scale;
    let best = null, bestA = Infinity;
    for (const s of list) {
      const pts = shapeLoop(s);
      if (pts.length < 3) continue;
      let hit = inPoly(pts, p.x, p.y);
      if (!hit) for (let i = 0; i < pts.length && !hit; i++)
        hit = distToSeg(p, pts[i], pts[(i + 1) % pts.length]) < near;
      if (!hit) continue;
      let A = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        A += a.x * b.y - b.x * a.y;
      }
      A = Math.abs(A) / 2;
      if (A < bestA) { bestA = A; best = s; }
    }
    return best;
  }

  // --- tegning -----------------------------------------------------------
  draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = this.host.clientWidth, H = this.host.clientHeight;
    if (!W || !H) return;
    if (this.canvas.width !== Math.round(W * dpr) ||
        this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.canvas.style.width = W + 'px';
      this.canvas.style.height = H + 'px';
    }
    // Passes inn av seg selv til du har panorert eller zoomet - og paa nytt
    // naar ruta endrer stoerrelse, saa tegninga aldri blir staaende i en
    // maalestokk som hoerte til en annen rutestoerrelse.
    if (!this.touched && this.fitted !== `${W}x${H}`) this.fit();
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const m = this.opts.model();
    this.grid(g);
    this.ghost(g, m);
    this.shapes(g, m);
    this.outline(g, m);
    this.drafting(g);
    this.dims(m);
  }

  grid(g) {
    const step = GRID * this.scale;
    if (step < 3) return;
    const x0 = this.wx(0), x1 = this.wx(this.w);
    const y1 = this.wy(0), y0 = this.wy(this.h);
    g.lineWidth = 1;
    for (let x = Math.ceil(x0 / GRID) * GRID; x <= x1; x += GRID) {
      const big = Math.abs(x % (10 * GRID)) < 1e-6;
      if (step < 7 && !big) continue;
      g.strokeStyle = big ? COL.grid10 : COL.grid;
      const px = Math.round(this.sx(x)) + 0.5;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, this.h); g.stroke();
    }
    for (let y = Math.ceil(y0 / GRID) * GRID; y <= y1; y += GRID) {
      const big = Math.abs(y % (10 * GRID)) < 1e-6;
      if (step < 7 && !big) continue;
      g.strokeStyle = big ? COL.grid10 : COL.grid;
      const py = Math.round(this.sy(y)) + 0.5;
      g.beginPath(); g.moveTo(0, py); g.lineTo(this.w, py); g.stroke();
    }
    // Origo er der plata staar i delas system, saa aksekrysset er en peikepinn
    // om hvor tegninga er i forhold til forbindelsen.
    g.strokeStyle = COL.axis;
    g.beginPath();
    g.moveTo(0, Math.round(this.sy(0)) + 0.5); g.lineTo(this.w, Math.round(this.sy(0)) + 0.5);
    g.moveTo(Math.round(this.sx(0)) + 0.5, 0); g.lineTo(Math.round(this.sx(0)) + 0.5, this.h);
    g.stroke();
  }

  // Plata og boltene: ikke en del av tegninga, men det du plasserer betongen
  // i forhold til.
  ghost(g, m) {
    const { ex, ey } = { ex: +m.concrete.ex || 0, ey: +m.concrete.ey || 0 };
    g.save();
    g.strokeStyle = COL.ghost; g.globalAlpha = 0.55; g.lineWidth = 1;
    g.setLineDash([5, 4]);
    if (m.plate.present) {
      const b = m.plate;
      g.strokeRect(this.sx(ex - b.bx / 2), this.sy(ey + b.by / 2),
                   b.bx * this.scale, b.by * this.scale);
    }
    g.setLineDash([]);
    const r = Math.max(2, m.anchors.d / 2 * this.scale);
    for (const q of anchorPositions(m)) {
      g.beginPath();
      g.arc(this.sx(ex + q.x), this.sy(ey + q.y), r, 0, 2 * Math.PI);
      g.stroke();
    }
    g.restore();
    this.reinforcementGhost(g, m, ex, ey);
  }

  // Automatisk generert tilleggsarmering (pkt. 4/9), sett ovenfra: samme
  // punktrekker som 3D-visninga bruker, projisert i planet. Kantbruddbøylene
  // ligger vannrett og viser da hele forma si; de stående U-bøylene til
  // kjeglebrudd viser bare beina. Ikke redigerbar her - bare til orientering.
  reinforcementGhost(g, m, ex, ey) {
    if (!m.reinforcements?.length) return;
    g.save();
    g.strokeStyle = COL.ghost; g.globalAlpha = 0.8; g.lineWidth = 1.25;
    g.setLineDash([2, 3]);
    for (const r of m.reinforcements) {
      for (const bar of buildBars(m, r)) {
        for (const path of bar.paths) {
          if (path.points.length < 2) continue;
          g.beginPath();
          path.points.forEach((p, i) => {
            const x = this.sx(ex + p.x), y = this.sy(ey + p.y);
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
          });
          if (path.closed) g.closePath();
          g.stroke();
        }
      }
    }
    g.restore();
  }

  // Formene tegninga er bygd av. De staar svakt: det er omrisset som er
  // figuren, formene er bare byggeklossene - men de maa vaere synlege for aa
  // kunne velges, flyttes og slettes.
  shapes(g, m) {
    const sel = this.opts.selected();
    for (const s of planShapes(m)) {
      const pts = shapeLoop(s);
      if (pts.length < 3) continue;
      const active = s.id === sel, hot = s.id === this.hover;
      g.save();
      g.lineWidth = active ? 1.6 : 1;
      g.setLineDash(active ? [] : [4, 3]);
      g.globalAlpha = active ? 1 : hot ? 0.8 : 0.3;
      g.strokeStyle = this.tool === 'erase' && hot ? COL.cut
        : active ? (s.op === 'cut' ? COL.cut : COL.sel)
        : s.op === 'cut' ? COL.cut : COL.shape;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(this.sx(p.x), this.sy(p.y))
                               : g.moveTo(this.sx(p.x), this.sy(p.y))));
      g.closePath();
      g.stroke();
      if (active || (this.tool === 'erase' && hot)) {
        g.globalAlpha = 0.12;
        g.fillStyle = s.op === 'cut' ? COL.cut : COL.sel;
        g.fill();
      }
      g.restore();

      // En form som ikke gaar gjennom hele tykkelsen ser ut som en som gjoer
      // det, sett ovenfra. Kotene skrives derfor ved sida av den - ellers
      // kunne en 80 mm grop og et gjennomgaaende hull ikke skilles i plan.
      if (s.z0 != null || s.z1 != null) {
        const [z0, z1] = shapeZ(m, s);
        const x = Math.min(...pts.map(q => q.x)), y = Math.max(...pts.map(q => q.y));
        g.save();
        g.font = '11px ui-monospace, monospace';
        g.fillStyle = s.op === 'cut' ? COL.cut : COL.sel;
        g.globalAlpha = active ? 0.95 : 0.6;
        g.fillText(`kote ${Math.round(z1)} … ${Math.round(z0)}`,
                   this.sx(x) + 3, this.sy(y) - 4);
        g.restore();
      }
    }
  }

  // Omrisset: det som faktisk er ytterkant av betongen.
  outline(g, m) {
    const segs = outlineSegments(m);
    g.save();
    g.strokeStyle = COL.outline; g.lineWidth = 2.2; g.lineJoin = 'round';
    g.beginPath();
    for (const s of segs) {
      g.moveTo(this.sx(s.p.x), this.sy(s.p.y));
      g.lineTo(this.sx(s.q.x), this.sy(s.q.y));
    }
    g.stroke();
    g.restore();
  }

  drafting(g) {
    const d = this.draft;
    if (!d) return;
    g.save();
    g.strokeStyle = this.cutMode ? COL.cut : COL.draw;
    g.lineWidth = 1.6; g.setLineDash([6, 4]);
    g.beginPath();
    if (d.kind === 'rect') {
      g.rect(this.sx(Math.min(d.a.x, d.b.x)), this.sy(Math.max(d.a.y, d.b.y)),
             Math.abs(d.b.x - d.a.x) * this.scale, Math.abs(d.b.y - d.a.y) * this.scale);
    } else if (d.kind === 'circle') {
      const r = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      g.arc(this.sx(d.a.x), this.sy(d.a.y), r * this.scale, 0, 2 * Math.PI);
    } else {
      const pts = [...d.pts, d.at];
      pts.forEach((p, i) => (i ? g.lineTo(this.sx(p.x), this.sy(p.y))
                               : g.moveTo(this.sx(p.x), this.sy(p.y))));
    }
    g.stroke();
    g.restore();
    if (d.kind === 'poly') {
      g.save();
      g.fillStyle = COL.draw;
      for (const p of d.pts) {
        g.beginPath(); g.arc(this.sx(p.x), this.sy(p.y), 3, 0, 2 * Math.PI); g.fill();
      }
      g.restore();
    }
  }

  // --- maal --------------------------------------------------------------
  //  Maalet tegnes som strek paa lerretet, mens selve tallet er et
  //  innskrivingsfelt lagt oppaa. Da kan du skrive et nytt maal rett i
  //  tegninga, og feltet holder skriftstoerrelsen uansett hvor du har zoomet.
  dims(m) {
    const g = this.ctx;
    const items = [];
    const list = planShapes(m);
    const OFF = 26;                     // px ut fra linja

    list.forEach((s, i) => {
      const pts = shapeLoop(s);
      if (pts.length < 3) return;
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      // Et maal som er kortere enn teksten sin, er bare rot. Under 34 px
      // utelates det - zoom inn, saa kommer det.
      const room = (a, b) => Math.hypot(b.x - a.x, b.y - a.y) * this.scale >= 34;
      if (s.kind === 'rect') {
        if (room({ x: x0, y: y0 }, { x: x1, y: y0 }))
          items.push(this.dim(`${s.id}bx`, { x: x0, y: y0 }, { x: x1, y: y0 }, OFF,
            s.bx, v => { s.bx = v; }));
        if (room({ x: x1, y: y0 }, { x: x1, y: y1 }))
          items.push(this.dim(`${s.id}by`, { x: x1, y: y0 }, { x: x1, y: y1 }, OFF,
            s.by, v => { s.by = v; }));
      } else if (s.kind === 'circle') {
        const yc = (y0 + y1) / 2;
        if (room({ x: x0, y: yc }, { x: x1, y: yc }))
          items.push(this.dim(`${s.id}d`, { x: x0, y: yc }, { x: x1, y: yc }, 0,
            2 * s.r, v => { s.r = v / 2; }, '⌀'));
      } else {
        // Ei linjefigur maales linje for linje. Maalet flytter hjoernet i
        // enden av linja, langs linja selv - resten av figuren staar.
        for (let k = 0; k < s.pts.length; k++) {
          const a = { x: s.pts[k][0], y: s.pts[k][1] };
          const nk = (k + 1) % s.pts.length;
          const b = { x: s.pts[nk][0], y: s.pts[nk][1] };
          const L = Math.hypot(b.x - a.x, b.y - a.y);
          if (L * this.scale < 34) continue;
          items.push(this.dim(`${s.id}p${k}`, a, b, OFF * 0.62, L, v => {
            const f = v / L;
            s.pts[nk] = [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
          }));
        }
      }
    });

    // Selve strekene.
    g.save();
    g.strokeStyle = COL.dim; g.lineWidth = 1; g.globalAlpha = 0.75;
    for (const it of items) {
      g.beginPath();
      g.moveTo(it.a.x, it.a.y); g.lineTo(it.b.x, it.b.y);
      // korte hjelpestreker paa tvers i endene
      const nx = it.n.x * 4, ny = it.n.y * 4;
      g.moveTo(it.a.x - nx, it.a.y - ny); g.lineTo(it.a.x + nx, it.a.y + ny);
      g.moveTo(it.b.x - nx, it.b.y - ny); g.lineTo(it.b.x + nx, it.b.y + ny);
      g.stroke();
    }
    g.restore();
    this.syncDims(items);
  }

  // Maalet i skjermkoordinater: fra a til b, forskjoevet `off` px vinkelrett.
  dim(key, a, b, off, value, apply, prefix = '') {
    const A = { x: this.sx(a.x), y: this.sy(a.y) };
    const B = { x: this.sx(b.x), y: this.sy(b.y) };
    const dx = B.x - A.x, dy = B.y - A.y;
    const L = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / L, y: dx / L };
    const sh = { x: n.x * off, y: n.y * off };
    return { key, prefix, value, apply,
             a: { x: A.x + sh.x, y: A.y + sh.y },
             b: { x: B.x + sh.x, y: B.y + sh.y }, n };
  }

  // Feltene gjenbrukes mellom tegningene, saa den du staar og skriver i ikke
  // rives vekk under fingrene paa deg.
  syncDims(items) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.key);
      let node = this.dimNodes.get(it.key);
      if (!node) {
        node = document.createElement('label');
        node.className = 'plan-dim';
        const pre = document.createElement('i');
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = GRID / 10; inp.min = 0;
        inp.autocomplete = 'off';
        node.append(pre, inp);
        node._inp = inp; node._pre = pre;
        inp.addEventListener('change', () => {
          const v = parseFloat(inp.value);
          const cur = this.dimNodes.get(it.key);
          if (Number.isFinite(v) && v > 0) cur._apply(v);
          this.opts.onChange(true);
        });
        this.layer.appendChild(node);
        this.dimNodes.set(it.key, node);
      }
      node._apply = it.apply;
      node._pre.textContent = it.prefix;
      node._pre.hidden = !it.prefix;
      if (document.activeElement !== node._inp)
        node._inp.value = String(Math.round(it.value * 10) / 10);
      node.style.left = `${(it.a.x + it.b.x) / 2}px`;
      node.style.top = `${(it.a.y + it.b.y) / 2}px`;
      node.hidden = false;
    }
    for (const [k, node] of this.dimNodes)
      if (!seen.has(k)) { node.remove(); this.dimNodes.delete(k); }
  }
}
