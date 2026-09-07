// ---------------------------------------------------------------------------
//  Betongdelen tegnet i plan.
//
//  Delen er ei liste FORMER tegnet i plan - rektangel, sirkel eller ei lukka
//  linjefigur - og hver form har et hoeydeintervall. Formen legger betong til
//  (add) eller tar den bort (cut). Legemet er unionen av alle add-formene
//  minus alle cut-formene, i tre dimensjoner: to former som overlapper i plan
//  men ligger i hvert sitt hoeydeintervall roerer ikke hverandre.
//
//  Det er hele modellen. En rett kloss er ett rektangel over hele tykkelsen.
//  En L-form er et rektangel og en utsparing. En rund soeyle er en sirkel. En
//  konsoll er et rektangel som stikker utenfor, med sitt eget hoeydeintervall.
//  Et spor er en utsparing som ikke gaar gjennom.  Legger du to former oppi
//  hverandre, blir de skaaret der linjene moetes - det foelger av at legemet
//  er en mengde, ikke en tegning: bare det som faktisk er ytterkant blir strek.
//
//  ---------------------------------------------------------------------------
//  Hvorfor det gaar an aa regne EKSAKT paa dette
//
//  Ytterkanten av legemet ligger alltid paa kantene til formene - en mengde
//  bygd av union og differanse kan ikke faa kant noe annet sted. Deler vi
//  hver kant i alle punkt der den moeter en annen kant, faar vi et sett
//  segmenter der hvert segment enten er ytterkant hele veien eller ikke i det
//  hele tatt. Da er:
//
//    * INNENFOR/UTENFOR   ett punktproevet oppslag pr. form (stråletest)
//    * SNITT LANGS EI LINJE  linja kuttes i kryssene med kantene, og hvert
//      delintervall klassifiseres ved midtpunktet - eksakt, fordi
//      klassifiseringa ikke kan skifte inne i et delintervall
//    * AREAL  det samme i to trinn: kutt i x der noe skjer, og i hver stripe
//      er intervallendene lineaere i x, saa midtpunktregelen er eksakt
//
//  Sirkler er det eneste unntaket: de deles opp i linjestykker (under 8 grader
//  pr. segment), og bade bildet og beregninga bruker det samme mangekantet.
//  Da kan tallet og tegninga aldri komme i utakt.
//
//  Koordinatene er BETONGDELENS eget system. Plata ligger i (e_x, e_y) i det
//  systemet, saa plate-x = del-x - e_x (se solid.js). z er felles: 0 i overkant
//  av delen, negativt nedover.
// ---------------------------------------------------------------------------

const TOL = 1e-6;
const EPS = 1e-3;                 // sideproeve: 1 um ut fra kanten
const R6 = v => Math.round(v * 1e6) / 1e6;

// Rutenettet i plantegninga. 100 mm er den delinga betongdeler faktisk maales
// i, og den holder tegninga fri for skjeve tall uten aa bli grov.
export const GRID = 100;

// Sirkelen tegnes som mangekant. Under 8 grader pr. segment leses den som
// rund, og knekken mellom to segmenter faller under grensa for naar en
// loddrett kantstrek tegnes i 3D (se CORNER).
const CIRCLE_STEP = 25;           // mm buelengde pr. segment, ca.
const CIRCLE_MIN = 48, CIRCLE_MAX = 96;

// Knekk over dette regnes som et hjoerne, ikke som en jevn kurve.
export const CORNER = 12 * Math.PI / 180;

export const SHAPE_LABEL = { rect: 'Rektangel', circle: 'Sirkel', poly: 'Linjer' };
export const OP_LABEL = { add: 'Betong', cut: 'Utsparing' };

export const planShapes = m => (m.concrete && m.concrete.plan) || [];

// Hoeydeintervallet til en form. null betyr «foelg tykkelsen»: overkant i 0 og
// underkant i -h. Da flytter formene seg med h uten aa maatte skrives om.
export function shapeZ(m, s) {
  const h = Math.abs(+m.concrete.h || 0);
  const z1 = s.z1 == null ? 0 : +s.z1;
  const z0 = s.z0 == null ? -h : +s.z0;
  return [Math.min(z0, z1), Math.max(z0, z1)];
}
export const spansFullDepth = (m, s) => s.z0 == null && s.z1 == null;

