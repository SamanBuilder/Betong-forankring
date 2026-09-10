// ---------------------------------------------------------------------------
//  Ren geometri for tilleggsarmering - ingen Three.js, ingen UI. Samme
//  prinsipp som solid.js/geometry.js: motoren returnerer tall og punkter,
//  grafikklaget (scene-builder.js) og plantegninga tegner dem.
//
//  Forma følger hva armeringa skal ta opp - den er ikke den samme for alle:
//
//   STREKK / kjeglebrudd (pkt. 7.2.1.2)
//     U-bøyle i et LODDRETT plan like ved bolten. Den vannrette delen - bøyen -
//     ligger rett under overflatearmeringa, som den omslutter, og de to beina
//     peker NEDOVER, ett på hver side av bolten, ned gjennom bruddkjegla og
//     videre ned til forankring under den. Rett stang er det samme uten bøy:
//     en loddrett stang like ved bolten. Avstanden fra boltaksen til beinet
//     styrer plasseringa - se tensionLayout().
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
import { anchorPositions, edgeDistances, memberThickness,
         memberLimits, anchorFoot } from '../core/model.js';
import { coneSurfaceDepth } from './geometry.js';
import { minAnchorageFactor, mandrelDiameter, barsPerAnchor,
         minBarSpacing, bendBarDiameter } from '../core/reinforcement.js';

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
  const a = m.anchors, ds = r.ds;
  const coverTop = r.coverTop ?? DEFAULT_COVER, coverBottom = r.coverBottom ?? DEFAULT_COVER;
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
  const base = { rOff, mandrel, coverTop, coverBottom, ds, bent, lbd, bendInside };

  // --- pkt. 4: lukka ringer rundt bolten -----------------------------------
  if (r.purpose === 'generic') {
    const dTop = coverTop + ds / 2;
    const dAvail = Math.max(0, memberThickness(m, [anchor]) - coverBottom);
    const rings = Math.max(1, Math.round(r.count / 2));
    const spacing = manualLeg ?? Math.max(3 * ds, 50);
    const dBot = dTop + (rings - 1) * spacing;
    return { ...base, kind: 'ring', dTop, spacing, rings,
             legLen: 0, insideLen: Math.PI * rOff, outsideLen: 0,
             wanted: dBot, available: dAvail, fits: dBot <= dAvail + 1e-6,
             stmH: Math.max(1, a.hef - dTop) };
  }

  // --- pkt. 3: liggende bøyle langs kanten ---------------------------------
  // Bøylen ligger i ett vannrett nivå - underkant betong er ikke aktuell her,
  // så bare coverTop (avstand ned fra overflata) brukes.
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
    const sCrown = coverTop;
    const sLegTop = sCrown + (bent ? rOff : 0);
    const sWanted = c1 + lbd;
    const sMax = Number.isFinite(cOpp) ? c1 + cOpp - coverTop : Infinity;
    const sEnd = Math.min(manualLeg != null ? sLegTop + manualLeg : sWanted, sMax);
    return { ...base, kind: 'shear-u', edgeDir: dir, c1,
             sCrown, sLegTop, sEnd, zLevel: -(coverTop + ds / 2),
             legLen: Math.max(0, sEnd - sLegTop),
             insideLen: Math.max(0, Math.min(sEnd, c1) - sLegTop) + bendInside,
             outsideLen: Math.max(0, sEnd - Math.max(c1, sLegTop)),
             wanted: sWanted, available: sMax, fits: sWanted <= sMax + 1e-6,
             stmH: Math.max(1, a.hef - (coverTop + ds / 2)) };
  }

  // --- pkt. 2: bøylene ligger ved siden av boltene, ikke i samme snitt ----
  return tensionLayout(m, r);
}

