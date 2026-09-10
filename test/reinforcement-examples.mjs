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

import { defaultModel, syncPlan, syncLoad, anchorPositions,
         anchorFoot } from '../src/core/model.js';
import { newReinforcement, minAnchorageFactor, mandrelDiameter,
         requirementIssues, bruddformFor, GEOMETRY_FOR, minBarSpacing,
         minClearSpacing, migrateReinforcements } from '../src/core/reinforcement.js';
import { fbd, anchorageLength, minInsideLength, effectiveCount, buildBars,
         tensionLayout, buildSurfaceMesh, surfaceMeshLevels, buildBendBars,
         splitPathAtCone } from '../src/engine/reinforcement-geometry.js';
import { coneSurfaceDepth } from '../src/engine/geometry.js';
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

console.log('\nKjeglebruddarmering: plassering etter FAKTISK avstand bolt -> bein (pkt. 7.2.1.2)');
{
  const m = defaultModel();
  m.concrete.h = 600; m.anchors.hef = 250;
  syncLoad(m);
  syncPlan(m);
  const dMax = 0.75 * m.anchors.hef;
  const r = newReinforcement('r1', 'tension', { count: 2, ds: 12 });
  const L = tensionLayout(m, r);
  const dist = (leg, p) => Math.hypot(leg.x - p.x, leg.y - p.y);

  ok('én bøyle på hver side av hver bolt', L.nSide === 1 && L.barsPerAnchor === 2,
    `${L.barsPerAnchor} pr. bolt`);
  ok('hver bolt får sine egne bøyler',
    L.bars.length === anchorPositions(m).length * L.barsPerAnchor,
    `${L.bars.length} bøyler på ${anchorPositions(m).length} bolter`);
  ok('ingen bøyle i samme snitt som bolten', L.bars.every(b => b.d >= L.dMin - 1e-6),
    `d_min = ${L.dMin.toFixed(0)} mm`);

  // Kravet: FAKTISK avstand i planet, ikke bare avstanden på tvers.
  ok('hver bolt har minst ett bein innenfor 0,75·h_ef', L.allServed,
    `0,75·h_ef = ${dMax.toFixed(0)} mm`);
  ok('faktisk avstand måles i planet, ikke pr. akse',
    Math.abs(L.dNearest - Math.hypot(L.halfSpan, L.dMin)) < 1e-6,
    `√(${L.halfSpan.toFixed(0)}² + ${L.dMin.toFixed(0)}²) = ${L.dNearest.toFixed(0)} mm`);
  ok('alle effektive bein ligger innenfor 0,75·h_ef', L.dFarthest <= dMax + 1e-6,
    `${L.dFarthest.toFixed(0)} mm mot ${dMax.toFixed(0)} mm`);

  // Bøylene skal ligge NÆR bolten, ikke ute ved 0,75·h_ef.
  ok('bøylene legges så nær bolten som praktisk mulig', L.dNearest < 0.4 * dMax,
    `${L.dNearest.toFixed(0)} mm mot 0,75·h_ef = ${dMax.toFixed(0)} mm`);

  // Symmetri: like mange bøyler på hver side av hver bolt.
  ok('symmetrisk om bolten', L.bars.filter(b => b.sgn > 0).length ===
    L.bars.filter(b => b.sgn < 0).length);
  for (const p of anchorPositions(m)) {
    const nEar = L.legs.filter(g => dist(g, p) <= dMax + 1e-6).length;
    if (nEar < 2) ok(`bolt ${p.id} har bein i sona`, false, `${nEar} bein`);
  }

  // Flere bøyler pr. bolt pakkes fra bolten og utover med minste tillatte
  // senteravstand etter NS-EN 1992-1-1 8.2 - de spres IKKE ut til 0,75·h_ef.
  const r4 = newReinforcement('r2', 'tension', { count: 4, ds: 12 });
  const L4 = tensionLayout(m, r4);
  ok('4 bøyler pr. bolt -> 2 på hver side', L4.nSide === 2 && L4.barsPerAnchor === 4);
  near('senteravstanden er minste tillatte etter EN 1992-1-1 8.2',
    L4.offsets[1] - L4.offsets[0], minBarSpacing(12, m.concrete.dg), 1e-9);
  near('minste senteravstand ⌀12/d_g16 = maks(12; 21; 20) + 12',
    minBarSpacing(12, 16), 33, 1e-9);
  {
    // Egne bøyler: den ytterste ligger der pakkinga slutter, ikke ute ved sonegrensa.
    const dOwn = Math.hypot(L4.halfSpan, L4.offsets[L4.nSide - 1]);
    ok('den ytterste egne bøylen ligger IKKE i ytterkant av sona', dOwn < 0.5 * dMax,
      `${dOwn.toFixed(0)} mm mot 0,75·h_ef = ${dMax.toFixed(0)} mm`);
  }
  ok('alle bein som telles med ligger innenfor 0,75·h_ef', L4.dFarthest <= dMax + 1e-6,
    `${L4.dFarthest.toFixed(0)} mm mot ${dMax.toFixed(0)} mm`);
  ok('antall bøyler = pr. bolt × antall bolter',
    buildBars(m, r4).length === L4.bars.length, `${buildBars(m, r4).length} bøyler`);

  // Et lite h_ef gjør sona så trang at bøylene ikke får plass ved siden av
  // bolten - da skal det flagges, ikke fikses ved å flytte dem utenfor.
  const mSmall = defaultModel();
  mSmall.concrete.h = 600; mSmall.anchors.hef = 60;
  syncLoad(mSmall); syncPlan(mSmall);
  const LSmall = tensionLayout(mSmall,
    newReinforcement('r3', 'tension', { count: 2, ds: 12, clearance: 60 }));
  ok('for lite h_ef mot klaringa flagges som at sona ikke holder', !LSmall.zoneOk,
    `√(a²+d²) = ${LSmall.dNearest.toFixed(0)} mm mot 0,75·h_ef = ${(0.75 * 60).toFixed(0)} mm`);

  // Retninga snur bøyleplanet.
  const r90 = newReinforcement('r4', 'tension', { count: 2, ds: 12, direction: 90 });
  const L90 = tensionLayout(m, r90);
  ok('retning 90° dreier bøylene et kvart omdreining',
    Math.abs(L90.u.x) < 1e-9 && Math.abs(L90.u.y - 1) < 1e-9);
}

