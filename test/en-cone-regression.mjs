// EN 1992-4 7.2.1.4: independent scalar examples for projected area and factors.
// https://preview.ideastatica.com/support-center/steel-connection-design-according-to-eurocode
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultModel, syncPlan, anchorPositions } from '../src/core/model.js';
import { tensionConcreteCone, partialFactors } from '../src/engine/en1992-4.js';
import { verify } from '../src/engine/verify.js';
import { validate } from '../src/engine/validate.js';
import { anchorFoot } from '../src/core/model.js';
import { coneSurfaceDepth } from '../src/engine/geometry.js';

function example(change = () => {}, tensionChange = () => {}) {
  const m = defaultModel();
  m.anchors.nx = m.anchors.ny = 1;
  change(m);
  syncPlan(m);
  const anchors = anchorPositions(m).map(a => ({ ...a, N: 10000 }));
  const tension = { anchors, Ntot: anchors.length * 10000, eNx: 0, eNy: 0 };
  tensionChange(tension);
  const result = tensionConcreteCone(m, { anchors, tension }, partialFactors(m));
  return { m, result, step: sym => result.calc.steps.find(s => s.sym === sym)?.value };
}
const near = (a, b) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < 1e-8 * Math.max(1, b), `${a} != ${b}`);
const basic = 8.9 * Math.sqrt(35) * 150 ** 1.5;

test('Cast-in anchor: cylinder strength, characteristic and design capacities', () => {
  const { result, step } = example();
  near(step('A_c,N'), 202500);
  near(result.NRk, basic);
  near(result.NRd, basic / 1.5);
  near(result.util, 10000 / (basic / 1.5));
});
test('Uncracked cast-in anchor uses k1 = 12.7', () => {
  near(example(m => m.code.cracked = false).result.NRk, basic * 12.7 / 8.9);
});
test('Four anchors: overlapping area is 650 x 650, not four full cones', () => {
  const { result, step } = example(m => m.anchors.nx = m.anchors.ny = 2);
  near(step('A_c,N'), 422500);
  near(result.NRk, basic * 422500 / 202500);
});
test('One edge 75 mm from axis: projected area and stress disturbance both apply', () => {
  const { result, step } = example(m => m.concrete.ex = 525);
  near(step('A_c,N'), 300 * 450);
  near(step('ψ_s,N'), 0.8);
  near(result.NRk, basic * (300 / 450) * 0.8);
});
test('Corner clips both directions but applies minimum-edge factor once', () => {
  const { result } = example(m => m.concrete.ex = m.concrete.ey = 525);
  near(result.NRk, basic * (300 * 300 / 202500) * 0.8);
});
test('Biaxial eccentricity uses the product of two factors, equation 7.6', () => {
  const { step } = example(m => m.anchors.nx = m.anchors.ny = 2,
    t => { t.eNx = 30; t.eNy = 40; });
  near(step('ψ_ec,N'), (1 / (1 + 60 / 450)) * (1 / (1 + 80 / 450)));
});
test('Only the tensioned row contributes to the projected cone', () => {
  const { step } = example(m => m.anchors.nx = m.anchors.ny = 2,
    t => { t.anchors = t.anchors.slice(0, 2); t.Ntot = 20000; });
  near(step('A_c,N'), 650 * 450);
});
test('Common end plate does not automatically increase EN cone area', () => {
  const normal = example(m => m.anchors.nx = m.anchors.ny = 2).result;
  for (const up of [20, 100]) {
    const { result } = example(m => {
      Object.assign(m.anchors, { nx: 2, ny: 2, endType: 'plate', up, tp: 10 });
    });
    near(result.NRk, normal.NRk);
  }
});
test('Short embedment with dense reinforcement applies shell-spalling factor', () => {
  const { step } = example(m => { m.anchors.hef = 60; m.code.denseReinf = true; });
  near(step('ψ_re,N'), 0.8);
});
test('Conservative moment assumption is explicit in the calculation record', () => {
  near(example().step('ψ_M,N'), 1);
});
test('No tension produces a skipped check', () => {
  const { result } = example(() => {}, t => { t.anchors = []; t.Ntot = 0; });
  assert.equal(result.util, 0);
  assert.equal(result.NRd, Infinity);
});
test('Zero cone area is not silently discarded from the overall verdict', () => {
  const m = defaultModel();
  m.anchors.hef = 350;
  m.load = { N: 1000, Vx: 0, Vy: 0, Mx: 0, My: 0, Mz: 0 };
  const v = verify(m);
  assert.equal(v.checks.find(c => c.id === 'N-cone').util, Infinity);
  assert.equal(v.maxUtil, Infinity);
  assert.equal(v.ok, false);
});
test('Nonconverged moment and exceeded contact pressure cannot return OK', () => {
  const m = defaultModel();
  m.plate.mount = 'standoff'; m.anchors.nx = m.anchors.ny = 1;
  m.load = { N: 0, Vx: 0, Vy: 0, Mx: 1e6, My: 0, Mz: 0 };
  assert.equal(verify(m).ok, false);
  m.plate.mount = 'direct'; m.load.Mx = 0; m.load.N = -2e6;
  const v = verify(m);
  assert.equal(v.bearing.ok, false);
  assert.equal(v.ok, false);
});
test('Effective depth ends at the head top; the entire head must fit in concrete', () => {
  const m = defaultModel();
  const foot = anchorFoot(m);
  m.anchors.hef = m.concrete.h - foot.t / 2;
  assert.ok(validate(m).some(i => i.level === 'error' && i.text.includes('Forankringsfoten')));
  m.anchors.hef = 150;
  assert.ok(!validate(m).some(i => i.text.includes('Forankringsfoten')));
  const pts = anchorPositions(m), p = pts[0];
  near(coneSurfaceDepth(m, foot, pts, 150, p.x, p.y), 150);
});
test('Shared cone surface uses bolt axes even with a common end plate', () => {
  const m = defaultModel();
  Object.assign(m.anchors, { nx: 1, ny: 1, hef: 150, endType: 'plate', up: 100 });
  const foot = anchorFoot(m), pts = anchorPositions(m), p = pts[0];
  near(coneSurfaceDepth(m, foot, pts, 150, p.x + 75, p.y), 100);
  near(coneSurfaceDepth(m, foot, pts, 150, p.x + 225, p.y), 0);
});
