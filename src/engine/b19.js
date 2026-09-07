// ---------------------------------------------------------------------------
//  Betongelementboka bind B - kapittel B19 «Forankring av stål».
//
//  Implementert etter den utgaven som ligger åpent på
//  betongelementboka.betong.no/betongapp/BindB/Del_3/B19/ (punktnumrene under
//  viser dit).  Kapitlet dekker det NS-EN 1992-4 ikke gjør: forankring UTEN
//  endemutter (ren heftforankring av kamstål eller gjengestang), og enkelt-
//  stående dybler uten stålplate.
//
//  Formlene i B19 gir DIMENSJONERENDE verdier direkte - materialfaktorene
//  ligger inne i k-faktorene (k_1 = 11,9/γ_c osv.), i motsetning til
//  EN 1992-4 som gir karakteristiske verdier som deles på γ_M etterpå.
//  Derfor settes NRk = NRd i kontrollene her.
//
//  Hovedskillene kapitlet håndterer, og som denne modulen regner på:
//
//    Forankringsende          Strekk                       Pkt.
//    ---------------------------------------------------------------
//    endemutter / bolthode    kjeglebrudd, ELLER heft      19.3.2
//    innstøpt plate i enden   kjeglebrudd (annen fot)      19.3.2 + 19.3.2.4
//    uten endemutter          heftforankring               19.3.3 / 19.3.4
//
//    Innfesting               Skjær                        Pkt.
//    ---------------------------------------------------------------
//    uten stålplate (dybel)   V⁰ = 1,0·⌀²·√(f_cd·f_yd)     19.4.2
//    innstøpt plate, sveist   V⁰ = 1,8·⌀²·√(f_cd·f_yd)     19.4.4
//    påskrudd plate           V⁰ = 1,5·⌀²·√(f_cd·f_yd)     19.4.4
//
//  Merk (19.3.1.2): kjeglebruddmodellen forutsetter ingen heft langs stanga.
//  En lang gjengestang med endemutter og liten kantavstand kan få mindre
//  kapasitet etter kjeglemodellen enn samme stang UTEN endemutter etter
//  heftmodellen. Boka sier uttrykkelig: «bruk den modellen som gir størst
//  forankringskapasitet». Kontrollen N-conc regner derfor begge og bruker den
//  som gir lavest utnyttelse når det er fot.
// ---------------------------------------------------------------------------

import { anchorPositions, edgeDistances, memberLimits, shaftProps, anchorFoot,
         grade, steelGrade } from '../core/model.js';
import { unionLength, clamp, clippedSquares, coneProjection } from './geometry.js';
import { Calc, skipped, n } from './calc.js';

export const KB = {
  // Kjeglebrudd, strekk - 19.3.2.1:  N⁰_Rd,c = (11,9/γ_c)·√f_ck,cube·h_ef^1,5
  k1: 11.9,
  // Risset uarmert betong (uten kantarmering eller bøyler) - 19.3.2.1 / 19.4.3.3
  crackedPlain: 0.7,
  // Trykk mot forankringsfoten - 19.3.2.4
  sigmaFoot: 8.4,          // urisset, eller risset med kantarmering og bøyler
  sigmaFootPlain: 6.0,     // risset uten kantarmering eller bøyler
  // Heftfasthet - 19.3.3.1 (kamstål) og 19.3.4 (gjengestang)
  bondRebar: 2.25, bondRod: 1.90, alphaCt: 0.85,
  // Dybelskjær - 19.4.2.3 og 19.4.4
  dowel: 1.0,              // uten stålplate (kombinasjonsformelen)
  dowelWelded: 1.8,        // innstøpt plate med påsveiste forankringer
  dowelBolted: 1.5,        // påskrudd plate
  dowelCrush: 4.5,         // ren betongknusing, V_Rd,c = 4,5·f_cd·⌀²
  momentArm: 0.75,         // maks moment i M = V·(e + 0,75·⌀)
  // Materialfaktorer - 19.5 (EC3-1-1 NA.6.1) og EC2 for kamstål
  gM0: 1.05, gM2: 1.25, gS: 1.15, alphaCc: 0.85,
  // Tverrarmeringens virkning på heft, α_3 - 19.3.3.1
  a3_bars: 0.95, a3_stirrups: 0.90, alphaMin: 0.7,
};

const B19_EDGE = { xNeg: '−x', xPos: '+x', yNeg: '−y', yPos: '+y' };
const B19_AXIS = { xNeg: 'x', xPos: 'x', yNeg: 'y', yPos: 'y' };

// ---------------------------------------------------------------------------
//  Materialer
// ---------------------------------------------------------------------------

// Betongen slik B19 bruker den: terningfasthet i brudd-/kantformlene,
// f_ctk,0,05 i heftformlene, f_cd i dybelformlene.
export function b19Concrete(m) {
  const g = grade(m.concrete.grade);
  const gc = m.code.gammaC;
  return {
    grade: g.id, fck: g.fck, fckCube: g.fckCube, fctk: g.fctk, gc,
    fcd: KB.alphaCc * g.fck / gc,
    fctd: KB.alphaCt * g.fctk / gc,
    inRange: g.fck >= 25 && g.fck <= 55,   // boka dekker selv bare B25-B55
  };
}

