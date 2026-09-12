// Publisher source: B19 19.3.2, pp. 250-255, figures B 19.12-19.13.
// https://betongelementboka.betong.no/betongapp/BindB/Del_3/B19/19_3_2.pdf
// Run: node --test test/b19-cone-regression.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultModel, syncPlan, anchorPositions } from '../src/core/model.js';
import { b19TensionConcrete, b19FootPressure } from '../src/engine/b19.js';

function cone({ Lx = 280, Ly = 310, ex = 20, ey = 5,
  freeEdges = { xNeg: true, xPos: true, yNeg: true, yPos: true },
  hef = 200, nx = 2, ny = 2, sx = 80, sy = 100,
  cracked = false, eNx = 0, eNy = 0, edgeReinf = 'none', endType = 'nut', up = 40 } = {}) {
  const m = defaultModel();
  Object.assign(m.concrete, { Lx, Ly, ex, ey, freeEdges, h: 1000 });
  Object.assign(m.anchors, { barType: 'stud', endType, up, hef, nx, ny, sx, sy });
  Object.assign(m.code, { cracked, gammaC: 1.5, edgeReinf });
  syncPlan(m);
  // Supply the cone branch with known tensile forces; no competing bond model.
  const anchors = anchorPositions(m).map(p => ({ ...p, N: 10000 }));
  const result = b19TensionConcrete(m, {
    anchors, tension: { anchors, Ntot: anchors.length * 10000, eNx, eNy },
  });
  assert.equal(result.showCone, true);
  return { result, step: sym => result.calc.steps.find(s => s.sym === sym)?.value };
}

function near(actual, expected) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <=
    1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

const k1 = 11.9 / 1.5 * Math.sqrt(45); // B35, table B 19.3.1.

test('Foot pressure also requires both edge bars and stirrups for the higher limit', () => {
  const m = defaultModel();
  m.code.cracked = true;
  const res = { anchors: anchorPositions(m).map(p => ({ ...p, N: 10000 })) };
  m.code.edgeReinf = 'bars+stirrups';
  const reinforced = b19FootPressure(m, res).NRd;
  for (const edgeReinf of ['none', 'bars']) {
    m.code.edgeReinf = edgeReinf;
    near(b19FootPressure(m, res).NRd, reinforced * 6 / 8.4);
  }
});

test('Example B 19.3.2: nearest-row edge distances give h_ef = 80 mm', () => {
  // a = [120, 80, 110, 100], s = [80, 100]; max(120/1.5, 100/3) = 80.
  const { result, step } = cone();
  near(step('h′_ef'), 80);
  near(step('N⁰_Rd,c'), k1 * 80 ** 1.5);
  near(step('A⁰_c,N'), 57600);
  near(step('A_c,N'), 86800);
  near(step('Ψ_s,N'), 0.9);
  near(step('Ψ_re,N'), 0.9);
  near(result.NRd, k1 * 80 ** 1.5 * (86800 / 57600) * 0.9 * 0.9);
  near(result.util, 40000 / result.NRd);
});

test('Figure B 19.13b: three nearby edges use the nearest outer rows', () => {
  const { step } = cone({
    freeEdges: { xNeg: false, xPos: true, yNeg: true, yPos: true },
  });
  near(step('h′_ef'), 110 / 1.5);
});

test('Two nearby edges do not trigger the reduced-depth rule', () => {
  const { step } = cone({
    freeEdges: { xNeg: false, xPos: false, yNeg: true, yPos: true },
  });
  assert.equal(step('h′_ef'), undefined);
  near(step('N⁰_Rd,c'), k1 * 200 ** 1.5);
});

test('19.3.2.2: spacing controls reduced depth when s_max/3 exceeds a_max/1.5', () => {
  const { step } = cone({ Lx: 340, Ly: 140, sx: 240, sy: 40, ex: 0, ey: 0 });
  near(step('h′_ef'), 80);
});

test('Example B 19.3.1: corner projection and edge reduction', () => {
  const { result, step } = cone({
    Lx: 1000, Ly: 1000, ex: -345, ey: -290,
    hef: 150, sx: 150, sy: 220,
  });
  assert.equal(step('h′_ef'), undefined);
  near(step('A⁰_c,N'), 202500);
  near(step('A_c,N'), 247975);
  near(step('Ψ_s,N'), 0.7 + 0.3 * 80 / 225);
  near(result.NRd, k1 * 150 ** 1.5 * (247975 / 202500) * (0.7 + 0.3 * 80 / 225));
});

test('19.3.2.1: isolated B35 anchor and cracked plain-concrete factor', () => {
  const options = { Lx: 2000, Ly: 2000, ex: 0, ey: 0, nx: 1, ny: 1, hef: 195 };
  const uncracked = cone(options);
  const cracked = cone({ ...options, cracked: true });
  near(uncracked.result.NRd, k1 * 195 ** 1.5);
  near(cracked.result.NRd, 0.7 * uncracked.result.NRd);
});

test('19.3.2.3: eccentricity factor also uses the reduced depth', () => {
  const { result, step } = cone({ eNx: 30, eNy: 40 });
  near(step('Ψ_ec,N'), 1 / (1 + 2 * 50 / (3 * 80)));
  near(result.NRd, cone().result.NRd / (1 + 2 * 50 / (3 * 80)));
});

test('19.3.2.1: edge bars alone do not establish the bars-and-stirrups condition', () => {
  near(cone({ cracked: true, edgeReinf: 'bars' }).result.NRd,
    cone({ cracked: true, edgeReinf: 'none' }).result.NRd);
  near(cone({ cracked: true, edgeReinf: 'bars+stirrups' }).result.NRd,
    cone({ cracked: false }).result.NRd);
});

test('Common end-plate extension receives no undocumented large-foot credit', () => {
  const options = { Lx: 2000, Ly: 2000, ex: 0, ey: 0, hef: 150 };
  near(cone({ ...options, endType: 'plate', up: 100 }).result.NRd, cone(options).result.NRd);
});
