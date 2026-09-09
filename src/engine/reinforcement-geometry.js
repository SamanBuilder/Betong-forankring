// ---------------------------------------------------------------------------
//  Ren geometri for tilleggsarmering - ingen Three.js, ingen UI. Samme
//  prinsipp som solid.js/geometry.js: motoren returnerer tall og punkter,
//  grafikklaget (scene-builder.js) og plantegninga tegner dem.
//
//  Forma følger hva armeringa skal ta opp - den er ikke den samme for alle:
//
//   STREKK / kjeglebrudd (pkt. 2)
//     U-bøyle i et LODDRETT plan gjennom bolten. Den vannrette delen - bøyen -
//     ligger like under stålplata, og de to beina peker NEDOVER, ett på hver
//     side av bolten, ned gjennom bruddkjegla og videre ned til forankring
//     under den.
//
//   SKJÆR / kantbrudd (pkt. 3)
//     Samme bøyle, men LIGGENDE. Bøyen ligger langs den frie kanten som får
//     kantbrudd, og beina går innover fra kanten - ett på hver side av bolten -
//     forbi bolten og videre inn til forankring utenfor bruddlegemet.
//
//   BØYLE RUNDT BOLTEN (pkt. 4)
//     Lukka ringer som omslutter bolten, stablet nedover langs den.
//
//  Utforminga (r.geometryType) styrer bare hvordan enden er lukket:
//    løkke  = én bøy (U)      bøyle = lukka begge ender      rett = to stenger
//
//  Alle lengder i mm, z = 0 i betongoverflata og negativ nedover, som ellers.
// ---------------------------------------------------------------------------
import { anchorPositions, edgeDistances, memberThickness } from '../core/model.js';
import { minAnchorageFactor, mandrelDiameter, barsPerRow } from '../core/reinforcement.js';
import { STRUT_ANGLE } from './stm.js';

export const DEFAULT_COVER = 30;
const ARC_SEG = 18;                 // punkter i en halvsirkelbøy

// Heftfasthet f_bd, NS-EN 1992-1-1 pkt. 8.4.2 - samme formel som resten av
// verktøyet bruker for heftforankring (se b19.js).
export function fbd(fck, ds, goodBond = true) {
  const fctk = 0.7 * 0.3 * Math.pow(fck, 2 / 3);   // f_ctk;0,05, tab. 3.1
  const fctd = fctk / 1.5;
  const eta1 = goodBond ? 1.0 : 0.7;
  const eta2 = ds <= 32 ? 1.0 : (132 - ds) / 100;
  return 2.25 * eta1 * eta2 * fctd;
}

// Grunnleggende og dimensjonerende forankringslengde langs stanga utenfor
// bruddlegemet, NS-EN 1992-1-1 pkt. 8.4.3/8.4.4 (8.3)/(8.4).
// Forenklet: alpha_2..alpha_5 = 1,0 (ingen kreditt for tverrtrykk, vinkelrett
// armering el.l.) - konservativt, men bør kontrolleres mot faktisk detaljering.
export function anchorageLength(fck, ds, fyd, bent, goodBond = true) {
  const f = fbd(fck, ds, goodBond);
  const lbRqd = (ds / 4) * (fyd / f);                  // fullt utnyttet stang
  const alpha1 = bent ? 0.7 : 1.0;                     // (8.4), krok/bøy
  const lbmin = Math.max(0.3 * lbRqd, 10 * ds, 100);   // (8.6), strekkforankring
  return { lbRqd, lbd: Math.max(alpha1 * lbRqd, lbmin), lbmin, fbd: f };
}

// Effektiv forankringslengde INNE i bruddlegemet - nedre grense etter
// geometritype, spesifikasjonens pkt. 2/3.
export function minInsideLength(ds, geometryType) {
  return minAnchorageFactor(geometryType) * ds;
}

// Effektivt antall bein innenfor sonen 0,75·zoneRef fra fasteneren,
// spesifikasjonens pkt. 2 (0,75·h_ef) / pkt. 3 (0,75·c_1). Beina i en bøyle
// ligger på samme avstand r_off fra boltaksen, så dette blir én sammenligning.
export function effectiveCount(count, rOff, zoneRef) {
  return rOff <= 0.75 * zoneRef ? count : 0;
}

export function anchorsServed(m, r) {
  return anchorPositions(m)
    .filter(p => r.anchorIds === 'all' || r.anchorIds.includes(p.id));
}