console.log('\nKjeglebruddarmering: forankring inne i og utenfor kjegla');
{
  const m = defaultModel();
  m.concrete.h = 700; m.anchors.hef = 200;
  m.concrete.Lx = 3000; m.concrete.Ly = 3000;
  syncLoad(m); syncPlan(m);

  // U-bøyle: l_1 >= 4⌀, rett stang: l_1 >= 10⌀.
  const u = tensionLayout(m, newReinforcement('r1', 'tension',
    { count: 2, ds: 12, geometryType: 'ubar' }));
  const st = tensionLayout(m, newReinforcement('r2', 'tension',
    { count: 2, ds: 12, geometryType: 'straight', lapToExisting: { present: true, lapLength: 600 } }));
  ok('U-bøyle: l_1 >= 4⌀', u.insideLen >= minInsideLength(12, 'ubar'),
    `${u.insideLen.toFixed(0)} mm mot ${minInsideLength(12, 'ubar')} mm`);
  ok('rett stang: l_1 >= 10⌀', st.insideLen >= minInsideLength(12, 'straight'),
    `${st.insideLen.toFixed(0)} mm mot ${minInsideLength(12, 'straight')} mm`);
  ok('rett stang har ingen bøy å regne med i l_1', st.bendArc === 0);
  ok('U-bøyla teller kvartbøyen med i l_1', u.bendArc > 0);

  // l_bd utenfor kjegla, EN 1992-1-1 8.4.
  ok('l_bd regnes fra h_ef og nedover', u.outsideLen <= u.dBot - m.anchors.hef + 1e-6);
  ok('forankringa strekker til i den tykke plata', u.fits,
    `${u.anchorageAvail.toFixed(0)} mm mot l_bd = ${u.lbd.toFixed(0)} mm`);

  // Rett stang uten omslutting: overlapp mot konstruksjonsarmeringa er et krav.
  ok('rett strekkarmering uten overlapp flagges',
    requirementIssues(newReinforcement('r3', 'tension',
      { geometryType: 'straight' })).some(t => /overlapp/i.test(t)));
  ok('rett strekkarmering med overlapp er i orden',
    requirementIssues(newReinforcement('r4', 'tension', { geometryType: 'straight',
      lapToExisting: { present: true, lapLength: 600 } })).length === 0);

  // Bøyen krøller seg RUNDT stanga i den, så bøylen ligger OVER den - ikke
  // under. Med overflatearmeringa i bøyen følger bøylen nettet.
  const wrap = tensionLayout(m, newReinforcement('r5', 'tension', { count: 2, ds: 12,
    coverTop: 30, surfaceReinf: { present: true, ds: 12, cover: 30, spacing: 150 } }));
  ok('bøylen ligger OVER stanga i bøyen', wrap.dCrown < wrap.dBend,
    `krone ${wrap.dCrown.toFixed(0)} mot stang ${wrap.dBend.toFixed(0)} mm`);
  near('stanga i bøyen er det innerste nettlaget – det som går på tvers',
    wrap.dBend, surfaceMeshLevels({ surfaceReinf: { ds: 12, cover: 30 } })[1], 1e-9);
  near('bøyen tangerer stanga: krone = stangnivå − ⌀_stang/2 − ⌀_s/2',
    wrap.dCrown, (30 + 12 + 6) - 6 - 6, 1e-9);
  near('bøylen får da sin egen overdekning', wrap.dCrown - 12 / 2, 30, 1e-9);
  ok('rett stang har ingen bøy å legge noe i',
    tensionLayout(m, newReinforcement('r7', 'tension', { count: 2, ds: 12,
      geometryType: 'straight', surfaceReinf: { present: true, ds: 12, cover: 30 },
      lapToExisting: { present: true, lapLength: 600 } })).dtBend === 0);

  // Egen stang i bøyen: bøylen står fritt med sin egen overdekning, og stanga
  // legges inne i bøyen under den. Nettet tegnes ikke.
  const own = tensionLayout(m, newReinforcement('r8', 'tension', { count: 2, ds: 12,
    coverTop: 40, bendBar: 'own', bendBarDs: 16 }));
  near('egen stang: bøylen får sin egen overdekning', own.dCrown - 12 / 2, 40, 1e-9);
  ok('egen stang ligger inne i bøyen, under kronen', own.dBend > own.dCrown,
    `stang ${own.dBend.toFixed(0)} mot krone ${own.dCrown.toFixed(0)} mm`);
  near('stang i bøyen = krone + ⌀_s/2 + ⌀_b/2', own.dBend, own.dCrown + 6 + 8, 1e-9);
  near('stanga er minst like tjukk som bøylen', own.dtBend, 16, 1e-9);
  near('for tynn oppgitt ⌀ løftes til bøylens', tensionLayout(m,
    newReinforcement('r9', 'tension', { count: 2, ds: 12, bendBar: 'own', bendBarDs: 8 })).dtBend,
    12, 1e-9);
  ok('egen stang i bøyen -> ingen overflatearmering å tegne',
    buildSurfaceMesh(m, newReinforcement('r10', 'tension', { count: 2, ds: 12,
      bendBar: 'own', surfaceReinf: { present: true, ds: 12, cover: 30, spacing: 150 } })).length === 0);
  {
    const bb = buildBendBars(m, newReinforcement('r11', 'tension',
      { count: 2, ds: 12, bendBar: 'own', bendBarDs: 16 }));
    ok('det legges en stang pr. bøy', bb.length > 0, `${bb.length} stenger`);
    ok('stanga går på tvers av bøyleretninga', bb.every(b => {
      const [p, q] = b.paths[0].points;
      return Math.abs((q.x - p.x) / Math.hypot(q.x - p.x, q.y - p.y)) < 1e-6;
    }));
    ok('stanga forankres etter EN 1992-1-1 8.4', bb[0].lbd > 0 &&
      bb[0].span > bb[0].lbd, `l_bd = ${bb[0].lbd.toFixed(0)} mm, lengde ${bb[0].span.toFixed(0)} mm`);
  }
}