// ---------------------------------------------------------------------------
//  Kjeglebruddarmering - NS-EN 1992-4 pkt. 7.2.1.2, jf. B19.3.2.6.
//
//  PLASSERING (dette er kravet som styrer geometrien):
//
//    Avstanden fra BOLTAKSEN til det LODDRETTE BEINET på tilleggsarmeringa
//    skal være <= 0,75*h_ef. Det er den FAKTISKE avstanden i planet -
//    sqrt(dx^2 + dy^2) fra bolten til beinet - ikke avstanden langs x eller y
//    hver for seg. Beinet ligger både forskjøvet på TVERS av bøyleretninga
//    (d, for å gå klar av bolten) og et stykke LANGS den (halve bøylebredda,
//    a), så den virkelige avstanden er hypot(a, d).
//
//    0,75*h_ef er en ØVRE grense for hvor langt unna et bein fortsatt regnes
//    som effektivt - ikke en anbefalt plassering. Armeringa legges derfor
//    symmetrisk om bolten og så nær den som praktisk mulig: første bøyle
//    akkurat klar av bolten, resten pakket utover med minste tillatte
//    senteravstand etter NS-EN 1992-1-1 pkt. 8.2 (minBarSpacing).
//
//  Dette erstatter den tidligere plasseringa, der den vannrette delen ble
//  strukket ut forbi ytterste bolt for å få en trykkstav i 45°. Stavvinkelen
//  er ikke et plasseringskrav i 1992-4, og ga bein som lå langt utenfor
//  0,75*h_ef.
//
//  UTFORMING:
//    U-bøyle / lukket bøyle  Bøyen ligger vannrett rett under overflate-
//      armeringa, så den omslutter overflatenettet og fører strekkraften
//      videre inn i det. Beina går ned gjennom kjegla og videre til
//      forankring under den. l_1 >= 4*⌀ inne i kjegla.
//    Rett stang  Ingen bøy, ingen omslutting av overflatearmeringa. Stanga
//      står loddrett like ved bolten, forankres inne i kjegla (l_1 >= 10*⌀)
//      og kobles til konstruksjonens armering med overlapp (kontrolleres for
//      seg i supplementary-reinforcement.js).
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

// Dybden ned til den vannrette delen av bøylen. Skal bøyen omslutte
// overflatearmeringa, legges den rett under nettet - ellers bare med sin egen
// overdekning. Rett stang har ingen bøy å legge noe sted.
// ---------------------------------------------------------------------------
//  Hvor den vannrette delen av bøylen ligger.
//
//  Bøyen krøller seg RUNDT stanga som ligger i den, så bøylen ligger OVER
//  stanga - ikke under. Stanga nøster seg inn i bøyen: overkant stang tangerer
//  innsida av bøyen i toppen. Med bøylens senterlinje i dybde d_crown ligger
//  innsida av bøyen i d_crown + ⌀_s/2, og stanga får senter i
//  d_crown + ⌀_s/2 + ⌀_b/2.
//
//  To måter å skaffe den stanga på (r.bendBar):
//
//   'surface'  Overflatearmeringa brukes. Nettet ligger der det ligger, og
//              BØYLEN følger etter: den legges rett over det laget som går på
//              tvers av bøyleretninga (lag 2, det innerste - se
//              buildSurfaceMesh, som legger nettet nettopp slik). Da blir
//              d_crown = nivået til lag 2 − ⌀_nett/2 − ⌀_s/2, altså akkurat
//              høyt nok til at bøyen omslutter stanga.
//   'own'      Egen stang i bøyen. Bøylen står fritt og får sin egen
//              overdekning; stanga legges inne i bøyen etter formelen over.
// ---------------------------------------------------------------------------
export function crownDepth(r) {
  const ds = r.ds, coverTop = r.coverTop ?? DEFAULT_COVER;
  const bent = r.geometryType !== 'straight';
  if (!bent) return { wrap: false, mode: 'none', dBend: 0, dCrown: coverTop + ds / 2 };

  const sr = r.surfaceReinf || {};
  const useMesh = r.bendBar !== 'own' && !!sr.present;
  if (useMesh) {
    const dt = sr.ds ?? 0;
    const dBend = surfaceMeshLevels(r)[1];              // laget på tvers
    return { wrap: true, mode: 'surface', dBend, dt,
             dCrown: dBend - dt / 2 - ds / 2 };
  }
  const dt = bendBarDiameter(r);
  const dCrown = coverTop + ds / 2;
  return { wrap: false, mode: 'own', dt, dCrown, dBend: dCrown + ds / 2 + dt / 2 };
}