// Stålets dimensjonerende kapasiteter, pkt. 19.5.
//   kamstål   f_yd = f_yk/1,15;  N = A_s·f_yd, V = A_s·f_yd/√3, M = W_p·f_yd
//   skrue     f_sd2 = 0,9·f_u/1,25, f_sd0 = f_y/1,05
//             N = A_sp·f_sd2, V = k_v·f_sd2·A_sp, M = W_p·f_sd0
//   annet     f_sd0 = f_y/1,05;  N = A_s·f_sd0, V = A_s·f_sd0/√3, M = W_p·f_sd0
//
//  fDowel er spenningen som går inn i dybelformlene √(f_cd·f_sd) - boka bruker
//  f_yd for kamstål (tab. B 19.11.15) og f_sd2 for gjengestang (tab. B 19.7.8).
export function b19Steel(m) {
  const s = steelGrade(m.anchors.steel), sh = shaftProps(m);
  const base = { id: s.id, nEdge: s.nEdge, As: sh.As, Wp: sh.Wp, sh };

  // Skjær og dybelbøyning regnes i snittet ved betongoverflata. Står det
  // glatte skaftet der, er det snittet grovere enn gjengene (sh.Av / sh.WpV).
  const vTxt = sh.smooth > 0 ? 'A_v' : (sh.threaded ? 'A_sp' : 'A_s');

  if (s.kind === 'rebar') {
    const fyd = s.fyk / KB.gS;
    return { ...base, kind: 'rebar', f: fyd, fDowel: fyd, fM: fyd,
      fSym: 'f_yd', fSrc: `f_yk / 1,15 = ${n(s.fyk, 0)} / 1,15`,
      NRd: sh.As * fyd, NTxt: 'A_s · f_yd',
      VRd: sh.Av * fyd / Math.sqrt(3), VTxt: `${vTxt} · f_yd / √3`,
      MRd: sh.WpV * fyd, MTxt: 'W_p · f_yd' };
  }
  if (s.kind === 'bolt') {
    const fsd0 = s.fyk / KB.gM0, fsd2 = 0.9 * s.fuk / KB.gM2;
    return { ...base, kind: 'bolt', f: fsd2, fDowel: fsd2, fM: fsd0, kv: s.kv,
      fSym: 'f_sd2', fSrc: `0,9 · f_u / 1,25 = 0,9 · ${n(s.fuk, 0)} / 1,25`,
      NRd: sh.As * fsd2, NTxt: 'A_sp · f_sd2',
      VRd: s.kv * fsd2 * sh.Av, VTxt: `${n(s.kv, 1)} · f_sd2 · ${vTxt}`,
      MRd: sh.WpV * fsd0, MTxt: 'W_p · f_sd0' };
  }
  const fsd0 = s.fyk / KB.gM0;
  return { ...base, kind: 'struct', f: fsd0, fDowel: fsd0, fM: fsd0,
    fSym: 'f_sd0', fSrc: `f_y / 1,05 = ${n(s.fyk, 0)} / 1,05`,
    NRd: sh.As * fsd0, NTxt: 'A_s · f_sd0',
    VRd: sh.Av * fsd0 / Math.sqrt(3), VTxt: `${vTxt} · f_sd0 / √3`,
    MRd: sh.WpV * fsd0, MTxt: 'W_p · f_sd0' };
}

// ---------------------------------------------------------------------------
//  Geometri
// ---------------------------------------------------------------------------

const minEdgeDist = (m, pts) => pts.reduce((acc, p) => {
  const e = edgeDistances(m, p.x, p.y);
  return Math.min(acc, e.xNeg, e.xPos, e.yNeg, e.yPos);
}, Infinity);

// 19.3.2.2, «Øvre grense for h_ef i hjørner på smale betongelementer».
// Er forankringen nær tre eller flere kanter, gir formelverket urimelig små
// kapasiteter. Da erstattes h_ef av h'ef = maks(a_maks/1,5 ; s_maks/3) i alle
// formlene i pkt. 19.3.2.
function b19EffectiveHef(m, pts) {
  const hef = m.anchors.hef, a = m.anchors;
  const near = [];
  for (const dir of ['xNeg', 'xPos', 'yNeg', 'yPos']) {
    const ds = pts.map(p => edgeDistances(m, p.x, p.y)[dir]).filter(Number.isFinite);
    if (ds.length && Math.min(...ds) < 1.5 * hef) near.push(Math.max(...ds));
  }
  if (near.length < 3) return { hef, reduced: false, nEdges: near.length };

  const cap = near.length >= 4 ? 3 * hef : 1.5 * hef;
  const aMax = Math.max(...near.map(d => Math.min(d, cap)));
  const sMax = Math.min(3 * hef,
    Math.max(a.nx > 1 ? a.sx : 0, a.ny > 1 ? a.sy : 0));
  const h2 = Math.max(aMax / 1.5, sMax / 3);
  return { hef: Math.min(hef, h2), reduced: h2 < hef, nEdges: near.length,
           aMax, sMax, raw: hef };
}

// ===========================================================================
//  STREKK
// ===========================================================================

// 19.5 / 19.7.1 Stålets strekkapasitet - pr. bolt
export function b19TensionSteel(m, res) {
  const st = b19Steel(m);
  const c = new Calc('19.5');
  const d = c.in('⌀', m.anchors.d, 'mm', 'Bolter');
  c.in(st.fSym, st.f, 'N/mm²', `Bolter · ${st.id} – ${st.fSrc}`);
  const NEd = Math.max(0, ...res.anchors.map(a => a.N));
  c.in('N_Ed', NEd, 'N', 'Største boltestrekk fra kraftfordelinga');

  c.step({ sym: st.sh.threaded ? 'A_sp' : 'A_s',
    desc: st.sh.threaded ? 'Spenningsareal i gjengene (tab. B 19.7.1)'
                         : 'Tverrsnitt i stanga',
    formula: st.sh.threaded ? 'A_sp (tabell)' : 'π · ⌀² / 4',
    subst: st.sh.threaded ? `M${n(d, 0)}` : `π · ${n(d, 0)}² / 4`,
    value: st.As, unit: 'mm²' });
  const NRd = c.res({ sym: 'N_Rd,s', formula: st.NTxt,
    subst: `${n(st.As, 0)} · ${n(st.f, 0)}`, value: st.NRd, unit: 'N', ref: '19.5' });
  c.util({ formula: 'N_Ed / N_Rd,s', subst: `${n(NEd)} / ${n(NRd)}`, value: NEd / NRd });

  return { id: 'N-steel', mode: 'Stålbrudd, strekk', clause: '19.5', scope: 'bolt',
           NRk: NRd, NRd, NEd, util: NEd / NRd, calc: c };
}

