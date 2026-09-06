// ---------------------------------------------------------------------------
//  Forankringsarmering - NS-EN 1992-4 pkt. 7.2.1.8 / 7.2.2.6.
//
//  Legges det egen armering som krysser bruddkjegla, erstattes kontrollen av
//  betongkjeglebrudd med to kontroller av armeringa:
//     a) stålbrudd i armeringa
//     b) forankringsbrudd - heft over lengden inne i kjegla
//
//  Dette er også mekanismen norsk praksis (Betongelementboka) bygger på når
//  innstøpingsgods forankres med sløyfer eller skråstag.
// ---------------------------------------------------------------------------

import { Calc, n } from './calc.js';

const GAMMA_S = 1.15;

// Heftfasthet f_bd etter NS-EN 1992-1-1 pkt. 8.4.2
export function fbd(fck, ds, goodBond = true) {
  const fctk = 0.7 * 0.3 * Math.pow(fck, 2 / 3);   // f_ctk;0,05
  const fctd = fctk / 1.5;
  const eta1 = goodBond ? 1.0 : 0.7;
  const eta2 = ds <= 32 ? 1.0 : (132 - ds) / 100;
  return 2.25 * eta1 * eta2 * fctd;
}

export function tensionReinforcement(m, res, r) {
  const NEd = res.tension.Ntot;
  const As = r.n * Math.PI * r.ds * r.ds / 4;

  // --- a) stålbrudd i armeringa ---
  const ca = new Calc('7.2.1.8');
  ca.in('n', r.n, 'stk', 'Forankringsarmering · bein som krysser kjegla');
  ca.in('⌀_s', r.ds, 'mm', 'Forankringsarmering');
  ca.in('f_yk', r.fyk, 'N/mm²', 'Forankringsarmering');
  ca.in('γ_Ms,re', GAMMA_S, '–', 'Armeringsstål – NS-EN 1992-1-1');
  ca.in('N_Ed,g', NEd, 'N', 'Sum strekk i boltegruppa');
  ca.step({ sym: 'A_s,re', desc: 'Samlet armeringsareal i bruddflata',
    formula: 'n · π · ⌀_s² / 4', subst: `${r.n} · π · ${n(r.ds, 0)}² / 4`,
    value: As, unit: 'mm²' });
  const NRk_s = ca.res({ sym: 'N_Rk,re', formula: 'A_s,re · f_yk',
    subst: `${n(As)} · ${n(r.fyk, 0)}`, value: As * r.fyk, unit: 'N' });
  const NRd_s = NRk_s / GAMMA_S;
  ca.step({ sym: 'N_Rd,re', desc: 'Dimensjonerende kapasitet',
    formula: 'N_Rk,re / γ_Ms,re', subst: `${n(NRk_s)} / ${n(GAMMA_S)}`,
    value: NRd_s, unit: 'N' });
  ca.util({ formula: 'N_Ed,g / N_Rd,re', subst: `${n(NEd)} / ${n(NRd_s)}`,
    value: NEd / NRd_s });

  // --- b) heft ---
  const cb = new Calc('7.2.1.8');
  const f = fbd(m.concrete.fck, r.ds, r.goodBond);
  const a1 = r.hooked ? 0.7 : 1.0;
  cb.in('n', r.n, 'stk', 'Forankringsarmering');
  cb.in('⌀_s', r.ds, 'mm', 'Forankringsarmering');
  cb.in('l_1', r.l1, 'mm', 'Forankringsarmering · lengde inne i bruddkjegla');
  cb.in('f_ck', m.concrete.fck, 'N/mm²', `Betongdel · ${m.concrete.grade}`);
  cb.in('α_1', a1, '–', r.hooked ? 'Kroket/bøyd stang' : 'Rett stangende');
  cb.in('N_Ed,g', NEd, 'N', 'Sum strekk i boltegruppa');
  const fctk = 0.7 * 0.3 * Math.pow(m.concrete.fck, 2 / 3);
  cb.step({ sym: 'f_ctk;0,05', desc: 'Nedre karakteristisk strekkfasthet',
    formula: '0,7 · 0,3 · f_ck^(2/3)', subst: `0,7 · 0,3 · ${n(m.concrete.fck, 0)}^(2/3)`,
    value: fctk, unit: 'N/mm²', ref: 'EN 1992-1-1 tab. 3.1' });
  cb.step({ sym: 'f_bd', desc: 'Dimensjonerende heftfasthet',
    formula: '2,25 · η_1 · η_2 · f_ctk;0,05 / γ_c',
    subst: `2,25 · ${r.goodBond ? '1,0' : '0,7'} · ${r.ds <= 32 ? '1,0' : n((132 - r.ds) / 100)}` +
           ` · ${n(fctk)} / 1,5`,
    value: f, unit: 'N/mm²', ref: 'EN 1992-1-1 8.4.2' });
  const NRk_a = cb.res({ sym: 'N_Rk,a', formula: 'n · π · ⌀_s · l_1 · f_bd / α_1',
    subst: `${r.n} · π · ${n(r.ds, 0)} · ${n(r.l1, 0)} · ${n(f)} / ${n(a1)}`,
    value: r.n * (r.l1 * Math.PI * r.ds * f) / a1, unit: 'N' });
  cb.util({ formula: 'N_Ed,g / N_Rd,a', subst: `${n(NEd)} / ${n(NRk_a)}`,
    value: NEd / NRk_a });

  const lbmin = Math.max(10 * r.ds, 100);
  const checks = [
    { id: 'N-re-steel', mode: 'Forankringsarmering – stålbrudd', clause: '7.2.1.8 (a)',
      scope: 'gruppe', NRk: NRk_s, NRd: NRd_s, NEd, util: NEd / NRd_s, calc: ca },
    { id: 'N-re-anch', mode: 'Forankringsarmering – heft', clause: '7.2.1.8 (b)',
      scope: 'gruppe', NRk: NRk_a, NRd: NRk_a, NEd, util: NEd / NRk_a, calc: cb,
      note: r.l1 < lbmin
        ? `l₁ < l_b,min = ${n(lbmin, 0)} mm – øk forankringslengden.` : undefined },
  ];
  return checks;
}