// Nivåa til de to lagene i overflatenettet, målt til senter av stanga.
// Lag 1 ligger ytterst (i overdekninga) og går LANGS bøyleretninga; lag 2
// ligger rett innenfor og går på TVERS - det er lag 2 bøyen omslutter, og
// derfor det som må ligge innerst.
export function surfaceMeshLevels(r) {
  const sr = r.surfaceReinf || {};
  const c = sr.cover ?? (r.coverTop ?? DEFAULT_COVER), d = sr.ds ?? 0;
  return [c + d / 2, c + d + d / 2];
}

export function tensionLayout(m, r) {
  const a = m.anchors, ds = r.ds, hef = a.hef;
  // Overkant styrer hvor den vannrette delen ligger (og dermed hvor beina
  // starter), underkant hvor langt ned beina får lov å gå.
  const coverTop = r.coverTop ?? DEFAULT_COVER, coverBottom = r.coverBottom ?? DEFAULT_COVER;
  const bent = r.geometryType !== 'straight';
  const rm = mandrelDiameter(ds) / 2;
  const th = (r.direction || 0) / DEG;
  const u = { x: Math.cos(th), y: Math.sin(th) };
  const nv = { x: -Math.sin(th), y: Math.cos(th) };
  const pts = anchorsServed(m, r);

  const cd = crownDepth(r);
  const { wrap: wrapSurface, dCrown } = cd;
  const dBend = cd.dBend;                          // stanga inne i bøyen
  const dtBend = cd.dt ?? 0;                       // ...og diameteren dens
  const dLegTop = bent ? dCrown + rm : coverTop;   // der det rette beinet starter
  const dAvail = Math.max(0, memberThickness(m, pts) - coverBottom);
  const { lbd, lbRqd, lbmin } = anchorageLength(m.concrete.fck, ds, r.fyk / 1.15, bent);
  const dWanted = hef + lbd;                       // forbi kjegla, pluss l_bd
  const dBot = Math.min(dWanted, dAvail);

  // --- sona og pakkinga -----------------------------------------------------
  // dMax  maksimal FAKTISK avstand bolt -> bein (0,75*h_ef)
  // a     halve bøylebredda: hvor langt beina står fra boltsnittet LANGS
  //       bøyleretninga. Så trangt bøyen tillater (2*rm mellom beina), med
  //       mindre brukeren har oppgitt en bredde.
  // dMin  første bøyle: akkurat klar av bolten på TVERS av retninga
  // dLim  den største tverravstanden som fortsatt gir hypot(a, d) <= dMax
  const dMax = 0.75 * hef;
  const halfSpan = bent ? Math.max(rm, (r.span > 0 ? r.span / 2 : rm)) : 0;
  // Rett stang har ingen spennvidde å strekke over en rad - den står alltid
  // ved sin egen bolt.
  const barLayout = bent ? (r.barLayout === 'row' ? 'row' : 'anchor') : 'anchor';
  const dMin = r.clearance + a.d / 2 + ds / 2;
  const dLim = halfSpan < dMax ? Math.sqrt(dMax * dMax - halfSpan * halfSpan) : 0;
  const zoneOk = dMin <= dLim + 1e-6;
  const sMin = minBarSpacing(ds, m.concrete?.dg);
  const nSide = Math.max(1, Math.round(barsPerAnchor(r) / 2));
  const offsets = [];
  for (let k = 0; k < nSide; k++) offsets.push(dMin + k * sMin);

  // --- endebøy --------------------------------------------------------------
  // Bøy i enden av beina, ut fra bolten (bare på åpen U-bøyle - den lukka har
  // ingen frie ender, og rett stang har ingen bøy). Bøyen med foten teller som
  // forankring, og flytter samtidig punktet den nye kjegla regnes fra utover.
  const endBend = !!r.endBend && r.geometryType === 'ubar';
  const bendArc = bent ? Math.PI * rm / 2 : 0;     // kvartbøy i hjørnet
  const legBottom = endBend ? Math.max(dLegTop, dBot - rm) : dBot;
  const straightOutside = Math.max(0, legBottom - Math.max(hef, dLegTop));
  const at = (s, v) => ({ x: u.x * s + nv.x * v, y: u.y * s + nv.y * v });

  let footLen = 0;
  if (endBend) {
    const need = r.endBendLength > 0
      ? r.endBendLength
      : Math.max(0, lbd - straightOutside - bendArc);
    footLen = need;
    for (const p of pts) {
      const sp = p.x * u.x + p.y * u.y, v0 = p.x * nv.x + p.y * nv.y;
      for (const d of offsets)
        for (const sgn of [1, -1]) {
          const v = v0 + sgn * d;
          footLen = Math.min(footLen,
            fitInside(m, t => at(sp + halfSpan + rm + t, v), need, coverTop),
            fitInside(m, t => at(sp - halfSpan - rm - t, v), need, coverTop));
        }
    }
  }
  const anchorageAvail = straightOutside + (endBend ? bendArc + footLen : 0);

  // --- bøylene --------------------------------------------------------------
  // Én bøyle pr. offset pr. side pr. bolt, symmetrisk om bolten. To bolter som
  // ligger tett kan gi bøyler i samme snitt - de slås sammen til én, ellers
  // ville den samme stanga blitt talt to ganger.
  const bars = [];
  const seen = new Map();
  const reach = endBend ? rm + footLen : 0;
  // «Bøyle om hver bolt» gir én spennvidde pr. bolt; «bøyle over hele
  // boltraden» slår boltene som ligger på linje langs bøyleretninga sammen,
  // så bøylen spenner fra ytterste til ytterste med beina rett utenfor
  // hjørneboltene.
  const spans = [];
  if (barLayout === 'row') {
    for (const p of pts) {
      const sp = p.x * u.x + p.y * u.y, vp = p.x * nv.x + p.y * nv.y;
      let row = spans.find(q => Math.abs(q.v0 - vp) < 1);
      if (!row) { row = { v0: vp, sLo: sp, sHi: sp, pts: [] }; spans.push(row); }
      row.sLo = Math.min(row.sLo, sp); row.sHi = Math.max(row.sHi, sp);
      row.pts.push(p);
    }
    for (const q of spans) q.s0 = (q.sLo + q.sHi) / 2;
  } else {
    for (const p of pts) {
      const sp = p.x * u.x + p.y * u.y;
      spans.push({ v0: p.x * nv.x + p.y * nv.y, sLo: sp, sHi: sp, s0: sp, pts: [p] });
    }
  }

  for (const row of spans) {
    const { s0, v0 } = row;
    for (const d of offsets)
      for (const sgn of [1, -1]) {
        const v = v0 + sgn * d;
        const uStart = row.sLo - halfSpan, uEnd = row.sHi + halfSpan;
        const key = `${Math.round(v)}|${Math.round(uStart)}|${Math.round(uEnd)}`;
        const hit = seen.get(key);
        if (hit) { for (const q of row.pts) if (!hit.anchors.includes(q)) hit.anchors.push(q); continue; }
        const bar = {
          d, v, sgn, s0, uStart, uEnd, halfSpan, endBend, footLen, legBottom,
          anchors: [...row.pts],
          // Loddrette bein i planet. Rett stang har bare ett.
          legs: bent ? [at(uStart, v), at(uEnd, v)] : [at(s0, v)],
          // Punktene den nye kjegla regnes fra: enden av foten, ellers bunnen
          // av beinet.
          endPoints: bent
            ? [at(uStart - reach, v), at(uEnd + reach, v)]
            : [at(s0, v)],
        };
        seen.set(key, bar);
        bars.push(bar);
      }
  }

  // --- hvilke bein hver bolt kan regne med ----------------------------------
  // Et bein teller for en bolt bare når den faktiske avstanden i planet er
  // <= 0,75*h_ef. Ligger beinet innenfor sona til flere bolter, deles det
  // mellom dem - ellers ville den samme stanga blitt regnet med to ganger.
  //
  //  Samtidig regnes det ut hvor BRUDDKJEGLA krysser hvert bein. Kjegla er en
  //  kjegle: den starter ved foten i dybde z_top og sprer seg opp og ut. Et
  //  bein som står et stykke fra bolten treffer derfor kjegleflata GRUNNERE
  //  enn h_ef, og bare biten over krysningspunktet ligger inne i bruddlegemet.
  //  Det er den biten som er l_1 - ikke hele beinet ned til h_ef.
  const foot = anchorFoot(m);
  const legs = [];
  for (const b of bars)
    for (const q of b.legs) {
      const serves = pts.filter(p => Math.hypot(q.x - p.x, q.y - p.y) <= dMax + 1e-6);
      const zCone = coneSurfaceDepth(m, foot, pts, hef, q.x, q.y);
      // Uten fot er det ingen kjegle - da er hele beinet ned til h_ef
      // «innenfor», som resten av verktøyet regner heftforankring.
      const zx = zCone == null ? hef : zCone;
      const l1 = Math.max(0, Math.min(legBottom, zx) - dLegTop) + bendArc;
      legs.push({ x: q.x, y: q.y, bar: b, serves, zCone: zx, l1 });
      b.effective = (b.effective ?? false) || serves.length > 0;
    }

  let dNearest = Infinity, dFarthest = 0;
  const perAnchor = pts.map(p => {
    let nEff = 0, dNear = Infinity, dFar = 0;
    for (const g of legs) {
      const dist = Math.hypot(g.x - p.x, g.y - p.y);
      dNear = Math.min(dNear, dist);
      if (dist <= dMax + 1e-6) { nEff += 1 / g.serves.length; dFar = Math.max(dFar, dist); }
    }
    dNearest = Math.min(dNearest, dNear);
    dFarthest = Math.max(dFarthest, dFar);
    return { id: p.id, x: p.x, y: p.y, nEff, dNear, dFar };
  });
  const allServed = perAnchor.every(q => q.nEff > 0);

  // Ligger beina så tett at NS-EN 1992-1-1 pkt. 8.2 brytes? Med automatisk
  // pakking skjer det bare når to bolter står så nær hverandre at bøylene
  // deres møtes; da er det en reell detaljeringskonflikt og ikke noe motoren
  // skal flytte på av seg selv.
  let gapMin = Infinity;
  for (let i = 0; i < legs.length; i++)
    for (let j = i + 1; j < legs.length; j++) {
      const dist = Math.hypot(legs[i].x - legs[j].x, legs[i].y - legs[j].y);
      if (dist > 1e-6) gapMin = Math.min(gapMin, dist);
    }
  const spacingOk = !Number.isFinite(gapMin) || gapMin >= sMin - 1e-6;

  // dOwn er selve plasseringa, målt mot 0,75*h_ef: for hver bolt tas det
  // nærmeste beinet i HVER av bøylene som er lagt for den bolten, og den
  // verste av dem styrer. Da fanges begge feilmåtene:
  //   - bøyle om hver bolt   den ytterste bøylen i pakken ligger for langt ute
  //   - bøyle over hele raden en bolt midt i raden har ikke noe bein nær seg
  // dFarthest er noe annet: der teller også bein som hører til en nabobolt,
  // men som tilfeldigvis ligger innenfor sona.
  // Forankringa inne i bruddlegemet: det korteste blant beina som teller med.
  const useLegs = legs.filter(g => g.serves.length > 0);
  const pool = useLegs.length ? useLegs : legs;
  const l1Min = pool.length ? Math.min(...pool.map(g => g.l1)) : 0;
  const l1Max = pool.length ? Math.max(...pool.map(g => g.l1)) : 0;
  const zConeMin = pool.length ? Math.min(...pool.map(g => g.zCone)) : 0;
  const zConeMax = pool.length ? Math.max(...pool.map(g => g.zCone)) : 0;

  let dOwn = 0;
  for (const p of pts)
    for (const b of bars) {
      if (!b.anchors.includes(p)) continue;
      let near = Infinity;
      for (const q of b.legs) near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y));
      if (Number.isFinite(near)) dOwn = Math.max(dOwn, near);
    }

  return {
    kind: 'tension-u', u, n: nv, rm, coverTop, coverBottom, ds, bent,
    dCrown, dLegTop, dBot, lbd, lbRqd, lbmin, endBend, footLen, legBottom, bendArc,
    wrapSurface, bendBarMode: cd.mode, dBend, dtBend,
    bendBarLbd: bent
      ? anchorageLength(m.concrete.fck, dtBend || ds, r.fyk / 1.15, false).lbd : 0,
    legLen: Math.max(0, legBottom - dLegTop),
    // Bein inne i kjegla + kvartbøyen i hjørnet, pr. bein. Målt fra der
    // kjegleflata faktisk krysser beinet, ikke fra h_ef - se over. Det
    // korteste beinet blant dem som teller med styrer.
    insideLen: l1Min, insideMax: l1Max, zConeMin, zConeMax,
    outsideLen: straightOutside, anchorageAvail,
    // Forankringa er nok når den rette biten under kjegla, pluss bøyen og
    // foten, til sammen når l_bd.
    wanted: dWanted, available: dAvail, fits: anchorageAvail + 1e-6 >= lbd,
    // Plasseringa
    dMin, dMax, dLim, halfSpan, sMin, offsets, zoneOk, spacingOk, gapMin,
    nSide, barsPerAnchor: 2 * nSide, legsPerBar: bent ? 2 : 1,
    dNearest, dFarthest, dOwn, allServed, barLayout,
    bars, legs, perAnchor,
    rOff: dMin, stmH: Math.max(1, hef - dCrown),
  };
}