console.log('\nBøylefordeling: om hver bolt, eller over hele boltraden');
{
  const m = defaultModel();
  m.concrete.h = 600; m.anchors.hef = 250; m.anchors.sx = 200;
  syncLoad(m); syncPlan(m);
  const dMax = 0.75 * m.anchors.hef;
  const perBolt = tensionLayout(m, newReinforcement('r1', 'tension',
    { count: 2, ds: 12, barLayout: 'anchor' }));
  const perRow = tensionLayout(m, newReinforcement('r2', 'tension',
    { count: 2, ds: 12, barLayout: 'row' }));

  ok('bøyle om hver bolt gir én bøyle pr. bolt pr. side',
    perBolt.bars.length === anchorPositions(m).length * perBolt.barsPerAnchor / 2 * 2,
    `${perBolt.bars.length} bøyler`);
  ok('bøyle over raden gir færre bøyler', perRow.bars.length < perBolt.bars.length,
    `${perRow.bars.length} mot ${perBolt.bars.length}`);
  ok('radbøylen spenner ut forbi de ytterste boltene i raden',
    perRow.bars[0].uEnd - perRow.bars[0].uStart >
      m.anchors.sx * (m.anchors.nx - 1) + 2 * perRow.halfSpan - 1e-6,
    `${(perRow.bars[0].uEnd - perRow.bars[0].uStart).toFixed(0)} mm`);
  ok('med to bolter i raden er begge hjørnebolter, og begge er dekket',
    perRow.allServed, `d_n = ${perRow.dOwn.toFixed(0)} mm`);
  ok('begge fordelingene gir 2 bein pr. bøyle', perRow.legsPerBar === 2);

  // Ei lang rad: bolten i midten får ikke noe bein nær seg, og det skal flagges.
  const mLong = defaultModel();
  mLong.concrete.h = 600; mLong.anchors.hef = 250;
  mLong.anchors.nx = 3; mLong.anchors.ny = 1; mLong.anchors.sx = 400;
  mLong.plate.bx = 1000;
  syncLoad(mLong); syncPlan(mLong);
  const long = tensionLayout(mLong, newReinforcement('r3', 'tension',
    { count: 2, ds: 12, barLayout: 'row' }));
  ok('lang rad: midtbolten havner utenfor 0,75·h_ef og flagges', !long.allServed,
    `d_n = ${long.dOwn.toFixed(0)} mm mot ${dMax.toFixed(0)} mm`);
  ok('samme rad med bøyle om hver bolt er i orden',
    tensionLayout(mLong, newReinforcement('r4', 'tension',
      { count: 2, ds: 12, barLayout: 'anchor' })).allServed);
  ok('rett stang har ingen spennvidde og faller alltid tilbake til pr. bolt',
    tensionLayout(m, newReinforcement('r5', 'tension', { count: 2, ds: 12,
      geometryType: 'straight', barLayout: 'row',
      lapToExisting: { present: true, lapLength: 600 } })).barLayout === 'anchor');
}