// 19.3.2 Kjeglebrudd - gruppe. Regnes bare når forankringen har fot.
function b19ConeBranch(m, res, c) {
  const foot = anchorFoot(m);
  if (!foot.hasFoot) return null;
  const pts = res.tension.anchors;
  const cd = b19Concrete(m);

  const he = b19EffectiveHef(m, pts);
  const hef = he.hef;
  if (he.reduced)
    c.step({ sym: 'h′_ef', desc:
      `Forankringen ligger nær ${he.nEdges} kanter – h_ef erstattes av h′_ef`,
      formula: 'maks(a_maks / 1,5 ; s_maks / 3)',
      subst: `maks(${n(he.aMax, 0)}/1,5 ; ${n(he.sMax, 0)}/3)`,
      value: hef, unit: 'mm', ref: '19.3.2.2' });

  const plain = m.code.cracked && m.code.edgeReinf === 'none';
  const k1 = c.step({ sym: 'k_1', desc: plain
      ? 'Risset uarmert betong (uten kantarmering eller bøyler): 0,7 · k_1'
      : 'Urisset betong, eller risset med kantarmering og bøyler',
    formula: (plain ? '0,7 · ' : '') + '(11,9 / γ_c) · √f_ck,cube',
    subst: `${plain ? '0,7 · ' : ''}(11,9 / ${n(cd.gc, 2)}) · √${n(cd.fckCube, 0)}`,
    value: (plain ? KB.crackedPlain : 1) * (KB.k1 / cd.gc) * Math.sqrt(cd.fckCube),
    unit: 'N/mm^1,5', ref: 'tab. B 19.3.1' });

  const N0 = c.step({ sym: 'N⁰_Rd,c',
    desc: 'Kjeglekapasitet, én forankring med store kant- og senteravstander',
    formula: 'k_1 · h_ef^1,5', subst: `${n(k1, 2)} · ${n(hef, 0)}^1,5`,
    value: k1 * Math.pow(hef, 1.5), unit: 'N', ref: '19.3.2.1' });
  const A0 = c.step({ sym: 'A⁰_c,N', desc: 'Full utrivingskjegle for én forankring',
    formula: '9 · h_ef²', subst: `9 · ${n(hef, 0)}²`,
    value: 9 * hef * hef, unit: 'mm²', ref: '19.3.2.2' });
  const Ac = c.step({ sym: 'A_c,N', desc: 'Bruddareal for gruppa',
    formula: foot.common
      ? 'endeplata ± 1,5·h_ef, klippet mot frie kanter'
      : 'union av (⌀ ± 1,5·h_ef), klippet mot frie kanter',
    subst: foot.common
      ? `felles endeplate ${n(foot.plate.bx, 0)} × ${n(foot.plate.by, 0)} mm, ` +
        `1,5·h_ef = ${n(1.5 * hef, 0)} mm`
      : `${pts.length} bolter i strekk, 1,5·h_ef = ${n(1.5 * hef, 0)} mm`,
    value: coneProjection(foot, pts, 1.5 * hef, memberLimits(m)), unit: 'mm²',
    ref: 'fig. B 19.11' });

  const cmin = minEdgeDist(m, pts);
  const psi_s = c.step({ sym: 'Ψ_s,N',
    desc: 'Kanteffekt – den rotasjonssymmetriske spenningstilstanden forstyrres',
    formula: '0,7 + 0,3 · a / (1,5 · h_ef) ≤ 1,0',
    subst: Number.isFinite(cmin)
      ? `0,7 + 0,3 · ${n(cmin, 0)} / ${n(1.5 * hef, 0)}` : 'ingen fri kant',
    value: Number.isFinite(cmin) ? clamp(0.7 + 0.3 * cmin / (1.5 * hef), 0, 1) : 1,
    unit: '–', ref: '19.3.2.3' });
  const psi_re = c.step({ sym: 'Ψ_re,N',
    desc: 'Overflatearmering – bare aktuell når h_ef < 100 mm',
    formula: '0,5 + h_ef / 200 ≤ 1,0', subst: `0,5 + ${n(hef, 0)} / 200`,
    value: clamp(0.5 + hef / 200, 0, 1), unit: '–', ref: '19.3.2.3' });
  const eN = Math.hypot(res.tension.eNx, res.tension.eNy);
  const psi_ec = c.step({ sym: 'Ψ_ec,N', desc: 'Eksentrisk strekkresultant',
    formula: '1 / (1 + 2 · e_N / (3 · h_ef)) ≤ 1,0',
    subst: `e_N = ${n(eN, 1)} mm`,
    value: clamp(1 / (1 + 2 * eN / (3 * hef)), 0, 1), unit: '–', ref: '19.3.2.3' });

  const NRd = N0 * (Ac / A0) * psi_s * psi_re * psi_ec;
  c.step({ sym: 'N_Rd,c', desc: 'Kjeglebrudd, samlet for gruppa',
    formula: 'N⁰_Rd,c · (A_c,N / A⁰_c,N) · Ψ_s,N · Ψ_re,N · Ψ_ec,N',
    subst: `${n(N0)} · (${n(Ac, 0)}/${n(A0, 0)}) · ${n(psi_s)} · ` +
           `${n(psi_re)} · ${n(psi_ec)}`,
    value: NRd, unit: 'N', ref: '19.3.2.5' });

  const NEd = res.tension.Ntot;
  return { name: 'Kjeglebrudd', clause: '19.3.2', scope: 'gruppe',
           NRd, NEd, util: NEd / NRd, hef };
}

// 19.3.3 / 19.3.4 Heftforankring - pr. stang.
// Kapasiteten er omvendinga av bokas lengdeformel: lbd = Πα · N/(π·⌀·f_bd),
// altså N_Rd,b = π·⌀·l_b·f_bd / Πα.  f_bd er nedre grense for heftfasthet (ved
// minste tillatte overdekning); god overdekning senker Πα og hever heften.
function b19BondBranch(m, res, c) {
  const sh = shaftProps(m);
  if (!sh.bond) return null;
  const cd = b19Concrete(m), a = m.anchors;
  const rebar = a.barType === 'rebar';
  // Heft utvikles bare der stanga har kammer eller gjenger. Er skaftet glatt
  // ned til en viss dybde, begynner heften først der gjengene begynner.
  const lb = sh.lBond;

  const kb = c.step({ sym: 'f_bd', desc: rebar
      ? 'Heftfasthet, kamstål – nedre grense etter EC2-1-1 pkt. 8'
      : 'Heftfasthet, gjengestang – 84 % av kamstål, konservativt',
    formula: `${rebar ? '2,25' : '1,90'} · f_ctd,   f_ctd = 0,85 · f_ctk,0,05 / γ_c`,
    subst: `${rebar ? '2,25' : '1,90'} · 0,85 · ${n(cd.fctk, 2)} / ${n(cd.gc, 2)}`,
    value: (rebar ? KB.bondRebar : KB.bondRod) * cd.fctd, unit: 'N/mm²',
    ref: rebar ? '19.3.3.1' : '19.3.4' });

  // R = det minste av kantavstanden og halve senteravstanden, fig. B 19.21.
  const half = [];
  if (a.nx > 1) half.push(a.sx / 2);
  if (a.ny > 1) half.push(a.sy / 2);
  const R = Math.min(minEdgeDist(m, anchorPositions(m)), ...half);
  const a2 = c.step({ sym: 'α_2', desc: 'Overdekning og senteravstand (spaltebrudd)',
    formula: '1 − 0,15 · (R/⌀ − 1,5),  0,7 ≤ α_2 ≤ 1,0   der R = min(a ; s/2)',
    subst: `R = ${n(R, 0)} mm → 1 − 0,15 · (${n(R / sh.d, 2)} − 1,5)`,
    value: clamp(1 - 0.15 * (R / sh.d - 1.5), 0.7, 1), unit: '–',
    ref: 'tab. B 19.3.2' });
  const a3v = { none: 1.0, bars: KB.a3_bars, 'bars+stirrups': KB.a3_stirrups
              }[m.code.edgeReinf] ?? 1.0;
  const a3 = c.step({ sym: 'α_3', desc: 'Tverrarmering som ikke er sveist til stanga',
    formula: '1,0 uten · 0,95 med rett tverrarmering · 0,90 med tverrbøyler',
    subst: `Regelverk · kantarmering «${m.code.edgeReinf}»`, value: a3v, unit: '–',
    ref: '19.3.3.1' });
  const pa = c.step({ sym: 'Πα', desc: 'Samlet α – boka krever α_2·α_3·α_5 ≥ 0,7',
    formula: 'maks(α_2 · α_3 ; 0,7)',
    subst: `maks(${n(a2)} · ${n(a3)} ; 0,7)`,
    value: Math.max(KB.alphaMin, a2 * a3), unit: '–', ref: '19.3.3.1' });

  c.step({ sym: 'l_b', desc: sh.smooth > 0
      ? 'Heftlengde – bare den gjengede delen utvikler heft'
      : 'Heftlengde – innstøpt lengde uten fot',
    formula: sh.smooth > 0 ? 'l_b = h_ef − l_glatt' : 'l_b = h_ef',
    subst: sh.smooth > 0
      ? `${n(a.hef, 0)} − ${n(sh.smooth, 0)}` : `${n(lb, 0)}`,
    value: lb, unit: 'mm' });
  const NRd = Math.PI * sh.d * lb * kb / pa;
  c.step({ sym: 'N_Rd,b', desc: 'Heftkapasitet pr. stang',
    formula: 'π · ⌀ · l_b · f_bd / Πα',
    subst: `π · ${n(sh.d, 0)} · ${n(lb, 0)} · ${n(kb, 2)} / ${n(pa)}`,
    value: NRd, unit: 'N', ref: '19.7.2.1' });

  const NEd = Math.max(0, ...res.anchors.map(x => x.N));
  const hook = a.endType === 'hook';
  if (hook)
    c.step({ sym: '–', desc: 'Endekrok', formula: '',
      subst: 'Kroken er ikke kvantifisert utover heften over l_b – B19 gir ' +
             'ingen bæreflateformel for kroker (bare hode/mutter, 19.3.2). ' +
             'Konservativt: samme kapasitet som rett stang uten krok.',
      value: null, unit: '' });
  return { name: 'Heftforankring', clause: rebar ? '19.3.3' : '19.3.4',
           scope: 'bolt', NRd, NEd, util: NEd / NRd, R,
           note: hook ? 'Konservativt: kroken gir ingen tillegg utover heften.'
                       : undefined };
}