// ---------------------------------------------------------------------------
//  Forma som lukka punktfoelge.
// ---------------------------------------------------------------------------
export function shapeLoop(s) {
  if (s.kind === 'circle') {
    const r = Math.abs(+s.r || 0);
    if (!(r > TOL)) return [];
    const n = Math.max(CIRCLE_MIN,
                       Math.min(CIRCLE_MAX, Math.ceil(2 * Math.PI * r / CIRCLE_STEP)));
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      out.push({ x: s.x + r * Math.cos(a), y: s.y + r * Math.sin(a) });
    }
    return out;
  }
  if (s.kind === 'poly')
    return (s.pts || []).map(p => ({ x: +p[0], y: +p[1] }));
  const bx = Math.abs(+s.bx || 0) / 2, by = Math.abs(+s.by || 0) / 2;
  return [{ x: s.x - bx, y: s.y - by }, { x: s.x + bx, y: s.y - by },
          { x: s.x + bx, y: s.y + by }, { x: s.x - bx, y: s.y + by }];
}

// Snoerebandsformelen. Positivt areal = mot klokka, altsaa ytterkant naar
// betongen ligger paa venstre side; negativt = hull.
export function loopArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Stråletest med halvaapen regel: y == at teller som «under». Da er svaret
// entydig ogsaa naar punktet ligger paa en vannrett kant - det klassifiseres
// som om det laa et uendelig lite stykke over. Uten en slik regel ville
// rutenettsnappinga, som legger kanter og boltrader paa de samme linjene,
// gjoere svaret tilfeldig.
function inLoop(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) &&
        x < a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
//  1D-intervallregning. Hoeydene er intervaller, og det er ogsaa snittene
//  langs ei linje - saa union, snitt og differanse gjoer nytte begge steder.
// ---------------------------------------------------------------------------
export function spanMerge(ivs) {
  const s = ivs.filter(i => i[1] > i[0] + TOL).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + TOL) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

export function spanIntersect(a, b) {
  const out = [];
  for (const p of a) for (const q of b) {
    const lo = Math.max(p[0], q[0]), hi = Math.min(p[1], q[1]);
    if (hi > lo + TOL) out.push([lo, hi]);
  }
  return out;
}

export function spanSubtract(a, b) {
  let cur = a.map(iv => [iv[0], iv[1]]);
  for (const [lo, hi] of spanMerge(b)) {
    const next = [];
    for (const [p, q] of cur) {
      if (hi <= p + TOL || lo >= q - TOL) { next.push([p, q]); continue; }
      if (lo > p + TOL) next.push([p, lo]);
      if (hi < q - TOL) next.push([hi, q]);
    }
    cur = next;
  }
  return cur;
}

export const spanLength = ivs => ivs.reduce((s, i) => s + Math.max(0, i[1] - i[0]), 0);

// ---------------------------------------------------------------------------
//  Den bygde plana: formene med lukka punktfoelger og hoeydeintervall, alle
//  kantene delt i krysningspunktene, og et omriss pr. hoeydeskive.
//
//  Bygges om bare naar geometrien faktisk endrer seg - motoren spoer om
//  kantavstander og bruddareal mange ganger pr. beregning.
// ---------------------------------------------------------------------------
let CACHE = { key: null, g: null };

function planKey(m) {
  const c = m.concrete;
  return JSON.stringify([c.h, planShapes(m)]);
}

export function plan(m) {
  const key = planKey(m);
  if (CACHE.key !== key) CACHE = { key, g: build(m) };
  return CACHE.g;
}

