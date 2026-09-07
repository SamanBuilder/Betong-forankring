// ---------------------------------------------------------------------------
//  Betongdelen som legeme: former tegnet i plan, hver med sitt hoeydeintervall.
//
//    node test/solid-shapes.mjs
//
//  Testene er reint geometriske, og alle fasitene er regnet for hånd i
//  kommentaren over hver linje. Poenget er at representasjonen er EKSAKT:
//  volum, bruddareal og kantavstand skal treffe på millimeteren, ikke
//  omtrentlig - og en betongdel som bare er ett rektangel skal gi nøyaktig de
//  samme tallene som den rette klossen gjorde før plantegninga fantes.
// ---------------------------------------------------------------------------

import { defaultModel, syncLoad, edgeDistances, memberThickness,
         anchorPositions, anchorFoot, newShape, migratePlan } from '../src/core/model.js';
import { coneProjection, frontWidth, edgeBreakout } from '../src/engine/geometry.js';
import { solidSlabs, solidOutline, solidVolume, surfaceZ,
         planSize } from '../src/engine/solid.js';

let fails = 0, runs = 0;

function eq(name, got, want, tol = 1e-6) {
  runs++;
  const ok = Object.is(got, want) || Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FEIL'} ${name.padEnd(50)} ` +
              `${String(typeof got === 'number' ? +got.toFixed(3) : got).padStart(12)} mot ${want}`);
}

// Standardmodellen: ett rektangel 1200 x 1200 over hele tykkelsen 300,
// 2x2 ⌀16 med c/c 200, h_ef 150. Bolt 1 ligger i (-100, -100).
// 1,5·h_ef = 225, så kjegla dekker x, y i [-325, 325] -> 650 x 650.
const R = (id, x, y, bx, by, extra = {}) =>
  newShape(id, 'rect', { x, y, bx, by, ...extra }, extra.op || 'add');

function build(extra = []) {
  const m = defaultModel();
  syncLoad(m);
  m.concrete.plan = [...m.concrete.plan, ...extra];
  return m;
}
const A = m => coneProjection(m, anchorFoot(m), anchorPositions(m), 1.5 * m.anchors.hef);
const c1 = (m, dir) => edgeDistances(m, -100, -100)[dir];

console.log('\nEtt rektangel – den rette klossen, som før');
{
  const m = build();
  eq('volum', solidVolume(m), 1200 * 1200 * 300);
  eq('A_c,N = 650²', A(m), 650 * 650);
  eq('kantavstand +x = 600 + 100', c1(m, 'xPos'), 700);
  eq('lokal tykkelse = h', memberThickness(m, anchorPositions(m)), 300);
  eq('ett prisme, tolv kanter', solidSlabs(m).length * 100 + solidOutline(m).length, 112);
  eq('L_x leses av tegninga', planSize(m).Lx, 1200);
}

console.log('\nUtsparing i +x-kanten: 600 brei, inn til x = 150');
{
  // Utsparinga stikker utenfor delen (til x = 700) – bare det som overlapper
  // betongen teller: (600 − 150) x 600 x 300.
  const m = build([R('s2', 425, 0, 550, 600, { op: 'cut' })]);
  eq('volum', solidVolume(m), 1200 * 1200 * 300 - 450 * 600 * 300);
  eq('A_c,N', A(m), 650 * 650 - 175 * 600);
  eq('kantavstand +x = 150 + 100', c1(m, 'xPos'), 250);
  eq('kantavstand −x uendret', c1(m, 'xNeg'), 500);
}

console.log('\nKonsoll ut av +x-kanten: 400 brei, 250 ut');
{
  const m = build([R('s2', 725, 0, 250, 400)]);
  eq('volum', solidVolume(m), 1200 * 1200 * 300 + 250 * 400 * 300);
  eq('kantavstand +x = 850 + 100', c1(m, 'xPos'), 950);
  eq('A_c,N uendret (kjegla når ikke ut)', A(m), 650 * 650);
  eq('omrisset vokser med konsollen', planSize(m).Lx, 1450);
}