// 7.2.2.6 Kantarmering mot skjær - forenklet: armeringa tar hele skjærkrafta
export function shearReinforcement(m, res, r) {
  const As = r.nV * Math.PI * r.dsV * r.dsV / 4;
  const VEd = res.shear.Vres;
  const c = new Calc('7.2.2.6');
  c.in('n', r.nV, 'stk', 'Forankringsarmering · kantarmering');
  c.in('⌀_s', r.dsV, 'mm', 'Forankringsarmering');
  c.in('f_yk', r.fykV, 'N/mm²', 'Forankringsarmering');
  c.in('γ_Ms,re', GAMMA_S, '–', 'Armeringsstål – NS-EN 1992-1-1');
  c.in('V_Ed,g', VEd, 'N', 'Resultant skjærkraft på gruppa');
  c.step({ sym: 'A_s,re', desc: 'Armeringsareal som krysser bruddflata',
    formula: 'n · π · ⌀_s² / 4', subst: `${r.nV} · π · ${n(r.dsV, 0)}² / 4`,
    value: As, unit: 'mm²' });
  const VRk = c.res({ sym: 'V_Rk,re', formula: 'A_s,re · f_yk',
    subst: `${n(As)} · ${n(r.fykV, 0)}`, value: As * r.fykV, unit: 'N' });
  const VRd = VRk / GAMMA_S;
  c.step({ sym: 'V_Rd,re', desc: 'Dimensjonerende kapasitet',
    formula: 'V_Rk,re / γ_Ms,re', subst: `${n(VRk)} / ${n(GAMMA_S)}`, value: VRd, unit: 'N' });
  c.util({ formula: 'V_Ed,g / V_Rd,re', subst: `${n(VEd)} / ${n(VRd)}`, value: VEd / VRd });

  return [{ id: 'V-re-steel', mode: 'Kantarmering – stålbrudd', clause: '7.2.2.6',
            scope: 'gruppe', NRk: VRk, NRd: VRd, NEd: VEd, util: VEd / VRd, calc: c,
            note: 'Forutsetter at armeringa er forankret på begge sider av bruddflata.' }];
}
