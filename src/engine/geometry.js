import { planMask, maskArea, anchorDepth, spansAlong,
         intersectSpans, mergeSpans } from './solid.js';

// Areal av unionen av akseparallelle rektangler, via koordinatkompresjon.
// rects: [{x0,x1,y0,y1}]  -> areal (mm2).  Brukes til A_c,N og A_c,V.
export function unionRectArea(rects) {
  const rs = rects.filter(r => r.x1 > r.x0 && r.y1 > r.y0);
  if (!rs.length) return 0;
  const xs = [...new Set(rs.flatMap(r => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rs.flatMap(r => [r.y0, r.y1]))].sort((a, b) => a - b);
  let A = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (rs.some(r => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1))
        A += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return A;
}

// Union av 1D-intervaller -> samlet lengde
export function unionLength(ivs) {
  const s = ivs.filter(i => i[1] > i[0]).sort((a, b) => a[0] - b[0]);
  let L = 0, cur = null;
  for (const i of s) {
    if (!cur || i[0] > cur[1]) { if (cur) L += cur[1] - cur[0]; cur = [...i]; }
    else cur[1] = Math.max(cur[1], i[1]);
  }
  if (cur) L += cur[1] - cur[0];
  return L;
}

// Prosjektert areal av kvadratene (punkt +/- r), klippet mot betongen slik den
// faktisk staar. Brukes til A_c,N i baade EN 1992-4 og B19.
//
// Kantene er ikke lenger fire tall: er det skaaret en utsparing eller lagt paa
// en konsoll, er det den formen kjegla maa rives ut av. Maska teller bare
// soeyler som har hel betong gjennom hele forankringsdybden - en kjegle som
// paa veien opp passerer et hull har ingenting aa rive ut der.
export function clippedSquares(m, pts, r) {
  const [z0, z1] = anchorDepth(m);
  return maskArea(planMask(m, z0, z1), pts.map(p => ({
    x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r,
  })));
}

// Prosjektert bruddareal for strekkbrudd.
//
// Henger boltene i en felles endeplate, er forankringen ett stivt legeme:
// kjegla sprer seg fra platekanten, ikke fra hver bolt for seg. Uten slik
// plate er arealet unionen av de enkelte boltenes kjegler.
export function coneProjection(m, foot, pts, r) {
  if (foot && foot.common) {
    const pl = foot.plate;
    const [z0, z1] = anchorDepth(m);
    return maskArea(planMask(m, z0, z1), [{
      x0: pl.x0 - r, x1: pl.x1 + r, y0: pl.y0 - r, y1: pl.y1 + r,
    }]);
  }
  return clippedSquares(m, pts, r);
}

// Bredden av kantbruddflata langs kanten.
//
// Bruddflata sprer seg 1,5*c_1 til hver side av boltene i fremste rekke, men
// bare saa langt det staar betong. Klippet skjer i boltradens eget plan: det er
// der bruddlegemet starter, og det er formen der som avgjoer hvor bredt det kan
// bli. En utsparing i kanten kutter bredden; en konsoll gir mer.
//
//   axis   aksen bredden maales langs ('x' eller 'y')
//   at     boltradens posisjon paa den andre aksen
//   spans  [[t0, t1], ...] de uklippede 1,5*c_1-feltene
export function frontWidth(m, axis, at, spans) {
  const [z0, z1] = anchorDepth(m);
  const solidSpans = spansAlong(planMask(m, z0, z1), axis, at);
  if (!solidSpans.length) return 0;
  return unionLength(intersectSpans(spans, solidSpans));
}

// ---------------------------------------------------------------------------
//  Kantbruddlegemet.
//
//  Bruddflata gaar ut fra fremste boltrad i betongoverflata og sprer seg med
//  FAST helning 1,5 : 1 - 1,5 mm nedover og 1,5 mm til hver side pr. mm utover.
//  Vinkelen er en egenskap ved bruddet, ikke ved betongklossen: den justeres
//  ALDRI for aa treffe et hjoerne. Flata loeper i den vinkelen til den gaar ut
//  av betongen, og det er betongen som avgjoer hvor det skjer:
//
//    tykk del  (h >= 1,5*c_1)  flata naar kantflata i dybden 1,5*c_1
//    tynn del  (h <  1,5*c_1)  flata treffer underflata alt etter h/1,5 mm,
//                              og resten ut til kanten river hele tykkelsen
//
//  Legemet er derfor en pyramide med spissen i boltraden, eventuelt kappet av
//  underflata. Med c_1 = 500 og h = 300 stopper skraaflata 200 mm ut fra
//  boltraden; de siste 300 mm ut til kanten staar loddrett gjennom hele
//  tykkelsen. Foer gikk skraaflata i ett strekk fra boltraden til nedre
//  kantlinje - helning 0,6 : 1 i det tilfellet, altsaa en vinkel som endret seg
//  med betongen.
//
//  A_c,V er dette legemet prosjektert paa kantflata, ikke en formel ved sida
//  av: hoeyden er den dybden flata faktisk gaar ut i, og bredden er der
//  legemet faktisk har betong aa rive i.
// ---------------------------------------------------------------------------
export const EDGE_SLOPE = 1.5;

const ETOL = 1e-6;

export function edgeBreakout(m, dir, c1, front, hLoc) {
  const S = EDGE_SLOPE;
  const axisX = dir.startsWith('x');
  const t = p => (axisX ? p.y : p.x);
  const ax = axisX ? front[0].x : front[0].y;      // boltradens plass i lastretninga
  const sgn = dir.endsWith('Pos') ? 1 : -1;
  const al = Math.min(...front.map(t)), ah = Math.max(...front.map(t));

  // Dybden flata naar ut i ved kanten: 1,5*c_1 om betongen rekker, ellers hele
  // tykkelsen - flata gaar da ut av underflata foer den naar kantflata.
  const height = Math.min(S * c1, hLoc);

  // Bredden klippes mot betongen slik den faktisk staar i boltradens plan.
  const [z0, z1] = anchorDepth(m);
  const spans = mergeSpans(intersectSpans(
    front.map(p => [t(p) - S * c1, t(p) + S * c1]),
    spansAlong(planMask(m, z0, z1), axisX ? 'y' : 'x', ax)));
  const width = spans.reduce((s, iv) => s + (iv[1] - iv[0]), 0);

  const ctx = { S, c1, al, ah, height, ax, sgn, axisX };
  return { dir, axisX, ax, sgn, c1, face: ax + sgn * c1, height, spans, width,
           Ac: width * height,
           bodies: spans.map(iv => wedgeBody(iv, ctx)) };
}

// ---------------------------------------------------------------------------
//  Ett bruddlegeme, som en rekke tverrsnitt langs veien ut mot kanten.
//
//  I avstanden u fra boltraden er tverrsnittet rektangelet
//    t fra al - 1,5*u til ah + 1,5*u   (klippet mot betongen)
//    z fra 0 ned til -min(1,5*u, hoeyden)
//  Alle knekkene - der skraaflata naar bunnen, og der sidespredninga naar
//  klippet - legges inn som egne snitt, saa flatene mellom dem blir plane og
//  legemet eksakt. Ingen triangulering av en skraa flate i et rutenett.
// ---------------------------------------------------------------------------
function wedgeBody([tl, th], { S, c1, al, ah, height, ax, sgn, axisX }) {
  const cuts = new Set([0, c1]);
  for (const u of [height / S,                 // skraaflata naar underflata
                   (al - tl) / S, (th - ah) / S,   // spredninga naar klippet
                   (al - th) / S, (tl - ah) / S])  // legemet begynner i det hele tatt
    if (u > ETOL && u < c1 - ETOL) cuts.add(u);
  const us = [...cuts].sort((a, b) => a - b);

  const V = [], F = [];
  const P = (u, tt, z) => {
    const a = ax + sgn * u;
    V.push(axisX ? [a, tt, z] : [tt, a, z]);
    return V.length - 1;
  };
  const tri = (a, b, c) => { if (a !== b && b !== c && a !== c) F.push([a, b, c]); };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };

  // Tverrsnittet som en loekke: overkant venstre -> overkant hoeyre -> bunn
  // hoeyre -> bunn venstre. Punkter som faller sammen deles, saa degenererte
  // trekanter faller ut av seg selv naar snittet er en linje eller et punkt.
  const cut = (u) => {
    const lo = Math.max(tl, al - S * u), hi = Math.min(th, ah + S * u);
    const dep = Math.min(S * u, height);
    if (hi < lo - ETOL) return null;
    const wide = hi > lo + ETOL, deep = dep > ETOL;
    const tL = P(u, lo, 0);
    const tR = wide ? P(u, hi, 0) : tL;
    const bL = deep ? P(u, lo, -dep) : tL;
    const bR = deep ? (wide ? P(u, hi, -dep) : bL) : tR;
    return [tL, tR, bR, bL];
  };

  let prev = null;
  for (const u of us) {
    const s = cut(u);
    if (!s) continue;
    if (!prev) quad(s[0], s[1], s[2], s[3]);           // der legemet begynner
    else for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(prev[i], s[i], s[j], prev[j]);              // mantelen mellom snittene
    }
    prev = s;
  }
  if (prev) quad(prev[3], prev[2], prev[1], prev[0]);  // kantflata
  // Sveipen gaar mot uret sett utenfra bare naar (utover, langs kant, opp) er
  // hoeyrehendt. Er den ikke det, snus alle trekantene, slik at normalene
  // peker ut av legemet uansett hvilken av de fire kantene det er.
  if ((axisX ? sgn : -sgn) < 0) for (const f of F) { const t0 = f[1]; f[1] = f[2]; f[2] = t0; }
  return { V, F };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