// Utrivning av betongen: kjeglebrudd og/eller heftforankring.
export function b19TensionConcrete(m, res) {
  const foot = anchorFoot(m), sh = shaftProps(m);
  if (!res.tension.anchors.length) {
    const why = 'Ingen bolter i strekk.';
    return { id: 'N-conc', mode: 'Utrivning av betong', clause: '19.3', scope: 'gruppe',
             NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
             calc: skipped('19.3', why), note: why };
  }
  if (!foot.hasFoot && !sh.bond) {
    const why = 'Glatt sveisebolt uten endemutter har verken fot eller heft. ' +
                'Velg kamstål eller gjengestang, eller sett på endemutter.';
    return { id: 'N-conc', mode: 'Utrivning av betong', clause: '19.3', scope: 'gruppe',
             NRk: NaN, NRd: NaN, NEd: res.tension.Ntot, util: NaN,
             calc: skipped('19.3', why), note: why };
  }

  const c = new Calc('19.3');
  const cd = b19Concrete(m);
  c.in('⌀', sh.d, 'mm', 'Bolter');
  c.in('h_ef', m.anchors.hef, 'mm',
    foot.hasFoot ? 'Bolter · dybde til underkant fot' : 'Bolter · innstøpt lengde');
  c.in('f_ck,cube', cd.fckCube, 'N/mm²', `Betongdel · ${cd.grade} · terningfasthet`);
  c.in('f_ctk,0,05', cd.fctk, 'N/mm²', `Betongdel · ${cd.grade}`);
  c.in('γ_c', cd.gc, '–', 'Regelverk');
  c.in('N_Ed,g', res.tension.Ntot, 'N', 'Sum strekk i boltegruppa');

  const cone = b19ConeBranch(m, res, c);
  const bond = b19BondBranch(m, res, c);

  // 19.3.1.2: med fot og heft langs stanga gjelder den modellen som gir
  // størst forankringskapasitet - altså lavest utnyttelse.
  const cands = [cone, bond].filter(Boolean);
  const win = cands.reduce((a, b) => (b.util < a.util ? b : a));
  const other = cands.find(x => x !== win);

  if (other)
    c.step({ sym: 'valg', desc:
      'Kjeglebruddmodellen forutsetter ingen heft langs stanga. Boka sier å ' +
      'bruke den modellen som gir størst forankringskapasitet',
      formula: 'styrende = modellen med lavest utnyttelse',
      subst: `${win.name} ${n(win.util * 100, 0)} % mot ` +
             `${other.name} ${n(other.util * 100, 0)} %`,
      value: 1, unit: '✓', ref: '19.3.1.2' });

  c.res({ sym: win.scope === 'gruppe' ? 'N_Rd,c' : 'N_Rd,b', formula: win.name,
    subst: win.scope === 'gruppe' ? 'gruppekapasitet' : 'pr. stang',
    value: win.NRd, unit: 'N', ref: win.clause });
  c.util({ formula: `N_Ed / ${win.scope === 'gruppe' ? 'N_Rd,c' : 'N_Rd,b'}`,
    subst: `${n(win.NEd)} / ${n(win.NRd)}`, value: win.util });

  const notes = [`Styrende modell: ${win.name.toLowerCase()} (pkt. ${win.clause}).`];
  if (!cd.inRange)
    notes.push(`B19 dekker selv B25–B55; ${cd.grade} er ekstrapolert.`);

  return { id: 'N-conc', mode: `Utrivning – ${win.name.toLowerCase()}`,
           clause: win.clause, scope: win.scope, showCone: win === cone,
           NRk: win.NRd, NRd: win.NRd, NEd: win.NEd, util: win.util,
           calc: c, note: notes.join(' ') };
}

