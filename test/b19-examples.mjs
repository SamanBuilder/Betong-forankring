// ---------------------------------------------------------------------------
//  Regner om beregningseksemplene og kapasitetstabellene i Betongelementboka
//  bind B kap. B19, og sammenlikner med tallene som står i boka.
//
//    node test/b19-examples.mjs
//
//  Kildene er punktnummerert i hver test. Toleransen står i hver linje, og
//  følger avrundinga i boka (tabellverdiene er oppgitt i hele kN).
// ---------------------------------------------------------------------------

import { syncPlan, defaultModel, syncLoad } from '../src/core/model.js';
import { b19Concrete, b19Steel, b19TensionConcrete, b19FootPressure,
         b19ShearBending, b19ShearConcrete } from '../src/engine/b19.js';
import { solvePlate } from '../src/engine/plate-solver.js';

let fails = 0, runs = 0;

function near(name, got, want, tol, unit = 'kN') {
  runs++;
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  console.log(`${ok ? '  ok  ' : '  FEIL'} ${name.padEnd(52)} ` +
              `${fmt(got).padStart(8)} mot ${fmt(want)} ${unit}  (±${tol})`);
}

// Bygger en modell og kjører kraftfordelinga, slik kontrollene forventer den.
function build(mut) {
  const m = defaultModel();
  m.code.cracked = false;          // bokas tabeller: urisset uarmert betong
  m.code.gammaC = 1.5;
  syncLoad(m);                     // load peker paa den aktive kombinasjonen
  m.load.N = 0; m.load.Vx = 0; m.load.Vy = 0;
  m.load.Mx = 0; m.load.My = 0; m.load.Mz = 0;
  mut(m);
  syncPlan(m);                     // L_x/L_y over i plantegninga
  return { m, res: solvePlate(m) };
}

const kN = v => v / 1000;

// ---------------------------------------------------------------------------
console.log('\n19.5 / 19.7.1  Stålets kapasitet – gjengestang M24 K4.8 (tab. B 19.7.1)');
{
  const { m, res } = build(m => {
    m.concrete.grade = 'B35'; m.concrete.fck = 35;
    m.plate.present = false; m.plate.e = 0;
    m.anchors.barType = 'rod'; m.anchors.endType = 'nut';
    m.anchors.d = 24; m.anchors.dh = 36; m.anchors.k = 19;
    m.anchors.steel = 'K4.8'; m.anchors.fyk = 320; m.anchors.fuk = 400;
    m.anchors.nx = 1; m.anchors.ny = 1; m.anchors.hef = 154;
    m.load.N = 1; m.load.Vx = 1; m.load.My = 0;
  });
  const st = b19Steel(m);
  near('N_Rd,s = 0,288 · A_sp', kN(st.NRd), 102, 1);
  near('V_Rd,s = 0,5 · f_sd2 · A_sp', kN(st.VRd), 51, 1);
  near('M_Rd,s = 0,305 · W_p', st.MRd / 1000, 484, 3, 'kNmm');
}

// ---------------------------------------------------------------------------
console.log('\n19.3.2.1  Kjeglebrudd – k_1 og N⁰_Rd,c (tab. B 19.3.1, eks. s. 251)');
{
  for (const [g, k1] of [['B30', 48.3], ['B35', 53.2], ['B45', 58.8], ['B55', 64.9]]) {
    const cd = b19Concrete({ concrete: { grade: g }, code: { gammaC: 1.5 } });
    near(`k_1 for ${g}`, (11.9 / cd.gc) * Math.sqrt(cd.fckCube), k1, 0.15, 'N/mm^1,5');
  }
  const cd = b19Concrete({ concrete: { grade: 'B35' }, code: { gammaC: 1.5 } });
  near('N⁰_Rd,c for h_ef = 195 mm i B35',
    kN((11.9 / cd.gc) * Math.sqrt(cd.fckCube) * Math.pow(195, 1.5)), 145, 1);
}

