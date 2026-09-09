// ---------------------------------------------------------------------------
//  Tilleggsarmering rundt bolter/stenger - NS-EN 1992-4:2018 pkt. 7.2.1.2
//  (strekk, erstatter betongkjeglebrudd), 7.2.2.2 (skjær, erstatter
//  kantbrudd) og 7.2.2.6 (felles krav til bøyler/løkker som armeringstype).
//
//  Erstatter den tidligere src/engine/anchor-reinforcement.js, som brukte
//  andre punkthenvisninger (7.2.1.8/7.2.2.6) og manglet: krav til diameter/
//  stålkvalitet, 0,75·h_ef/0,75·c_1-sona, riktig 4⌀/10⌀-grense etter
//  geometritype, og en STM-kontroll for kraftoverføringa fra fot til
//  armering. Se src/engine/reinforcement-geometry.js for geometrien og
//  src/engine/stm.js for stavmodellen.
//
//  VIKTIG - flagget forenkling: effektiviteten til en løkke/bøyle i skjær er
//  ikke satt likt A_s·f_yd i denne modellen (se pkt. 3 i spesifikasjonen),
//  men den eksakte reduksjonsfaktoren i NS-EN 1992-4 tillegg C er ikke
//  gjengitt i spesifikasjonen og er ikke hentet fra trykt standard her.
//  LOOP_SHEAR_EFFICIENCY under er en dokumentert antakelse - kontroller mot
//  trykt utgave av tillegg C før bruk i prosjektering.
// ---------------------------------------------------------------------------
import { Calc, n } from './calc.js';
import { requirementIssues, minAnchorageFactor } from '../core/reinforcement.js';
import { fbd, anchorageLength, minInsideLength, barGeometry, anchorsServed,
         effectiveCount, minEdgeForAnchors, tensionLayout,
         DEFAULT_COVER } from './reinforcement-geometry.js';
import { endplateToLoopSTM, STRUT_ANGLE } from './stm.js';

const GAMMA_S = 1.15;
export const LOOP_SHEAR_EFFICIENCY = 0.7;   // se fil-hodets forbehold

// Geometrien lagt til grunn for kontrollene, delt mellom strekk og skjær slik
// at UI-et (krav vs. valgt) og rapporten kan bruke akkurat det samme.
// Bøylene er like for alle boltene gruppa betjener, så målene tas av den
// styrende - den med minst kantavstand.
export function groupGeometry(m, res, r) {
  const pts = anchorsServed(m, r);
  const hef = m.anchors.hef;
  const c1 = minEdgeForAnchors(m, r.anchorIds);
  const insideMin = minInsideLength(r.ds, r.geometryType);
  const reqIssues = requirementIssues(r);

  // Kjeglebrudd: bøylene ligger radvis ved siden av boltene, så både antallet
  // som teller og kravene kommer fra oppsettet (se tensionLayout).
  if (r.purpose === 'tension') {
    const geo = pts.length ? tensionLayout(m, r) : null;
    const effCount = geo ? geo.effLegsPerRow : 0;
    const insideLen = geo ? geo.insideLen : 0;
    const qualifies = reqIssues.length === 0 && !!geo && geo.fits && geo.zoneOk
      && geo.angleOk && insideLen >= insideMin && effCount > 0;
    return { pts, hef, c1, zoneRef: hef, geo, effCount, insideLen, insideMin,
             reqIssues, qualifies };
  }

  // Skjær/generisk: like bøyler rundt hver bolt, målene tas av den styrende -
  // den med minst kantavstand.
  const lead = pts.length
    ? pts.reduce((a, b) => (minEdgeForAnchors(m, [b.id]) < minEdgeForAnchors(m, [a.id]) ? b : a))
    : null;
  const geo = lead ? barGeometry(m, r, lead) : null;
  const effCount = geo ? effectiveCount(r.count, geo.rOff, c1) : 0;
  const insideLen = geo ? geo.insideLen : 0;
  const qualifies = reqIssues.length === 0 && !!geo && geo.fits && insideLen >= insideMin
    && effCount > 0;
  return { pts, hef, c1, zoneRef: c1, geo, effCount, insideLen, insideMin,
           reqIssues, qualifies };
}