// ---------------------------------------------------------------------------
//  Del en armeringsbane i de bitene som ligger INNE i bruddlegemet og de som
//  ligger utenfor. Brukes både av figurene (rosa strek) og av 3D-visninga
//  (rosa rør), så de to viser nøyaktig det samme.
//
//  Grensa er kjegleflata: et punkt er inne når det ligger grunnere enn
//  coneSurfaceDepth() i sitt eget punkt i planet. Der banen krysser flata,
//  settes det inn et punkt akkurat på krysningen, så skjøten blir nøyaktig.
// ---------------------------------------------------------------------------
export function splitPathAtCone(m, r, path) {
  const pts = path.points;
  if (pts.length < 2) return [{ points: pts, inside: false, closed: path.closed }];
  const foot = anchorFoot(m);
  const hef = m.anchors.hef;
  const served = anchorsServed(m, r);
  if (!foot.hasFoot) return [{ points: pts, inside: false, closed: path.closed }];

  // f(p) > 0 inne i bruddlegemet. z er negativ nedover, dybde = -z.
  const f = p => {
    const zc = coneSurfaceDepth(m, foot, served, hef, p.x, p.y);
    return zc == null ? -1 : zc - (-p.z);
  };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
                               z: a.z + (b.z - a.z) * t });

  const seq = path.closed ? [...pts, pts[0]] : pts;
  const out = [];
  let run = [seq[0]], inside = f(seq[0]) > 0;
  for (let i = 1; i < seq.length; i++) {
    const fa = f(seq[i - 1]), fb = f(seq[i]);
    if ((fa > 0) !== (fb > 0)) {
      const t = fa / (fa - fb);
      const cut = lerp(seq[i - 1], seq[i], Math.max(0, Math.min(1, t)));
      run.push(cut);
      out.push({ points: run, inside, closed: false });
      run = [cut];
      inside = fb > 0;
    }
    run.push(seq[i]);
  }
  if (run.length > 1) out.push({ points: run, inside, closed: false });
  return out;
}