// ---------------------------------------------------------------------------
console.log('\n19.7.2.2  Eksempel: M24 K4.8 i B35, tynn vegg (fig. B 19.59, B 19.60)');
{
  // a1 > 1,5·h_ef: full kjegle, h_ef = 154 mm skal gi N_Rd,c = N_Rd,s = 102 kN
  {
    const { m, res } = build(m => {
      m.concrete.grade = 'B35'; m.concrete.fck = 35;
      m.concrete.Lx = 4000; m.concrete.Ly = 4000; m.concrete.h = 1000;
      m.plate.present = false;
      m.anchors.barType = 'rod'; m.anchors.endType = 'nut';
      m.anchors.d = 24; m.anchors.dh = 36; m.anchors.k = 19;
      m.anchors.steel = 'K4.8'; m.anchors.fyk = 320; m.anchors.fuk = 400;
      m.anchors.nx = 1; m.anchors.ny = 1; m.anchors.hef = 154;
      m.load.N = 100000; m.load.Vx = 0; m.load.My = 0;
    });
    const c = b19TensionConcrete(m, res);
    near('h_ef = 154, full kjegle → N_Rd,c', kN(c.NRd), 102, 1.5);
  }
  // a1 = 150 mm i en 300 mm vegg, h_ef = 400: kjegla gir 83 kN, heften 102 kN,
  // og boka konkluderer med at heftmodellen (uten endemutter) styrer.
  {
    const { m, res } = build(m => {
      m.concrete.grade = 'B35'; m.concrete.fck = 35;
      m.concrete.Lx = 300; m.concrete.Ly = 4000; m.concrete.h = 1000;
      m.concrete.freeEdges = { xNeg: true, xPos: true, yNeg: false, yPos: false };
      m.plate.present = false;
      m.anchors.barType = 'rod'; m.anchors.endType = 'nut';
      m.anchors.d = 24; m.anchors.dh = 36; m.anchors.k = 19;
      m.anchors.steel = 'K4.8'; m.anchors.fyk = 320; m.anchors.fuk = 400;
      m.anchors.nx = 1; m.anchors.ny = 1; m.anchors.hef = 400;
      m.load.N = 100000; m.load.Vx = 0; m.load.My = 0;
    });
    const c = b19TensionConcrete(m, res);
    near('h_ef = 400, a_1 = 150 → styrende N_Rd (heft)', kN(c.NRd), 102, 2);
    console.log(`         styrende modell: ${c.mode}`);
  }
  // Samme geometri uten endemutter – ren heftforankring, tab. B 19.7.3:
  // l_bd = 400 mm gir N⁰_Rd,c = 102 kN.
  {
    const { m, res } = build(m => {
      m.concrete.grade = 'B35'; m.concrete.fck = 35;
      m.concrete.Lx = 4000; m.concrete.Ly = 4000; m.concrete.h = 1000;
      m.plate.present = false;
      m.anchors.barType = 'rod'; m.anchors.endType = 'none';
      m.anchors.d = 24; m.anchors.steel = 'K4.8';
      m.anchors.fyk = 320; m.anchors.fuk = 400;
      m.anchors.nx = 1; m.anchors.ny = 1; m.anchors.hef = 400;
      m.load.N = 100000; m.load.Vx = 0; m.load.My = 0;
    });
    const c = b19TensionConcrete(m, res);
    near('uten endemutter, l_b = 400 → N_Rd,b', kN(c.NRd), 102, 2);
  }
}

// ---------------------------------------------------------------------------
console.log('\n19.3.2.4  Trykk mot endemutter – M24 K8.8 i B35 (tab. B 19.7.5)');
{
  const { m, res } = build(m => {
    m.concrete.grade = 'B35'; m.concrete.fck = 35;
    m.plate.present = false;
    m.anchors.barType = 'rod'; m.anchors.endType = 'nut';
    m.anchors.d = 24; m.anchors.dh = 36; m.anchors.k = 19;
    m.anchors.steel = '8.8'; m.anchors.fyk = 640; m.anchors.fuk = 800;
    m.anchors.nx = 1; m.anchors.ny = 1; m.anchors.hef = 300;
    m.load.N = 100000; m.load.Vx = 0; m.load.My = 0;
  });
  const c = b19FootPressure(m, res);
  near('N⁰_Rd,c = σ_c · A_h  (NV 36 → A_h = 670 mm²)', kN(c.NRd), 169, 2);
}

