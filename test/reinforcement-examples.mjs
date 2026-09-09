// ---------------------------------------------------------------------------
//  Tilleggsarmering rundt bolter/stenger - interne konsistenskontroller.
//
//    node test/reinforcement-examples.mjs
//
//  VIKTIG, i motsetning til test/b19-examples.mjs: dette er IKKE regnet om
//  mot et publisert eksempel fra NS-EN 1992-4 tillegg C - det finnes ingen
//  slikt eksempel i spesifikasjonen dette er bygd fra. Testene under
//  kontrollerer at formlene i src/engine/reinforcement-geometry.js,
//  src/engine/stm.js og src/engine/supplementary-reinforcement.js gjør det de
//  sier de gjør (riktig minstelengde etter geometritype, riktig sone,
//  konsistente enheter i stavmodellen osv.) - ikke at tallene stemmer mot en
//  fasit utenfra. Se filhodene for hvilke forenklinger som er dokumentert som
//  antakelser og bør kontrolleres mot trykt standard før prosjektering.
// ---------------------------------------------------------------------------

import { defaultModel, syncPlan, syncLoad } from '../src/core/model.js';
import { newReinforcement, minAnchorageFactor, mandrelDiameter,
         requirementIssues, bruddformFor, GEOMETRY_FOR,
         migrateReinforcements } from '../src/core/reinforcement.js';
import { fbd, anchorageLength, minInsideLength, effectiveCount,
         buildBars, tensionLayout } from '../src/engine/reinforcement-geometry.js';
import { strutCapacity, nodeCapacity, nuPrime } from '../src/engine/stm.js';
import { verify } from '../src/engine/verify.js';