function build(m) {
  const list = [];
  for (const s of planShapes(m)) {
    const pts = shapeLoop(s);
    if (pts.length < 3 || Math.abs(loopArea(pts)) < TOL) continue;
    const [z0, z1] = shapeZ(m, s);
    if (!(z1 > z0 + TOL)) continue;
    list.push({ id: s.id, cut: s.op === 'cut', pts, z0, z1 });
  }

  // Omslutningsrektangelet regnes av det som LEGGER betong til. En utsparing
  // som stikker utenfor delen utvider den ikke.
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0, any = false;
  for (const e of list) {
    if (e.cut) continue;
    for (const p of e.pts) {
      if (!any) { x0 = x1 = p.x; y0 = y1 = p.y; any = true; continue; }
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
  }
  const bbox = any ? { x0: R6(x0), x1: R6(x1), y0: R6(y0), y1: R6(y1) }
                   : { x0: 0, x1: 0, y0: 0, y1: 0 };

  const g = { list, bbox, segs: null, _slabs: null };
  g.segs = arrangement(g);
  return g;
}

// ---------------------------------------------------------------------------
//  Alle kantene, delt i hvert punkt der de moeter en annen kant.
//
//  Etter delinga er hvert segment enten ytterkant hele veien eller ikke i det
//  hele tatt - og det er nettopp det som gjoer at to former lagt oppi
//  hverandre blir «skaaret der linjene moetes» av seg selv.
// ---------------------------------------------------------------------------
function arrangement(g) {
  const raw = [];
  for (const e of g.list) {
    const n = e.pts.length;
    for (let i = 0; i < n; i++) {
      const a = e.pts[i], b = e.pts[(i + 1) % n];
      if (Math.hypot(b.x - a.x, b.y - a.y) > TOL)
        raw.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  const cuts = raw.map(() => new Set([0, 1]));
  for (let i = 0; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) split(raw[i], raw[j], cuts[i], cuts[j]);

  const out = [];
  raw.forEach((s, i) => {
    const ts = [...cuts[i]].sort((a, b) => a - b);
    for (let k = 0; k < ts.length - 1; k++) {
      const p = along(s, ts[k]), q = along(s, ts[k + 1]);
      if (Math.hypot(q.x - p.x, q.y - p.y) > TOL) out.push({ p, q });
    }
  });
  return out;
}

const along = (s, t) => ({ x: s.ax + t * (s.bx - s.ax), y: s.ay + t * (s.by - s.ay) });

function split(a, b, ta, tb) {
  const rx = a.bx - a.ax, ry = a.by - a.ay;
  const sx = b.bx - b.ax, sy = b.by - b.ay;
  const den = rx * sy - ry * sx;
  const qx = b.ax - a.ax, qy = b.ay - a.ay;
  const IN = (v) => v > 1e-9 && v < 1 - 1e-9;
  const ON = (v) => v > -1e-9 && v < 1 + 1e-9;
  if (Math.abs(den) > 1e-12) {
    const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    if (IN(t) && ON(u)) ta.add(t);
    if (IN(u) && ON(t)) tb.add(u);
    return;
  }
  // Parallelle kanter: de kan likevel ligge oppaa hverandre et stykke. Da er
  // det den andres endepunkt som er delingspunktet.
  onSeg(a, b.ax, b.ay, ta); onSeg(a, b.bx, b.by, ta);
  onSeg(b, a.ax, a.ay, tb); onSeg(b, a.bx, a.by, tb);
}

function onSeg(s, x, y, set) {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const L2 = dx * dx + dy * dy;
  if (L2 < TOL) return;
  const t = ((x - s.ax) * dx + (y - s.ay) * dy) / L2;
  if (t <= 1e-9 || t >= 1 - 1e-9) return;
  const px = s.ax + t * dx - x, py = s.ay + t * dy - y;
  if (px * px + py * py < 1e-12) set.add(t);
}

// ---------------------------------------------------------------------------
//  Oppslag i legemet.
// ---------------------------------------------------------------------------

// Hoeydeintervalla med betong i soeyla over (x, y).
export function zSpansAt(g, x, y) {
  const add = [], cut = [];
  for (const e of g.list)
    if (inLoop(e.pts, x, y)) (e.cut ? cut : add).push([e.z0, e.z1]);
  if (!add.length) return [];
  return spanSubtract(spanMerge(add), cut);
}

// Er soeyla hel gjennom HELE dybdeintervallet? Det er kravet bruddflatene
// stilles mot: en kjegle som paa veien opp passerer et hull, har ingen betong
// aa rive ut der.
export function coversDepth(g, x, y, zb, zt) {
  const lo = Math.min(zb, zt), hi = Math.max(zb, zt);
  const sp = zSpansAt(g, x, y);
  if (hi - lo < TOL) return sp.some(iv => iv[0] <= lo + TOL && iv[1] >= lo - TOL);
  return sp.some(iv => iv[0] <= lo + TOL && iv[1] >= hi - TOL);
}

// Er det betong i det hele tatt i soeyla? Det er formen sett ovenfra.
export const hasConcreteAt = (g, x, y) => zSpansAt(g, x, y).length > 0;

// ---------------------------------------------------------------------------
//  Snitt langs ei linje.
//
//  Linja kuttes der kantene krysser den, og hvert delintervall klassifiseres
//  ved midtpunktet. Klassifiseringa kan ikke skifte inne i et delintervall -
//  da ville det ha vaert en kant der - saa svaret er eksakt.
//
//    axis  retninga intervalla loeper i ('x' eller 'y')
//    at    posisjonen paa den andre aksen
//    inside(x, y) -> boolean
// ---------------------------------------------------------------------------
export function spansAt(g, axis, at, inside, extra = []) {
  const alongX = axis === 'x';
  const test = alongX ? a => inside(a, at) : a => inside(at, a);
  const cuts = [];
  for (const s of g.segs) {
    const c0 = alongX ? s.p.y : s.p.x, c1 = alongX ? s.q.y : s.q.x;
    const a0 = alongX ? s.p.x : s.p.y, a1 = alongX ? s.q.x : s.q.y;
    if (Math.abs(c0 - at) < TOL) cuts.push(a0);
    if (Math.abs(c1 - at) < TOL) cuts.push(a1);
    if ((c0 - at) * (c1 - at) < 0) cuts.push(a0 + (at - c0) / (c1 - c0) * (a1 - a0));
  }
  for (const v of extra) cuts.push(v);
  if (!cuts.length) return [];
  const xs = [...new Set(cuts.map(R6))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    if (xs[i + 1] - xs[i] < TOL) continue;
    if (!test(mid)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - xs[i]) < TOL) last[1] = xs[i + 1];
    else out.push([xs[i], xs[i + 1]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Areal av (legemet sett ovenfra) klippet mot en union av akseparallelle
//  rektangler. Det er A_c,N.
//
//  Planet deles i striper i x. Kuttene legges der noe kan skje: i hvert
//  endepunkt av et segment (kryssene ligger alt der, siden kantene er delt i
//  dem), i rektanglenes sidekanter, og der en kant krysser en av rektanglenes
//  over- eller underkant. Inne i ei stripe er hver intervallende lineaer i x,
//  saa lengden er lineaer, og midtpunktregelen gir eksakt areal.
// ---------------------------------------------------------------------------
export function areaOfRects(g, rects, inside, cutsX = [], cutsY = []) {
  const rs = rects.filter(r => r.x1 > r.x0 + TOL && r.y1 > r.y0 + TOL);
  if (!rs.length) return 0;
  const lo = Math.min(...rs.map(r => r.x0)), hi = Math.max(...rs.map(r => r.x1));

  const cuts = new Set([R6(lo), R6(hi)]);
  const put = v => { if (v > lo - TOL && v < hi + TOL) cuts.add(R6(v)); };
  for (const r of rs) { put(r.x0); put(r.x1); }
  for (const v of cutsX) put(v);
  const ys = [...new Set([...rs.flatMap(r => [r.y0, r.y1]), ...cutsY])];
  for (const s of g.segs) {
    put(s.p.x); put(s.q.x);
    const dy = s.q.y - s.p.y;
    if (Math.abs(dy) < TOL) continue;
    for (const y of ys) {
      const t = (y - s.p.y) / dy;
      if (t > 0 && t < 1) put(s.p.x + t * (s.q.x - s.p.x));
    }
  }
  const xs = [...cuts].sort((a, b) => a - b);
  let A = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const w = xs[i + 1] - xs[i];
    if (w < TOL) continue;
    const xm = (xs[i] + xs[i + 1]) / 2;
    const band = rs.filter(r => xm > r.x0 && xm < r.x1).map(r => [r.y0, r.y1]);
    if (!band.length) continue;
    const sp = spansAt(g, 'y', xm, inside, cutsY);
    A += w * spanLength(spanIntersect(sp, spanMerge(band)));
  }
  return A;
}

// ---------------------------------------------------------------------------
//  Omrisset: bare de segmentene som faktisk skiller betong fra luft.
//
//  Et segment proeves paa begge sider, en tusendels millimeter ut. Er svaret
//  det samme, er det en soem inne i betongen eller ute i lufta, og det tegnes
//  ikke. Er svaret ulikt, er det ytterkant - og segmentet snus slik at
//  betongen alltid ligger til venstre.
// ---------------------------------------------------------------------------
export function boundary(g, inside) {
  const out = [];
  for (const s of g.segs) {
    const dx = s.q.x - s.p.x, dy = s.q.y - s.p.y;
    const L = Math.hypot(dx, dy);
    if (L < TOL) continue;
    const mx = (s.p.x + s.q.x) / 2, my = (s.p.y + s.q.y) / 2;
    const nx = -dy / L * EPS, ny = dx / L * EPS;
    const left = inside(mx + nx, my + ny), right = inside(mx - nx, my - ny);
    if (left === right) continue;
    out.push(left ? { p: s.p, q: s.q } : { p: s.q, q: s.p });
  }
  return out;
}

const KEY = p => `${R6(p.x)},${R6(p.y)}`;

// Segmentene kjedes til lukka sloeyfer. Moetes fire segmenter i samme punkt -
// to former som krysser hverandre - er det den foerste med klokka fra veien du
// kom, som holder betongen paa venstre side hele veien rundt.
export function chainLoops(segs) {
  const byStart = new Map();
  for (const s of segs) {
    const k = KEY(s.p);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push({ ...s, used: false });
  }
  const loops = [];
  for (const bucket of byStart.values())
    for (const start of bucket) {
      if (start.used) continue;
      const pts = [];
      let cur = start;
      for (let guard = 0; guard < 100000; guard++) {
        cur.used = true;
        pts.push(cur.p);
        const nexts = (byStart.get(KEY(cur.q)) || []).filter(s => !s.used);
        if (!nexts.length) break;
        const inA = Math.atan2(cur.p.y - cur.q.y, cur.p.x - cur.q.x);
        let best = null, bestT = Infinity;
        for (const nx of nexts) {
          let d = inA - Math.atan2(nx.q.y - nx.p.y, nx.q.x - nx.p.x);
          while (d <= 0) d += 2 * Math.PI;
          while (d > 2 * Math.PI) d -= 2 * Math.PI;
          if (d < bestT) { bestT = d; best = nx; }
        }
        if (best === start) break;
        cur = best;
      }
      if (pts.length >= 3) loops.push(pts);
    }
  return loops;
}

// Sloeyfene sortert i ytterkanter med sine hull. Med betongen paa venstre side
// gaar ytterkanter mot klokka (positivt areal) og hull med klokka.
export function facesOf(loops) {
  const outer = [], holes = [];
  for (const l of loops) (loopArea(l) > 0 ? outer : holes).push(l);
  const faces = outer.map(l => ({ outer: l, holes: [] }));
  for (const hle of holes) {
    const p = hle[0];
    let best = null, bestA = Infinity;
    for (const f of faces) {
      const a = Math.abs(loopArea(f.outer));
      if (a < bestA && inLoop(f.outer, p.x, p.y)) { best = f; bestA = a; }
    }
    (best || faces[0])?.holes.push(hle);
  }
  return faces;
}

// ---------------------------------------------------------------------------
//  Legemet som hoeydeskiver.
//
//  Alle over- og underkantene i formene deler hoeyden i skiver. Inne i en
//  skive er planet det samme hele veien, saa skiva er et rett prisme - og
//  naboskiver med samme plan slaas sammen, saa en enkel del blir én skive.
// ---------------------------------------------------------------------------
export function slabs(m) {
  const g = plan(m);
  if (g._slabs) return g._slabs;
  const lv = new Set();
  for (const e of g.list) { lv.add(R6(e.z0)); lv.add(R6(e.z1)); }
  const zs = [...lv].sort((a, b) => a - b);
  const raw = [];
  for (let k = 0; k < zs.length - 1; k++) {
    const z0 = zs[k], z1 = zs[k + 1];
    if (z1 - z0 < TOL) continue;
    const zm = (z0 + z1) / 2;
    const sig = g.list.map(e => (e.z0 <= zm && e.z1 >= zm) ? (e.cut ? 'c' : 'a') : '-').join('');
    if (!sig.includes('a')) continue;
    const last = raw[raw.length - 1];
    if (last && last.sig === sig && Math.abs(last.z1 - z0) < TOL) { last.z1 = z1; continue; }
    raw.push({ z0, z1, sig, zm });
  }
  const out = raw.map(s => {
    const inside = (x, y) => coversDepth(g, x, y, s.zm, s.zm);
    const segs = boundary(g, inside);
    return { z0: s.z0, z1: s.z1, segs, faces: facesOf(chainLoops(segs)) };
  });
  g._slabs = out;
  return out;
}

// Volumet av legemet - grunnlaget for at 3D-visninga og beregninga viser
// samme del.
export function solidVolume(m) {
  let V = 0;
  for (const s of slabs(m))
    for (const f of s.faces)
      V += (loopArea(f.outer) + f.holes.reduce((a, h) => a + loopArea(h), 0)) * (s.z1 - s.z0);
  return V;
}

// ---------------------------------------------------------------------------
//  De ekte kantene paa legemet - til 3D-visninga.
//
//  VANNRETT  et segment i overkant av ei skive tegnes bare naar veggen ikke
//            fortsetter rett opp i skiva over. Fortsetter den, er streken en
//            soem midt i en jevn vegg.
//  LODDRETT  ei loddrett strek tegnes der veggen knekker - ikke i hvert
//            punkt paa en sirkel, som er jevnt krum og ikke har hjoerner.
// ---------------------------------------------------------------------------
export function solidEdges(m) {
  const sl = slabs(m);
  const out = [];
  const sideKey = s => `${KEY(s.p)}|${KEY(s.q)}`;
  const maps = sl.map(s => new Map(s.segs.map(x => [sideKey(x), x])));

  for (let k = 0; k < sl.length; k++) {
    const s = sl[k];
    for (const [zLevel, nb] of [[s.z1, k + 1], [s.z0, k - 1]]) {
      const other = sl[nb] && Math.abs(nb > k ? sl[nb].z0 - s.z1 : sl[nb].z1 - s.z0) < TOL
        ? maps[nb] : null;
      for (const seg of s.segs) {
        if (other && other.has(sideKey(seg))) continue;     // veggen fortsetter
        out.push([[seg.p.x, seg.p.y, zLevel], [seg.q.x, seg.q.y, zLevel]]);
      }
    }
    // Loddrette kanter i hjoernene av skiva.
    for (const f of s.faces)
      for (const loop of [f.outer, ...f.holes])
        for (let i = 0; i < loop.length; i++) {
          const a = loop[(i + loop.length - 1) % loop.length], b = loop[i];
          const c = loop[(i + 1) % loop.length];
          const t1 = Math.atan2(b.y - a.y, b.x - a.x), t2 = Math.atan2(c.y - b.y, c.x - b.x);
          let d = Math.abs(t2 - t1);
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > CORNER) out.push([[b.x, b.y, s.z0], [b.x, b.y, s.z1]]);
        }
  }
  return out;
}

// Omrisset sett ovenfra: alt som har betong i seg, uansett hoeyde. Det er
// figuren plantegninga viser.
export function planOutline(m) {
  const g = plan(m);
  return boundary(g, (x, y) => hasConcreteAt(g, x, y));
}
