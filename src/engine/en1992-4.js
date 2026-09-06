// ---------------------------------------------------------------------------
//  NS-EN 1992-4:2018 - forankring i betong.
//  Standarden dekker forankringer MED FOT (headed fasteners): bolthode,
//  endemutter eller innstøpt plate i boltenden.  Uten fot - ren
//  heftforankring av kamstål eller gjengestang - har EN 1992-4 ingen modell;
//  de kontrollene hoppes over med henvisning til Betongelementboka B19
//  pkt. 19.3.3 og 19.3.4 (se src/engine/b19.js).
//
//  Hver kontroll registrerer utregninga si i et Calc-objekt: inndata med kilde,
//  hvert mellomledd symbolsk og med tall, og punktet i standarden. Det er den
//  registreringa resultatruta viser fram.
//
//  VIKTIG: alle tallkonstanter ligger samlet i K nedenfor, med henvisning til
//  punkt i standarden. De må kontrolleres mot trykt utgave av NS-EN 1992-4 +
//  norsk NA før verktøyet brukes i prosjektering.
// ---------------------------------------------------------------------------

import { anchorPositions, shaftProps, anchorFoot, edgeDistances,
         memberLimits } from '../core/model.js';
import { unionLength, clamp, clippedSquares } from './geometry.js';
import { Calc, skipped, n } from './calc.js';

export const K = {
  // Betongkjegle, strekk - 7.2.1.4 (7.2)
  k1_cracked: 8.9, k1_uncracked: 12.7,     // innstøpt hodebolt
  // Uttrekk (pull-out) - 7.2.1.5 (7.6)
  k2_cracked: 7.5, k2_uncracked: 10.5,
  // Utblåsing (blow-out) - 7.2.1.9 (7.15)
  k5_cracked: 8.7, k5_uncracked: 12.2,
  // Stålbrudd skjær - 7.2.2.3.1
  k6: 0.6,
  k7_ductile: 1.0, k7_brittle: 0.8,
  // Betongutstøting (pry-out) - 7.2.2.4 (7.39)
  k8_short: 1.0, k8_long: 2.0,             // h_ef < 60 mm / >= 60 mm
  // Kantbrudd skjær - 7.2.2.5 (7.42)
  k9_cracked: 1.7, k9_uncracked: 2.4,
};

const EDGE_LABEL = { xNeg: '−x', xPos: '+x', yNeg: '−y', yPos: '+y' };
const nz = v => (Number.isFinite(v) ? v : 1e9);

const FOOT_TXT = { head: 'bolthodet', nut: 'endemutteren', plate: 'endeplata' };
const FOOT_SRC = {
  head: 'Bolter · hodediameter (EN ISO 13918)',
  nut: 'Bolter · nøkkelvidde på endemutteren',
  plate: 'Bolter · medvirkende sidekant på endeplata',
};
const FOOT_FORMULA = {
  head: 'π · (⌀_h² − ⌀²) / 4',
  nut: '0,866 · NV² − π · ⌀² / 4',
  plate: 'b_eff² − π · ⌀² / 4,   b_eff = min(b_p ; ⌀ + 2·t_p)',
};

// Kontroller som forutsetter en forankringsfot. Uten fot (ren heftforankring)
// har EN 1992-4 ingen modell - da vises kontrollen som ikke aktuell, med
// henvisning til B19.
const NO_FOOT =
  'Forankringen har ingen fot (uten endemutter). NS-EN 1992-4 dekker bare ' +
  'forankringer med fot. Heftforankring av kamstål og gjengestang er dekket ' +
  'av Betongelementboka bind B kap. B19, pkt. 19.3.3 og 19.3.4 – bytt ' +
  'regelverk for å få den kontrollen.';
const noFoot = (id, mode, clause, scope) => ({
  id, mode, clause, scope, NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
  calc: skipped(clause, NO_FOOT), note: NO_FOOT,
});

// ---------------------------------------------------------------------------
//  Materialfaktorer, 4.4.3.1 + NA
// ---------------------------------------------------------------------------
export function partialFactors(m) {
  const { fuk, fyk } = m.anchors;
  const gMsN = Math.max(1.2 * fuk / fyk, 1.4);
  const mild = fuk <= 800 && fyk / fuk <= 0.8;
  const gMsV = mild ? Math.max(1.0 * fuk / fyk, 1.25) : 1.5;
  const gMc = m.code.gammaC * m.code.gammaInst;
  return { gMsN, gMsV, gMc, gMp: gMc, gMsp: gMc, gMcb: gMc, mild };
}

// Prosjektert areal for betongkjegle, 7.2.1.4 - union av rektangler klippet
// mot betongdelens frie kanter.
function coneArea(m, pts, ccr) {
  return clippedSquares(pts, ccr, memberLimits(m));
}

function minEdge(m, pts) {
  let c = Infinity;
  for (const p of pts) {
    const e = edgeDistances(m, p.x, p.y);
    c = Math.min(c, e.xNeg, e.xPos, e.yNeg, e.yPos);
  }
  return c;
}

// ===========================================================================
//  STREKK
// ===========================================================================