// 19.3.2.4 Trykk mot forankringsfoten. Holdes trykket under grensa, unngås
// pullout-brudd og kjeglebrudd kan utvikles.
export function b19FootPressure(m, res) {
  const foot = anchorFoot(m);
  if (!foot.hasFoot) {
    const why = 'Forankringen har ingen fot – kontrollen er ikke aktuell.';
    return { id: 'N-foot', mode: 'Trykk mot forankringsfot', clause: '19.3.2.4',
             scope: 'bolt', NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
             calc: skipped('19.3.2.4', why), note: why };
  }
  const cd = b19Concrete(m), sh = shaftProps(m);
  const c = new Calc('19.3.2.4');
  const plain = m.code.cracked && m.code.edgeReinf === 'none';
  const FOOT = { head: 'bolthode', nut: 'endemutter',
                 plate: 'felles innstøpt endeplate' };

  c.in('⌀', sh.d, 'mm', 'Bolter');
  c.in('f_ck,cube', cd.fckCube, 'N/mm²', `Betongdel · ${cd.grade}`);
  c.in('γ_c', cd.gc, '–', 'Regelverk');
  c.in('fot', foot.size, 'mm', `Bolter · ${FOOT[foot.kind]}` +
    (foot.kind === 'nut' ? ' (nøkkelvidde)'
     : foot.kind === 'plate' ? ' (minste sidekant på den felles plata)' : ''));
  const NEd = Math.max(0, ...res.anchors.map(a => a.N));
  c.in('N_Ed', NEd, 'N', 'Største boltestrekk fra kraftfordelinga');

  const sc = c.step({ sym: 'σ_c', desc: plain
      ? 'Risset betong uten kantarmering eller bøyler'
      : 'Urisset betong, eller risset med kantarmering og bøyler',
    formula: `${plain ? '6,0' : '8,4'} · f_ck,cube / γ_c`,
    subst: `${plain ? '6,0' : '8,4'} · ${n(cd.fckCube, 0)} / ${n(cd.gc, 2)}`,
    value: (plain ? KB.sigmaFootPlain : KB.sigmaFoot) * cd.fckCube / cd.gc,
    unit: 'N/mm²', ref: '19.3.2.4' });

  if (foot.kind === 'plate') {
    c.step({ sym: 'b_eff', desc:
      'Plata må være stiv – utstikket u ≤ tykkelsen t, så bare et felt rundt ' +
      'hver bolt regnes som trykkflate',
      formula: '⌀ + 2 · t_p',
      subst: `${n(sh.d, 0)} + 2·${n(foot.t, 0)}`,
      value: foot.eff, unit: 'mm', ref: 'fig. B 19.18 / B 19.57' });
    c.step({ sym: 'A_eff', desc:
      'Medvirkende felt for hele gruppa – overlappende felt telles én gang, ' +
      'og alt utenfor plata faller bort',
      formula: 'union av (⌀ + 2·t_p) innenfor endeplata',
      subst: `${n(foot.plate.bx, 0)} × ${n(foot.plate.by, 0)} mm plate, ` +
             `${m.anchors.nx * m.anchors.ny} bolter`,
      value: foot.Aeff, unit: 'mm²', ref: 'fig. B 19.18' });
  }

  const AFORM = { head: 'π · ⌀_h² / 4', nut: '0,866 · NV²',
                  plate: 'A_eff / n' };
  c.step({ sym: 'A_fot', desc: foot.common
      ? 'Trykkflate pr. bolt – lasta deles likt på boltene i plata'
      : 'Fotens bruttoareal', formula: AFORM[foot.kind],
    subst: foot.common
      ? `${n(foot.Aeff, 0)} / ${m.anchors.nx * m.anchors.ny}` : `${n(foot.eff, 0)} mm`,
    value: foot.Agross, unit: 'mm²' });
  const Ah = c.step({ sym: 'A_h', desc: 'Netto trykkareal mot betongen',
    formula: 'A_fot − π/4 · ⌀²',
    subst: `${n(foot.Agross, 0)} − π/4 · ${n(sh.d, 0)}²`,
    value: foot.Ah, unit: 'mm²', ref: 'fig. B 19.16' });

  const NRd = c.res({ sym: 'N_Rd,fot', formula: 'σ_c · A_h',
    subst: `${n(sc, 0)} · ${n(Ah, 0)}`, value: sc * Ah, unit: 'N', ref: '19.3.2.4' });
  c.util({ formula: 'N_Ed / N_Rd,fot', subst: `${n(NEd)} / ${n(NRd)}`,
    value: NEd / NRd });

  return { id: 'N-foot', mode: 'Trykk mot forankringsfot', clause: '19.3.2.4',
           scope: 'bolt', NRk: NRd, NRd, NEd, util: NEd / NRd, calc: c,
           note: NEd > NRd
             ? 'Foten er for liten til å utvikle kjeglebrudd. Legg på skive ' +
               'etter fig. B 19.57, eller øk fotstørrelsen.' : undefined };
}

// ===========================================================================
//  SKJÆR
// ===========================================================================

// 19.5 Stålets skjærkapasitet - pr. bolt
export function b19ShearSteel(m, res) {
  const st = b19Steel(m);
  const c = new Calc('19.5');
  c.in('⌀', m.anchors.d, 'mm', 'Bolter');
  c.in(st.fSym, st.f, 'N/mm²', `Bolter · ${st.id} – ${st.fSrc}`);
  if (st.kind === 'bolt')
    c.in('k_v', st.kv, '–',
      `${st.kv === 0.6 ? '0,6 for K4.6, K5.6 og K8.8' : '0,5 for K4.8, K5.8, K6.8 og K10.9'}`);
  const VEd = Math.max(0, ...res.anchors.map(a => a.V));
  c.in('V_Ed', VEd, 'N', 'Største boltskjær fra kraftfordelinga');

  c.step({ sym: st.sh.threaded ? 'A_sp' : 'A_s', desc: 'Tverrsnitt i stanga',
    formula: st.sh.threaded ? 'A_sp (tabell)' : 'π · ⌀² / 4',
    subst: st.sh.threaded ? `M${n(m.anchors.d, 0)}` : `π · ${n(m.anchors.d, 0)}² / 4`,
    value: st.As, unit: 'mm²' });
  const VRd = c.res({ sym: 'V_Rd,s', formula: st.VTxt,
    subst: `${n(st.As, 0)} · ${n(st.f, 0)}${st.kind === 'bolt' ? '' : ' / √3'}`,
    value: st.VRd, unit: 'N', ref: '19.5' });
  c.util({ formula: 'V_Ed / V_Rd,s', subst: `${n(VEd)} / ${n(VRd)}`, value: VEd / VRd });

  return { id: 'V-steel', mode: 'Stålbrudd, skjær', clause: '19.5', scope: 'bolt',
           NRk: VRd, NRd: VRd, NEd: VEd, util: VEd / VRd, calc: c };
}