console.log('\nl_1 måles fra der KJEGLA krysser beinet, ikke fra h_ef');
{
  const m = defaultModel();
  m.concrete.h = 800; m.anchors.hef = 250;
  m.concrete.Lx = 4000; m.concrete.Ly = 4000;
  syncLoad(m); syncPlan(m);
  const foot = anchorFoot(m);
  const pts = anchorPositions(m);
  const zTop = m.anchors.hef - foot.t;

  // Kjegleflata: dyp ved bolten, grunn langt ute. Rett over bolten er den i
  // trykkflata; c_cr,N unna er den oppe i overflata.
  const at = (x, y) => coneSurfaceDepth(m, foot, pts, m.anchors.hef, x, y);
  near('kjegla er dypest rett over bolten', at(pts[0].x, pts[0].y), zTop, 1e-6);
  {
    // Målt fra den ytterste bolten - kjegla spres fra alle boltene, så
    // avstanden regnes til den NÆRMESTE av dem.
    const xMax = Math.max(...pts.map(p => p.x));
    near('kjegla når overflata c_cr,N utenfor ytterste bolt',
      at(xMax + 1.5 * m.anchors.hef + 10, pts[0].y), 0, 1e-6);
  }
  ok('kjegla blir grunnere jo lenger ut man går',
    at(pts[0].x + 100, pts[0].y) < at(pts[0].x + 50, pts[0].y));

  // Kjegla er IKKE flat mellom boltene: den sprer seg fra hver fot for seg og
  // møter nabokjegla i en rygg på midten. Det er ryggen som avgjør hvor djupt
  // et bøylebein mellom boltene står inne i bruddlegemet.
  {
    const xs = [...new Set(pts.map(p => p.x))].sort((a, b) => a - b);
    const y = pts[0].y, mid = (xs[0] + xs[1]) / 2;
    ok('mellom to bolter stiger kjegla opp i en rygg',
      at(mid, y) < at(xs[0], y) && at(mid, y) < at(xs[1], y),
      `rygg ${at(mid, y).toFixed(0)} mot fot ${at(xs[0], y).toFixed(0)} mm`);
    ok('ryggen ligger på midten, symmetrisk om de to boltene',
      Math.abs(at(mid - 40, y) - at(mid + 40, y)) < 1e-6);
    ok('ryggen er høyest akkurat på midten',
      at(mid, y) < at(mid - 40, y) + 1e-6 && at(mid, y) < at(mid + 40, y) + 1e-6);
    ok('taket er ikke flatt mellom boltene',
      Math.abs(at(mid, y) - at(xs[0], y)) > 1,
      `${at(mid, y).toFixed(0)} mot ${at(xs[0], y).toFixed(0)} mm`);
  }

  // Bein lenger fra bolten treffer kjegla grunnere, og får kortere l_1.
  const naer = tensionLayout(m, newReinforcement('r1', 'tension', { count: 2, ds: 12 }));
  const fjern = tensionLayout(m, newReinforcement('r2', 'tension', { count: 8, ds: 12 }));
  ok('bein lenger ute krysser kjegla grunnere', fjern.zConeMin < naer.zConeMin,
    `${fjern.zConeMin.toFixed(0)} mot ${naer.zConeMin.toFixed(0)} mm`);
  ok('og får dermed kortere l_1', fjern.insideLen < naer.insideLen,
    `${fjern.insideLen.toFixed(0)} mot ${naer.insideLen.toFixed(0)} mm`);
  ok('l_1 er kortere enn beinet ned til h_ef', naer.insideLen <
    m.anchors.hef - naer.dLegTop + naer.bendArc,
    `${naer.insideLen.toFixed(0)} mot ${(m.anchors.hef - naer.dLegTop + naer.bendArc).toFixed(0)} mm`);
  near('l_1 = beinet ned til krysningspunktet + kvartbøyen',
    naer.insideLen, naer.zConeMin - naer.dLegTop + naer.bendArc, 1e-6);
  ok('det korteste beinet blant dem som teller med styrer',
    fjern.insideLen <= fjern.insideMax + 1e-9);

  // Banen deles på nøyaktig samme flate når den skal tegnes.
  const r = newReinforcement('r3', 'tension', { count: 2, ds: 12 });
  const segs = buildBars(m, r).flatMap(b => b.paths.flatMap(p => splitPathAtCone(m, r, p)));
  ok('banen deles i biter inne i og utenfor bruddlegemet',
    segs.some(x => x.inside) && segs.some(x => !x.inside), `${segs.length} biter`);
  ok('skjøtene ligger på kjegleflata', segs.filter(x => x.inside).every(x => {
    const e = x.points[0];
    return Math.abs(-e.z - coneSurfaceDepth(m, foot, pts, m.anchors.hef, e.x, e.y)) < 1 ||
           -e.z < coneSurfaceDepth(m, foot, pts, m.anchors.hef, e.x, e.y) + 1;
  }));

  // Uten fot er det ingen kjegle å krysse - da flagges det ikke som en deling.
  const mNone = defaultModel();
  mNone.concrete.h = 800; mNone.anchors.hef = 250; mNone.anchors.endType = 'none';
  syncLoad(mNone); syncPlan(mNone);
  ok('uten forankringsfot deles ikke banen',
    splitPathAtCone(mNone, r, buildBars(mNone, r)[0].paths[0]).every(x => !x.inside));
}

