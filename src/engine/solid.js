// ---------------------------------------------------------------------------
//  Betongdelen som legeme - broa mellom plantegninga og beregninga.
//
//  Formen selv ligger i plan.js: ei liste former tegnet i plan, hver med sitt
//  hoeydeintervall. Her gjoeres den om til det motoren spoer om:
//
//    planMask()          soeylene som har hel betong gjennom en dybde
//      .has()            innenfor/utenfor
//      .spans()          betongens utstrekning langs ei linje
//      .area()           bruddareal A_c,N klippet mot den virkelige formen
//    edgeDistancesAt()   kantavstand ved aa gaa utover til betongen slutter
//    thicknessAt()       lokal tykkelse under en bolt
//    surfaceZ()          betongoverflata under plata
//    solidSlabs()        legemet som prismer, til 3D-visninga
//    solidOutline()      bare de ekte kantene
//
//  TO KOORDINATSYSTEM. Formene tegnes i BETONGDELENS system, der (0,0) er
//  tegneorigo. Motoren regner i PLATAS system, der (0,0) er platesenter.
//  Plata ligger i (e_x, e_y) i delas system, saa
//
//      plate = del - e            del = plate + e
//
//  Da staar formene stille naar plata flyttes med e_x / e_y, og en form du
//  har tegnet flytter ikke boltene.
//
//  Sider som ikke er frie regnes uendelige: der fortsetter konstruksjonen, og
//  bruddflata skal ikke stoppe i omrisset. Det gjelder utenfor
//  omslutningsrektangelet paa den sida - inne i det er det den tegnede formen
//  som gjelder, ogsaa der.
// ---------------------------------------------------------------------------

import { plan, planShapes, shapeZ, shapeLoop, spansFullDepth, zSpansAt,
         coversDepth, spansAt, areaOfRects, spanMerge, spanIntersect,
         slabs, solidEdges, solidVolume, planOutline, loopArea,
         GRID, CORNER, SHAPE_LABEL, OP_LABEL } from './plan.js';

const NEAR = 1e-6;
const BIG = 1e9;
const rnd = v => Math.round(v * 1e6) / 1e6;

// Videre ut til resten av motoren, saa ingen andre trenger aa kjenne plan.js.
export { planShapes, shapeZ, shapeLoop, spansFullDepth, slabs, solidVolume,
         loopArea, GRID, CORNER, SHAPE_LABEL, OP_LABEL };
export const mergeSpans = spanMerge;
export const intersectSpans = spanIntersect;

// Forskyvninga mellom de to systemene.
const off = m => ({ ex: +m.concrete.ex || 0, ey: +m.concrete.ey || 0 });
export const toPart = (m, x, y) => ({ x: x + (+m.concrete.ex || 0),
                                      y: y + (+m.concrete.ey || 0) });
export const toPlate = (m, x, y) => ({ x: x - (+m.concrete.ex || 0),
                                       y: y - (+m.concrete.ey || 0) });

// Omslutningsrektangelet i platas system - det som foer var grunnklossen.
// Brukes der det er ytterkanten som er referansen (endeplata, maalsettinga).
// Bruddarealene klippes mot den virkelige formen, ikke mot dette.
export function baseBox(m) {
  const b = plan(m).bbox, { ex, ey } = off(m), h = Math.abs(+m.concrete.h || 0);
  return { x0: rnd(b.x0 - ex), x1: rnd(b.x1 - ex),
           y0: rnd(b.y0 - ey), y1: rnd(b.y1 - ey), z0: rnd(-h), z1: 0 };
}

// Delas utstrekning. Lx og Ly er ikke lenger inndata, men leses av tegninga.
export function planSize(m) {
  const b = plan(m).bbox;
  return { Lx: rnd(b.x1 - b.x0), Ly: rnd(b.y1 - b.y0) };
}

// ---------------------------------------------------------------------------
//  Planmaske: soeylene som har betong gjennom HELE dybdeintervallet [z0, z1].
//
//  Det er den maska bruddflatene skal klippes mot. En kjegle som paa veien opp
//  passerer et hull har ingen betong aa rive ut der, saa soeyla teller ikke -
//  konservativt, og eksakt naar formen er hel.
//
//  Maska svarer i PLATAS system.
// ---------------------------------------------------------------------------
let MASKS = { key: null, map: new Map() };

function maskKey(m) {
  const c = m.concrete;
  return JSON.stringify([c.h, c.ex, c.ey, c.freeEdges, planShapes(m)]);
}