// 19.4.2.2 Stålets bøyningskapasitet. Dybelen får et flyteledd i avstanden
// x ≈ 1,5·⌀ under betongoverflata, som gir M = V·(e + 0,75·⌀).
// Er stanga sveist til en innstøpt plate, holder plata betongen på plass og
// bøyningen dekkes av forhøyelsesfaktoren i 19.4.4 i stedet.
export function b19ShearBending(m, res) {
  const plate = m.plate.present, e = res.leverArm;
  if (plate && e <= 0) {
    const why = 'Stanga er festet i en plate som ligger an mot betongen – ' +
      'ingen utkraging, og bøyningen er dekket av dybelformelen for plate ' +
      '(pkt. 19.4.4).';
    return { id: 'V-bend', mode: 'Stålbrudd, bøyning av dybel', clause: '19.4.2.2',
             scope: 'bolt', NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
             calc: skipped('19.4.2.2', why), note: why };
  }
  const st = b19Steel(m), sh = shaftProps(m);
  const c = new Calc('19.4.2.2');
  c.in('⌀', sh.d, 'mm', 'Bolter');
  if (sh.threaded) c.in('⌀_ekv', sh.dEff, 'mm', 'Bolter · ekvivalent diameter, tab. B 19.7.1');
  c.in('f', st.fM, 'N/mm²', `Bolter · ${st.id} – ${st.kind === 'bolt' ? 'f_sd0' : st.fSym}`);
  c.in('e', e, 'mm', plate
    ? 'Plate · fri avstand + t/2' : 'Bolter · utkraging over betongen');
  const VEd = Math.max(0, ...res.anchors.map(a => a.V));
  c.in('V_Ed', VEd, 'N', 'Største boltskjær fra kraftfordelinga');

  c.step({ sym: 'W_p', desc: 'Plastisk motstandsmoment, rundt tverrsnitt',
    formula: '⌀_ekv³ / 6', subst: `${n(sh.dEff, 1)}³ / 6`, value: st.Wp, unit: 'mm³',
    ref: '19.5' });
  const MRd = c.step({ sym: 'M_Rd,s', desc: 'Momentkapasitet i stanga',
    formula: st.MTxt, subst: `${n(st.Wp, 0)} · ${n(st.fM, 0)}`,
    value: st.MRd, unit: 'Nmm', ref: '19.5' });
  const arm = c.step({ sym: 'x', desc:
    'Maksimalmomentet ligger ca. 1,5·⌀ under overflata; med betongtrykket ' +
    'fordelt over den lengden blir armen e + 0,75·⌀',
    formula: 'e + 0,75 · ⌀', subst: `${n(e, 0)} + 0,75 · ${n(sh.d, 0)}`,
    value: e + KB.momentArm * sh.d, unit: 'mm', ref: '19.4.2.2' });
  const VRd = c.res({ sym: 'V_Rd,s,M', formula: 'M_Rd,s / (e + 0,75 · ⌀)',
    subst: `${n(MRd)} / ${n(arm, 0)}`, value: MRd / arm, unit: 'N', ref: '19.4.2.2' });
  c.util({ formula: 'V_Ed / V_Rd,s,M', subst: `${n(VEd)} / ${n(VRd)}`, value: VEd / VRd });

  return { id: 'V-bend', mode: 'Stålbrudd, bøyning av dybel', clause: '19.4.2.2',
           scope: 'bolt', NRk: VRd, NRd: VRd, NEd: VEd, util: VEd / VRd, calc: c,
           MEd: VEd * arm, MRd: st.MRd };
}

// Bruddflatas bredde langs kanten: 1,5·a_1 til hver side av boltene i fremste
// rekke, slått sammen og klippet mot sidekantene. ks = bredde / (3·a_1),
// altså A_c,V / A⁰_c,V når høyden ikke er begrensende (fig. B 19.50).
function b19FrontWidth(m, dir, a1, front) {
  const axisX = B19_AXIS[dir] === 'x';
  const t = p => (axisX ? p.y : p.x);
  const lim = memberLimits(m);
  const lo = axisX ? lim.y0 : lim.x0;
  const hi = axisX ? lim.y1 : lim.x1;
  return unionLength(front.map(p =>
    [Math.max(t(p) - 1.5 * a1, lo), Math.min(t(p) + 1.5 * a1, hi)]));
}