console.log('\nOverflatearmering: nettet bøylen omslutter');
{
  const m = defaultModel();
  m.concrete.h = 600; m.anchors.hef = 250;
  syncLoad(m); syncPlan(m);
  const r = newReinforcement('r1', 'tension', { count: 2, ds: 12,
    surfaceReinf: { present: true, ds: 12, cover: 30, spacing: 150 } });
  const mesh = buildSurfaceMesh(m, r);
  const L = tensionLayout(m, r);

  ok('nettet har to ortogonale lag',
    mesh.some(b => b.layer === 1) && mesh.some(b => b.layer === 2));
  const lv = surfaceMeshLevels(r);
  near('ytterste lag ligger i overdekninga', lv[0], 30 + 6, 1e-9);
  near('innerste lag rett innenfor', lv[1], 30 + 12 + 6, 1e-9);
  ok('bøyen tangerer det innerste laget – bøylen over, stanga inne i bøyen',
    Math.abs((L.dCrown + r.ds / 2) - (lv[1] - 12 / 2)) < 1e-6,
    `innside bøy ${(L.dCrown + r.ds / 2).toFixed(0)} mot overkant stang ${(lv[1] - 6).toFixed(0)} mm`);
  {
    const ys = mesh.filter(b => b.layer === 1).map(b => b.paths[0].points[0].y).sort((a, b) => a - b);
    near('senteravstanden i nettet er den oppgitte', ys[1] - ys[0], 150, 1e-9);
  }
  ok('nettet holder seg innenfor betongdelen', mesh.every(b =>
    b.paths[0].points.every(p => Math.abs(p.x) <= m.concrete.Lx / 2 &&
                                 Math.abs(p.y) <= m.concrete.Ly / 2)));
  ok('endret c/c endrer antall stenger',
    buildSurfaceMesh(m, newReinforcement('r2', 'tension', { count: 2, ds: 12,
      surfaceReinf: { present: true, ds: 12, cover: 30, spacing: 300 } })).length < mesh.length);
  ok('uten overflatearmering tegnes ingenting',
    buildSurfaceMesh(m, newReinforcement('r3', 'tension', { count: 2, ds: 12,
      surfaceReinf: { present: false, ds: 12, cover: 30, spacing: 150 } })).length === 0);
  ok('rett stang omslutter ingenting – ikke noe nett å tegne',
    buildSurfaceMesh(m, newReinforcement('r4', 'tension', { count: 2, ds: 12,
      geometryType: 'straight',
      lapToExisting: { present: true, lapLength: 600 },
      surfaceReinf: { present: true, ds: 12, cover: 30, spacing: 150 } })).length === 0);
}