export function planMask(m, z0, z1) {
  const key = maskKey(m);
  if (MASKS.key !== key) MASKS = { key, map: new Map() };
  const zb = Math.min(z0, z1), zt = Math.max(z0, z1);
  const k = `${rnd(zb)}:${rnd(zt)}`;
  if (MASKS.map.has(k)) return MASKS.map.get(k);

  const g = plan(m), { ex, ey } = off(m), fe = m.concrete.freeEdges;
  const b = g.bbox;                                  // delas system
  const ext = { x0: fe.xNeg ? b.x0 : -BIG, x1: fe.xPos ? b.x1 : BIG,
                y0: fe.yNeg ? b.y0 : -BIG, y1: fe.yPos ? b.y1 : BIG };
  const inBase = (x, y) => x > b.x0 - NEAR && x < b.x1 + NEAR &&
                           y > b.y0 - NEAR && y < b.y1 + NEAR;
  const inExt = (x, y) => x > ext.x0 && x < ext.x1 && y > ext.y0 && y < ext.y1;
  // I delas system: hel betong gjennom dybden, eller utenfor omrisset paa ei
  // side som ikke er fri.
  const hasPart = (x, y) => coversDepth(g, x, y, zb, zt) ||
                            (inExt(x, y) && !inBase(x, y));

  // Alle koordinatene der noe kan skje, i platas system. Bruddkjegla bygges
  // over dette rutenettet, saa flata i bildet foelger den samme formen
  // arealet er regnet av.
  const cx = new Set([b.x0 - ex, b.x1 - ex]), cy = new Set([b.y0 - ey, b.y1 - ey]);
  for (const sg of g.segs) {
    cx.add(rnd(sg.p.x - ex)); cx.add(rnd(sg.q.x - ex));
    cy.add(rnd(sg.p.y - ey)); cy.add(rnd(sg.q.y - ey));
  }

  const base = baseBox(m);
  const mask = {
    zb, zt, base, freeEdges: fe,
    xs: [...cx].sort((u, w) => u - w),
    ys: [...cy].sort((u, w) => u - w),
    has: (x, y) => hasPart(x + ex, y + ey),

    // Betongens utstrekning langs en akse, i platas system. Enden forlenges til
    // det uendelige der omrisset slutter paa ei side som ikke er fri.
    spans: (axis, at) => {
      const alongX = axis === 'x';
      const dA = alongX ? ex : ey, dB = alongX ? ey : ex;
      const raw = spansAt(g, axis, at + dB, hasPart,
                          [b.x0, b.x1, b.y0, b.y1].slice(alongX ? 0 : 2, alongX ? 2 : 4));
      const out = raw.map(iv => [rnd(iv[0] - dA), rnd(iv[1] - dA)]);
      if (!out.length) return out;
      const free0 = alongX ? fe.xNeg : fe.yNeg, free1 = alongX ? fe.xPos : fe.yPos;
      const b0 = alongX ? base.x0 : base.y0, b1 = alongX ? base.x1 : base.y1;
      if (!free0 && out[0][0] <= b0 + NEAR) out[0][0] = -BIG;
      const last = out[out.length - 1];
      if (!free1 && last[1] >= b1 - NEAR) last[1] = BIG;
      return out;
    },

    // Areal av (union av rektangler) klippet mot maska. Rektanglene kommer i
    // platas system og flyttes over til delas foer de klippes.
    area: (rects) => areaOfRects(g,
      rects.map(r => ({ x0: r.x0 + ex, x1: r.x1 + ex, y0: r.y0 + ey, y1: r.y1 + ey })),
      hasPart, [b.x0, b.x1], [b.y0, b.y1]),
  };
  MASKS.map.set(k, mask);
  return mask;
}

// De to gamle frittstaaende funksjonene, saa geometry.js ikke trenger aa vite
// at maska naa svarer for seg selv.
export const maskArea = (mask, rects) => mask.area(rects);
export const spansAlong = (mask, axis, at) => mask.spans(axis, at);

// ---------------------------------------------------------------------------
//  Betongoverflata under plata.
//
//  Er det skaaret en grop der plata staar, er det gropas bunn forankringene
//  gaar ned fra: h_ef maales fra den betongoverflata som faktisk finnes, ikke
//  fra et plan som er skaaret vekk. Ligger det en pute under plata, hever den
//  referansen tilsvarende. Maalt i platesenter - det er der plata ligger an.
// ---------------------------------------------------------------------------
export function surfaceZ(m) {
  const g = plan(m), { ex, ey } = off(m);
  const sp = zSpansAt(g, ex, ey);
  return sp.length ? rnd(Math.max(...sp.map(iv => iv[1]))) : 0;
}

