import { planMask, maskArea, anchorDepth, spansAlong,
         intersectSpans } from './solid.js';

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

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
