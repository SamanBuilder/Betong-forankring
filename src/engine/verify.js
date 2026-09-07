// Orkestrering: loes kraftfordeling, kjoer valgt regelverk, sorter resultat.
//
// Regelverket kan velges separat for tre grupper: stål/samvirkning (generelt),
// strekk mot betong (kjeglebrudd/heft), og skjær mot betong (kantbrudd/
// dybelskjær). Kontroller som bare finnes i én av bøkene - utblåsing og
// spalting (kun EN1992-4), heftforankring og trykk mot fot (kun B19) - følger
// automatisk med når den boka er valgt for sin gruppe, og har ikke noe eget
// valg. Samvirkningsformlene følger alltid det generelle regelverksvalget,
// men leter blant ALLE strekk-/skjærkontrollene mot betong uansett hvilken
// bok som produserte dem.
import { solvePlate } from './plate-solver.js';
import {
  tensionSteel, tensionPullout, tensionConcreteCone, tensionBlowout,
  tensionSplitting, shearSteel, shearPryout, shearConcreteEdge,
  partialFactors, interaction,
} from './en1992-4.js';
import {
  b19TensionSteel, b19TensionConcrete, b19FootPressure, b19ShearSteel,
  b19ShearBending, b19ShearConcrete, b19Concrete, b19Steel, b19Interaction,
} from './b19.js';
import { tensionReinforcement, shearReinforcement } from './anchor-reinforcement.js';
import { validate, bearingCheck } from './validate.js';
import { syncPlan } from '../core/model.js';

const STD_LABEL = {
  'EN1992-4': 'NS-EN 1992-4:2018',
  'B19': 'Betongelementboka bind B, kap. B19',
};
const std = s => (s === 'B19' ? 'B19' : 'EN1992-4');
const tag = (checks, s) => checks.map(c => ({ ...c, standardId: s, standard: STD_LABEL[s] }));

export function verify(m) {
  syncPlan(m);                     // L_x/L_y mot tegninga, og gamle filer over
  const issues = validate(m);
  const res = solvePlate(m);
  const gEN = partialFactors(m);

  const general = std(m.code.standard);
  const tcStd = std(m.code.tensionConcreteStandard);
  const scStd = std(m.code.shearConcreteStandard);

  const steelChecks = general === 'B19'
    ? tag([b19TensionSteel(m, res), b19ShearSteel(m, res), b19ShearBending(m, res)], 'B19')
    : tag([tensionSteel(m, res, gEN), shearSteel(m, res, gEN)], 'EN1992-4');

  let tensionConcChecks;
  if (tcStd === 'B19') {
    tensionConcChecks = tag([b19TensionConcrete(m, res), b19FootPressure(m, res)], 'B19');
  } else {
    const cone = tensionConcreteCone(m, res, gEN);
    tensionConcChecks = tag([
      tensionPullout(m, res, gEN), cone,
      tensionBlowout(m, res, gEN), tensionSplitting(m, res, gEN, cone),
    ], 'EN1992-4');
  }

  const shearConcChecks = scStd === 'B19'
    ? tag([b19ShearConcrete(m, res)], 'B19')
    : tag([shearPryout(m, res, gEN), shearConcreteEdge(m, res, gEN)], 'EN1992-4');

  const primary = [...steelChecks, ...tensionConcChecks, ...shearConcChecks];

  const interactionChecks = general === 'B19'
    ? tag(b19Interaction(m, res, primary), 'B19')
    : tag(interaction(primary), 'EN1992-4');

  let checks = [...primary, ...interactionChecks];

  // Forankringsarmering er bare implementert etter EN 1992-4 tillegg C. B19
  // dimensjonerer tilsvarende armering med stavmodell (19.3.2.6 / 19.4.3.5),
  // som ikke er lagt inn.
  if (tcStd === 'EN1992-4' && m.code.supplementaryReinf && m.reinf) {
    const extra = tag([
      ...tensionReinforcement(m, res, m.reinf),
      ...(m.reinf.nV > 0 ? shearReinforcement(m, res, m.reinf) : []),
    ], 'EN1992-4');
    // Med forankringsarmering erstattes betongkjegla av armeringskontrollen
    checks = checks.filter(c => c.id !== 'N-cone').concat(extra);
  }

  const gamma = general === 'B19'
    ? (() => {
        const cd = b19Concrete(m), st = b19Steel(m);
        return { gc: cd.gc, gM0: 1.05, gM2: 1.25, gS: 1.15, steel: st.kind };
      })()
    : gEN;

  const valid = checks.filter(c => Number.isFinite(c.util));
  const governing = valid.length
    ? valid.reduce((a, b) => (b.util > a.util ? b : a)) : null;

  return {
    model: m, res, standard: STD_LABEL[general],
    standards: {
      general, tcStd, scStd,
      generalLabel: STD_LABEL[general],
      tcLabel: STD_LABEL[tcStd],
      scLabel: STD_LABEL[scStd],
    },
    gamma,
    issues, bearing: bearingCheck(m, res),
    checks, governing,
    maxUtil: governing ? governing.util : NaN,
    ok: governing ? governing.util <= 1.0 : false,
  };
}
