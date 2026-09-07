// ---------------------------------------------------------------------------
//  Betongdelen som legeme: grunnkloss + snitt dratt ut eller inn.
//
//    node test/solid-shapes.mjs
//
//  Testene er reint geometriske, og alle fasitene er regnet for hånd i
//  kommentaren over hver linje. Poenget er at representasjonen er EKSAKT:
//  volum, bruddareal og kantavstand skal treffe på millimeteren, ikke
//  omtrentlig - og en betongdel uten snitt skal gi nøyaktig de samme tallene
//  som den rette klossen gjorde før formene fantes.
// ---------------------------------------------------------------------------

import { defaultModel, syncLoad, edgeDistances, memberThickness,
         anchorPositions, anchorFoot } from '../src/core/model.js';
import { coneProjection, frontWidth } from '../src/engine/geometry.js';
import { solidBoxes, boundaryEdges, surfaceZ } from '../src/engine/solid.js';

let fails = 0, runs = 0;

function eq(name, got, want) {
  runs++;
  const ok = Object.is(got, want) || Math.abs(got - want) < 1e-6;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FEIL'} ${name.padEnd(50)} ` +
              `${String(got).padStart(12)} mot ${want}`);
}

// Standardmodellen: 1200 x 1200 x 300, 2x2 ⌀16 med c/c 200, h_ef 150.
// Bolt 1 ligger i (-100, -100). 1,5·h_ef = 225, så kjegla dekker
// x, y i [-325, 325] -> 650 x 650 = 422 500 mm².
function build(feats = []) {
  const m = defaultModel();
  syncLoad(m);
  m.concrete.features = feats;
  return m;
}
const A = m => coneProjection(m, anchorFoot(m), anchorPositions(m), 1.5 * m.anchors.hef);
const V = m => solidBoxes(m).reduce((a, b) =>
  a + (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0), 0);
const c1 = (m, dir) => edgeDistances(m, -100, -100)[dir];

console.log('\nRett kloss – formene skal ikke endre noe når det ikke er noen');
{
  const m = build();
  eq('volum', V(m), 1200 * 1200 * 300);
  eq('A_c,N = 650²', A(m), 650 * 650);
  eq('kantavstand +x = 600 + 100', c1(m, 'xPos'), 700);
  eq('lokal tykkelse = h', memberThickness(m, anchorPositions(m)), 300);
  eq('én kasse, tolv kanter', solidBoxes(m).length * 100 + boundaryEdges(m).length, 112);
}

console.log('\nUtsparing i +x-kanten: 600 brei, 450 inn -> ny kant i x = 150');
{
  // Kjeglerektangelet mister (325 − 150) x 600 = 105 000 mm².
  const m = build([{ id: 'f1', face: 'xPos', u: 0, v: -150, bu: 600, bv: 300, depth: -450 }]);
  eq('volum', V(m), 1200 * 1200 * 300 - 600 * 300 * 450);
  eq('A_c,N', A(m), 650 * 650 - 175 * 600);
  eq('kantavstand +x = 150 + 100', c1(m, 'xPos'), 250);
  eq('kantavstand −x uendret', c1(m, 'xNeg'), 500);
}

console.log('\nKonsoll ut av +x-kanten: 400 brei, 250 ut');
{
  const m = build([{ id: 'f1', face: 'xPos', u: 0, v: -150, bu: 400, bv: 300, depth: 250 }]);
  eq('volum', V(m), 1200 * 1200 * 300 + 400 * 300 * 250);
  eq('kantavstand +x = 850 + 100', c1(m, 'xPos'), 950);
  eq('A_c,N uendret (kjegla når ikke ut)', A(m), 650 * 650);
}

