// ---------------------------------------------------------------------------
//  Tilleggsarmering rundt bolter/stenger - NS-EN 1992-4:2018 pkt. 7.2.1.2
//  (strekk, erstatter betongkjeglebrudd), 7.2.2.2 (skjær, erstatter
//  kantbrudd) og 7.2.2.6 (felles krav til bøyler/løkker som armeringstype).
//
//  Erstatter den tidligere src/engine/anchor-reinforcement.js, som brukte
//  andre punkthenvisninger (7.2.1.8/7.2.2.6) og manglet: krav til diameter/
//  stålkvalitet, 0,75·h_ef/0,75·c_1-sona og riktig 4⌀/10⌀-grense etter
//  geometritype. Se src/engine/reinforcement-geometry.js for geometrien.
//
//  MERK om stavmodell: plasseringa av kjeglebruddarmeringa ble tidligere
//  bestemt av en 45° trykkstav fra endeplata ut til bøylehjørnet. Det er ikke
//  et plasseringskrav i NS-EN 1992-4, og ga bein langt utenfor 0,75·h_ef.
//  Plasseringa styres nå av selve avstandskravet (pkt. 7.2.1.2 / B19.3.2.6);
//  src/engine/stm.js står igjen som en generell byggekloss, men brukes ikke
//  til å plassere armeringa.
//
//  VIKTIG - flagget forenkling: effektiviteten til en løkke/bøyle i skjær er
//  ikke satt likt A_s·f_yd i denne modellen (se pkt. 3 i spesifikasjonen),
//  men den eksakte reduksjonsfaktoren i NS-EN 1992-4 tillegg C er ikke
//  gjengitt i spesifikasjonen og er ikke hentet fra trykt standard her.
//  LOOP_SHEAR_EFFICIENCY under er en dokumentert antakelse - kontroller mot
//  trykt utgave av tillegg C før bruk i prosjektering.
// ---------------------------------------------------------------------------
import { Calc, n } from './calc.js';
import { edgeDistances } from '../core/model.js';
import { clamp, clippedSquares } from './geometry.js';
import { K, partialFactors } from './en1992-4.js';
import { requirementIssues, minAnchorageFactor } from '../core/reinforcement.js';
import { fbd, anchorageLength, minInsideLength, barGeometry, anchorsServed,
         effectiveCount, minEdgeForAnchors, tensionLayout,
         buildBendBars } from './reinforcement-geometry.js';

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

  // Kjeglebrudd: bøylene ligger symmetrisk om hver bolt, så nær den som
  // praktisk mulig, og bare bein med FAKTISK avstand <= 0,75*h_ef teller med
  // (se tensionLayout).
  if (r.purpose === 'tension') {
    const geo = pts.length ? tensionLayout(m, r) : null;
    // Bein pr. bolt for den bolten som har færrest - det er den som styrer.
    const effCount = geo && geo.perAnchor.length
      ? Math.min(...geo.perAnchor.map(q => q.nEff)) : 0;
    const insideLen = geo ? geo.insideLen : 0;
    const qualifies = reqIssues.length === 0 && !!geo && geo.fits && geo.zoneOk
      && geo.allServed && geo.spacingOk && insideLen >= insideMin && effCount > 0;
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

// ---------------------------------------------------------------------------
//  Kjeglebrudd regnet PÅ NYTT fra enden av armeringen.
//
//  Tilleggsarmeringa flytter lasta ned og ut i betongen, men den forsvinner
//  ikke: legger du armering for å ta kjeglebruddet fra endeplata, må kjegla
//  også kontrolleres fra det punktet armeringa leverer lasta - enden av
//  beina. Den kjegla er mye større, fordi den starter dypere og på flere
//  punkter, og med en bøy ut i enden flyttes punktene enda lenger ut.
//
//  Regnes med de samme konstantene som den vanlige kjeglekontrollen
//  (en1992-4.js pkt. 7.2.1.4), bare med h_ef og punkter fra armeringa.
// ---------------------------------------------------------------------------
function reinforcementCone(m, res, r, L) {
  const g = partialFactors(m);
  const cracked = m.code.cracked;
  const hef = L.dBot;                          // dybden armeringa leverer i
  const ccr = 1.5 * hef, scr = 3 * hef;
  const pts = L.bars.flatMap(b => b.endPoints);
  const NEd = res.tension.Ntot;                // hele gruppa henger i denne kjegla

  const c = new Calc('7.2.1.2');
  c.in('h_ef,re', hef, 'mm', 'Dybde til enden av tilleggsarmeringa');
  c.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  const k1 = c.in('k_1', cracked ? K.k1_cracked : K.k1_uncracked, '–',
    `Regelverk · ${cracked ? 'opprisset' : 'uopprisset'}`);
  const gM = c.in('γ_Mc', g.gMc, '–', 'γ_c · γ_inst – 4.4.3.1');
  c.in('n_punkt', pts.length, 'stk',
    L.endBend ? 'Endene av føttene på bøylene' : 'Bunnen av bøylebeina');
  c.in('N_Ed,g', NEd, 'N', 'Sum strekk i boltegruppa');

  const N0 = c.step({ sym: 'N⁰_Rk,c', desc: 'Kjeglekapasitet for ett punkt, uten kant- eller gruppevirkning',
    formula: 'k_1 · √f_ck · h_ef,re^1,5',
    subst: `${n(k1)} · √${n(m.concrete.fck, 0)} · ${n(hef, 0)}^1,5`,
    value: k1 * Math.sqrt(m.concrete.fck) * Math.pow(hef, 1.5), unit: 'N', ref: '(7.2)' });
  const A0 = c.step({ sym: 'A⁰_c,N', desc: 'Referanseareal for ett punkt',
    formula: 's_cr,N² = (3·h_ef,re)²', subst: `${n(scr, 0)}²`, value: scr * scr, unit: 'mm²' });
  const Ac = c.step({ sym: 'A_c,N', desc: 'Faktisk utbruddsareal fra armeringsendene',
    formula: 'union av (endepunkt ± 1,5·h_ef,re), klippet mot frie kanter',
    subst: `${pts.length} punkt, c_cr,N = ${n(ccr, 0)} mm` +
           (L.endBend ? `, flyttet ${n(L.rm + L.footLen, 0)} mm ut av endebøyen` : ''),
    value: clippedSquares(m, pts, ccr), unit: 'mm²', ref: '(7.3)' });

  let cmin = Infinity;
  for (const p of pts) {
    const e = edgeDistances(m, p.x, p.y);
    cmin = Math.min(cmin, e.xNeg, e.xPos, e.yNeg, e.yPos);
  }
  const psi_s = c.step({ sym: 'ψ_s,N', desc: 'Kanteffekt',
    formula: '0,7 + 0,3 · c / c_cr,N ≤ 1,0',
    subst: Number.isFinite(cmin) ? `0,7 + 0,3 · ${n(cmin, 0)} / ${n(ccr, 0)}`
      : 'ingen fri kant innenfor c_cr,N',
    value: Number.isFinite(cmin) ? clamp(0.7 + 0.3 * cmin / ccr, 0, 1) : 1.0, unit: '–' });
  const psi_re = c.step({ sym: 'ψ_re,N', desc: 'Tett armering gir finere oppsprekking',
    formula: m.code.denseReinf ? '0,5 + h_ef,re / 200 ≤ 1,0' : '1,0 (ikke tett armering)',
    subst: m.code.denseReinf ? `0,5 + ${n(hef, 0)} / 200` : '–',
    value: m.code.denseReinf ? clamp(0.5 + hef / 200, 0, 1) : 1.0, unit: '–' });

  const NRk = c.res({ sym: 'N_Rk,c,re',
    formula: 'N⁰_Rk,c · (A_c,N / A⁰_c,N) · ψ_s,N · ψ_re,N',
    subst: `${n(N0)} · (${n(Ac, 0)}/${n(A0, 0)}) · ${n(psi_s)} · ${n(psi_re)}`,
    value: N0 * (Ac / A0) * psi_s * psi_re, unit: 'N', ref: '(7.1)' });
  const NRd = NRk / gM;
  c.step({ sym: 'N_Rd,c,re', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,c,re / γ_Mc', subst: `${n(NRk)} / ${n(gM)}`, value: NRd, unit: 'N' });
  c.util({ formula: 'N_Ed,g / N_Rd,c,re', subst: `${n(NEd)} / ${n(NRd)}`, value: NEd / NRd });

  return { id: `N-sre-cone-${r.id}`,
    mode: `Tilleggsarmering ${r.id} – kjeglebrudd fra armeringsenden`,
    clause: '7.2.1.2', scope: 'gruppe', NRk, NRd, NEd, util: NEd / NRd, calc: c, group: r.id,
    note: 'Kjegla fra endeplata er erstattet av armeringa, men lasta må fortsatt ' +
          'ut i betongen der armeringa slutter – derfor denne kontrollen. ' +
          (L.endBend
            ? 'Bøyen i enden flytter punktene utover og gjør kjegla større.'
            : 'En bøy ut i enden av beina ville flyttet punktene utover og gitt større kjegle.') +
          ' Forenklet: ψ_ec,N = 1,0, siden bøylene ligger symmetrisk om boltraden.' };
}

// ===========================================================================
//  STREKK - erstatter betongkjeglebrudd, pkt. 7.2.1.2 (jf. B19.3.2.6)
//
//  Kontrollrekka:
//    a) stålbrudd i beina som ligger innenfor 0,75*h_ef fra bolten
//    b) plassering: faktisk avstand bolt -> loddrett bein, symmetri, avstand
//       mellom bøylene etter NS-EN 1992-1-1 pkt. 8.2
//    c) forankring INNE i kjegla: l_1 >= 4*⌀ (bøyd) / 10*⌀ (rett), og heft
//    d) forankring UTENFOR kjegla: l_bd etter NS-EN 1992-1-1 pkt. 8.4
//    e) kjeglebrudd regnet på nytt fra enden av armeringa
//    f) overlapp mot konstruksjonens armering (påkrevd for rett stang)
// ===========================================================================
export function tensionSupplementary(m, res, r) {
  const G = groupGeometry(m, res, r);
  const L = G.geo;
  const checks = [];
  const bent = r.geometryType !== 'straight';
  const typeTxt = bent ? 'U-bøyle/løkke' : 'rett stang';

  // Hver bolt henger i sine egne bein, så det er den bolten som har mest kraft
  // pr. effektivt bein som styrer - ikke summen for hele gruppa.
  const byId = new Map((L?.perAnchor || []).map(q => [q.id, q]));
  let gov = null;
  for (const p of res.tension.anchors) {
    const q = byId.get(p.id);
    const nEff = q ? q.nEff : 0;
    const dem = nEff > 0 ? p.N / nEff : Infinity;
    if (!gov || dem > gov.dem) gov = { p, q, nEff, dem };
  }
  const NEd = gov ? gov.p.N : res.tension.Ntot;
  const nLegs = gov ? gov.nEff : 0;
  const boltTxt = gov && res.tension.anchors.length > 1
    ? `Styrende bolt ${gov.p.id} av ${res.tension.anchors.length} i strekk.` : undefined;

  // --- a) stålbrudd i armeringa ------------------------------------------
  const ca = new Calc('7.2.1.2');
  ca.in('n_bøyler', L ? L.barsPerAnchor : 0, 'stk',
    `Tilleggsarmering · ${bent ? 'bøyler' : 'stenger'} pr. bolt, symmetrisk fordelt`);
  ca.in('⌀_s', r.ds, 'mm', 'Tilleggsarmering');
  ca.in('f_yk', r.fyk, 'N/mm²', 'Tilleggsarmering (kamstål, ⌀ ≤ 16 mm, f_yk ≤ 600 – 7.2.2.6)');
  ca.in('γ_Ms,re', GAMMA_S, '–', 'Armeringsstål – NS-EN 1992-1-1');
  ca.in('N_Ed,bolt', NEd, 'N', 'Strekk i den styrende bolten');
  const nEff = ca.step({ sym: 'n_eff', desc:
      'Loddrette bein med faktisk avstand ≤ 0,75·h_ef fra boltaksen',
    formula: bent
      ? '2 · (bøyler med √(a² + d²) ≤ 0,75·h_ef), delt med antall bolter beinet dekker'
      : '(stenger med √(a² + d²) ≤ 0,75·h_ef), delt med antall bolter stanga dekker',
    subst: L ? `0,75·h_ef = ${n(L.dMax, 0)} mm, nærmeste bein ${n(L.dNearest, 0)} mm, ` +
      `fjerneste bein som teller med ${n(L.dFarthest, 0)} mm` : '–',
    value: nLegs, unit: 'stk' });
  const As = ca.step({ sym: 'A_s,re', desc: 'Effektivt armeringsareal pr. bolt',
    formula: 'n_eff · π · ⌀_s² / 4', subst: `${n(nEff)} · π · ${n(r.ds, 0)}² / 4`,
    value: nEff * Math.PI * r.ds * r.ds / 4, unit: 'mm²' });
  const NRk_s = ca.res({ sym: 'N_Rk,re', formula: 'A_s,re · f_yk',
    subst: `${n(As)} · ${n(r.fyk, 0)}`, value: As * r.fyk, unit: 'N' });
  const NRd_s = NRk_s / GAMMA_S;
  ca.step({ sym: 'N_Rd,re', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,re / γ_Ms,re', subst: `${n(NRk_s)} / ${n(GAMMA_S)}`, value: NRd_s, unit: 'N' });
  ca.util({ formula: 'N_Ed,bolt / N_Rd,re', subst: `${n(NEd)} / ${n(NRd_s)}`, value: NEd / NRd_s });
  checks.push({ id: `N-sre-steel-${r.id}`, mode: `Tilleggsarmering ${r.id} – stålbrudd`,
    clause: '7.2.1.2', scope: 'gruppe', NRk: NRk_s, NRd: NRd_s, NEd, util: NEd / NRd_s, calc: ca,
    group: r.id, note: boltTxt });

  // --- b) plassering: faktisk avstand, symmetri og senteravstand ----------
  if (L) {
    const cp = new Calc('7.2.1.2');
    cp.in('h_ef', G.hef, 'mm', 'Bolter · effektiv forankringsdybde');
    const dMax = cp.step({ sym: '0,75·h_ef', desc:
        'Største avstand fra boltaksen til det loddrette beinet som fortsatt regnes som effektiv',
      formula: '0,75 · h_ef', subst: `0,75 · ${n(G.hef, 0)}`, value: L.dMax, unit: 'mm',
      note: 'Øvre grense, ikke en anbefalt plassering: armeringa legges så nær ' +
            'bolten som praktisk mulig.' });
    const aa = cp.in('a', L.halfSpan, 'mm', bent
      ? 'Halve bøylebredda – beinets avstand fra ytterste bolt LANGS bøyleretninga'
      : 'Rett stang står i boltsnittet – ingen forskyvning langs retninga');
    cp.in('fordeling', L.bars.length, 'stk', L.barLayout === 'row'
      ? 'Bøyler i alt – én bøyle spenner hele boltraden'
      : 'Bøyler i alt – én bøyle om hver bolt');
    const dd = cp.in('d', L.dMin, 'mm',
      'Nærmeste bøyle på TVERS av retninga – akkurat klar av bolten ' +
      `(${n(r.clearance, 0)} + ⌀_bolt/2 + ⌀_s/2)`);
    cp.step({ sym: 'd_1', desc:
        'Faktisk avstand fra boltaksen til nærmeste loddrette bein, uavhengig av x/y-retning',
      formula: '√(a² + d²)', subst: `√(${n(aa, 0)}² + ${n(dd, 0)}²)`,
      value: L.dNearest, unit: 'mm' });
    const sMin = cp.in('s_min', L.sMin, 'mm',
      `Minste senteravstand – NS-EN 1992-1-1 8.2, d_g = ${n(m.concrete?.dg ?? 16, 0)} mm`);
    const rowMode = L.barLayout === 'row';
    cp.step({ sym: 'd_n', desc: rowMode
        ? 'Største avstand fra en bolt til nærmeste bein i bøylen som betjener den'
        : `Faktisk avstand ut til den ytterste bøylen gruppa legger om bolten ` +
          `(${L.nSide} pr. side, pakket med s_min)`,
      formula: rowMode
        ? 'maks over boltene av √(Δu² + d²) til nærmeste bein'
        : '√(a² + (d + (n−1)·s_min)²)',
      subst: rowMode
        ? 'bøylen spenner hele boltraden – beina står bare i endene'
        : L.nSide > 1
          ? `√(${n(aa, 0)}² + (${n(dd, 0)} + ${L.nSide - 1}·${n(sMin, 0)})²)`
          : 'bare én bøyle pr. side',
      value: L.dOwn, unit: 'mm' });
    cp.util({ formula: 'd_n / (0,75·h_ef)', subst: `${n(L.dOwn, 0)} / ${n(dMax, 0)}`,
      value: L.dOwn / Math.max(dMax, 1e-6) });
    const placeNotes = [];
    if (!L.zoneOk)
      placeNotes.push(`Bøylene får ikke plass innenfor 0,75·h_ef = ${n(L.dMax, 0)} mm når de ` +
        `samtidig skal gå klar av bolten (√(a² + d²) = ${n(L.dNearest, 0)} mm). ` +
        'Øk h_ef, reduser bøylebredda, eller reduser ⌀/klaringa.');
    if (!L.allServed)
      placeNotes.push(L.barLayout === 'row'
        ? 'Ikke alle boltene har et bein innenfor 0,75·h_ef: bøylen spenner hele ' +
          'boltraden, så bare boltene i endene får et bein nær seg. Velg «bøyle om ' +
          'hver bolt», eller del raden i flere grupper.'
        : 'Ikke alle boltene gruppa betjener har et bein innenfor 0,75·h_ef.');
    if (!L.spacingOk)
      placeNotes.push(`Minste avstand mellom to bein er ${n(L.gapMin, 0)} mm < s_min = ` +
        `${n(L.sMin, 0)} mm – bøyler fra nabobolter kolliderer. Reduser antallet ` +
        'pr. bolt, eller la færre bolter dele gruppa.');
    checks.push({ id: `N-sre-placement-${r.id}`,
      mode: `Tilleggsarmering ${r.id} – plassering innenfor 0,75·h_ef`,
      clause: '7.2.1.2', scope: 'gruppe', NRk: NaN, NRd: NaN, NEd: NaN,
      util: L.dOwn / Math.max(L.dMax, 1e-6), calc: cp, group: r.id,
      expr: 'd_n / (0,75·h_ef) ≤ 1,0',
      note: placeNotes.length ? placeNotes.join(' ')
        : (L.barLayout === 'row'
            ? `Én bøyle spenner hele boltraden, med beina rett utenfor de ytterste ` +
              `boltene. ${L.nSide} bøyle${L.nSide > 1 ? 'r' : ''} på hver side av raden, ` +
              `pakket med minste tillatte senteravstand.`
            : `Armeringa ligger symmetrisk om bolten, ${L.nSide} ${bent ? 'bøyle' : 'stang'}` +
              `${L.nSide > 1 ? 'r' : ''} på hver side, pakket fra bolten og utover med ` +
              `minste tillatte senteravstand – ikke spredt ut til 0,75·h_ef.`) });
  }

  // --- c) forankring/heft over lengden inne i bruddlegemet ---------------
  const cb = new Calc('7.2.1.2');
  const f = fbd(m.concrete.fck, r.ds, true);
  const alpha1 = bent ? 0.7 : 1.0;                 // bøyd stangende
  cb.in('n_eff', nLegs, 'stk', 'Bein pr. bolt, se stålkontrollen');
  cb.in('⌀_s', r.ds, 'mm', 'Tilleggsarmering');
  // Kjegla er en kjegle: den er dypest ved bolten og grunnere lenger ut, så
  // et bein som står lenger fra bolten krysser kjegleflata høyere og har
  // kortere l_1. Det korteste beinet blant dem som teller med styrer.
  cb.in('l_1', G.insideLen, 'mm', bent
    ? 'Bein inne i bruddlegemet + kvartbøyen i hjørnet, pr. bein – målt ned til ' +
      'der kjegleflata krysser beinet'
    : 'Rett stang inne i bruddlegemet, ned til der kjegleflata krysser stanga');
  if (L) {
    cb.in('z_kjegle', L.zConeMin, 'mm',
      'Dybden der kjegleflata krysser det styrende beinet' +
      (L.zConeMax - L.zConeMin > 1
        ? ` (${n(L.zConeMin, 0)}–${n(L.zConeMax, 0)} mm over beina)` : ''));
  }
  cb.in('l_1,min', G.insideMin, 'mm',
    `${minAnchorageFactor(r.geometryType)}·⌀_s – minste forankring i bruddlegemet (${typeTxt})`);
  cb.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  cb.in('α_1', alpha1, '–', bent ? 'Bøyd stangende' : 'Rett stangende');
  cb.in('N_Ed,bolt', NEd, 'N', 'Strekk i den styrende bolten');
  cb.step({ sym: 'f_bd', desc: 'Dimensjonerende heftfasthet',
    formula: '2,25 · η_1 · η_2 · f_ctk;0,05 / γ_c', subst: '–', value: f, unit: 'N/mm²',
    ref: 'EN 1992-1-1 8.4.2' });
  const NRk_a = cb.res({ sym: 'N_Rk,a', formula: 'n_eff · π · ⌀_s · l_1 · f_bd / α_1',
    subst: `${n(nLegs)} · π · ${n(r.ds, 0)} · ${n(G.insideLen, 0)} · ${n(f)} / ${n(alpha1)}`,
    value: nLegs * (G.insideLen * Math.PI * r.ds * f) / alpha1, unit: 'N' });
  cb.util({ formula: 'N_Ed,bolt / N_Rd,a', subst: `${n(NEd)} / ${n(NRk_a)}`, value: NEd / NRk_a });
  const minLenTxt = G.insideLen < G.insideMin
    ? `l₁ = ${n(G.insideLen, 0)} mm < ${minAnchorageFactor(r.geometryType)}⌀ = ${n(G.insideMin, 0)} mm – ` +
      `kravet til minste forankringslengde inne i bruddlegemet (${typeTxt}) er ikke oppfylt.`
    : `l₁ = ${n(G.insideLen, 0)} mm ≥ ${minAnchorageFactor(r.geometryType)}⌀ = ` +
      `${n(G.insideMin, 0)} mm (${typeTxt}).` +
      (L ? ` Målt ned til ${n(L.zConeMin, 0)} mm, der kjegleflata krysser beinet – ` +
        `ikke til h_ef = ${n(G.hef, 0)} mm.` : '') +
      (boltTxt ? ' ' + boltTxt : '');
  const noReach = L && L.zConeMin <= L.dLegTop + 1e-6;
  checks.push({ id: `N-sre-anchorage-${r.id}`, mode: `Tilleggsarmering ${r.id} – forankring i bruddlegemet`,
    clause: '7.2.1.2', scope: 'gruppe', NRk: NRk_a, NRd: NRk_a, NEd, util: NEd / NRk_a, calc: cb,
    group: r.id, note: noReach
      ? `Kjegleflata krysser beinet ${n(L.zConeMin, 0)} mm nede, over der beinet ` +
        `begynner (${n(L.dLegTop, 0)} mm): det rette beinet ligger helt utenfor ` +
        `bruddlegemet, og bare bøyen bidrar. Legg armeringa nærmere bolten, ` +
        `eller øk h_ef.` + ' ' + minLenTxt
      : minLenTxt });

  // --- d) forankringslengde UTENFOR kjegla, EN 1992-1-1 8.4 ---------------
  //  l_b,rqd skal regnes med den FAKTISKE spenninga i stanga ved dette
  //  tverrsnittet (8.4.3(2), σ_sd i (8.3)), ikke fullt utnyttet f_yd - ellers
  //  blir kravet det samme uansett hvor mye eller hvor tjukk armering som er
  //  lagt inn, og flere/tjukkere bein gir aldri kortere forankring igjen.
  //  L.fits/qualifies (gruppa sin egnethet til å erstatte kjegla) er en
  //  geometrisk detaljeringssjekk og skal fortsatt være konservativ mot full
  //  utnyttelse - det er bare DENNE utnyttelsen som skal følge lasten.
  if (L) {
    const cl = new Calc('EN 1992-1-1 8.4');
    const fyd = r.fyk / GAMMA_S;
    const As = Math.PI * r.ds * r.ds / 4;
    const sigmaSd = nLegs > 0 ? Math.min(fyd, NEd / (nLegs * As)) : 0;
    const alOut = anchorageLength(m.concrete.fck, r.ds, sigmaSd, bent);
    cl.in('⌀_s', r.ds, 'mm', 'Tilleggsarmering');
    cl.in('N_Ed,bolt', NEd, 'N', 'Strekk i den styrende bolten, se stålkontrollen');
    cl.in('n_eff', nLegs, 'stk', 'Bein pr. bolt, se stålkontrollen');
    const sSd = cl.step({ sym: 'σ_sd', desc:
        'Faktisk spenning i armeringa - ikke fullt utnyttet f_yd, se (8.3)',
      formula: 'min(f_yd; N_Ed,bolt / (n_eff · A_s))',
      subst: `min(${n(fyd)}; ${n(NEd)} / (${n(nLegs)} · ${n(As, 0)}))`,
      value: sigmaSd, unit: 'N/mm²' });
    cl.in('f_bd', f, 'N/mm²', 'Heftfasthet, se forankringskontrollen');
    const lbr = cl.step({ sym: 'l_b,rqd', desc: 'Grunnleggende forankringslengde',
      formula: '(⌀_s / 4) · (σ_sd / f_bd)',
      subst: `(${n(r.ds, 0)} / 4) · (${n(sSd)} / ${n(f)})`,
      value: alOut.lbRqd, unit: 'mm', ref: '(8.3)' });
    const a1 = cl.in('α_1', alpha1, '–', bent ? 'Krok/bøy i enden – tab. 8.2' : 'Rett stang');
    cl.step({ sym: 'l_b,min', desc: 'Nedre grense for strekkforankring',
      formula: 'maks(0,3·l_b,rqd; 10·⌀_s; 100 mm)',
      subst: `maks(${n(0.3 * alOut.lbRqd, 0)}; ${n(10 * r.ds, 0)}; 100)`,
      value: alOut.lbmin, unit: 'mm', ref: '(8.6)' });
    const lbd = cl.res({ sym: 'l_bd', formula: 'maks(α_1 · l_b,rqd; l_b,min)',
      subst: `maks(${n(a1)} · ${n(lbr, 0)}; ${n(alOut.lbmin, 0)})`, value: alOut.lbd, unit: 'mm',
      ref: '(8.4)' });
    const avail = cl.step({ sym: 'l_bd,tilgj.', desc:
        'Forankring tilgjengelig UTENFOR bruddkjegla, langs stanga fra h_ef og nedover',
      formula: L.endBend ? 'rett bein + endebøy + fot' : 'rett bein under kjegla',
      subst: L.endBend
        ? `${n(L.outsideLen, 0)} + ${n(L.bendArc, 0)} + ${n(L.footLen, 0)}`
        : `${n(L.outsideLen, 0)}`,
      value: L.anchorageAvail, unit: 'mm' });
    cl.util({ formula: 'l_bd / l_bd,tilgj.', subst: `${n(lbd, 0)} / ${n(avail, 0)}`,
      value: alOut.lbd / Math.max(avail, 1e-6) });
    const fitsOut = L.anchorageAvail + 1e-6 >= alOut.lbd;
    checks.push({ id: `N-sre-lbd-${r.id}`,
      mode: `Tilleggsarmering ${r.id} – forankringslengde utenfor kjegla`,
      clause: 'EN 1992-1-1 8.4', scope: 'gruppe', NRk: NaN, NRd: NaN, NEd: NaN,
      util: alOut.lbd / Math.max(avail, 1e-6), calc: cl, group: r.id,
      expr: 'l_bd / l_bd,tilgj. ≤ 1,0',
      note: fitsOut
        ? undefined
        : `Bare ${n(L.anchorageAvail, 0)} mm forankring utenfor kjegla mot l_bd = ` +
          `${n(alOut.lbd, 0)} mm.` + (bent && !L.endBend
            ? ' En bøy ut i enden av beina gir bøyen pluss foten som forankring, ' +
              'og hjelper i en tynn plate.'
            : ' Øk tykkelsen, reduser ⌀, eller legg inn endebøy.') });
  }

  // --- d2) egen stang i bøyen: forankring, EN 1992-1-1 8.4 ----------------
  //  Bøyen på bøylen krøller seg rundt en stang på tvers. Er den stanga egen
  //  (ikke overflatearmeringa), er det den som fører kraften fra bøyene ut i
  //  konstruksjonen, og da må den forankres for seg.
  if (L && bent && L.bendBarMode === 'own') {
    const bars = buildBendBars(m, r);
    // Styrende er den med minst EKTE kantavstand, ikke den avkuttede
    // tegneverdien - se merknaden i buildBendBars.
    const worst = bars.length
      ? bars.reduce((a, b) => (b.trueAnchorage < a.trueAnchorage ? b : a)) : null;
    const cbb = new Calc('EN 1992-1-1 8.4');
    cbb.in('⌀_b', L.dtBend, 'mm',
      `Stang i bøyen – minst like tjukk som bøylen (⌀_s = ${n(r.ds, 0)} mm)`);
    cbb.in('n_stenger', bars.length, 'stk', 'Én stang pr. bøy, lagt på tvers av bøyleretninga');
    cbb.in('d_b', L.dBend, 'mm',
      'Dybde til senter av stanga – den ligger INNE i bøyen, under den ' +
      'vannrette delen av bøylen');
    const fb = fbd(m.concrete.fck, L.dtBend, true);
    cbb.step({ sym: 'f_bd', desc: 'Dimensjonerende heftfasthet',
      formula: '2,25 · η_1 · η_2 · f_ctk;0,05 / γ_c', subst: '–', value: fb,
      unit: 'N/mm²', ref: 'EN 1992-1-1 8.4.2' });
    const lreq = cbb.res({ sym: 'l_bd', desc: 'Nødvendig forankring utenfor ytterste bøyle',
      formula: 'maks(α_1 · l_b,rqd; l_b,min)', subst: '–', value: L.bendBarLbd,
      unit: 'mm', ref: '(8.4)' });
    const lprov = cbb.in('l_bd,tilgj.', worst ? worst.trueAnchorage : 0, 'mm',
      'Faktisk avstand til fri kant utenfor ytterste bøyle - IKKE avkuttet ved l_bd');
    cbb.util({ formula: 'l_bd / l_bd,tilgj.', subst: `${n(lreq, 0)} / ${n(lprov, 0)}`,
      value: lreq / Math.max(lprov, 1e-6) });
    // Detaljeringskontroll, ikke en gradert utnyttelse: enten får stanga nok
    // forankring i betongen som er der, eller så gjør den ikke. Prosent-
    // visning ville antydet en marginvurdering som ikke gir mening her.
    checks.push({ id: `N-sre-bendbar-${r.id}`,
      mode: `Tilleggsarmering ${r.id} – stang i bøyen`,
      clause: 'EN 1992-1-1 8.4', scope: 'gruppe', NRk: NaN, NRd: NaN, NEd: NaN,
      util: lreq / Math.max(lprov, 1e-6), binary: true, calc: cbb, group: r.id,
      expr: 'l_bd / l_bd,tilgj. ≤ 1,0',
      note: 'Bøyen krøller seg rundt denne stanga, så bøylen ligger over den. ' +
        (worst && worst.trueAnchorage + 1e-6 < L.bendBarLbd
          ? `Betongdelen gir bare ${n(worst.trueAnchorage, 0)} mm forankring utenfor ` +
            `ytterste bøyle mot l_bd = ${n(L.bendBarLbd, 0)} mm – forleng stanga, ` +
            'reduser ⌀_b, eller bruk overflatearmeringa i bøyen i stedet.'
          : `Stanga er ${n(worst ? worst.span : 0, 0)} mm lang, med ` +
            `${n(worst ? worst.trueAnchorage : 0, 0)} mm tilgjengelig forankring utenfor ` +
            'ytterste bøyle i hver ende.') });
  }

  // --- e) kjeglebrudd på nytt, fra enden av armeringa ---------------------
  if (L && L.bars.length) checks.push(reinforcementCone(m, res, r, L));

  // --- f) videre kraftoverføring til konstruksjonens armering -------------
  //  U-bøyle/løkke: bøyen skal fortrinnsvis omslutte overflatearmeringa, så
  //  kraften føres videre gjennom nettet. Rett stang omslutter ingenting og
  //  MÅ i stedet skjøtes mot konstruksjonens armering.
  if (r.lapToExisting?.present) {
    const cl = new Calc('EN 1992-1-1 8.7');
    const al = anchorageLength(m.concrete.fck, r.ds, r.fyk / 1.15, bent);
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
      note: (bent
        ? 'U-bøyla omslutter overflatearmeringa; overlappet er en tilleggsdokumentasjon. '
        : 'Rett tilleggsarmering omslutter ikke overflatearmeringa – dette overlappet ' +
          'er kraftveien videre inn i konstruksjonen. ') +
        'Overlappet er ikke kontrollert mot den faktiske armeringen i konstruksjonen ' +
        'for øvrig, bare mot den oppgitte lengden.' });
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