// 7.2.1.3 Stålbrudd - pr. bolt
export function tensionSteel(m, res, g) {
  const c = new Calc('7.2.1.3');
  const sh = shaftProps(m);
  const d = c.in('⌀', m.anchors.d, 'mm', 'Bolter');
  const fuk = c.in('f_uk', m.anchors.fuk, 'N/mm²', `Bolter · ${m.anchors.steel}`);
  const gM = c.in('γ_Ms,N', g.gMsN, '–', 'maks(1,2·f_uk/f_yk ; 1,4) – 4.4.3.1');
  const NEd = Math.max(0, ...res.anchors.map(a => a.N));
  c.in('N_Ed', NEd, 'N', 'Største boltestrekk fra kraftfordelinga');

  const As = c.step({
    sym: 'A_s', desc: sh.threaded
      ? 'Spenningsareal A_sp i gjengene' : 'Spenningstverrsnitt i boltskaftet',
    formula: sh.threaded ? 'A_sp (tabell)' : 'π · ⌀² / 4',
    subst: sh.threaded ? `M${n(d, 0)}` : `π · ${n(d, 0)}² / 4`,
    value: sh.As, unit: 'mm²',
  });
  const NRk = c.res({
    sym: 'N_Rk,s', formula: 'A_s · f_uk',
    subst: `${n(As)} · ${n(fuk, 0)}`, value: As * fuk, unit: 'N', ref: '(7.1)',
  });
  const NRd = NRk / gM;
  c.step({
    sym: 'N_Rd,s', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,s / γ_Ms,N', subst: `${n(NRk)} / ${n(gM)}`,
    value: NRd, unit: 'N',
  });
  c.util({ formula: 'N_Ed / N_Rd,s', subst: `${n(NEd)} / ${n(NRd)}`, value: NEd / NRd });

  return { id: 'N-steel', mode: 'Stålbrudd, strekk', clause: '7.2.1.3', scope: 'bolt',
           NRk, NRd, NEd, util: NEd / NRd, calc: c };
}