// Dybdeintervallet for kjegleberegningen: fra trykkflaten over foten og opp til
// betongoverflata. Det er der betongen maa vaere hel for at kjegla skal ha noe
// aa rive i.
export function anchorDepth(m) {
  const z = surfaceZ(m);
  return [z - Math.abs(m.anchors.hef), z];
}

// ---------------------------------------------------------------------------
//  Kantavstand: gaa utover fra bolten til betongen slutter.
//
//  Med en utsparing foran bolten flytter kanten seg naermere, med en konsoll
//  lenger ut - avstanden leses av formen slik den faktisk staar.
// ---------------------------------------------------------------------------
export function edgeDistancesAt(m, x, y, z0, z1) {
  const mask = planMask(m, z0, z1);
  const out = { xNeg: 0, xPos: 0, yNeg: 0, yPos: 0 };
  if (!mask.has(x, y)) return out;
  for (const alongX of [true, false]) {
    const sp = mask.spans(alongX ? 'x' : 'y', alongX ? y : x);
    const v = alongX ? x : y;
    const iv = sp.find(s => v > s[0] - NEAR && v < s[1] + NEAR);
    const lo = iv ? iv[0] : v, hi = iv ? iv[1] : v;
    out[alongX ? 'xNeg' : 'yNeg'] = lo <= -BIG + 1 ? Infinity : v - lo;
    out[alongX ? 'xPos' : 'yPos'] = hi >= BIG - 1 ? Infinity : hi - v;
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Lokal tykkelse i en soeyle: den sammenhengende betongen som omslutter
//  dybden zRef. En utsparing i overflata gjoer betongen tynnere akkurat der,
//  og det er den tykkelsen psi_h og utstoetingsformlene skal ha.
// ---------------------------------------------------------------------------
export function thicknessAt(m, x, y, zRef) {
  const g = plan(m), { ex, ey } = off(m);
  const z = zRef ?? -Math.abs(m.concrete.h) / 2;
  const iv = zSpansAt(g, x + ex, y + ey)
    .find(s => z > s[0] - NEAR && z < s[1] + NEAR);
  return iv ? rnd(iv[1] - iv[0]) : 0;
}

// Minste lokale tykkelse under et sett punkter - den som styrer.
export function minThickness(m, pts) {
  const zRef = surfaceZ(m) - Math.min(Math.abs(m.anchors.hef), m.concrete.h) / 2;
  let t = Infinity;
  for (const p of pts) t = Math.min(t, thicknessAt(m, p.x, p.y, zRef));
  return Number.isFinite(t) && t > 0 ? t : m.concrete.h;
}

// Er delen noe annet enn en rett kloss?  Ett rektangel over hele tykkelsen er
// den rette klossen; alt annet er en form.
export function isShaped(m) {
  const list = planShapes(m);
  if (list.length !== 1) return true;
  const s = list[0];
  return s.kind !== 'rect' || s.op === 'cut' || !spansFullDepth(m, s);
}

// ---------------------------------------------------------------------------
//  Legemet til 3D-visninga, i PLATAS system.
// ---------------------------------------------------------------------------
const shiftLoop = (loop, ex, ey) => loop.map(p => ({ x: p.x - ex, y: p.y - ey }));

export function solidSlabs(m) {
  const { ex, ey } = off(m);
  return slabs(m).map(s => ({
    z0: s.z0, z1: s.z1,
    faces: s.faces.map(f => ({ outer: shiftLoop(f.outer, ex, ey),
                               holes: f.holes.map(h => shiftLoop(h, ex, ey)) })),
  }));
}

export function solidOutline(m) {
  const { ex, ey } = off(m);
  return solidEdges(m).map(([p, q]) =>
    [[p[0] - ex, p[1] - ey, p[2]], [q[0] - ex, q[1] - ey, q[2]]]);
}

// Omrisset sett ovenfra, i platas system - figuren plantegninga viser.
export function outlineSegments(m) {
  const { ex, ey } = off(m);
  return planOutline(m).map(s => ({ p: { x: s.p.x - ex, y: s.p.y - ey },
                                    q: { x: s.q.x - ex, y: s.q.y - ey } }));
}
