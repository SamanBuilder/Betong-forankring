// Orkestrering: loes kraftfordeling, kjoer valgt regelverk, sorter resultat.
import { solvePlate } from './plate-solver.js';
import { runEN1992_4 } from './en1992-4.js';
import { runB19 } from './b19.js';
import { tensionReinforcement, shearReinforcement } from './anchor-reinforcement.js';
import { validate, bearingCheck } from './validate.js';

const CODES = { 'EN1992-4': runEN1992_4, 'B19': runB19 };

export function verify(m) {
  const issues = validate(m);
  const res = solvePlate(m);
  const run = CODES[m.code.standard] || runEN1992_4;
  const out = run(m, res);

  let checks = out.checks;
  // Forankringsarmering er bare implementert etter EN 1992-4 tillegg C. B19
  // dimensjonerer tilsvarende armering med stavmodell (19.3.2.6 / 19.4.3.5),
  // som ikke er lagt inn.
  if (m.code.standard === 'EN1992-4' && m.code.supplementaryReinf && m.reinf) {
    const extra = [
      ...tensionReinforcement(m, res, m.reinf),
      ...(m.reinf.nV > 0 ? shearReinforcement(m, res, m.reinf) : []),
    ];
    // Med forankringsarmering erstattes betongkjegla av armeringskontrollen
    checks = checks.filter(c => c.id !== 'N-cone').concat(extra);
  }

  const valid = checks.filter(c => Number.isFinite(c.util));
  const governing = valid.length
    ? valid.reduce((a, b) => (b.util > a.util ? b : a)) : null;

  return {
    model: m, res, standard: out.standard, gamma: out.gamma,
    issues, bearing: bearingCheck(m, res),
    checks, governing,
    maxUtil: governing ? governing.util : NaN,
    ok: governing ? governing.util <= 1.0 : false,
  };
}