console.log('\nGjennomgående hull 200 x 200 med senter i x = 250');
{
  const m = build([R('s2', 250, 0, 200, 200, { op: 'cut' })]);
  eq('volum', solidVolume(m), 1200 * 1200 * 300 - 200 * 200 * 300);
  eq('A_c,N', A(m), 650 * 650 - 175 * 200);
  eq('kantavstand +x stopper i hullet', c1(m, 'xPos'), 250);
}

console.log('\nGrop i overflata der plata står: 500 x 500, 80 dyp');
{
  const m = build([R('s2', 0, 0, 500, 500, { op: 'cut', z0: -80, z1: 0 })]);
  eq('volum', solidVolume(m), 1200 * 1200 * 300 - 500 * 500 * 80);
  eq('referanseplan flyttet til gropas bunn', surfaceZ(m), -80);
  eq('lokal tykkelse 300 − 80', memberThickness(m, anchorPositions(m)), 220);
  eq('A_c,N uendret: kjegla måles fra gropa', A(m), 650 * 650);
  eq('to prismer', solidSlabs(m).length, 2);
}

console.log('\nFortykkelse under: 600 x 600, 120 ned');
{
  const m = build([R('s2', 0, 0, 600, 600, { z0: -420, z1: -300 })]);
  eq('volum', solidVolume(m), 1200 * 1200 * 300 + 600 * 600 * 120);
  eq('lokal tykkelse 300 + 120', memberThickness(m, anchorPositions(m)), 420);
  eq('referanseplanet står i ro', surfaceZ(m), 0);
}

console.log('\nAvtrapping i +x-kanten: to utsparinger i hvert sitt høydelag');
{
  // Øvre halvdel skjæres 200 inn, nedre halvdel 400 inn.
  const m = build([
    R('s2', 500, 0, 200, 600, { op: 'cut', z0: -150, z1: 0 }),
    R('s3', 400, 0, 400, 600, { op: 'cut', z0: -300, z1: -150 }),
  ]);
  eq('volum', solidVolume(m),
    1200 * 1200 * 300 - 200 * 600 * 150 - 400 * 600 * 150);
  eq('to prismer: 0 til −150 og −150 til −300', solidSlabs(m).length, 2);
  // Kjegla står i dybden [−150, 0]: bare det øvre trinnet er hult der.
  eq('kantavstand +x i øvre lag', c1(m, 'xPos'), 500);
}

console.log('\nTo rektangler som overlapper – unionen, ikke summen');
{
  // 1200 x 1200 og et 600 x 600 som ligger halvveis oppi det, fra x = 300
  // til x = 900. Bare det som stikker utenfor (300 x 600) er nytt volum.
  const m = build([R('s2', 600, 0, 600, 600)]);
  eq('volum = union', solidVolume(m), 1200 * 1200 * 300 + 300 * 600 * 300);
  eq('kantavstand +x = 900 + 100', c1(m, 'xPos'), 1000);
  // Omrisset er én sammenhengende sløyfe: de innvendige linjene er borte.
  eq('ett hulrom-fritt omriss', solidSlabs(m)[0].faces.length, 1);
  eq('åtte hjørner i omrisset', solidSlabs(m)[0].faces[0].outer.length, 8);
}

console.log('\nSirkel: rundt hull i betongen');
{
  const m = build();
  m.concrete.plan.push(newShape('s2', 'circle', { x: 300, y: 300, r: 200 }, 'cut'));
  // Mangekanten ligger like innenfor sirkelen; avviket er kjent og lite.
  const exact = 1200 * 1200 * 300 - Math.PI * 200 * 200 * 300;
  eq('volum ≈ πr²h fjernet', solidVolume(m), exact, Math.abs(exact) * 0.001);
  eq('hullet er ett hull i flata', solidSlabs(m)[0].faces[0].holes.length, 1);
}

console.log('\nLinjefigur: en L-form tegnet som lukka linjer');
{
  const m = defaultModel();
  syncLoad(m);
  m.concrete.plan = [newShape('s1', 'poly', { pts: [
    [-600, -600], [600, -600], [600, 0], [0, 0], [0, 600], [-600, 600]] })];
  eq('volum = 1200·600 + 600·600', solidVolume(m), (1200 * 600 + 600 * 600) * 300);
  eq('kantavstand +y fra (−100, −100)', c1(m, 'yPos'), 700);
  eq('kantavstand +x fra (−100, −100)', c1(m, 'xPos'), 700);
  // I det øvre beinet stopper betongen i x = 0.
  eq('kantavstand +x fra (−100, 300)', edgeDistances(m, -100, 300).xPos, 100);
}