// 19.4.2.3 / 19.4.4 Betongens avskjæringskapasitet.
export function b19ShearConcrete(m, res) {
  const V = res.shear;
  if (V.Vres < 1e-9) {
    const why = 'Ingen skjærkraft på forbindelsen.';
    return { id: 'V-conc', mode: 'Dybelskjær i betong', clause: '19.4', scope: 'gruppe',
             NRk: Infinity, NRd: Infinity, NEd: 0, util: 0,
             calc: skipped('19.4', why), note: why };
  }
  const cd = b19Concrete(m), st = b19Steel(m), sh = shaftProps(m);
  const cc = m.concrete, a = m.anchors, all = anchorPositions(m);
  const plate = m.plate.present;
  const welded = a.attachment !== 'bolted';

  const kind = !plate ? 'dowel' : welded ? 'welded' : 'bolted';
  const factor = { dowel: KB.dowel, welded: KB.dowelWelded, bolted: KB.dowelBolted }[kind];
  const FTXT = {
    dowel: 'Dybel uten stålplate – kombinasjonsformelen (19.4.2.3)',
    welded: 'Innstøpt stålplate med påsveiste forankringer: 86 % høyere enn ' +
            'ren dybel, avrundet til 1,8 (19.4.4)',
    bolted: 'Påskrudd stålplate: 1,8 · 0,5/0,6 = 1,5 (19.4.4)',
  };

  const c = new Calc(plate ? '19.4.4' : '19.4.2.3');
  c.in('⌀', sh.d, 'mm', 'Bolter · nominell diameter');
  c.in('f_cd', cd.fcd, 'N/mm²', `Betongdel · 0,85 · f_ck / γ_c`);
  c.in(st.kind === 'rebar' ? 'f_yd' : st.fSym, st.fDowel, 'N/mm²',
    `Bolter · ${st.id}`);
  c.in('n · ⌀', st.nEdge * sh.d, 'mm',
    `Kantavstand for øvre grense, n = ${st.nEdge} – tab. B 19.4.2`);
  c.in('V_Ed,g', V.Vres, 'N', 'Resultant skjærkraft på gruppa');

  const kf = c.step({ sym: 'faktor', desc: FTXT[kind],
    formula: 'V⁰_Rd,c = faktor · ⌀² · √(f_cd · f_sd)', subst: `${n(factor, 1)}`,
    value: factor, unit: '–', ref: plate ? '19.4.4' : '19.4.2.3' });
  const V0 = c.step({ sym: 'V⁰_Rd,c', desc: 'Kapasitet pr. stang ved stor kantavstand',
    formula: 'faktor · ⌀² · √(f_cd · f_sd)',
    subst: `${n(kf, 1)} · ${n(sh.d, 0)}² · √(${n(cd.fcd, 1)} · ${n(st.fDowel, 0)})`,
    value: factor * sh.d * sh.d * Math.sqrt(cd.fcd * st.fDowel), unit: 'N',
    ref: plate ? '19.4.4' : '19.4.2.3' });

  if (!plate)
    c.step({ sym: 'sammenlikning', desc:
      'De to enkeltmodellene kombinasjonsformelen ligger mellom: stålets ' +
      'bøyning og ren knusing av betongen foran dybelen',
      formula: 'f_yd·⌀²/4,5   og   4,5 · f_cd · ⌀²',
      subst: `${n(st.fM * sh.d * sh.d / 4.5)} N  og  ` +
             `${n(KB.dowelCrush * cd.fcd * sh.d * sh.d)} N`,
      value: Math.min(st.fM * sh.d * sh.d / 4.5, KB.dowelCrush * cd.fcd * sh.d * sh.d),
      unit: 'N', ref: '19.4.2.3' });

  // --- kant i skjærkraftas retning ---------------------------------------
  const cands = [];
  if (V.Vx > 0 && cc.freeEdges.xPos) cands.push('xPos');
  if (V.Vx < 0 && cc.freeEdges.xNeg) cands.push('xNeg');
  if (V.Vy > 0 && cc.freeEdges.yPos) cands.push('yPos');
  if (V.Vy < 0 && cc.freeEdges.yNeg) cands.push('yNeg');

  let worst = null;
  for (const dir of cands) {
    const ds = all.map(p => edgeDistances(m, p.x, p.y)[dir]);
    const a1 = Math.min(...ds);
    if (!Number.isFinite(a1)) continue;
    const front = all.filter((p, i) => Math.abs(ds[i] - a1) < 1e-6);
    const back = all.length - front.length;
    const n1 = front.length ? all.length / front.length : 1;   // rekker i lastretninga
    const n2 = front.length;                                   // stenger i fremste rekke
    const a1c = Math.min(a1, st.nEdge * sh.d);                 // øvre grense i ks og Ψ_f,V

    const ka = clamp((a1 - sh.d) / (st.nEdge * sh.d - sh.d), 0, Infinity);
    const width = b19FrontWidth(m, dir, a1c, front);
    const ks = width / (3 * a1c);
    const kak = Math.min(ka * ks, n2);
    const s1 = B19_AXIS[dir] === 'x' ? a.sx : a.sy;
    const psi_f = (plate && !welded) ? 1
      : clamp(1 + (n1 - 1) * s1 / (0.75 * a1c), 1, n1);
    const VRd = kak * psi_f * V0;
    const cand = { dir, a1, a1c, front, back, n1, n2, ka, ks, kak, width, psi_f, VRd,
                   util: V.Vres / VRd, s1 };
    if (!worst || cand.util > worst.util) worst = cand;
  }

  if (!worst) {
    // Ingen fri kant i lastretninga: kapasiteten er den øvre grensa pr. stang
    // ganger antall stenger (k_a·k_s ≤ n_2 og Ψ_f,V ≤ n_1).
    const VRd = c.res({ sym: 'V_Rd,c', formula: 'n · V⁰_Rd,c   (øvre grense)',
      subst: `${all.length} · ${n(V0)}`, value: all.length * V0, unit: 'N',
      ref: '19.4.4' });
    c.util({ formula: 'V_Ed,g / V_Rd,c', subst: `${n(V.Vres)} / ${n(VRd)}`,
      value: V.Vres / VRd });
    return { id: 'V-conc', mode: 'Dybelskjær i betong', clause: plate ? '19.4.4' : '19.4.2.3',
             scope: 'gruppe', NRk: VRd, NRd: VRd, NEd: V.Vres, util: V.Vres / VRd,
             calc: c, note: 'Ingen fri kant i skjærkraftas retning – øvre grense ' +
                            'for lokal knusing av betongen styrer.' };
  }

  const w = worst;
  c.in('a_1', w.a1, 'mm',
    `Kantavstand til kant ${B19_EDGE[w.dir]}, fremste rekke`);
  if (w.a1c < w.a1)
    c.step({ sym: 'a′_1', desc:
      'Stor kantavstand overvurderer k_s og Ψ_f,V – a_1 begrenses til n·⌀ i disse',
      formula: 'min(a_1 ; n · ⌀)',
      subst: `min(${n(w.a1, 0)} ; ${st.nEdge}·${n(sh.d, 0)})`,
      value: w.a1c, unit: 'mm', ref: '19.4.4' });
  const ka = c.step({ sym: 'k_a', desc:
    'Kantavstanden i kraftretninga. Øvre grense nås ved a_1 = n·⌀; under det ' +
    'faller kapasiteten rettlinjet mot null ved a_1 = ⌀',
    formula: '(a_1 − ⌀) / (n·⌀ − ⌀)',
    subst: `(${n(w.a1, 0)} − ${n(sh.d, 0)}) / (${st.nEdge}·${n(sh.d, 0)} − ${n(sh.d, 0)})`,
    value: w.ka, unit: '–', ref: 'fig. B 19.49' });
  const ks = c.step({ sym: 'k_s', desc:
    `Bruddflata på tvers: 1,5·a_1 til hver side av de ${w.n2} stengene i fremste ` +
    'rekke, slått sammen og klippet mot sidekantene',
    formula: 'bredde / (3 · a_1)',
    subst: `${n(w.width, 0)} / (3 · ${n(w.a1c, 0)})`,
    value: w.ks, unit: '–', ref: 'fig. B 19.50' });
  const kak = c.step({ sym: 'k_a · k_s', desc:
    `Samlet effekt kan ikke overstige antallet stenger i fremste rekke (${w.n2})`,
    formula: 'min(k_a · k_s ; n_2)',
    subst: `min(${n(ka)} · ${n(ks)} ; ${w.n2})`, value: w.kak, unit: '–',
    ref: '19.4.4' });
  const psi_f = c.step({ sym: 'Ψ_f,V', desc: (plate && !welded)
      ? 'Påskrudd plate i overdimensjonerte hull – bare fremste rekke regnes med'
      : `Bakre rekker bidrar når s_1 ≥ 0,75·a_1 (${w.n1} rekker i lastretninga)`,
    formula: (plate && !welded) ? '1,0'
      : '1 + (n_1 − 1) · s_1 / (0,75 · a_1) ≤ n_1',
    subst: (plate && !welded) ? '–'
      : `1 + (${w.n1} − 1) · ${n(w.s1, 0)} / (0,75 · ${n(w.a1c, 0)})`,
    value: w.psi_f, unit: '–', ref: '19.4.4' });

  const VRd = c.res({ sym: 'V_Rd,c', formula: 'k_a · k_s · Ψ_f,V · V⁰_Rd,c',
    subst: `${n(kak)} · ${n(psi_f)} · ${n(V0)}`, value: w.VRd, unit: 'N',
    ref: '19.4.4' });
  c.util({ formula: 'V_Ed,g / V_Rd,c', subst: `${n(V.Vres)} / ${n(VRd)}`,
    value: w.util });

  return { id: 'V-conc', mode: `Dybelskjær mot kant ${B19_EDGE[w.dir]}`,
           clause: plate ? '19.4.4' : '19.4.2.3', scope: 'gruppe', edgeDir: w.dir,
           NRk: VRd, NRd: VRd, NEd: V.Vres, util: w.util, calc: c };
}