// 7.2.1.5 Uttrekk (hodetrykk) - pr. bolt
export function tensionPullout(m, res, g) {
  const foot = anchorFoot(m);
  if (!foot.hasFoot) return noFoot('N-pullout', 'Uttrekk (hodetrykk)', '7.2.1.5', 'bolt');
  const c = new Calc('7.2.1.5');
  const d = c.in('⌀', m.anchors.d, 'mm', 'Bolter');
  const dh = c.in('⌀_h', foot.eff, 'mm', FOOT_SRC[foot.kind]);
  const fck = c.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  const cracked = m.code.cracked;
  const k2 = c.in('k_2', cracked ? K.k2_cracked : K.k2_uncracked, '–',
    `Regelverk · ${cracked ? 'opprisset' : 'uopprisset'} betong`);
  const gM = c.in('γ_Mp', g.gMp, '–', 'γ_c · γ_inst – 4.4.3.1');
  const NEd = Math.max(0, ...res.anchors.map(a => a.N));
  c.in('N_Ed', NEd, 'N', 'Største boltestrekk fra kraftfordelinga');

  const Ah = c.step({
    sym: 'A_h', desc: `Lastopptakende netto areal under ${FOOT_TXT[foot.kind]}`,
    formula: FOOT_FORMULA[foot.kind],
    subst: `${n(foot.Agross, 0)} − π · ${n(d, 0)}² / 4` +
           (foot.limited ? `   (medvirkende sidekant begrenset til ⌀ + 2·t)` : ''),
    value: foot.Ah, unit: 'mm²',
  });
  const NRk = c.res({
    sym: 'N_Rk,p', formula: 'k_2 · A_h · f_ck',
    subst: `${n(k2)} · ${n(Ah)} · ${n(fck, 0)}`, value: k2 * Ah * fck, unit: 'N', ref: '(7.6)',
  });
  const NRd = NRk / gM;
  c.step({ sym: 'N_Rd,p', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,p / γ_Mp', subst: `${n(NRk)} / ${n(gM)}`, value: NRd, unit: 'N' });
  c.util({ formula: 'N_Ed / N_Rd,p', subst: `${n(NEd)} / ${n(NRd)}`, value: NEd / NRd });

  return { id: 'N-pullout', mode: 'Uttrekk (hodetrykk)', clause: '7.2.1.5', scope: 'bolt',
           NRk, NRd, NEd, util: NEd / NRd, calc: c };
}

// 7.2.1.4 Betongkjegle - gruppe av strekkbolter
export function tensionConcreteCone(m, res, g) {
  if (!anchorFoot(m).hasFoot)
    return noFoot('N-cone', 'Betongkjegle', '7.2.1.4', 'gruppe');
  const pts = res.tension.anchors;
  if (!pts.length) {
    return { id: 'N-cone', mode: 'Betongkjegle', clause: '7.2.1.4', scope: 'gruppe',
             NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
             calc: skipped('7.2.1.4', 'Ingen bolter i strekk.'),
             note: 'Ingen bolter i strekk.' };
  }
  const c = new Calc('7.2.1.4');
  const hef = c.in('h_ef', m.anchors.hef, 'mm', 'Bolter · effektiv forankringsdybde');
  const fck = c.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  const cracked = m.code.cracked;
  const k1 = c.in('k_1', cracked ? K.k1_cracked : K.k1_uncracked, '–',
    `Regelverk · ${cracked ? 'opprisset' : 'uopprisset'}, innstøpt hodebolt`);
  const gM = c.in('γ_Mc', g.gMc, '–', 'γ_c · γ_inst – 4.4.3.1');
  const nt = c.in('n_strekk', pts.length, 'stk', 'Bolter i strekk fra kraftfordelinga');
  const NEd = c.in('N_Ed,g', res.tension.Ntot, 'N', 'Sum strekk i boltegruppa');

  const scr = c.step({ sym: 's_cr,N', desc: 'Karakteristisk senteravstand',
    formula: '3 · h_ef', subst: `3 · ${n(hef, 0)}`, value: 3 * hef, unit: 'mm', ref: '(7.4)' });
  const ccr = c.step({ sym: 'c_cr,N', desc: 'Karakteristisk kantavstand',
    formula: 's_cr,N / 2 = 1,5 · h_ef', subst: `1,5 · ${n(hef, 0)}`,
    value: 1.5 * hef, unit: 'mm' });

  const N0 = c.step({
    sym: 'N⁰_Rk,c', desc: 'Kjeglekapasitet, én bolt uten kant- eller gruppevirkning',
    formula: 'k_1 · √f_ck · h_ef^1,5',
    subst: `${n(k1)} · √${n(fck, 0)} · ${n(hef, 0)}^1,5`,
    value: k1 * Math.sqrt(fck) * Math.pow(hef, 1.5), unit: 'N', ref: '(7.2)',
  });
  const A0 = c.step({ sym: 'A⁰_c,N', desc: 'Referanseareal for én bolt',
    formula: 's_cr,N²', subst: `${n(scr, 0)}²`, value: scr * scr, unit: 'mm²' });
  const Ac = c.step({
    sym: 'A_c,N', desc: 'Faktisk utbruddsareal for gruppa',
    formula: 'union av (⌀ ± c_cr,N) for strekkboltene, klippet mot frie kanter',
    subst: `${nt} bolter, c_cr,N = ${n(ccr, 0)} mm`,
    value: coneArea(m, pts, 1.5 * hef), unit: 'mm²', ref: '(7.3)',
  });

  const cmin = minEdge(m, pts);
  const psi_s = c.step({
    sym: 'ψ_s,N', desc: 'Kanteffekt – trykkspenningene forstyrres nær en fri kant',
    formula: '0,7 + 0,3 · c / c_cr,N ≤ 1,0',
    subst: Number.isFinite(cmin)
      ? `0,7 + 0,3 · ${n(cmin, 0)} / ${n(ccr, 0)}` : 'ingen fri kant innenfor c_cr,N',
    value: Number.isFinite(cmin) ? clamp(0.7 + 0.3 * cmin / ccr, 0, 1) : 1.0,
    unit: '–', ref: '(7.4)',
  });
  const psi_re = c.step({
    sym: 'ψ_re,N', desc: 'Tett armering gir finere oppsprekking',
    formula: m.code.denseReinf ? '0,5 + h_ef / 200 ≤ 1,0' : '1,0 (ikke tett armering)',
    subst: m.code.denseReinf ? `0,5 + ${n(hef, 0)} / 200` : '–',
    value: m.code.denseReinf ? clamp(0.5 + hef / 200, 0, 1) : 1.0, unit: '–', ref: '(7.5)',
  });
  const psi_ecx = clamp(1 / (1 + 2 * res.tension.eNx / scr), 0, 1);
  const psi_ecy = clamp(1 / (1 + 2 * res.tension.eNy / scr), 0, 1);
  const psi_ec = c.step({
    sym: 'ψ_ec,N', desc: 'Eksentrisk strekkresultant, regnet hver retning for seg',
    formula: '1 / (1 + 2·e_N/s_cr,N) ≤ 1,0   (x-retning · y-retning)',
    subst: `e_N,x = ${n(res.tension.eNx, 1)} mm → ${n(psi_ecx)} · ` +
           `e_N,y = ${n(res.tension.eNy, 1)} mm → ${n(psi_ecy)}`,
    value: psi_ecx * psi_ecy, unit: '–', ref: '(7.3)',
  });

  const NRk = c.res({
    sym: 'N_Rk,c', formula: 'N⁰_Rk,c · (A_c,N / A⁰_c,N) · ψ_s,N · ψ_re,N · ψ_ec,N',
    subst: `${n(N0)} · (${n(Ac, 0)}/${n(A0, 0)}) · ${n(psi_s)} · ${n(psi_re)} · ${n(psi_ec)}`,
    value: N0 * (Ac / A0) * psi_s * psi_re * psi_ec, unit: 'N', ref: '(7.1)',
  });
  const NRd = NRk / gM;
  c.step({ sym: 'N_Rd,c', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,c / γ_Mc', subst: `${n(NRk)} / ${n(gM)}`, value: NRd, unit: 'N' });
  c.util({ formula: 'N_Ed,g / N_Rd,c', subst: `${n(NEd)} / ${n(NRd)}`, value: NEd / NRd });

  return { id: 'N-cone', mode: 'Betongkjegle', clause: '7.2.1.4', scope: 'gruppe',
           NRk, NRd, NEd, util: NEd / NRd, calc: c };
}

// 7.2.1.9 Utblåsing ved kant - kun når c <= 0,5·h_ef
export function tensionBlowout(m, res, g) {
  const foot = anchorFoot(m);
  if (!foot.hasFoot) return noFoot('N-blowout', 'Utblåsing ved kant', '7.2.1.9', 'bolt');
  const hef = m.anchors.hef;
  const Ah = foot.Ah;
  const cracked = m.code.cracked;
  const k5 = cracked ? K.k5_cracked : K.k5_uncracked;

  let worst = null;
  for (const p of res.tension.anchors) {
    const e = edgeDistances(m, p.x, p.y);
    const c1 = Math.min(e.xNeg, e.xPos, e.yNeg, e.yPos);
    if (!Number.isFinite(c1) || c1 > 0.5 * hef) continue;
    const perp = (c1 === e.xNeg || c1 === e.xPos)
      ? Math.min(e.yNeg, e.yPos) : Math.min(e.xNeg, e.xPos);
    const psi_s = clamp(0.7 + 0.3 * nz(perp) / (2 * c1), 0, 1);
    const N0 = k5 * c1 * Math.sqrt(Ah) * Math.sqrt(m.concrete.fck);
    const NRk = N0 * psi_s, NRd = NRk / g.gMcb;
    const cand = { c1, perp, psi_s, N0, NRk, NRd, NEd: p.N, util: p.N / NRd };
    if (!worst || cand.util > worst.util) worst = cand;
  }
  if (!worst) {
    const why = `Ikke aktuell: c > 0,5·h_ef = ${n(0.5 * hef, 0)} mm for alle bolter i strekk.`;
    return { id: 'N-blowout', mode: 'Utblåsing ved kant', clause: '7.2.1.9', scope: 'bolt',
             NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
             calc: skipped('7.2.1.9', why), note: why };
  }
  const c = new Calc('7.2.1.9');
  c.in('c_1', worst.c1, 'mm', 'Minste kantavstand for bolt i strekk');
  c.in('A_h', Ah, 'mm²', 'Hodeareal, se uttrekkskontrollen');
  c.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  c.in('k_5', k5, '–', `Regelverk · ${cracked ? 'opprisset' : 'uopprisset'}`);
  c.in('γ_Mcb', g.gMcb, '–', '4.4.3.1');
  c.in('N_Ed', worst.NEd, 'N', 'Strekk i den styrende bolten');
  c.step({ sym: 'gyldighet', desc: 'Kontrollen er bare aktuell nær en kant',
    formula: 'c_1 ≤ 0,5 · h_ef',
    subst: `${n(worst.c1, 0)} ≤ ${n(0.5 * hef, 0)}`, value: 1, unit: '✓' });
  c.step({ sym: 'N⁰_Rk,cb', desc: 'Grunnverdi utblåsing',
    formula: 'k_5 · c_1 · √A_h · √f_ck',
    subst: `${n(k5)} · ${n(worst.c1, 0)} · √${n(Ah)} · √${n(m.concrete.fck, 0)}`,
    value: worst.N0, unit: 'N', ref: '(7.15)' });
  c.step({ sym: 'ψ_s,Nb', desc: 'Sidekant vinkelrett på c_1',
    formula: '0,7 + 0,3 · c_2 / (2·c_1) ≤ 1,0',
    subst: Number.isFinite(worst.perp)
      ? `0,7 + 0,3 · ${n(worst.perp, 0)} / (2·${n(worst.c1, 0)})` : 'ingen sidekant',
    value: worst.psi_s, unit: '–' });
  c.res({ sym: 'N_Rk,cb', formula: 'N⁰_Rk,cb · ψ_s,Nb',
    subst: `${n(worst.N0)} · ${n(worst.psi_s)}`, value: worst.NRk, unit: 'N' });
  c.step({ sym: 'N_Rd,cb', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,cb / γ_Mcb', subst: `${n(worst.NRk)} / ${n(g.gMcb)}`,
    value: worst.NRd, unit: 'N' });
  c.util({ formula: 'N_Ed / N_Rd,cb',
    subst: `${n(worst.NEd)} / ${n(worst.NRd)}`, value: worst.util });

  return { id: 'N-blowout', mode: 'Utblåsing ved kant', clause: '7.2.1.9', scope: 'bolt',
           NRk: worst.NRk, NRd: worst.NRd, NEd: worst.NEd, util: worst.util, calc: c };
}

// 7.2.1.7 Spalting under last (forenklet)
export function tensionSplitting(m, res, g, cone) {
  if (!Number.isFinite(cone.NRk))
    return noFoot('N-split', 'Spalting', '7.2.1.7', 'gruppe');
  const hef = m.anchors.hef;
  const ccr_sp = 2 * hef, hmin = 2 * hef;
  const cmin = minEdge(m, res.tension.anchors);
  const dekket = m.code.supplementaryReinf;
  const geomOk = (Number.isFinite(cmin) ? cmin >= ccr_sp : true) && m.concrete.h >= hmin;

  if (dekket || geomOk) {
    const why = dekket
      ? 'Dekket av spaltearmering – 7.2.1.7(1).'
      : `Ikke nødvendig: c ≥ c_cr,sp = ${n(ccr_sp, 0)} mm og h ≥ h_min = ${n(hmin, 0)} mm.`;
    return { id: 'N-split', mode: 'Spalting', clause: '7.2.1.7', scope: 'gruppe',
             NRk: Infinity, NRd: Infinity, NEd: res.tension.Ntot, util: 0,
             calc: skipped('7.2.1.7', why), note: why };
  }
  const c = new Calc('7.2.1.7');
  c.in('h', m.concrete.h, 'mm', 'Betongdel · tykkelse');
  c.in('h_min', hmin, 'mm', 'Forenklet: 2·h_ef (skal hentes fra ETA)');
  c.in('c_cr,sp', ccr_sp, 'mm', 'Forenklet: 2·h_ef (skal hentes fra ETA)');
  c.in('N_Rk,c', cone.NRk, 'N', 'Fra betongkjeglekontrollen');
  c.in('γ_Msp', g.gMsp, '–', '4.4.3.1');
  const psi_h = c.step({ sym: 'ψ_h,sp', desc: 'Tynn betongdel gir redusert spaltekapasitet',
    formula: '(h / h_min)^(2/3) ≤ 1,0',
    subst: `(${n(m.concrete.h, 0)} / ${n(hmin, 0)})^(2/3)`,
    value: clamp(Math.pow(m.concrete.h / hmin, 2 / 3), 0, 1), unit: '–' });
  const NRk = c.res({ sym: 'N_Rk,sp', formula: 'N_Rk,c · ψ_h,sp',
    subst: `${n(cone.NRk)} · ${n(psi_h)}`, value: cone.NRk * psi_h, unit: 'N' });
  const NRd = NRk / g.gMsp;
  c.step({ sym: 'N_Rd,sp', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,sp / γ_Msp', subst: `${n(NRk)} / ${n(g.gMsp)}`, value: NRd, unit: 'N' });
  const NEd = res.tension.Ntot;
  c.util({ formula: 'N_Ed,g / N_Rd,sp', subst: `${n(NEd)} / ${n(NRd)}`, value: NEd / NRd });

  return { id: 'N-split', mode: 'Spalting', clause: '7.2.1.7', scope: 'gruppe',
           NRk, NRd, NEd, util: NEd / NRd, calc: c,
           note: 'Forenklet: c_cr,sp = 2·h_ef antatt. Skal hentes fra ETA/produktdata.' };
}

// ===========================================================================
//  SKJÆR
// ===========================================================================

// 7.2.2.3 Stålbrudd
export function shearSteel(m, res, g) {
  const VEd = Math.max(0, ...res.anchors.map(a => a.V));
  const sh = shaftProps(m);
  const d = m.anchors.d, fuk = m.anchors.fuk;
  const As = sh.As;

  if (res.leverArm > 0) {
    const c = new Calc('7.2.2.3.2');
    c.in('⌀', d, 'mm', 'Bolter');
    c.in('f_uk', fuk, 'N/mm²', `Bolter · ${m.anchors.steel}`);
    c.in('l_a', res.leverArm, 'mm', 'Plate · avstand fra betong + t/2');
    c.in('γ_Ms,V', g.gMsV, '–', '4.4.3.1');
    c.in('V_Ed', VEd, 'N', 'Største boltskjær fra kraftfordelinga');
    const Wel = c.step({ sym: 'W_el', desc: 'Elastisk motstandsmoment i skaftet',
      formula: 'π · ⌀_ekv³ / 32', subst: `π · ${n(sh.dEff, 1)}³ / 32`,
      value: Math.PI * Math.pow(sh.dEff, 3) / 32, unit: 'mm³' });
    const M0 = c.step({ sym: 'M⁰_Rk,s', desc: 'Momentkapasitet uten samtidig strekk',
      formula: '1,2 · W_el · f_uk', subst: `1,2 · ${n(Wel)} · ${n(fuk, 0)}`,
      value: 1.2 * Wel * fuk, unit: 'Nmm', ref: '(7.37)' });
    const NRds = As * fuk / g.gMsN;
    const NEd = Math.max(0, ...res.anchors.map(a => a.N));
    const MRk = c.step({ sym: 'M_Rk,s', desc: 'Redusert av samtidig strekk i bolten',
      formula: 'M⁰_Rk,s · (1 − N_Ed/N_Rd,s)',
      subst: `${n(M0)} · (1 − ${n(NEd)}/${n(NRds)})`,
      value: M0 * Math.max(0, 1 - NEd / NRds), unit: 'Nmm', ref: '(7.36)' });
    const alphaM = c.in('α_M', 1.0, '–', 'Fritt dreibar plate (2,0 ved full innspenning)');
    const VRk = c.res({ sym: 'V_Rk,s,M', formula: 'α_M · M_Rk,s / l_a',
      subst: `${n(alphaM)} · ${n(MRk)} / ${n(res.leverArm, 0)}`,
      value: alphaM * MRk / res.leverArm, unit: 'N', ref: '(7.35)' });
    const VRd = VRk / g.gMsV;
    c.step({ sym: 'V_Rd,s', desc: 'Dimensjonerende kapasitet',
      formula: 'V_Rk,s,M / γ_Ms,V', subst: `${n(VRk)} / ${n(g.gMsV)}`, value: VRd, unit: 'N' });
    c.util({ formula: 'V_Ed / V_Rd,s', subst: `${n(VEd)} / ${n(VRd)}`, value: VEd / VRd });
    return { id: 'V-steel', mode: 'Stålbrudd, skjær m/ momentarm', clause: '7.2.2.3.2',
             scope: 'bolt', NRk: VRk, NRd: VRd, NEd: VEd, util: VEd / VRd, calc: c };
  }

  const c = new Calc('7.2.2.3.1');
  c.in('⌀', d, 'mm', 'Bolter');
  c.in('f_uk', fuk, 'N/mm²', `Bolter · ${m.anchors.steel}`);
  const k6 = c.in('k_6', K.k6, '–', 'Innstøpt hodebolt – 7.2.2.3.1');
  const k7 = c.in('k_7', m.anchors.ductile ? K.k7_ductile : K.k7_brittle, '–',
    m.anchors.ductile ? 'Duktilt stål (A₅ ≥ 8 %)' : 'Ikke duktilt stål');
  c.in('γ_Ms,V', g.gMsV, '–',
    g.mild ? 'maks(f_uk/f_yk ; 1,25) – 4.4.3.1' : '1,5 – høyfast stål, 4.4.3.1');
  c.in('V_Ed', VEd, 'N', 'Største boltskjær fra kraftfordelinga');
  c.step({ sym: 'A_s', desc: 'Spenningstverrsnitt i boltskaftet',
    formula: 'π · ⌀² / 4', subst: `π · ${n(d, 0)}² / 4`, value: As, unit: 'mm²' });
  const VRk = c.res({ sym: 'V_Rk,s', formula: 'k_6 · k_7 · A_s · f_uk',
    subst: `${n(k6)} · ${n(k7)} · ${n(As)} · ${n(fuk, 0)}`,
    value: K.k6 * k7 * As * fuk, unit: 'N', ref: '(7.34)' });
  const VRd = VRk / g.gMsV;
  c.step({ sym: 'V_Rd,s', desc: 'Dimensjonerende kapasitet',
    formula: 'V_Rk,s / γ_Ms,V', subst: `${n(VRk)} / ${n(g.gMsV)}`, value: VRd, unit: 'N' });
  c.util({ formula: 'V_Ed / V_Rd,s', subst: `${n(VEd)} / ${n(VRd)}`, value: VEd / VRd });

  return { id: 'V-steel', mode: 'Stålbrudd, skjær', clause: '7.2.2.3.1', scope: 'bolt',
           NRk: VRk, NRd: VRd, NEd: VEd, util: VEd / VRd, calc: c };
}

// 7.2.2.4 Betongutstøting (pry-out)
export function shearPryout(m, res, g) {
  if (!anchorFoot(m).hasFoot)
    return noFoot('V-pryout', 'Betongutstøting (pry-out)', '7.2.2.4', 'gruppe');
  const c = new Calc('7.2.2.4');
  const hef = c.in('h_ef', m.anchors.hef, 'mm', 'Bolter');
  const fck = c.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  const k8 = c.in('k_8', hef < 60 ? K.k8_short : K.k8_long, '–',
    hef < 60 ? 'h_ef < 60 mm' : 'h_ef ≥ 60 mm');
  const gM = c.in('γ_Mc', g.gMc, '–', '4.4.3.1');
  const VEd = c.in('V_Ed,g', res.shear.Vres, 'N', 'Resultant skjærkraft på gruppa');

  const all = anchorPositions(m);
  const ccr = 1.5 * hef, scr = 3 * hef;
  const cracked = m.code.cracked;
  const k1 = cracked ? K.k1_cracked : K.k1_uncracked;
  const N0 = k1 * Math.sqrt(fck) * Math.pow(hef, 1.5);
  const Ac = coneArea(m, all, ccr), A0 = scr * scr;
  const cmin = minEdge(m, all);
  const psi_s = Number.isFinite(cmin) ? clamp(0.7 + 0.3 * cmin / ccr, 0, 1) : 1.0;
  const psi_re = m.code.denseReinf ? clamp(0.5 + hef / 200, 0, 1) : 1.0;

  c.step({ sym: 'A_c,N', desc: 'Utbruddsareal for ALLE bolter som tar skjær, ikke bare strekkboltene',
    formula: 'union av (⌀ ± c_cr,N), klippet mot frie kanter',
    subst: `${all.length} bolter, c_cr,N = ${n(ccr, 0)} mm`, value: Ac, unit: 'mm²' });
  const NRkc = c.step({
    sym: 'N_Rk,c', desc: 'Kjeglekapasitet for hele boltegruppa',
    formula: 'k_1·√f_ck·h_ef^1,5 · (A_c,N/A⁰_c,N) · ψ_s,N · ψ_re,N',
    subst: `${n(N0)} · (${n(Ac, 0)}/${n(A0, 0)}) · ${n(psi_s)} · ${n(psi_re)}`,
    value: N0 * (Ac / A0) * psi_s * psi_re, unit: 'N', ref: '7.2.1.4',
  });
  const VRk = c.res({ sym: 'V_Rk,cp', formula: 'k_8 · N_Rk,c',
    subst: `${n(k8)} · ${n(NRkc)}`, value: k8 * NRkc, unit: 'N', ref: '(7.39)' });
  const VRd = VRk / gM;
  c.step({ sym: 'V_Rd,cp', desc: 'Dimensjonerende kapasitet',
    formula: 'V_Rk,cp / γ_Mc', subst: `${n(VRk)} / ${n(gM)}`, value: VRd, unit: 'N' });
  c.util({ formula: 'V_Ed,g / V_Rd,cp', subst: `${n(VEd)} / ${n(VRd)}`, value: VEd / VRd });

  return { id: 'V-pryout', mode: 'Betongutstøting (pry-out)', clause: '7.2.2.4', scope: 'gruppe',
           NRk: VRk, NRd: VRd, NEd: VEd, util: VEd / VRd, calc: c };
}

// 7.2.2.5 Kantbrudd i betong
export function shearConcreteEdge(m, res, g) {
  const V = res.shear;
  if (V.Vres < 1e-9) {
    const why = 'Ingen skjærkraft på forbindelsen.';
    return { id: 'V-edge', mode: 'Kantbrudd', clause: '7.2.2.5', scope: 'gruppe',
             NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
             calc: skipped('7.2.2.5', why), note: why };
  }
  const all = anchorPositions(m);
  const cc = m.concrete, a = m.anchors;
  const dnom = a.d;
  const lf = Math.min(a.hef, Math.max(8 * dnom, 300));
  const cracked = m.code.cracked;
  const k9 = cracked ? K.k9_cracked : K.k9_uncracked;
  const psi_re = { none: 1.0, bars: 1.2, 'bars+stirrups': 1.4 }[m.code.edgeReinf] ?? 1.0;

  const cands = [];
  if (V.Vx > 0 && cc.freeEdges.xPos) cands.push({ dir: 'xPos', axis: 'x' });
  if (V.Vx < 0 && cc.freeEdges.xNeg) cands.push({ dir: 'xNeg', axis: 'x' });
  if (V.Vy > 0 && cc.freeEdges.yPos) cands.push({ dir: 'yPos', axis: 'y' });
  if (V.Vy < 0 && cc.freeEdges.yNeg) cands.push({ dir: 'yNeg', axis: 'y' });
  if (!cands.length) {
    const why = 'Ingen fri kant i skjærkraftas retning.';
    return { id: 'V-edge', mode: 'Kantbrudd', clause: '7.2.2.5', scope: 'gruppe',
             NRk: Infinity, NRd: Infinity, NEd: V.Vres, util: 0,
             calc: skipped('7.2.2.5', why), note: why };
  }

  let worst = null;
  for (const cd of cands) {
    const ds = all.map(p => edgeDistances(m, p.x, p.y)[cd.dir]);
    const c1 = Math.min(...ds);
    if (!Number.isFinite(c1)) continue;
    const front = all.filter((p, i) => Math.abs(ds[i] - c1) < 1e-6);
    const axisX = cd.axis === 'x';
    const t = p => (axisX ? p.y : p.x);
    const sideNeg = axisX ? 'yNeg' : 'xNeg', sidePos = axisX ? 'yPos' : 'xPos';
    const lo = cc.freeEdges[sideNeg] ? -(axisX ? cc.Ly / 2 + cc.ey : cc.Lx / 2 + cc.ex) : -1e9;
    const hi = cc.freeEdges[sidePos] ? (axisX ? cc.Ly / 2 - cc.ey : cc.Lx / 2 - cc.ex) : 1e9;
    const width = unionLength(front.map(p =>
      [Math.max(t(p) - 1.5 * c1, lo), Math.min(t(p) + 1.5 * c1, hi)]));
    const height = Math.min(1.5 * c1, cc.h);
    const Ac = width * height, A0 = 4.5 * c1 * c1;
    const alpha = 0.1 * Math.sqrt(lf / c1);
    const beta = 0.1 * Math.pow(dnom / c1, 0.2);
    const V0 = k9 * Math.pow(dnom, alpha) * Math.pow(lf, beta)
             * Math.sqrt(cc.fck) * Math.pow(c1, 1.5);
    const c2 = Math.min(...front.map(p => {
      const e = edgeDistances(m, p.x, p.y); return Math.min(e[sideNeg], e[sidePos]); }));
    const psi_s = Number.isFinite(c2) ? clamp(0.7 + 0.3 * c2 / (1.5 * c1), 0, 1) : 1.0;
    const psi_h = Math.max(1, Math.sqrt(1.5 * c1 / cc.h));
    const comp = axisX ? Math.abs(V.Vx) : Math.abs(V.Vy);
    const cosA = clamp(comp / V.Vres, 0, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const psi_a = Math.max(1, Math.sqrt(1 / (cosA * cosA + Math.pow(0.5 * sinA, 2))));
    const eV = Math.abs(front.reduce((s, p) => s + t(p), 0) / front.length);
    const psi_ec = clamp(1 / (1 + 2 * eV / (3 * c1)), 0, 1);
    const VRk = V0 * (Ac / A0) * psi_s * psi_h * psi_a * psi_ec * psi_re;
    const VRd = VRk / g.gMc;
    const cand = { dir: cd.dir, c1, c2, front, width, height, Ac, A0, alpha, beta, V0,
                   psi_s, psi_h, psi_a, psi_ec, eV, VRk, VRd, util: V.Vres / VRd };
    if (!worst || cand.util > worst.util) worst = cand;
  }
  if (!worst) {
    const why = 'Ingen fri kant i skjærkraftas retning.';
    return { id: 'V-edge', mode: 'Kantbrudd', clause: '7.2.2.5', scope: 'gruppe',
             NRk: Infinity, NRd: Infinity, NEd: V.Vres, util: 0,
             calc: skipped('7.2.2.5', why), note: why };
  }

  const w = worst;
  const c = new Calc('7.2.2.5');
  c.in('c_1', w.c1, 'mm', `Kantavstand til kant ${EDGE_LABEL[w.dir]}, forreste boltrad`);
  c.in('⌀_nom', dnom, 'mm', 'Bolter');
  c.in('h', cc.h, 'mm', 'Betongdel · tykkelse');
  c.in('f_ck', cc.fck, 'N/mm²', `Betongdel · ${cc.grade}`);
  c.in('k_9', k9, '–', `Regelverk · ${cracked ? 'opprisset' : 'uopprisset'}`);
  c.in('γ_Mc', g.gMc, '–', '4.4.3.1');
  c.in('V_Ed,g', V.Vres, 'N', 'Resultant skjærkraft på gruppa');

  c.step({ sym: 'l_f', desc: 'Effektiv boltlengde i skjær',
    formula: 'min(h_ef ; maks(8·⌀ ; 300))',
    subst: `min(${n(a.hef, 0)} ; maks(${n(8 * dnom, 0)} ; 300))`, value: lf, unit: 'mm' });
  c.step({ sym: 'α', desc: 'Eksponent for boltlengde',
    formula: '0,1 · √(l_f / c_1)', subst: `0,1 · √(${n(lf, 0)}/${n(w.c1, 0)})`,
    value: w.alpha, unit: '–' });
  c.step({ sym: 'β', desc: 'Eksponent for boltdiameter',
    formula: '0,1 · (⌀_nom / c_1)^0,2', subst: `0,1 · (${n(dnom, 0)}/${n(w.c1, 0)})^0,2`,
    value: w.beta, unit: '–' });
  c.step({ sym: 'V⁰_Rk,c', desc: 'Grunnverdi kantbrudd, én bolt ved rett kant',
    formula: 'k_9 · ⌀_nom^α · l_f^β · √f_ck · c_1^1,5',
    subst: `${n(k9)} · ${n(dnom, 0)}^${n(w.alpha)} · ${n(lf, 0)}^${n(w.beta)} · ` +
           `√${n(cc.fck, 0)} · ${n(w.c1, 0)}^1,5`,
    value: w.V0, unit: 'N', ref: '(7.42)' });
  c.step({ sym: 'A⁰_c,V', desc: 'Referanseareal på kantflata for én bolt',
    formula: '4,5 · c_1²', subst: `4,5 · ${n(w.c1, 0)}²`, value: w.A0, unit: 'mm²' });
  c.step({ sym: 'A_c,V', desc: 'Faktisk bruddflate langs kanten',
    formula: 'bredde · høyde,  bredde = union av 1,5·c_1 hver vei fra forreste bolter',
    subst: `${n(w.width, 0)} · ${n(w.height, 0)}   ` +
           `(høyde = min(1,5·c_1 ; h) = min(${n(1.5 * w.c1, 0)} ; ${n(cc.h, 0)}))`,
    value: w.Ac, unit: 'mm²', ref: '(7.41)' });
  c.step({ sym: 'ψ_s,V', desc: 'Sidekant vinkelrett på lastretninga',
    formula: '0,7 + 0,3 · c_2 / (1,5·c_1) ≤ 1,0',
    subst: Number.isFinite(w.c2)
      ? `0,7 + 0,3 · ${n(w.c2, 0)} / (1,5·${n(w.c1, 0)})` : 'ingen sidekant',
    value: w.psi_s, unit: '–' });
  c.step({ sym: 'ψ_h,V', desc: 'Tynn betongdel – bruddflata får ikke utvikle seg fritt',
    formula: '√(1,5·c_1 / h) ≥ 1,0',
    subst: `√(${n(1.5 * w.c1, 0)} / ${n(cc.h, 0)})`, value: w.psi_h, unit: '–' });
  c.step({ sym: 'ψ_α,V', desc: 'Skjærkraft på skrå mot kanten',
    formula: '√(1 / (cos²α_V + (0,5·sin α_V)²)) ≥ 1,0',
    subst: `V mot kant ${EDGE_LABEL[w.dir]}`, value: w.psi_a, unit: '–' });
  c.step({ sym: 'ψ_ec,V', desc: 'Eksentrisk skjærresultant langs kanten',
    formula: '1 / (1 + 2·e_V/(3·c_1)) ≤ 1,0',
    subst: `e_V = ${n(w.eV, 1)} mm`, value: w.psi_ec, unit: '–' });
  c.step({ sym: 'ψ_re,V', desc: 'Kantarmering',
    formula: '1,0 uten · 1,2 med kantstenger · 1,4 med kantstenger og bøyler',
    subst: `Regelverk · ${m.code.edgeReinf}`, value: psi_re, unit: '–' });
  const VRk = c.res({ sym: 'V_Rk,c',
    formula: 'V⁰_Rk,c · (A_c,V/A⁰_c,V) · ψ_s,V · ψ_h,V · ψ_α,V · ψ_ec,V · ψ_re,V',
    subst: `${n(w.V0)} · (${n(w.Ac, 0)}/${n(w.A0, 0)}) · ${n(w.psi_s)} · ${n(w.psi_h)} · ` +
           `${n(w.psi_a)} · ${n(w.psi_ec)} · ${n(psi_re)}`,
    value: w.VRk, unit: 'N', ref: '(7.40)' });
  c.step({ sym: 'V_Rd,c', desc: 'Dimensjonerende kapasitet',
    formula: 'V_Rk,c / γ_Mc', subst: `${n(VRk)} / ${n(g.gMc)}`, value: w.VRd, unit: 'N' });
  c.util({ formula: 'V_Ed,g / V_Rd,c', subst: `${n(V.Vres)} / ${n(w.VRd)}`, value: w.util });

  return { id: 'V-edge', mode: `Kantbrudd mot ${EDGE_LABEL[w.dir]}`, clause: '7.2.2.5',
           scope: 'gruppe', edgeDir: w.dir,
           NRk: w.VRk, NRd: w.VRd, NEd: V.Vres, util: w.util, calc: c };
}

// ===========================================================================
//  7.2.3 Kombinert strekk og skjær
// ===========================================================================
export function interaction(checks) {
  const get = id => checks.find(c => c.id === id);
  const out = [];

  const bNs = get('N-steel').util, bVs = get('V-steel').util;
  const cs = new Calc('7.2.3');
  cs.in('β_N', bNs, '–', 'Stålbrudd strekk – utnyttelse');
  cs.in('β_V', bVs, '–', 'Stålbrudd skjær – utnyttelse');
  cs.res({ sym: 'β_N² + β_V²', formula: '(β_N)² + (β_V)² ≤ 1,0',
    subst: `${n(bNs)}² + ${n(bVs)}²`, value: bNs ** 2 + bVs ** 2, unit: '–', ref: '(7.54)' });
  cs.util({ formula: '(β_N)² + (β_V)²', subst: `${n(bNs)}² + ${n(bVs)}²`,
    value: bNs ** 2 + bVs ** 2 });
  out.push({ id: 'IA-steel', mode: 'Samvirkning stål', clause: '7.2.3', scope: 'kombinasjon',
    expr: '(β_N)² + (β_V)² ≤ 1', util: bNs ** 2 + bVs ** 2, calc: cs,
    NRk: NaN, NRd: NaN, NEd: NaN });

  const tension = ['N-cone', 'N-pullout', 'N-blowout', 'N-split'];
  const shear = ['V-pryout', 'V-edge'];
  const tw = tension.map(id => get(id)).filter(Boolean)
    .reduce((a, b) => ((b.util || 0) > (a?.util || 0) ? b : a), null);
  const sw = shear.map(id => get(id)).filter(Boolean)
    .reduce((a, b) => ((b.util || 0) > (a?.util || 0) ? b : a), null);
  const bN = tw?.util || 0, bV = sw?.util || 0;

  const cc = new Calc('7.2.3');
  cc.in('β_N', bN, '–', `Styrende betongbrudd i strekk: ${tw?.mode ?? '–'}`);
  cc.in('β_V', bV, '–', `Styrende betongbrudd i skjær: ${sw?.mode ?? '–'}`);
  cc.step({ sym: 'forenklet', desc: 'Alternativ, lineær samvirkning',
    formula: 'β_N + β_V ≤ 1,2', subst: `${n(bN)} + ${n(bV)} = ${n(bN + bV)}`,
    value: (bN + bV) / 1.2, unit: '–' });
  cc.res({ sym: 'β_N^1,5 + β_V^1,5', formula: '(β_N)^1,5 + (β_V)^1,5 ≤ 1,0',
    subst: `${n(bN)}^1,5 + ${n(bV)}^1,5`,
    value: bN ** 1.5 + bV ** 1.5, unit: '–', ref: '(7.55)' });
  cc.util({ formula: '(β_N)^1,5 + (β_V)^1,5', subst: `${n(bN)}^1,5 + ${n(bV)}^1,5`,
    value: bN ** 1.5 + bV ** 1.5 });
  out.push({ id: 'IA-conc', mode: 'Samvirkning betong', clause: '7.2.3', scope: 'kombinasjon',
    expr: '(β_N)^1,5 + (β_V)^1,5 ≤ 1', util: bN ** 1.5 + bV ** 1.5, calc: cc,
    NRk: NaN, NRd: NaN, NEd: NaN });

  return out;
}

// ---------------------------------------------------------------------------
export function runEN1992_4(m, res) {
  const g = partialFactors(m);
  const cone = tensionConcreteCone(m, res, g);
  const checks = [
    tensionSteel(m, res, g),
    tensionPullout(m, res, g),
    cone,
    tensionBlowout(m, res, g),
    tensionSplitting(m, res, g, cone),
    shearSteel(m, res, g),
    shearPryout(m, res, g),
    shearConcreteEdge(m, res, g),
  ];
  return { standard: 'NS-EN 1992-4:2018', gamma: g, checks: [...checks, ...interaction(checks)] };
}