// Strekket fordelt på bøyleradene: hver rad tas av sine egne bøyler, så det er
// den mest belastede raden som styrer - ikke summen for hele gruppa.
function tensionRows(layout, anchors) {
  const rows = layout.rows.map(row => ({ row, N: 0 }));
  if (!rows.length) return rows;
  for (const p of anchors) {
    const v = p.x * layout.n.x + p.y * layout.n.y;
    const hit = rows.reduce((a, b) =>
      Math.abs(b.row.v - v) < Math.abs(a.row.v - v) ? b : a);
    hit.N += p.N;
  }
  return rows;
}

// ===========================================================================
//  STREKK - erstatter betongkjeglebrudd, pkt. 7.2.1.2
// ===========================================================================
export function tensionSupplementary(m, res, r) {
  const G = groupGeometry(m, res, r);
  const L = G.geo;
  const checks = [];

  // Hver boltrad tas av sine egne bøyler, så det er den mest belastede raden
  // som styrer - ikke summen for hele gruppa.
  const rows = L ? tensionRows(L, res.tension.anchors) : [];
  const gov = rows.length ? rows.reduce((a, b) => (b.N > a.N ? b : a)) : null;
  const NEd = gov ? gov.N : res.tension.Ntot;
  const nLegs = G.effCount;                       // bein pr. rad som teller med
  const rowTxt = rows.length > 1
    ? `Styrende av ${rows.length} boltrader på tvers av bøyleretninga (${n(r.direction || 0, 0)}°).`
    : undefined;

  // --- a) stålbrudd i armeringa ------------------------------------------
  const ca = new Calc('7.2.1.2');
  ca.in('n_bøyler', L ? L.barsPerRow : 0, 'stk', 'Tilleggsarmering · bøyler pr. boltrad');
  ca.in('⌀_s', r.ds, 'mm', 'Tilleggsarmering');
  ca.in('f_yk', r.fyk, 'N/mm²', 'Tilleggsarmering (kamstål, ⌀ ≤ 16 mm, f_yk ≤ 600 – 7.2.2.6)');
  ca.in('γ_Ms,re', GAMMA_S, '–', 'Armeringsstål – NS-EN 1992-1-1');
  ca.in('N_Ed,rad', NEd, 'N', 'Strekk i den mest belastede boltraden');
  const nEff = ca.step({ sym: 'n_eff', desc: 'Bein som teller med – to pr. bøyle',
    formula: '2 · (bøyler med avstand ≤ 0,75·h_ef fra bolten)',
    subst: L ? `2 · ${L.effPerRow} av ${L.barsPerRow / 2} pr. side · ` +
      `0,75·h_ef = ${n(0.75 * G.hef, 0)} mm` : '–',
    value: nLegs, unit: 'stk' });
  const As = ca.step({ sym: 'A_s,re', desc: 'Effektivt armeringsareal pr. rad',
    formula: 'n_eff · π · ⌀_s² / 4', subst: `${n(nEff, 0)} · π · ${n(r.ds, 0)}² / 4`,
    value: nEff * Math.PI * r.ds * r.ds / 4, unit: 'mm²' });
  const NRk_s = ca.res({ sym: 'N_Rk,re', formula: 'A_s,re · f_yk',
    subst: `${n(As)} · ${n(r.fyk, 0)}`, value: As * r.fyk, unit: 'N' });
  const NRd_s = NRk_s / GAMMA_S;
  ca.step({ sym: 'N_Rd,re', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,re / γ_Ms,re', subst: `${n(NRk_s)} / ${n(GAMMA_S)}`, value: NRd_s, unit: 'N' });
  ca.util({ formula: 'N_Ed,rad / N_Rd,re', subst: `${n(NEd)} / ${n(NRd_s)}`, value: NEd / NRd_s });
  checks.push({ id: `N-sre-steel-${r.id}`, mode: `Tilleggsarmering ${r.id} – stålbrudd`,
    clause: '7.2.1.2', scope: 'gruppe', NRk: NRk_s, NRd: NRd_s, NEd, util: NEd / NRd_s, calc: ca,
    group: r.id, note: !L || L.zoneOk ? rowTxt
      : `Bøylene får ikke plass innenfor 0,75·h_ef = ${n(0.75 * G.hef, 0)} mm når de ` +
        `samtidig skal gå klar av bolten (${n(L.dMin, 0)} mm). Øk h_ef, eller reduser ⌀/avstand.` });

  // --- b) forankring/heft over lengden inne i bruddlegemet ---------------
  const cb = new Calc('7.2.1.2');
  const f = fbd(m.concrete.fck, r.ds, true);
  const alpha1 = 0.7;                              // bøyd stangende
  cb.in('n_eff', nLegs, 'stk', 'Bein pr. rad, se stålkontrollen');
  cb.in('⌀_s', r.ds, 'mm', 'Tilleggsarmering');
  cb.in('l_1', G.insideLen, 'mm',
    'Bein inne i bruddkjegla (ned til h_ef) + kvartbøyen i hjørnet, pr. bein');
  cb.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  cb.in('α_1', alpha1, '–', 'Bøyd stangende');
  cb.in('N_Ed,rad', NEd, 'N', 'Strekk i den mest belastede boltraden');
  cb.step({ sym: 'f_bd', desc: 'Dimensjonerende heftfasthet',
    formula: '2,25 · η_1 · η_2 · f_ctk;0,05 / γ_c', subst: '–', value: f, unit: 'N/mm²',
    ref: 'EN 1992-1-1 8.4.2' });
  const NRk_a = cb.res({ sym: 'N_Rk,a', formula: 'n_eff · π · ⌀_s · l_1 · f_bd / α_1',
    subst: `${n(nLegs, 0)} · π · ${n(r.ds, 0)} · ${n(G.insideLen, 0)} · ${n(f)} / ${n(alpha1)}`,
    value: nLegs * (G.insideLen * Math.PI * r.ds * f) / alpha1, unit: 'N' });
  cb.util({ formula: 'N_Ed,rad / N_Rd,a', subst: `${n(NEd)} / ${n(NRk_a)}`, value: NEd / NRk_a });
  const minLenTxt = G.insideLen < G.insideMin
    ? `l₁ = ${n(G.insideLen, 0)} mm < ${minAnchorageFactor(r.geometryType)}⌀ = ${n(G.insideMin, 0)} mm – ` +
      'kravet til minste forankringslengde inne i bruddlegemet er ikke oppfylt.' : rowTxt;
  checks.push({ id: `N-sre-anchorage-${r.id}`, mode: `Tilleggsarmering ${r.id} – forankring i bruddlegemet`,
    clause: '7.2.1.2', scope: 'gruppe', NRk: NRk_a, NRd: NRk_a, NEd, util: NEd / NRk_a, calc: cb,
    group: r.id, note: minLenTxt });

  // --- c) STM: endeplate -> trykkstav -> bøylehjørne -> strekk i bøylen ---
  if (L && nLegs > 0) {
    const fcd = m.concrete.fck / 1.5;
    const bar = L.govBar;                          // flatest stav styrer
    const NCorner = NEd / nLegs;                   // ett hjørne pr. bein
    const stm = endplateToLoopSTM(m, {
      NEd: NCorner, hStrut: bar.diag, wTie: bar.L,
      bStrut: 2 * (r.cover ?? DEFAULT_COVER), dBolt: m.anchors.d,
      fck: m.concrete.fck, fcd, cracked: m.code.cracked,
    });
    const spanTxt = `Alle bøylene er like: ${n(L.barLength, 0)} mm vannrett, ` +
      `med ${n(L.overhang, 0)} mm utstikk i hver ende.`;
    const angleTxt = L.angleOk
      ? `${spanTxt} Én felles lengde gir staver i ${n(L.alphaMin, 0)}–${n(L.alphaMax, 0)}° ` +
        `mot den vannrette delen, innenfor ${STRUT_ANGLE.min}–${STRUT_ANGLE.max}°.`
      : !L.windowOk
        ? `${spanTxt} Bøylene ligger så spredt at ingen felles lengde gir alle ` +
          `staver innenfor ${STRUT_ANGLE.min}–${STRUT_ANGLE.max}° (${n(L.alphaMin, 0)}–` +
          `${n(L.alphaMax, 0)}°). Reduser antallet bøyler pr. rad, eller øk h_ef.`
        : `${spanTxt} Staven står i ${n(L.alphaMin, 0)}–${n(L.alphaMax, 0)}°, utenfor ` +
          `${STRUT_ANGLE.min}–${STRUT_ANGLE.max}°: betongen gir ikke plass til utstikket ` +
          'bøylene trenger. Reduser overdekninga, flytt boltene inn, eller øk delen.';
    checks.push({ ...stm, id: `N-sre-stm-${r.id}`, group: r.id,
      mode: `Tilleggsarmering ${r.id} – stavmodell endeplate→bøyle`,
      note: `${angleTxt} ${stm.note}` });
  }

  // --- d) overlapp mot eksisterende konstruksjonsarmering, dersom oppgitt ---
  if (r.lapToExisting?.present) {
    const cl = new Calc('EN 1992-1-1 8.7');
    const al = anchorageLength(m.concrete.fck, r.ds, r.fyk / 1.15, true);
    // Forenklet: α6 = 1,5 antatt (mer enn 50 % skjøtet i samme snitt, 8.7.3).
    // Kontroller den faktiske skjøteprosenten mot tab. 8.3 i printet standard.
    const lap0 = cl.in('l_bd', al.lbd, 'mm', 'Forankringslengde, se forankringskontrollen');
    const a6 = cl.in('α_6', 1.5, '–', 'Forenklet antakelse – kontroller mot EN 1992-1-1 8.7.3/tab. 8.3');
    const lapReq = cl.res({ sym: 'l_0', formula: 'α_6 · l_bd',
      subst: `${n(a6)} · ${n(lap0)}`, value: a6 * lap0, unit: 'mm' });
    const lapProv = cl.in('l_0,valgt', r.lapToExisting.lapLength, 'mm', 'Oppgitt overlappslengde');
    cl.util({ formula: 'l_0 / l_0,valgt', subst: `${n(lapReq)} / ${n(lapProv)}`,
      value: lapReq / Math.max(lapProv, 1e-6) });
    checks.push({ id: `N-sre-lap-${r.id}`, mode: `Tilleggsarmering ${r.id} – overlapp mot konstruksjonsarmering`,
      clause: 'EN 1992-1-1 8.7', scope: 'gruppe', NRk: NaN, NRd: NaN, NEd: NaN,
      util: lapReq / Math.max(lapProv, 1e-6), calc: cl, group: r.id, expr: 'l_0 / l_0,valgt ≤ 1,0',
      note: 'Overlappet er ikke kontrollert mot den faktiske armeringen i konstruksjonen for øvrig, ' +
            'bare mot den oppgitte lengden.' });
  }

  return { checks, qualifies: G.qualifies, geometry: G };
}

// ===========================================================================
//  SKJÆR - erstatter kantbrudd, pkt. 7.2.2.2 (og §4-generisk bøyle)
// ===========================================================================
export function shearSupplementary(m, res, r) {
  const VEd = res.shear.Vres;
  const G = groupGeometry(m, res, r);
  const checks = [];

  // --- a) stålbrudd, med redusert effektivitet for løkke/bøyle (se fil-hode) ---
  const ca = new Calc('7.2.2.2');
  const eff = r.geometryType === 'straight' ? 1.0 : LOOP_SHEAR_EFFICIENCY;
  ca.in('n_eff', G.effCount, 'stk', 'Bein innenfor 0,75·c_1 fra fasteneren');
  ca.in('⌀_s', r.ds, 'mm', 'Tilleggsarmering');
  ca.in('f_yk', r.fyk, 'N/mm²', 'Tilleggsarmering (kamstål, ⌀ ≤ 16 mm, f_yk ≤ 600 – 7.2.2.6)');
  ca.in('η', eff, '–', r.geometryType === 'straight' ? 'Rett stang – full utnyttelse' :
    'Løkke/bøyle – hele A_s·f_yd forutsettes IKKE mobilisert, se fil-hodets forbehold');
  ca.in('γ_Ms,re', GAMMA_S, '–', 'Armeringsstål – NS-EN 1992-1-1');
  ca.in('V_Ed,g', VEd, 'N', 'Resultant skjærkraft på gruppa');
  const As = ca.step({ sym: 'A_s,re', desc: 'Effektivt armeringsareal',
    formula: 'n_eff · π · ⌀_s² / 4', subst: `${n(G.effCount, 0)} · π · ${n(r.ds, 0)}² / 4`,
    value: G.effCount * Math.PI * r.ds * r.ds / 4, unit: 'mm²' });
  const VRk = ca.res({ sym: 'V_Rk,re', formula: 'η · A_s,re · f_yk',
    subst: `${n(eff)} · ${n(As)} · ${n(r.fyk, 0)}`, value: eff * As * r.fyk, unit: 'N' });
  const VRd = VRk / GAMMA_S;
  ca.step({ sym: 'V_Rd,re', desc: 'Dimensjonerende kapasitet',
    formula: 'V_Rk,re / γ_Ms,re', subst: `${n(VRk)} / ${n(GAMMA_S)}`, value: VRd, unit: 'N' });
  ca.util({ formula: 'V_Ed,g / V_Rd,re', subst: `${n(VEd)} / ${n(VRd)}`, value: VEd / VRd });
  checks.push({ id: `V-sre-steel-${r.id}`, mode: `Tilleggsarmering ${r.id} – stålbrudd`,
    clause: '7.2.2.2', scope: 'gruppe', NRk: VRk, NRd: VRd, NEd: VEd, util: VEd / VRd, calc: ca,
    group: r.id, note: G.effCount < r.count
      ? `Bare ${G.effCount} av ${r.count} bein ligger innenfor 0,75·c_1 og telles med.` : undefined });

  // --- b) forankring/heft inne i bruddlegemet ---
  const cb = new Calc('7.2.2.2');
  const bent = r.geometryType !== 'straight';
  const f = fbd(m.concrete.fck, r.ds, true);
  const alpha1 = bent ? 0.7 : 1.0;
  cb.in('n_eff', G.effCount, 'stk', 'Tilleggsarmering');
  cb.in('⌀_s', r.ds, 'mm', 'Tilleggsarmering');
  cb.in('l_1', G.insideLen, 'mm',
    'Bein mellom kanten og bolten + halve bøyen, pr. bein');
  cb.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  cb.in('α_1', alpha1, '–', bent ? 'Bøyle/krok/løkke' : 'Rett stangende');
  const VRk_a = cb.res({ sym: 'V_Rk,a', formula: 'n_eff · π · ⌀_s · l_1 · f_bd / α_1',
    subst: `${n(G.effCount, 0)} · π · ${n(r.ds, 0)} · ${n(G.insideLen, 0)} · ${n(f)} / ${n(alpha1)}`,
    value: G.effCount * (G.insideLen * Math.PI * r.ds * f) / alpha1, unit: 'N' });
  cb.util({ formula: 'V_Ed,g / V_Rd,a', subst: `${n(VEd)} / ${n(VRk_a)}`, value: VEd / VRk_a });
  const minLenTxt = G.insideLen < G.insideMin
    ? `l₁ = ${n(G.insideLen, 0)} mm < ${minAnchorageFactor(r.geometryType)}⌀ = ${n(G.insideMin, 0)} mm – ` +
      'kravet til minste forankringslengde inne i bruddlegemet er ikke oppfylt.' : undefined;
  checks.push({ id: `V-sre-anchorage-${r.id}`, mode: `Tilleggsarmering ${r.id} – forankring i bruddlegemet`,
    clause: '7.2.2.2', scope: 'gruppe', NRk: VRk_a, NRd: VRk_a, NEd: VEd, util: VEd / VRk_a, calc: cb,
    group: r.id, note: minLenTxt });

  return { checks, qualifies: G.qualifies, geometry: G };
}
