// ---------------------------------------------------------------------------
//  Inndatakontroll.  Fanger geometri som ikke gir mening, og minstekrav til
//  kant-/senteravstand.  'error' stopper ikke beregningen, men resultatet skal
//  ikke brukes.
// ---------------------------------------------------------------------------

import { anchorPositions, edgeDistances, mounting , boltsOutside, EDGE_MIN } from '../core/model.js';

export function validate(m) {
  const out = [];
  const err = t => out.push({ level: 'error', text: t });
  const warn = t => out.push({ level: 'warn', text: t });

  const a = m.anchors, c = m.concrete, p = m.plate;
  const pos = anchorPositions(m);

  // --- entydig gal geometri ---------------------------------------------
  for (const q of pos) {
    const e = edgeDistances(m, q.x, q.y);
    const cmin = Math.min(e.xNeg, e.xPos, e.yNeg, e.yPos);
    if (cmin <= 0) {
      err(`Bolt ${q.id} ligger utenfor betongdelen (kantavstand ${Math.round(cmin)} mm). ` +
          `Øk L_x/L_y, eller reduser senteravstand/offset.`);
      break;
    }
  }
  if (a.hef >= c.h) err(`h_ef = ${a.hef} mm er ikke mindre enn tykkelsen h = ${c.h} mm.`);
  else if (a.hef > 0.8 * c.h)
    warn(`h_ef = ${a.hef} mm er over 80 % av tykkelsen (h = ${c.h} mm) – kontroller ` +
         `gjennomlokking og plass til hodet.`);
  if (p.bx > c.Lx || p.by > c.Ly) warn('Forankringsplata er større enn betongdelen.');
  if (a.nx * a.ny < 1) err('Minst én bolt kreves.');

  // --- minstekrav (veiledende, skal hentes fra ETA/produktdata) ----------
  const sMin = 5 * a.d, cMin = 5 * a.d;
  if (a.nx > 1 && a.sx < sMin)
    warn(`Senteravstand s_x = ${a.sx} mm < veiledende s_min = ${sMin} mm (5·⌀).`);
  if (a.ny > 1 && a.sy < sMin)
    warn(`Senteravstand s_y = ${a.sy} mm < veiledende s_min = ${cMin} mm (5·⌀).`);
  let cAbs = Infinity;
  for (const q of pos) {
    const e = edgeDistances(m, q.x, q.y);
    cAbs = Math.min(cAbs, e.xNeg, e.xPos, e.yNeg, e.yPos);
  }
  if (Number.isFinite(cAbs) && cAbs > 0 && cAbs < cMin)
    warn(`Minste kantavstand ${Math.round(cAbs)} mm < veiledende c_min = ${cMin} mm (5·⌀).`);

  if (boltsOutside(m))
    warn(`Boltene ligger nærmere platekanten enn ${EDGE_MIN} mm, eller utenfor ` +
         `plata. Endre antallet for å sette senteravstanden automatisk.`);

  // --- kontakttrykk mot betong ------------------------------------------
  const mnt = mounting(m);
  if (mnt.kind === 'standoff')
    warn(`Plata står ${p.gap} mm fra betongen – skjær regnes med momentarm ` +
         `og boltene tar også trykk.`);
  if (mnt.kind === 'grout' && !mnt.groutOk)
    warn(`Gytemassen (${p.fckGrout} N/mm²) er svakere enn betongen eller under ` +
         `30 N/mm². Undergytingen regnes da ikke som fast anlegg, og skjæret ` +
         `får momentarm gjennom gytesjiktet.`);

  // --- forankringsarmering ----------------------------------------------
  if (m.code.supplementaryReinf && m.reinf) {
    if (!(m.reinf.n > 0)) err('Forankringsarmering er valgt, men antall bein er 0.');
    if (m.reinf.l1 > a.hef)
      warn(`l₁ = ${m.reinf.l1} mm er lengre enn h_ef = ${a.hef} mm.`);
  }
  return out;
}

// Kontakttrykk mot betongens dimensjonerende trykkfasthet
export function bearingCheck(m, res) {
  if (!res.compression) return null;
  const fcd = 0.85 * m.concrete.fck / m.code.gammaC;
  return {
    sigma: res.compression.sigmaMax, fcd,
    util: res.compression.sigmaMax / fcd,
    ok: res.compression.sigmaMax <= fcd,
  };
}