// ===========================================================================
//  19.6 Interaksjonsformler
// ===========================================================================
export function b19Interaction(m, res, checks) {
  const pick = id => checks.find(c => c.id === id);
  const u = id => { const c = pick(id); return Number.isFinite(c?.util) ? c.util : 0; };
  // Dekker også id-ene fra EN 1992-4-motoren (N-cone/N-pullout/N-blowout/
  // N-split, V-pryout/V-edge), i tilfelle strekk eller skjær mot betong er
  // valgt fra den standarden mens samvirkningen fortsatt regnes etter B19.
  const uMax = ids => Math.max(0, ...ids.map(u));
  const out = [];
  const sh = shaftProps(m);
  const e = res.leverArm;
  const long = e > 2 * sh.d;

  // --- stål -------------------------------------------------------------
  const nS = u('N-steel'), vS = u('V-steel'), mS = u('V-bend');
  const cs = new Calc('19.6');
  cs.in('n', nS, '–', 'Stålbrudd strekk – utnyttelse');
  cs.in('v', vS, '–', 'Stålbrudd skjær – utnyttelse');
  cs.in('m', mS, '–', 'Bøyning av dybel – utnyttelse');
  cs.in('e', e, 'mm', 'Utkraging');
  cs.step({ sym: 'n² + v²', desc: 'Ekstremt kort bolt – skjær styrer',
    formula: 'n² + v² ≤ 1', subst: `${n(nS)}² + ${n(vS)}²`,
    value: nS ** 2 + vS ** 2, unit: '–' });
  cs.step({ sym: 'n² + m', desc: 'Utkraget stang (e > 2·⌀) – moment styrer',
    formula: 'n² + m ≤ 1', subst: `${n(nS)}² + ${n(mS)}`,
    value: nS ** 2 + mS, unit: '–' });
  const uS = long ? nS ** 2 + mS : nS ** 2 + vS ** 2;
  cs.res({ sym: 'styrende', formula: long ? 'n² + m ≤ 1' : 'n² + v² ≤ 1',
    subst: long ? `e = ${n(e, 0)} mm > 2·⌀ = ${n(2 * sh.d, 0)} mm`
                : `e = ${n(e, 0)} mm ≤ 2·⌀ = ${n(2 * sh.d, 0)} mm`,
    value: uS, unit: '–', ref: '19.6' });
  cs.util({ formula: long ? 'n² + m' : 'n² + v²',
    subst: long ? `${n(nS)}² + ${n(mS)}` : `${n(nS)}² + ${n(vS)}²`, value: uS });
  out.push({ id: 'IA-steel', mode: 'Samvirkning stål', clause: '19.6',
    scope: 'kombinasjon', expr: long ? 'n² + m ≤ 1' : 'n² + v² ≤ 1',
    util: uS, calc: cs, NRk: NaN, NRd: NaN, NEd: NaN });

  // --- betong -----------------------------------------------------------
  const nC = uMax(['N-conc', 'N-cone', 'N-pullout', 'N-blowout', 'N-split']);
  const vC = uMax(['V-conc', 'V-pryout', 'V-edge']);
  const cc = new Calc('19.6');
  cc.in('n', nC, '–', 'Utrivning av betong – utnyttelse');
  cc.in('v', vC, '–', 'Dybelskjær i betong – utnyttelse');
  cc.res({ sym: 'n^1,5 + v^1,5', formula: 'n^1,5 + v^1,5 ≤ 1',
    subst: `${n(nC)}^1,5 + ${n(vC)}^1,5`, value: nC ** 1.5 + vC ** 1.5,
    unit: '–', ref: '19.6' });
  cc.util({ formula: 'n^1,5 + v^1,5', subst: `${n(nC)}^1,5 + ${n(vC)}^1,5`,
    value: nC ** 1.5 + vC ** 1.5 });
  out.push({ id: 'IA-conc', mode: 'Samvirkning betong', clause: '19.6',
    scope: 'kombinasjon', expr: 'n^1,5 + v^1,5 ≤ 1',
    util: nC ** 1.5 + vC ** 1.5, calc: cc, NRk: NaN, NRd: NaN, NEd: NaN });

  // --- stål og betong ---------------------------------------------------
  // Er stålet svakest i den ene bruddtypen og betongen i den andre, gjelder
  // en mellomliggende kurve. n og v regnes da av den minste kapasiteten.
  const nMix = Math.max(nS, nC), vMix = Math.max(vS, mS, vC);
  const nGov = nS >= nC ? 'stål' : 'betong';
  const vGov = Math.max(vS, mS) >= vC ? 'stål' : 'betong';
  const cm = new Calc('19.6');
  cm.in('n', nMix, '–', `Strekk mot minste kapasitet (${nGov})`);
  cm.in('v', vMix, '–', `Skjær mot minste kapasitet (${vGov})`);
  cm.res({ sym: 'n^5/3 + v^5/3', formula: 'n^5/3 + v^5/3 ≤ 1',
    subst: `${n(nMix)}^5/3 + ${n(vMix)}^5/3`,
    value: nMix ** (5 / 3) + vMix ** (5 / 3), unit: '–', ref: 'fig. B 19.53' });
  cm.util({ formula: 'n^5/3 + v^5/3', subst: `${n(nMix)}^5/3 + ${n(vMix)}^5/3`,
    value: nMix ** (5 / 3) + vMix ** (5 / 3) });
  out.push({ id: 'IA-mix', mode: 'Samvirkning stål og betong', clause: '19.6',
    scope: 'kombinasjon', expr: 'n^5/3 + v^5/3 ≤ 1',
    util: nMix ** (5 / 3) + vMix ** (5 / 3), calc: cm,
    NRk: NaN, NRd: NaN, NEd: NaN,
    note: nGov === vGov
      ? `Begge bruddtypene styres av ${nGov}. Boka anbefaler denne formelen ` +
        'når stålet er svakest i den ene og betongen i den andre – den er da ' +
        `strengere enn nødvendig; se «Samvirkning ${nGov}».`
      : undefined });

  return out;
}

// ---------------------------------------------------------------------------
export function runB19(m, res) {
  const cd = b19Concrete(m), st = b19Steel(m);
  const checks = [
    b19TensionSteel(m, res),
    b19TensionConcrete(m, res),
    b19FootPressure(m, res),
    b19ShearSteel(m, res),
    b19ShearBending(m, res),
    b19ShearConcrete(m, res),
  ];
  return {
    standard: 'Betongelementboka bind B, kap. B19',
    gamma: { gc: cd.gc, gM0: KB.gM0, gM2: KB.gM2, gS: KB.gS, steel: st.kind },
    checks: [...checks, ...b19Interaction(m, res, checks)],
  };
}