console.log('\nGjennomgående hull 200 x 200 med senter i x = 250');
{
  // Hullet dekker x i [150, 350], y i [-100, 100]. Innenfor kjegla:
  // x i [150, 325] -> 175 x 200 = 35 000 mm².
  const m = build([{ id: 'f1', face: 'top', u: 250, v: 0, bu: 200, bv: 200, depth: -300 }]);
  eq('volum', V(m), 1200 * 1200 * 300 - 200 * 200 * 300);
  eq('A_c,N', A(m), 650 * 650 - 175 * 200);
  eq('kantavstand +x stopper i hullet', c1(m, 'xPos'), 250);
}

console.log('\nGrop i overflata der plata står: 500 x 500, 80 dyp');
{
  const m = build([{ id: 'f1', face: 'top', u: 0, v: 0, bu: 500, bv: 500, depth: -80 }]);
  eq('volum', V(m), 1200 * 1200 * 300 - 500 * 500 * 80);
  eq('referanseplan flyttet til gropas bunn', surfaceZ(m), -80);
  eq('lokal tykkelse 300 − 80', memberThickness(m, anchorPositions(m)), 220);
  eq('A_c,N uendret: kjegla måles fra gropa', A(m), 650 * 650);
}

console.log('\nFortykkelse under: 600 x 600, 120 ned');
{
  const m = build([{ id: 'f1', face: 'bottom', u: 0, v: 0, bu: 600, bv: 600, depth: 120 }]);
  eq('volum', V(m), 1200 * 1200 * 300 + 600 * 600 * 120);
  eq('lokal tykkelse 300 + 120', memberThickness(m, anchorPositions(m)), 420);
  eq('referanseplanet står i ro', surfaceZ(m), 0);
}

console.log('\nFlere former: uttrekket måles fra grunnformens flate, ikke fra');
console.log('den forrige forma – tillegg går utover, utsparinger innover');
{
  const cut = { id: 'f1', face: 'xPos', u: 0, v: -150, bu: 600, bv: 300, depth: -450 };
  const add = { id: 'f2', face: 'xPos', u: 0, v: -150, bu: 600, bv: 300, depth: 450 };
  // Tillegget legger seg UTENPAA klossen (x fra 600 til 1050) og fyller ikke
  // igjen utsparinga (x fra 150 til 600). De to rører ikke hverandre.
  const m = build([cut, add]);
  eq('volum: −81e6 + 81e6, men to ulike steder',
    V(m), 1200 * 1200 * 300 - 600 * 300 * 450 + 600 * 300 * 450);
  eq('utsparinga står fortsatt', c1(m, 'xPos'), 250);
  // Snu rekkefølga: like disjunkte, samme svar.
  m.concrete.features = [add, cut];
  eq('rekkefølga betyr ingenting', c1(m, 'xPos'), 250);

  // En avtrapping bygges av to utsparinger i samme flate, ikke av trinn på
  // trinn: begge måles fra flata, den ene dypere enn den andre.
  m.concrete.features = [
    { id: 'f1', face: 'xPos', u: 0, v: -75, bu: 600, bv: 150, depth: -200 },
    { id: 'f2', face: 'xPos', u: 0, v: -37.5, bu: 600, bv: 75, depth: -400 },
  ];
  eq('avtrapping: to trinn', V(m),
    1200 * 1200 * 300 - 600 * 150 * 200 - 600 * 75 * 200);
}

console.log('\nSide som ikke er fri: betongen fortsetter forbi klossen');
{
  const m = build();
  m.concrete.freeEdges.xPos = false;
  eq('kantavstand +x uendelig', c1(m, 'xPos'), Infinity);
  eq('A_c,N uendret', A(m), 650 * 650);
  // Bruddflatas bredde langs kanten skal ikke stoppe i sidekanten heller.
  m.concrete.freeEdges.yPos = false;
  eq('bredde 1,5·c_1 hver vei, uklippet',
    frontWidth(m, 'y', -100, [[-400, 400]]), 800);
}

console.log(`\n${runs - fails} av ${runs} stemmer.`);
process.exit(fails ? 1 : 0);