// Minste kantavstand for boltene gruppa betjener - brukt som c_1 i skjær.
export function minEdgeForAnchors(m, anchorIds) {
  const pts = anchorPositions(m)
    .filter(p => anchorIds === 'all' || anchorIds.includes(p.id));
  let c = Infinity;
  for (const p of pts) {
    const e = edgeDistances(m, p.x, p.y);
    c = Math.min(c, e.xNeg, e.xPos, e.yNeg, e.yPos);
  }
  return c;
}

// e = utover mot kanten, t = langs kanten, opp = motsatt side.
const AXIS = {
  xNeg: { e: { x: -1, y: 0 }, t: { x: 0, y: 1 }, opp: 'xPos' },
  xPos: { e: { x: 1, y: 0 }, t: { x: 0, y: 1 }, opp: 'xNeg' },
  yNeg: { e: { x: 0, y: -1 }, t: { x: 1, y: 0 }, opp: 'yPos' },
  yPos: { e: { x: 0, y: 1 }, t: { x: 1, y: 0 }, opp: 'yNeg' },
};

// Kanten kantbruddarmeringa skal ligge langs: fri kant i skjærkraftas retning,
// ellers den nærmeste frie kanten. Samme utvalg som kantbruddkontrollen gjør
// i en1992-4.js, men uten kraftfordelinga - her holder retninga på lasta.
export function edgeDirFor(m, pts) {
  const fe = m.concrete.freeEdges, L = m.load || {};
  const inLoad = [];
  if ((L.Vx || 0) > 0 && fe.xPos) inLoad.push('xPos');
  if ((L.Vx || 0) < 0 && fe.xNeg) inLoad.push('xNeg');
  if ((L.Vy || 0) > 0 && fe.yPos) inLoad.push('yPos');
  if ((L.Vy || 0) < 0 && fe.yNeg) inLoad.push('yNeg');
  const list = inLoad.length ? inLoad : ['xNeg', 'xPos', 'yNeg', 'yPos'].filter(d => fe[d]);
  let dir = null, best = Infinity;
  for (const d of list) {
    let c = Infinity;
    for (const p of pts) c = Math.min(c, edgeDistances(m, p.x, p.y)[d]);
    if (c < best) { best = c; dir = d; }
  }
  return dir && Number.isFinite(best) ? dir : null;
}

// ---------------------------------------------------------------------------
//  Målene for én bøyle rundt én bolt. Rene tall - hvor bøyen ligger, hvor
//  langt beina går, hvor mye av dem som ligger inne i bruddlegemet og hvor
//  mye som er forankring utenfor det. Kontrollene i
//  supplementary-reinforcement.js leser disse; punktene tegnes av buildBars().
// ---------------------------------------------------------------------------
export function barGeometry(m, r, anchor) {
  const a = m.anchors, ds = r.ds, cover = r.cover ?? DEFAULT_COVER;
  const bent = r.geometryType !== 'straight';
  const mandrel = mandrelDiameter(ds) / 2;
  // Bøyeradien kan ikke være mindre enn mandrelen, så en tett bøyle rundt en
  // tynn bolt spriker akkurat så mye som bøyen krever.
  const rOff = r.placement === 'manual' && r.width > 0
    ? r.width / 2
    : Math.max(r.clearance + a.d / 2 + ds / 2, bent ? mandrel : 0);
  const { lbd } = anchorageLength(m.concrete.fck, ds, r.fyk / 1.15, bent);
  const manualLeg = r.placement === 'manual' && r.height > 0 ? r.height : null;
  // Bøyen ligger i sin helhet inne i bruddlegemet og teller som forankring
  // der. Den deles på to bein, derfor halve buelengden pr. bein.
  const bendInside = bent ? Math.PI * rOff / 2 : 0;
  const base = { rOff, mandrel, cover, ds, bent, lbd, bendInside };

  // --- pkt. 4: lukka ringer rundt bolten -----------------------------------
  if (r.purpose === 'generic') {
    const dTop = cover + ds / 2;
    const dAvail = Math.max(0, memberThickness(m, [anchor]) - cover);
    const rings = Math.max(1, Math.round(r.count / 2));
    const spacing = manualLeg ?? Math.max(3 * ds, 50);
    const dBot = dTop + (rings - 1) * spacing;
    return { ...base, kind: 'ring', dTop, spacing, rings,
             legLen: 0, insideLen: Math.PI * rOff, outsideLen: 0,
             wanted: dBot, available: dAvail, fits: dBot <= dAvail + 1e-6,
             stmH: Math.max(1, a.hef - dTop) };
  }

  // --- pkt. 3: liggende bøyle langs kanten ---------------------------------
  if (r.purpose === 'shear') {
    const dir = edgeDirFor(m, anchorsServed(m, r));
    if (!dir) {
      return { ...base, kind: 'shear-u', edgeDir: null, c1: Infinity,
               legLen: 0, insideLen: 0, outsideLen: 0,
               wanted: 0, available: 0, fits: false };
    }
    const ed = edgeDistances(m, anchor.x, anchor.y);
    const c1 = ed[dir], cOpp = ed[AXIS[dir].opp];
    // s = avstand innover fra kanten. Bøyens krone står med overdekning fra
    // kanten, beina går innover forbi bolten (s = c_1) og videre l_bd.
    const sCrown = cover;
    const sLegTop = sCrown + (bent ? rOff : 0);
    const sWanted = c1 + lbd;
    const sMax = Number.isFinite(cOpp) ? c1 + cOpp - cover : Infinity;
    const sEnd = Math.min(manualLeg != null ? sLegTop + manualLeg : sWanted, sMax);
    return { ...base, kind: 'shear-u', edgeDir: dir, c1,
             sCrown, sLegTop, sEnd, zLevel: -(cover + ds / 2),
             legLen: Math.max(0, sEnd - sLegTop),
             insideLen: Math.max(0, Math.min(sEnd, c1) - sLegTop) + bendInside,
             outsideLen: Math.max(0, sEnd - Math.max(c1, sLegTop)),
             wanted: sWanted, available: sMax, fits: sWanted <= sMax + 1e-6,
             stmH: Math.max(1, a.hef - (cover + ds / 2)) };
  }

  // --- pkt. 2: bøylene ligger ved siden av boltene, ikke i samme snitt ----
  return tensionLayout(m, r);
}