let fails = 0, runs = 0;
function ok(name, cond, detail = '') {
  runs++;
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : '  FEIL'} ${name.padEnd(60)} ${detail}`);
}
function near(name, got, want, tol) {
  ok(name, Math.abs(got - want) <= tol, `${got.toFixed(3)} mot ${want.toFixed(3)} (±${tol})`);
}

console.log('\nMinste forankringslengde i bruddlegemet - pkt. 2/3 (4⌀ bøyd, 10⌀ rett)');
near('U-bøyle', minAnchorageFactor('ubar'), 4, 0);
near('lukket bøyle', minAnchorageFactor('closed'), 4, 0);
near('rett stang', minAnchorageFactor('straight'), 10, 0);
near('minInsideLength(⌀12, U-bøyle)', minInsideLength(12, 'ubar'), 48, 1e-6);
near('minInsideLength(⌀12, straight)', minInsideLength(12, 'straight'), 120, 1e-6);

console.log('\nMandreldiameter - EN 1992-1-1 tab. 8.1N (4⌀ for ⌀ ≤ 16 mm)');
near('⌀12 → 4⌀ = 48', mandrelDiameter(12), 48, 1e-6);
near('⌀16 → 4⌀ = 64', mandrelDiameter(16), 64, 1e-6);

console.log('\nKrav til tilleggsarmering - pkt. 7.2.2.6 (ribbet, ⌀ ≤ 16, f_yk ≤ 600)');
ok('⌀12/f_yk500 - ingen avvik', requirementIssues(newReinforcement('r', 'tension', { ds: 12, fyk: 500 })).length === 0);
ok('⌀20 flagges', requirementIssues(newReinforcement('r', 'tension', { ds: 20 })).length === 1);
ok('f_yk 700 flagges', requirementIssues(newReinforcement('r', 'tension', { fyk: 700 })).length === 1);
ok('antall 0 flagges', requirementIssues(newReinforcement('r', 'tension', { count: 0 })).length === 1);

console.log('\nHvilket betongbrudd en gruppe er ment å erstatte - pkt. 8 (kjegle/kant, aldri pry-out)');
ok('tension -> cone', bruddformFor({ purpose: 'tension' }) === 'cone');
ok('shear -> edge', bruddformFor({ purpose: 'shear' }) === 'edge');
ok('generic -> ingen erstatning', bruddformFor({ purpose: 'generic' }) === null);

console.log('\nHeftfasthet f_bd - NS-EN 1992-1-1 pkt. 8.4.2 (samme formel som b19.js bruker for kamstål)');
{
  // B35, god heft, ⌀12: f_ctk;0,05 = 0,7·0,3·35^(2/3) = 2,247, f_ctd = 1,498,
  // f_bd = 2,25 · 1,498 = 3,37 N/mm².
  const f = fbd(35, 12, true);
  near('f_bd(B35, ⌀12, god heft)', f, 3.37, 0.02);
  ok('dårlig heft gir lavere f_bd', fbd(35, 12, false) < f);
}

console.log('\nEffektivt antall bein innenfor 0,75·sone (pkt. 2/3)');
near('innenfor sona - fullt antall', effectiveCount(4, 50, 100), 4, 0);      // 50 <= 0,75*100=75
near('utenfor sona - null bein telles', effectiveCount(4, 90, 100), 0, 0);   // 90 > 75

console.log('\nStavmodell (STM), EN 1992-1-1 6.5 - node-/trykkfeltfaktorer');
near('ν´(f_ck=35) = 1 − 35/250', nuPrime(35), 1 - 35 / 250, 1e-9);
{
  const fcd = 35 / 1.5;
  near('trykkstav, oppsprukket = 0,6·ν´·f_cd', strutCapacity(fcd, 35, true), 0.6 * nuPrime(35) * fcd, 1e-9);
  near('trykkstav, ingen tverrstrekk = f_cd', strutCapacity(fcd, 35, false), fcd, 1e-9);
  near('node CCT = 0,85·ν´·f_cd', nodeCapacity('CCT', fcd, 35), 0.85 * nuPrime(35) * fcd, 1e-9);
}

console.log('\nKjeglebruddbøyler: plassering ved siden av boltraden (pkt. 2)');
{
  const m = defaultModel();
  m.concrete.h = 600; m.anchors.hef = 250;
  syncLoad(m);
  syncPlan(m);
  const r = newReinforcement('r1', 'tension', { count: 2, ds: 12 });
  const L = tensionLayout(m, r);

  ok('2×2 bolter, retning 0° -> to boltrader', L.rows.length === 2,
    `${L.rows.length} rader`);
  ok('minst én bøyle på hver side av raden', L.barsPerRow >= 2 &&
    L.rows[0].bars.filter(b => b.sgn > 0).length ===
    L.rows[0].bars.filter(b => b.sgn < 0).length, `${L.barsPerRow} pr. rad`);
  ok('ingen bøyle i samme snitt som bolten', L.rows.every(row =>
    row.bars.every(b => b.d >= L.dMin - 1e-6)), `d_min = ${L.dMin.toFixed(0)} mm`);
  ok('alle bøyler innenfor 0,75·h_ef', L.rows.every(row =>
    row.bars.every(b => b.d <= 0.75 * m.anchors.hef + 1e-6)),
    `0,75·h_ef = ${(0.75 * m.anchors.hef).toFixed(0)} mm`);
  near('trykkstaven treffer måltvinkelen når det er plass', L.alphaMax, 45, 0.5);
  {
    const all = L.rows.flatMap(row => row.bars);
    const len = all.map(b => b.uEnd - b.uStart);
    ok('alle bøylene er like lange', Math.max(...len) - Math.min(...len) < 1e-6,
      `${len[0].toFixed(0)} mm`);
    ok('alle bøylene starter og slutter i samme snitt',
      all.every(b => Math.abs(b.uStart - all[0].uStart) < 1e-6 &&
                     Math.abs(b.uEnd - all[0].uEnd) < 1e-6));
  }
  ok('den vannrette delen stikker ut forbi ytterste bolt', L.rows[0].bars.every(b =>
    b.uEnd > Math.max(...L.rows[0].pts.map(p => p.x)) + 1),
    `utstikk = ${L.rows[0].bars[0].L.toFixed(0)} mm`);

  // Flere bøyler pr. rad fordeles utover i sona, fortsatt symmetrisk.
  const r4 = newReinforcement('r2', 'tension', { count: 4, ds: 12 });
  const L4 = tensionLayout(m, r4);
  ok('4 bøyler pr. rad -> 2 på hver side', L4.rows[0].bars.length === 4 &&
    L4.rows[0].bars.filter(b => b.sgn > 0).length === 2);
  ok('den ytterste ligger i ytterkant av sona',
    Math.abs(Math.max(...L4.rows[0].bars.map(b => b.d)) - 0.75 * m.anchors.hef) < 1e-6);
  {
    // Bøyler i ulik avstand fra bolten deler én lengde: staven kan ikke stå i
    // 45° for alle, men alle skal ligge i 35-55°-vinduet.
    const len4 = L4.rows.flatMap(row => row.bars).map(b => b.uEnd - b.uStart);
    ok('ulik avstand fra bolten gir fortsatt én felles lengde',
      Math.max(...len4) - Math.min(...len4) < 1e-6, `${len4[0].toFixed(0)} mm`);
    ok('alle stavene ligger i 35-55°', L4.angleOk,
      `${L4.alphaMin.toFixed(1)}-${L4.alphaMax.toFixed(1)}°`);
  }
  ok('antall bøyler = pr. rad × antall rader',
    buildBars(m, r4).length === 4 * L4.rows.length,
    `${buildBars(m, r4).length} bøyler`);

  // Retninga snur radinndelinga.
  const r90 = newReinforcement('r3', 'tension', { count: 2, ds: 12, direction: 90 });
  const L90 = tensionLayout(m, r90);
  ok('retning 90° gir rader på tvers av 0°-tilfellet',
    Math.abs(L90.u.x) < 1e-9 && Math.abs(L90.u.y - 1) < 1e-9);
}

console.log('\nForm: kjeglebrudd står loddrett under plata, kantbrudd ligger langs kanten');
{
  const m = defaultModel();
  m.concrete.h = 450; m.anchors.hef = 100;
  syncLoad(m);
  syncPlan(m);
  const cover = 30;

  const rt = newReinforcement('r1', 'tension',
    { count: 2, ds: 12, coverTop: cover, coverBottom: cover });
  const barT = buildBars(m, rt)[0];
  const gt = barT.geo;
  const bt = barT.paths[0].points;
  const ztop = Math.max(...bt.map(p => p.z)), zbot = Math.min(...bt.map(p => p.z));
  ok('strekk: kronen ligger med overdekning under overflata',
    Math.abs(ztop + (cover + rt.ds / 2)) < 1e-6, `z_krone = ${ztop.toFixed(1)}`);
  ok('strekk: beina peker nedover, forbi h_ef', zbot < -m.anchors.hef,
    `z_bunn = ${zbot.toFixed(0)} mot h_ef = ${-m.anchors.hef}`);
  ok('strekk: bøyen ligger i et loddrett plan (beina på hver side av bolten)',
    Math.abs(gt.rOff - (rt.clearance + m.anchors.d / 2 + rt.ds / 2)) < 1e-6);

  const rs = newReinforcement('r2', 'shear', { count: 2, ds: 12, coverTop: cover });
  const barS = buildBars(m, rs)[0];
  const gs = barS.geo;
  const bs = barS.paths[0].points;
  const zs = bs.map(p => p.z);
  ok('skjær: hele bøylen ligger vannrett i ett nivå',
    Math.max(...zs) - Math.min(...zs) < 1e-6, `z = ${zs[0].toFixed(1)}`);
  ok('skjær: bøyen ligger langs en fri kant', !!gs.edgeDir, `kant ${gs.edgeDir}`);
  {
    // Kronen skal stå med overdekning fra kanten, og beina gå innover forbi
    // bolten (som ligger c_1 fra kanten).
    const ax = gs.edgeDir === 'xPos' || gs.edgeDir === 'xNeg' ? 'x' : 'y';
    const sgn = gs.edgeDir === 'xPos' || gs.edgeDir === 'yPos' ? 1 : -1;
    // avstand innover fra kanten; kanten ligger c_1 utenfor bolten
    const s = bs.map(p => gs.c1 - sgn * (p[ax] - barS.anchor[ax]));
    ok('skjær: kronen står med overdekning fra kanten',
      Math.abs(Math.min(...s) - cover) < 1e-6, `s_min = ${Math.min(...s).toFixed(1)}`);
    ok('skjær: beina går innover forbi bolten', Math.max(...s) > gs.c1,
      `s_maks = ${Math.max(...s).toFixed(0)} mot c_1 = ${gs.c1.toFixed(0)}`);
  }
}

console.log('\nOverdekning: overkant og underkant er to forskjellige tall');
{
  const m = defaultModel();
  m.concrete.h = 450; m.anchors.hef = 100;
  syncLoad(m);
  syncPlan(m);

  // Kjeglebrudd: overkant styrer kronens nivå, underkant hvor langt ned
  // beina får gå (uavhengig av hverandre).
  const r = newReinforcement('r1', 'tension',
    { count: 2, ds: 12, coverTop: 25, coverBottom: 80 });
  const L = tensionLayout(m, r);
  near('overkant styrer kronens nivå', L.dCrown, 25 + r.ds / 2, 1e-6);
  near('underkant styrer hvor dypt beina kan gå', L.available, m.concrete.h - 80, 1e-6);

  const rSame = newReinforcement('r2', 'tension', { count: 2, ds: 12, coverTop: 25, coverBottom: 25 });
  const rDiff = newReinforcement('r3', 'tension', { count: 2, ds: 12, coverTop: 25, coverBottom: 200 });
  ok('kronens nivå upåvirket av underkant alene',
    tensionLayout(m, rSame).dCrown === tensionLayout(m, rDiff).dCrown);
  ok('endret underkant endrer tilgjengelig dybde',
    tensionLayout(m, rSame).available !== tensionLayout(m, rDiff).available);

  // Gammel, flat `cover` skal migreres til begge - ikke tapes eller telle dobbelt.
  const legacy = { id: 'r4', purpose: 'tension', geometryType: 'ubar', ds: 12, count: 2,
    fyk: 500, anchorIds: 'all', placement: 'auto', clearance: 10, cover: 42,
    height: null, width: null, lapToExisting: { present: false, lapLength: 0 } };
  const mLegacy = { reinforcements: [legacy] };
  migrateReinforcements(mLegacy);
  ok('migrering: gammel cover -> coverTop og coverBottom',
    mLegacy.reinforcements[0].coverTop === 42 && mLegacy.reinforcements[0].coverBottom === 42 &&
    mLegacy.reinforcements[0].cover === undefined);
}

console.log('\nEndebøy: bøy ut i enden av beina (tynn plate)');
{
  // Tynn plate: ikke dybde nok til h_ef + l_bd som rett bein.
  const m = defaultModel();
  m.concrete.h = 300; m.anchors.hef = 150;
  syncLoad(m);
  syncPlan(m);

  const rett = newReinforcement('r1', 'tension', { count: 2, ds: 12 });
  const bøyd = newReinforcement('r2', 'tension', { count: 2, ds: 12, endBend: true });
  const A = tensionLayout(m, rett), B = tensionLayout(m, bøyd);

  ok('uten endebøy: for kort forankring i den tynne plata', !A.fits,
    `${A.anchorageAvail.toFixed(0)} mm mot l_bd = ${A.lbd.toFixed(0)} mm`);
  ok('endebøyen gir bøy + fot som forankring i tillegg',
    B.anchorageAvail > A.anchorageAvail,
    `${B.anchorageAvail.toFixed(0)} mm mot ${A.anchorageAvail.toFixed(0)} mm`);
  ok('foten legges så lang forankringa krever', B.footLen > 0,
    `fot = ${B.footLen.toFixed(0)} mm`);
  ok('bøylen holder seg innenfor underkant betong',
    Math.min(...buildBars(m, bøyd)[0].paths[0].points.map(p => p.z)) >=
      -(m.concrete.h - bøyd.coverBottom) - 1e-6);

  // Punktet den nye kjegla regnes fra flyttes utover av bøyen.
  const uOf = (L, i) => L.rows[0].bars[i].endPoints.map(p => p.x);
  const spanA = Math.max(...uOf(A, 0)) - Math.min(...uOf(A, 0));
  const spanB = Math.max(...uOf(B, 0)) - Math.min(...uOf(B, 0));
  ok('endebøyen flytter kjeglepunktene utover', spanB > spanA,
    `${spanB.toFixed(0)} mm mot ${spanA.toFixed(0)} mm`);

  // ... og med betong å spre seg i skal det gi større kjegle fra armeringsenden.
  // (I en trang plate ligger kjegla allerede an mot kantene; da flytter bøyen
  // bare endene nærmere kanten, og ψ_s trekker ned i stedet. Derfor en romslig
  // plate her - det er tilfellet bøyen er ment for: tynn, men ikke smal.)
  const coneOf = r => {
    const mm = defaultModel();
    mm.concrete.h = 300; mm.anchors.hef = 150;
    mm.concrete.Lx = 4000; mm.concrete.Ly = 4000;
    syncLoad(mm); syncPlan(mm);
    mm.reinforcements.push(r);
    return verify(mm).checks.find(c => c.id === `N-sre-cone-${r.id}`);
  };
  const cA = coneOf(newReinforcement('r1', 'tension', { count: 2, ds: 12 }));
  const cB = coneOf(newReinforcement('r2', 'tension', { count: 2, ds: 12, endBend: true }));
  ok('kjeglekontroll fra armeringsenden finnes', !!cA && !!cB);
  ok('endebøyen gir større kjegle fra armeringsenden', cB.NRd > cA.NRd,
    `${(cB.NRd / 1000).toFixed(0)} kN mot ${(cA.NRd / 1000).toFixed(0)} kN`);

  // Den nye kjegla skal være vesentlig større enn den fra endeplata - det er
  // hele poenget med å føre lasta ned og ut med armeringa.
  const mRef = defaultModel();
  mRef.concrete.h = 300; mRef.anchors.hef = 150;
  mRef.concrete.Lx = 4000; mRef.concrete.Ly = 4000;
  syncLoad(mRef); syncPlan(mRef);
  const fraEndeplata = verify(mRef).checks.find(c => c.id === 'N-cone');
  ok('kjegla fra armeringsenden er større enn kjegla fra endeplata',
    cB.NRd > fraEndeplata.NRd,
    `${(cB.NRd / 1000).toFixed(0)} kN mot ${(fraEndeplata.NRd / 1000).toFixed(0)} kN`);
}

console.log('\nUtforming: U-bøyle, lukket bøyle og rett stang gir hver sin form');
{
  const m = defaultModel();
  m.concrete.h = 450; m.anchors.hef = 100;
  syncLoad(m);
  syncPlan(m);
  const paths = (purpose, t) => buildBars(m, newReinforcement('r', purpose,
    { count: 2, ds: 12, geometryType: t }))[0].paths;
  ok('U-bøyle: én åpen stang',
    paths('tension', 'ubar').length === 1 && !paths('tension', 'ubar')[0].closed);
  ok('lukket bøyle: én lukka stang',
    paths('tension', 'closed').length === 1 && paths('tension', 'closed')[0].closed);
  ok('rett stang finnes ikke for kjeglebrudd',
    !GEOMETRY_FOR.tension.includes('straight'));
  ok('rett stang: to frittstående stenger (skjær)',
    paths('shear', 'straight').length === 2);
}

console.log('\nOrkestrering: kvalifiserende gruppe erstatter kjegle-/kantbrudd, men aldri pry-out');
{
  const m = defaultModel();
  m.concrete.h = 450; m.anchors.hef = 100;
  syncLoad(m);
  syncPlan(m);
  m.reinforcements.push(newReinforcement('r1', 'tension', { count: 4, ds: 12, fyk: 500 }));
  m.reinforcements.push(newReinforcement('r2', 'shear', { count: 4, ds: 12, fyk: 500 }));
  const v = verify(m);
  ok('N-cone er borte fra styrende kontroller', !v.checks.some(c => c.id === 'N-cone'));
  ok('V-edge er borte fra styrende kontroller', !v.checks.some(c => c.id === 'V-edge'));
  ok('V-pryout er fortsatt med (erstattes aldri)', v.checks.some(c => c.id === 'V-pryout'));
  ok('N-cone er lagret som erstattet', v.replacedConcreteChecks.some(c => c.id === 'N-cone'));
  ok('V-edge er lagret som erstattet', v.replacedConcreteChecks.some(c => c.id === 'V-edge'));
  ok('tilleggsarmeringskontrollene er med', v.checks.some(c => c.id === 'N-sre-steel-r1') &&
    v.checks.some(c => c.id === 'V-sre-steel-r2'));
}
{
  // For høy f_yk - gruppa skal IKKE kvalifisere til å erstatte kjeglebrudd,
  // selv om stål-/forankringskontrollene fortsatt regnes og vises.
  const m = defaultModel();
  m.concrete.h = 450; m.anchors.hef = 100;
  syncLoad(m);
  syncPlan(m);
  m.reinforcements.push(newReinforcement('r1', 'tension', { count: 4, ds: 12, fyk: 700 }));
  const v = verify(m);
  ok('N-cone blir stående når gruppa ikke kvalifiserer', v.checks.some(c => c.id === 'N-cone'));
  ok('ingenting erstattet', v.replacedConcreteChecks.length === 0);
  ok('stålkontrollen er likevel regnet', v.checks.some(c => c.id === 'N-sre-steel-r1'));
}

console.log(`\n${runs - fails} av ${runs} stemmer.`);
if (fails) process.exit(1);