console.log('\nSide som ikke er fri: betongen fortsetter forbi omrisset');
{
  const m = build();
  m.concrete.freeEdges.xPos = false;
  eq('kantavstand +x uendelig', c1(m, 'xPos'), Infinity);
  eq('A_c,N uendret', A(m), 650 * 650);
  m.concrete.freeEdges.yPos = false;
  eq('bredde 1,5·c_1 hver vei, uklippet',
    frontWidth(m, 'y', -100, [[-400, 400]]), 800);
}

console.log('\nKantbruddlegemet: fast vinkel 1,5 : 1, betongen bestemmer hvor det slutter');
{
  const wedge = (h) => {
    const m = build();
    m.concrete.h = h;
    const pts = anchorPositions(m);
    const ds = pts.map(p => edgeDistances(m, p.x, p.y).xPos);
    const c = Math.min(...ds);
    const front = pts.filter((p, i) => Math.abs(ds[i] - c) < 1e-6);
    return edgeBreakout(m, 'xPos', c, front, memberThickness(m, front));
  };
  const slope = (r) => {
    const V = r.bodies[0].V;
    const zMin = Math.min(...V.map(v => v[2]));
    const xAt = Math.min(...V.filter(v => Math.abs(v[2] - zMin) < 1e-6).map(v => v[0]));
    return -zMin / (xAt - 100);
  };
  eq('h = 300: helning', slope(wedge(300)), 1.5);
  eq('h = 500: helning', slope(wedge(500)), 1.5);
  eq('h = 900: helning', slope(wedge(900)), 1.5);
  eq('h = 300: dybde ved kanten er tykkelsen', wedge(300).height, 300);
  eq('h = 900: dybde ved kanten er 1,5·c_1', wedge(900).height, 750);
  eq('h = 300: A_c,V', wedge(300).Ac, 1200 * 300);
  eq('h = 900: A_c,V', wedge(900).Ac, 1200 * 750);

  const vol = (r) => {
    const { V, F } = r.bodies[0];
    const d = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let v = 0;
    for (const [i, j, k] of F) {
      const [a, b, c] = [V[i], V[j], V[k]];
      const p = d(b, a), q = d(c, a);
      v += (a[0] * (p[1] * q[2] - p[2] * q[1])
          + a[1] * (p[2] * q[0] - p[0] * q[2])
          + a[2] * (p[0] * q[1] - p[1] * q[0])) / 6;
    }
    return v;
  };
  eq('h = 300: volum', vol(wedge(300)), 118e6);
  for (const dir of ['xNeg', 'yPos', 'yNeg']) {
    const m = build();
    const pts = anchorPositions(m);
    const ds = pts.map(p => edgeDistances(m, p.x, p.y)[dir]);
    const c = Math.min(...ds);
    const front = pts.filter((p, i) => Math.abs(ds[i] - c) < 1e-6);
    eq(`volum mot ${dir}`,
      vol(edgeBreakout(m, dir, c, front, memberThickness(m, front))), 118e6);
  }
}

console.log('\nProsjektfiler fra før plantegninga: snittene blir former i plan');
{
  const m = defaultModel();
  syncLoad(m);
  delete m.concrete.plan;
  m.concrete.Lx = 1200; m.concrete.Ly = 1200;
  m.concrete.features = [
    { id: 'f1', face: 'xPos', u: 0, v: -150, bu: 600, bv: 300, depth: -450 },
  ];
  migratePlan(m);
  eq('samme volum som snittet ga', solidVolume(m), 1200 * 1200 * 300 - 600 * 300 * 450);
  eq('samme kantavstand', c1(m, 'xPos'), 250);
}

console.log(`\n${runs - fails} av ${runs} stemmer.`);
process.exit(fails ? 1 : 0);