// ---------------------------------------------------------------------------
//  Overflatearmeringa - nettet U-bøyla omslutter.
//
//  To ortogonale lag: det ytterste ligger i overdekninga, det innerste rett
//  innenfor. Bøylens vannrette del ligger under begge (se crownDepth), så den
//  låser seg om nettet og fører strekkraften videre inn i det.
//
//  Nettet tegnes bare der det har noe med kontrollen å gjøre: over
//  utstrekninga til tilleggsarmeringa, utvidet med c_cr,N = 1,5*h_ef til hver
//  side, og klippet mot betongdelen. Et helt nett over hele dekket ville
//  skjult resten av modellen uten å si mer.
// ---------------------------------------------------------------------------
export function buildSurfaceMesh(m, r) {
  const sr = r.surfaceReinf;
  if (r.bendBar === 'own') return [];              // egen stang i bøyen i stedet
  if (!sr?.present || r.purpose !== 'tension' || r.geometryType === 'straight') return [];
  const ds = sr.ds > 0 ? sr.ds : 0;
  const spacing = sr.spacing > 0 ? sr.spacing : 150;
  if (!(ds > 0)) return [];

  const L = tensionLayout(m, r);
  if (!(L.legLen > 0) || !L.bars.length) return [];
  const levels = surfaceMeshLevels(r);
  return meshGrid(m, L, spacing, [
    // Lag 1, ytterst: LANGS bøyleretninga. Ligger i samme høgd som den
    // vannrette delen av bøylen og flettes inn ved siden av den.
    { layer: 1, ds, level: levels[0], dir: L.u, across: L.n },
    // Lag 2, innerst: på TVERS. Det er dette laget bøyen omslutter, og
    // derfor må det ligge innenfor lag 1 - se crownDepth().
    { layer: 2, ds, level: levels[1], dir: L.n, across: L.u },
  ]);
}