console.log('\nForm: kjeglebrudd står loddrett under plata, kantbrudd ligger langs kanten');
{
  const m = defaultModel();
  m.concrete.h = 450; m.anchors.hef = 100;
  syncLoad(m);
  syncPlan(m);
  const cover = 30;

  const rt = newReinforcement('r1', 'tension',
    { count: 2, ds: 12, coverTop: cover, coverBottom: cover,
      surfaceReinf: { present: false, ds: 12, cover } });
  const barT = buildBars(m, rt)[0];
  const gt = barT.geo;
  const bt = barT.paths[0].points;
  const ztop = Math.max(...bt.map(p => p.z)), zbot = Math.min(...bt.map(p => p.z));
  ok('strekk: kronen ligger med overdekning under overflata',
    Math.abs(ztop + (cover + rt.ds / 2)) < 1e-6, `z_krone = ${ztop.toFixed(1)}`);

  // Skal bøyen omslutte overflatearmeringa, legges den rett OVER det laget som
  // går på tvers - bøyen krøller seg rundt stanga, så bøylen er den øverste.
  const rw = newReinforcement('r1b', 'tension', { count: 2, ds: 12, coverTop: cover,
    surfaceReinf: { present: true, ds: 10, cover: 25, spacing: 150 } });
  const zw = Math.max(...buildBars(m, rw)[0].paths[0].points.map(p => p.z));
  const zBend = 25 + 10 + 10 / 2;                 // innerste nettlag
  ok('strekk: bøylen ligger over stanga den omslutter',
    Math.abs(zw + (zBend - 10 / 2 - rw.ds / 2)) < 1e-6, `z_krone = ${zw.toFixed(1)}`);
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
  const noMesh = { present: false, ds: 12, cover: 30, spacing: 150 };
  const r = newReinforcement('r1', 'tension',
    { count: 2, ds: 12, coverTop: 25, coverBottom: 80, surfaceReinf: noMesh });
  const L = tensionLayout(m, r);
  near('overkant styrer kronens nivå', L.dCrown, 25 + r.ds / 2, 1e-6);
  near('underkant styrer hvor dypt beina kan gå', L.available, m.concrete.h - 80, 1e-6);

  const rSame = newReinforcement('r2', 'tension',
    { count: 2, ds: 12, coverTop: 25, coverBottom: 25, surfaceReinf: noMesh });
  const rDiff = newReinforcement('r3', 'tension',
    { count: 2, ds: 12, coverTop: 25, coverBottom: 200, surfaceReinf: noMesh });
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
  const uOf = (L, i) => L.bars[i].endPoints.map(p => p.x);
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
  ok('rett stang er tillatt for kjeglebrudd (med overlappskrav)',
    GEOMETRY_FOR.tension.includes('straight'));
  ok('rett kjeglebruddarmering: én loddrett stang pr. bøyle',
    paths('tension', 'straight').length === 1 &&
    paths('tension', 'straight')[0].points.length === 2);
  ok('rett stang: to frittstående stenger (skjær)',
    paths('shear', 'straight').length === 2);
}

console.log('\nOrkestrering: kvalifiserende gruppe erstatter kjegle-/kantbrudd, men aldri pry-out');
{
  // Realistisk dybde: med h_ef = 100 mm og bøylen lagt under overflatenettet
  // blir det ikke l_1 nok igjen inne i kjegla til at gruppa kvalifiserer -
  // se testen over. Her er det orkestreringa som skal prøves, ikke geometrien.
  const m = defaultModel();
  m.concrete.h = 700; m.anchors.hef = 250;
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