// ---------------------------------------------------------------------------
console.log('\n19.4.2.3  Dybelskjær uten stålplate – Ø20 B500NC i B35, e = 0');
{
  const { m, res } = build(m => {
    m.concrete.grade = 'B35'; m.concrete.fck = 35;
    m.concrete.Lx = 4000; m.concrete.Ly = 4000; m.concrete.h = 1000;
    m.concrete.freeEdges = { xNeg: false, xPos: false, yNeg: false, yPos: false };
    m.plate.present = false; m.plate.e = 0;
    m.anchors.barType = 'rebar'; m.anchors.endType = 'none';
    m.anchors.d = 20; m.anchors.steel = 'B500NC (kamstål)';
    m.anchors.fyk = 500; m.anchors.fuk = 550;
    m.anchors.nx = 1; m.anchors.ny = 1; m.anchors.hef = 200;
    m.load.N = 0; m.load.Vx = 10000; m.load.My = 0;
  });
  const st = b19Steel(m);
  near('stålets bøyning  V_Rd,s = f_yd·⌀²/4,5', kN(b19ShearBending(m, res).NRd), 39, 1);
  near('stålets skjær    V_Rd,s = A_s·f_yd/√3', kN(st.VRd), 79, 1);
  near('kombinasjon      V⁰_Rd,c = ⌀²·√(f_cd·f_yd)', kN(b19ShearConcrete(m, res).NRd), 37, 1);
}

// ---------------------------------------------------------------------------
console.log('\n19.4.4  Eksempel B 19.4.2: innstøpt plate, 4 Ø16 B500NC i B35');
{
  // a1 = 55 mm til kanten i lastretninga, s1 = s2 = 90 mm, sveist til plata.
  // Boka: V⁰ = 42,8 kN, k_a = 0,188, k_s = 1,545, Ψ_f,V = 2 → ΣV_Rd,c = 24,8 kN
  const { m, res } = build(m => {
    m.concrete.grade = 'B35'; m.concrete.fck = 35;
    m.concrete.Lx = 200; m.concrete.Ly = 2000; m.concrete.h = 1000;
    m.concrete.freeEdges = { xNeg: false, xPos: true, yNeg: true, yPos: true };
    m.plate.present = true; m.plate.mount = 'direct';
    m.plate.bx = 160; m.plate.by = 160; m.plate.t = 15;
    m.anchors.barType = 'rebar'; m.anchors.endType = 'none';
    m.anchors.attachment = 'welded';
    m.anchors.d = 16; m.anchors.steel = 'B500NC (kamstål)';
    m.anchors.fyk = 500; m.anchors.fuk = 550;
    m.anchors.nx = 2; m.anchors.ny = 2; m.anchors.sx = 90; m.anchors.sy = 90;
    m.anchors.hef = 120;
    m.load.N = 0; m.load.Vx = 10000; m.load.My = 0;
  });
  const c = b19ShearConcrete(m, res);
  const step = s => c.calc.steps.find(x => x.sym === s)?.value;
  near('V⁰_Rd,c = 1,8 · ⌀² · √(f_cd · f_yd)', kN(step('V⁰_Rd,c')), 42.8, 0.3);
  near('k_a = (a_1 − ⌀)/(14·⌀ − ⌀)', step('k_a'), 0.188, 0.002, '–');
  near('k_s = bredde / (3·a_1)', step('k_s'), 1.545, 0.01, '–');
  near('Ψ_f,V (2 rekker, s_1 > 0,75·a_1)', step('Ψ_f,V'), 2, 0.01, '–');
  near('ΣV_Rd,c for hele plata', kN(c.NRd), 24.8, 0.4);
}

// ---------------------------------------------------------------------------
console.log('\n19.11.2.2  Kamstål uten plate, betongkapasitet (tab. B 19.11.15, B35)');
{
  for (const [d, want] of [[12, 13], [16, 24], [20, 37], [25, 58], [32, 95]]) {
    const { m, res } = build(m => {
      m.concrete.grade = 'B35'; m.concrete.fck = 35;
      m.concrete.freeEdges = { xNeg: false, xPos: false, yNeg: false, yPos: false };
      m.concrete.h = 1000;
      m.plate.present = false; m.plate.e = 0;
      m.anchors.barType = 'rebar'; m.anchors.endType = 'none';
      m.anchors.d = d; m.anchors.steel = 'B500NC (kamstål)';
      m.anchors.fyk = 500; m.anchors.fuk = 550;
      m.anchors.nx = 1; m.anchors.ny = 1; m.anchors.hef = 200;
      m.load.N = 0; m.load.Vx = 5000; m.load.My = 0;
    });
    near(`⌀${d}: V⁰_Rd,c`, kN(b19ShearConcrete(m, res).NRd), want, 0.6);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${runs - fails} av ${runs} stemmer med boka.`);
process.exit(fails ? 1 : 0);