// Et rutenett av stenger i bøylens eget system: `dir` er retninga stanga går
// i, `across` retninga de fordeles i. Hver stang trimmes mot betongdelen, så
// nettet følger en vilkårlig tegnet plan.
function meshGrid(m, L, spacing, layers) {
  const margin = 1.5 * m.anchors.hef;
  // Utstrekninga i bøylens system: alt armeringa dekker, pluss kjeglas
  // utbredelse til hver side.
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const b of L.bars)
    for (const q of [...b.legs, ...b.endPoints]) {
      const uu = q.x * L.u.x + q.y * L.u.y, vv = q.x * L.n.x + q.y * L.n.y;
      uMin = Math.min(uMin, uu); uMax = Math.max(uMax, uu);
      vMin = Math.min(vMin, vv); vMax = Math.max(vMax, vv);
    }
  if (!Number.isFinite(uMin)) return [];
  uMin -= margin; uMax += margin; vMin -= margin; vMax += margin;

  const out = [];
  for (const lay of layers) {
    // Fordelingsretninga: `across`. Langs den legges stengene symmetrisk om
    // midten av feltet, så nettet ser likt ut uansett hvor boltegruppa står.
    const alongU = Math.abs(lay.dir.x * L.u.x + lay.dir.y * L.u.y) > 0.5;
    const [a0, a1] = alongU ? [vMin, vMax] : [uMin, uMax];   // fordeling
    const [b0, b1] = alongU ? [uMin, uMax] : [vMin, vMax];   // lengde
    const mid = (a0 + a1) / 2, nHalf = Math.floor(((a1 - a0) / 2) / spacing);
    for (let k = -nHalf; k <= nHalf; k++) {
      const a = mid + k * spacing;
      const at = t => alongU
        ? { x: L.u.x * t + L.n.x * a, y: L.u.y * t + L.n.y * a }
        : { x: L.u.x * a + L.n.x * t, y: L.u.y * a + L.n.y * t };
      const c = (a0 + a1) / 2 * 0 + (b0 + b1) / 2;   // midtpunkt i lengderetninga
      // Trim hver ende mot betongen, så stanga ikke stikker ut av delen.
      const half = (b1 - b0) / 2;
      const e0 = fitInside(m, t => at(c - t), half, lay.ds);
      const e1 = fitInside(m, t => at(c + t), half, lay.ds);
      if (!(e0 + e1 > 4 * lay.ds)) continue;
      const p0 = at(c - e0), p1 = at(c + e1);
      out.push({ ds: lay.ds, layer: lay.layer,
        paths: [{ points: [{ ...p0, z: -lay.level }, { ...p1, z: -lay.level }],
                  closed: false }] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Egen stang i bøyen (r.bendBar = 'own').
//
//  Én stang pr. bøy, lagt PÅ TVERS av bøyleretninga inne i bøyen, gjennom alle
//  bøylene som har bøyen sin i det samme snittet. Stanga skal være minst like
//  tjukk som bøylen, og forankres i hver ende etter NS-EN 1992-1-1 pkt. 8.4 -
//  det er den som fører kraften fra bøyene videre ut i konstruksjonen.
// ---------------------------------------------------------------------------
export function buildBendBars(m, r) {
  if (r.bendBar !== 'own' || r.purpose !== 'tension') return [];
  if (r.geometryType === 'straight') return [];
  const L = tensionLayout(m, r);
  if (!(L.legLen > 0) || !L.bars.length) return [];
  const ds = L.dtBend;
  const { lbd } = anchorageLength(m.concrete.fck, ds, r.fyk / 1.15, false);

  // Bøyene ligger i toppen av hvert hjørne: for en trang U (hårnål) faller de
  // to hjørnene sammen i ett, ellers er det ett i hver ende.
  const stations = new Map();
  for (const b of L.bars)
    for (const uu of [b.uStart + L.rm, b.uEnd - L.rm]) {
      const key = Math.round(uu);
      const st = stations.get(key) || { u: uu, vMin: Infinity, vMax: -Infinity };
      st.vMin = Math.min(st.vMin, b.v); st.vMax = Math.max(st.vMax, b.v);
      stations.set(key, st);
    }

  const out = [];
  for (const st of stations.values()) {
    const at = v => ({ x: L.u.x * st.u + L.n.x * v, y: L.u.y * st.u + L.n.y * v });
    // Forankringa legges utenfor den ytterste bøylen stanga betjener, så langt
    // betongen tillater.
    const e0 = fitInside(m, t => at(st.vMin - t), lbd, ds);
    const e1 = fitInside(m, t => at(st.vMax + t), lbd, ds);
    out.push({ ds, bendBar: true, u: st.u, lbd,
      anchorage: Math.min(e0, e1), anchorEnds: [e0, e1],
      span: (st.vMax - st.vMin) + e0 + e1,
      paths: [{ points: [{ ...at(st.vMin - e0), z: -L.dBend },
                         { ...at(st.vMax + e1), z: -L.dBend }], closed: false }] });
  }
  return out;
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

// Én kjeglebruddbøyle: vannrett del rett under overflatearmeringa, bøyd 90° i
// hvert hjørne og ned i to bein. «Lukket bøyle» får i tillegg bunn med to bøyer
// til. Rett stang er bare det loddrette beinet - ingen bøy, ingen omslutting.
function tensionBarPath(layout, bar, geometryType) {
  const { u, n, rm } = layout;
  const P = (s, z) => V(u.x * s + n.x * bar.v, u.y * s + n.y * bar.v, z);
  const zTop = -layout.dCrown, zBot = -layout.dBot;

  if (geometryType === 'straight')
    return [{ points: [P(bar.s0, -layout.dLegTop), P(bar.s0, zBot)], closed: false }];

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

  // Med bøy i enden svinger beinet 90° UT fra bolten nederst, og fortsetter i
  // en vannrett fot. Bøyens senter ligger en mandrelradius inn og opp fra
  // bunnpunktet, så foten havner i kote -dBot.
  if (bar.endBend) {
    const zLeg = -layout.legBottom;                  // der beinet møter endebøyen
    const f = bar.footLen;
    pts.push(P(bar.uStart - rm - f, zLeg - rm));     // fotenden, venstre
    arcTo(pts, P, bar.uStart - rm, zLeg, rm, -Math.PI / 2, 0, seg);
    arcTo(pts, P, uA, zTan, rm, Math.PI, Math.PI / 2, seg);
    arcTo(pts, P, uB, zTan, rm, Math.PI / 2, 0, seg);
    arcTo(pts, P, bar.uEnd + rm, zLeg, rm, Math.PI, -Math.PI / 2 + 2 * Math.PI, seg);
    pts.push(P(bar.uEnd + rm + f, zLeg - rm));       // fotenden, høyre
    return [{ points: pts, closed: false }];
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

  // Kjeglebrudd: bøylene ligger symmetrisk om HVER bolt, så nær den som
  // praktisk mulig - se tensionLayout().
  if (r.purpose === 'tension') {
    const layout = tensionLayout(m, r);
    if (!(layout.legLen > 0)) return [];
    return layout.bars.map(bar => ({
      anchor: bar.anchors[0], bar, geo: layout, ds: r.ds,
      paths: tensionBarPath(layout, bar, r.geometryType) }));
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