// ---------------------------------------------------------------------------
//  Kjeglebruddarmering (pkt. 2).
//
//  Bøylene kan ikke stå i samme snitt som boltene - de ville kollidert. De
//  legges derfor ved siden av boltraden, symmetrisk, med minst én bøyle på
//  hver side, og alle innenfor 0,75·h_ef fra bolten (NS-EN 1992-4 / B19).
//
//  Retninga velges av brukeren (r.direction, grader om z-aksen). Bøylene
//  ligger langs den retninga; boltene deles i RADER på tvers av den, og hver
//  rad spennes av sine egne bøyler. Den vannrette delen går over hele raden
//  og stikker ut forbi den ytterste bolten i hver ende - så langt at
//  trykkstaven fra endeplata opp til bøylehjørnet står i 45° mot den
//  vannrette delen (STRUT_ANGLE.target), eller så langt betongen tillater.
// ---------------------------------------------------------------------------
const DEG = 180 / Math.PI;

// Største s der punktet pointAt(s) fortsatt ligger minst `cover` inne i
// betongen. Binærsøk, så det virker for en vilkårlig tegnet plan.
function fitInside(m, pointAt, target, cover) {
  const okAt = s => {
    const p = pointAt(s);
    const e = edgeDistances(m, p.x, p.y);
    return Math.min(e.xNeg, e.xPos, e.yNeg, e.yPos) >= cover;
  };
  if (okAt(target)) return target;
  let lo = 0, hi = target;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (okAt(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

export function tensionLayout(m, r) {
  const a = m.anchors, ds = r.ds, cover = r.cover ?? DEFAULT_COVER, hef = a.hef;
  const rm = mandrelDiameter(ds) / 2;
  const th = (r.direction || 0) / DEG;
  const u = { x: Math.cos(th), y: Math.sin(th) };
  const n = { x: -Math.sin(th), y: Math.cos(th) };
  const pts = anchorsServed(m, r);

  const dCrown = cover + ds / 2;                  // vannrett del, under plata
  const dLegTop = dCrown + rm;                    // der de rette beina starter
  const dAvail = Math.max(0, memberThickness(m, pts) - cover);
  const { lbd } = anchorageLength(m.concrete.fck, ds, r.fyk / 1.15, true);
  const dWanted = hef + lbd;                      // forbi kjegla, pluss l_bd
  const dBot = Math.min(dWanted, dAvail);
  const rise = Math.max(1, hef - dCrown);         // fra endeplate opp til bøylen

  // Sona bøylene kan ligge i: fra der de går klar av bolten, ut til 0,75·h_ef.
  const dMin = r.clearance + a.d / 2 + ds / 2;
  const dMax = 0.75 * hef;
  const nSide = Math.max(1, barsPerRow(r) / 2);
  const zoneOk = dMin <= dMax + 1e-6;

  // Boltene delt i rader på tvers av bøyleretninga.
  const rows = [];
  for (const p of pts) {
    const v = p.x * n.x + p.y * n.y, s = p.x * u.x + p.y * u.y;
    let row = rows.find(q => Math.abs(q.v - v) < 1);
    if (!row) { row = { v, pts: [], uMin: Infinity, uMax: -Infinity }; rows.push(row); }
    row.pts.push(p);
    row.uMin = Math.min(row.uMin, s);
    row.uMax = Math.max(row.uMax, s);
  }

  // ALLE bøylene skal være like - én lengde, ett bøyeskjema. Bøylene ligger i
  // ulik avstand fra bolten, så staven kan ikke stå i 45° for alle samtidig.
  // Det er nettopp derfor vinkelen har et vindu: lengden velges så staven
  // treffer 45° for gjennomsnittsbøylen, og klemmes inn i det området der
  // ALLE bøylene havner mellom 35° og 55°.
  const offsets = [];
  for (let k = 0; k < nSide; k++)
    offsets.push(nSide === 1 ? dMin : dMin + (dMax - dMin) * (k / (nSide - 1)));
  const diags = offsets.map(d => Math.hypot(rise, d));
  const dgMin = Math.min(...diags), dgMax = Math.max(...diags);
  const loL = dgMax / Math.tan(STRUT_ANGLE.max / DEG);   // korteste som holder ≤ 55°
  const hiL = dgMin / Math.tan(STRUT_ANGLE.min / DEG);   // lengste som holder ≥ 35°
  const aimL = diags.reduce((s, d) => s + d, 0) / diags.length / Math.tan(STRUT_ANGLE.target / DEG);
  const windowOk = loL <= hiL;
  const targetL = windowOk ? Math.min(Math.max(aimL, loL), hiL) : loL;

  // Bøylene spenner hele gruppa, ikke bare sin egen rad, så de blir like også
  // når radene er ulikt lange. Utstikket kortes bare hvis betongen tvinger det.
  const uMinAll = Math.min(...rows.map(q => q.uMin));
  const uMaxAll = Math.max(...rows.map(q => q.uMax));
  const at = (s, v) => ({ x: u.x * s + n.x * v, y: u.y * s + n.y * v });
  let L = targetL;
  for (const row of rows)
    for (const d of offsets)
      for (const sgn of [1, -1]) {
        const v = row.v + sgn * d;
        L = Math.min(L, fitInside(m, s => at(uMaxAll + s, v), L, cover),
                        fitInside(m, s => at(uMinAll - s, v), L, cover));
      }

  let alphaMin = Infinity, alphaMax = -Infinity;
  for (const row of rows) {
    row.bars = [];
    // Staven går fra ytterste bolt i RADEN ut til bøylehjørnet, så en kort rad
    // i en bred gruppe gir et lengre sprang - og dermed flatere stav.
    const overStart = L + (row.uMin - uMinAll);
    const overEnd = L + (uMaxAll - row.uMax);
    for (const d of offsets) {
      const diag = Math.hypot(rise, d);
      const alpha = Math.min(Math.atan2(diag, Math.max(overStart, 1e-6)),
                             Math.atan2(diag, Math.max(overEnd, 1e-6))) * DEG;
      const alphaHigh = Math.max(Math.atan2(diag, Math.max(overStart, 1e-6)),
                                 Math.atan2(diag, Math.max(overEnd, 1e-6))) * DEG;
      alphaMin = Math.min(alphaMin, alpha);
      alphaMax = Math.max(alphaMax, alphaHigh);
      for (const sgn of [1, -1])
        row.bars.push({ d, v: row.v + sgn * d, sgn, L, alpha, diag,
                        uStart: uMinAll - L, uEnd: uMaxAll + L,
                        effective: d <= dMax + 1e-6 });
    }
  }

  const angleOk = Number.isFinite(alphaMin) &&
    alphaMin >= STRUT_ANGLE.min - 1e-6 && alphaMax <= STRUT_ANGLE.max + 1e-6;
  const effPerRow = rows.length ? rows[0].bars.filter(b => b.effective).length : 0;
  // Flatest stav styrer stavmodellen: F_c = N/sin α og F_t = N/tan α vokser
  // begge når α blir mindre.
  const govBar = rows.flatMap(q => q.bars)
    .reduce((a, b) => (!a || b.alpha < a.alpha ? b : a), null);

  return {
    kind: 'tension-u', u, n, rows, rm, cover, ds, bent: true,
    dCrown, dLegTop, dBot, rise, lbd,
    legLen: Math.max(0, dBot - dLegTop),
    // Bein inne i kjegla + kvartbøyen i hjørnet, pr. bein.
    insideLen: Math.max(0, Math.min(dBot, hef) - dLegTop) + Math.PI * rm / 2,
    outsideLen: Math.max(0, dBot - Math.max(hef, dLegTop)),
    wanted: dWanted, available: dAvail, fits: dWanted <= dAvail + 1e-6,
    dMin, dMax, zoneOk, nSide, barsPerRow: 2 * nSide, effPerRow,
    effLegsPerRow: 2 * effPerRow, alphaMin, alphaMax, angleOk, windowOk,
    barLength: (uMaxAll - uMinAll) + 2 * L, overhang: L, govBar,
    rOff: dMin, stmH: rise,
  };
}

// ---------------------------------------------------------------------------
//  Punktene. Alle tre formene er den samme bøylen i hver sin ramme:
//    O  senter i bøyen,  u  ut mot det ene beinet,  v  mot bøyens krone.
//  Beina går i −v. Buen tegnes ut, så grafikklaget bare trenger å trekke et
//  rør langs punktrekka.
// ---------------------------------------------------------------------------
const V = (x, y, z) => ({ x, y, z });
const madd = (p, u, s) => V(p.x + u.x * s, p.y + u.y * s, p.z + u.z * s);

function uBar(O, u, v, rOff, legLen, geometryType) {
  const A = madd(O, u, rOff), B = madd(O, u, -rOff);
  if (geometryType === 'straight')
    return [{ points: [madd(A, v, -legLen), A], closed: false },
            { points: [madd(B, v, -legLen), B], closed: false }];

  const pts = [madd(A, v, -legLen)];
  for (let i = 0; i <= ARC_SEG; i++) {
    const phi = Math.PI * i / ARC_SEG;
    pts.push(madd(madd(O, u, rOff * Math.cos(phi)), v, rOff * Math.sin(phi)));
  }
  pts.push(madd(B, v, -legLen));
  if (geometryType !== 'stirrup') return [{ points: pts, closed: false }];

  // Lukka bøyle: bøy i den frie enden også, så stanga går rundt.
  const O2 = madd(O, v, -legLen);
  for (let i = 1; i < ARC_SEG; i++) {
    const psi = Math.PI * i / ARC_SEG;
    pts.push(madd(madd(O2, u, -rOff * Math.cos(psi)), v, -rOff * Math.sin(psi)));
  }
  return [{ points: pts, closed: true }];
}

// Kvartbøy/bue lagt inn i punktrekka. (cu, cz) er senter i bøyen, målt i
// bøylens eget plan: s langs bøyleretninga, z loddrett.
function arcTo(pts, P, cu, cz, rad, a0, a1, seg) {
  for (let i = 0; i <= seg; i++) {
    const phi = a0 + (a1 - a0) * (i / seg);
    pts.push(P(cu + rad * Math.cos(phi), cz + rad * Math.sin(phi)));
  }
}

// Én kjeglebruddbøyle: vannrett del under plata, bøyd 90° i hvert hjørne og
// ned i to bein. «Lukket bøyle» får i tillegg bunn med to bøyer til.
function tensionBarPath(layout, bar, geometryType) {
  const { u, n, rm } = layout;
  const P = (s, z) => V(u.x * s + n.x * bar.v, u.y * s + n.y * bar.v, z);
  const zTop = -layout.dCrown, zBot = -layout.dBot;
  const zTan = zTop - rm;                    // der beinet møter hjørnebøyen
  const seg = Math.max(4, Math.round(ARC_SEG / 2));
  const uA = bar.uStart + rm, uB = bar.uEnd - rm;
  const pts = [];

  if (geometryType === 'closed') {
    const zLo = zBot + rm;
    arcTo(pts, P, uA, zTan, rm, Math.PI, Math.PI / 2, seg);          // topp venstre
    arcTo(pts, P, uB, zTan, rm, Math.PI / 2, 0, seg);                // topp høyre
    arcTo(pts, P, uB, zLo, rm, 0, -Math.PI / 2, seg);                // bunn høyre
    arcTo(pts, P, uA, zLo, rm, -Math.PI / 2, -Math.PI, seg);         // bunn venstre
    return [{ points: pts, closed: true }];
  }

  pts.push(P(bar.uStart, zBot));
  arcTo(pts, P, uA, zTan, rm, Math.PI, Math.PI / 2, seg);
  arcTo(pts, P, uB, zTan, rm, Math.PI / 2, 0, seg);
  pts.push(P(bar.uEnd, zBot));
  return [{ points: pts, closed: false }];
}

function ringBar(anchor, geo, k) {
  const z = -(geo.dTop + k * geo.spacing);
  const pts = [];
  const seg = Math.max(24, ARC_SEG * 2);
  for (let i = 0; i < seg; i++) {
    const phi = 2 * Math.PI * i / seg;
    pts.push(V(anchor.x + geo.rOff * Math.cos(phi),
               anchor.y + geo.rOff * Math.sin(phi), z));
  }
  return [{ points: pts, closed: true }];
}

// ---------------------------------------------------------------------------
//  Alle bøylene i én gruppe. `count` er antall BEIN for hele gruppa (det er
//  summen som kontrolleres mot N_Ed,g/V_Ed,g), delt i par som utgjør én bøyle
//  og fordelt på boltene gruppa betjener - én bøyle pr. bolt før noen bolt får
//  sin andre. Et oddetall bein rundes opp til nærmeste par.
//
//  Kantbruddbøylene legges på de fremste boltene først: det er de som styrer
//  kantbruddet.
// ---------------------------------------------------------------------------
export function buildBars(m, r) {
  let pts = anchorsServed(m, r);
  if (!pts.length) return [];

  // Kjeglebrudd: bøylene følger radene, ikke boltene enkeltvis.
  if (r.purpose === 'tension') {
    const layout = tensionLayout(m, r);
    if (!(layout.legLen > 0)) return [];
    const out = [];
    for (const row of layout.rows)
      for (const bar of row.bars)
        out.push({ anchor: row.pts[0], row, bar, geo: layout, ds: r.ds,
                   paths: tensionBarPath(layout, bar, r.geometryType) });
    return out;
  }

  if (r.purpose === 'shear') {
    const dir = edgeDirFor(m, pts);
    if (!dir) return [];
    pts = [...pts].sort((p, q) =>
      edgeDistances(m, p.x, p.y)[dir] - edgeDistances(m, q.x, q.y)[dir]);
  }

  const total = Math.max(1, Math.round(r.count / 2));
  const rounds = Math.ceil(total / pts.length);
  const out = [];
  for (let k = 0; k < total; k++) {
    const anchor = pts[k % pts.length];
    const round = Math.floor(k / pts.length);
    const geo = barGeometry(m, r, anchor);

    if (geo.kind === 'ring') {
      for (let i = 0; i < geo.rings; i++)
        out.push({ anchor, geo, ds: r.ds, paths: ringBar(anchor, geo, i) });
      break;                        // ringene dekker hele antallet i én omgang
    }
    if (!(geo.legLen > 0)) continue;

    if (geo.kind === 'shear-u') {
      const ax = AXIS[geo.edgeDir];
      // Flere omganger på samme bolt stables nedover langs bolten.
      const z = geo.zLevel - round * Math.max(3 * r.ds, 50);
      const O = V(anchor.x + ax.e.x * (geo.c1 - geo.sLegTop),
                  anchor.y + ax.e.y * (geo.c1 - geo.sLegTop), z);
      out.push({ anchor, geo, ds: r.ds,
        paths: uBar(O, V(ax.t.x, ax.t.y, 0), V(ax.e.x, ax.e.y, 0),
          geo.rOff, geo.legLen, r.geometryType) });
      continue;
    }

    // Stående U: flere omganger på samme bolt dreies rundt boltaksen.
    const ang = (round / rounds) * Math.PI;
    const O = V(anchor.x, anchor.y, -geo.dLegTop);
    out.push({ anchor, geo, ds: r.ds,
      paths: uBar(O, V(Math.cos(ang), Math.sin(ang), 0), V(0, 0, 1),
        geo.rOff, geo.legLen, r.geometryType) });
  }
  return out;
}
