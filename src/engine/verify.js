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
import { tensionSupplementary, shearSupplementary } from './supplementary-reinforcement.js';
import { validate, bearingCheck } from './validate.js';
import { syncPlan } from '../core/model.js';
import { migrateReinforcements, bruddformFor, reinforcementLabel } from '../core/reinforcement.js';

const STD_LABEL = {
  'EN1992-4': 'NS-EN 1992-4:2018',
  'B19': 'Betongelementboka bind B, kap. B19',
};
const std = s => (s === 'B19' ? 'B19' : 'EN1992-4');
const tag = (checks, s) => checks.map(c => ({ ...c, standardId: s, standard: STD_LABEL[s] }));

export function verify(m) {
  syncPlan(m);                     // L_x/L_y mot tegninga, og gamle filer over
  migrateReinforcements(m);        // gamle filer med flat m.reinf -> m.reinforcements
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

  let primary = [...steelChecks, ...tensionConcChecks, ...shearConcChecks];

  // Tilleggsarmering er implementert etter NS-EN 1992-4 pkt. 7.2.1.2/
  // 7.2.2.2/7.2.2.6 og NS-EN 1992-1-1 kap. 8. B19 har ingen egne regler for
  // stål, forankring og l_bd i slik armering (19.3.2.6 viser bare til
  // stavmodell), så når B19 er valgt for strekk mot betong regnes armeringa
  // likevel etter Eurokodene - bare kjegla fra armeringsenden regnes etter
  // B19 19.3.2, som boka dekker. Skjær mot betong etter B19 (dybelskjær,
  // 19.4) har ingen tilsvarende erstatningsregel, og kontrolleres fortsatt
  // bare når EN 1992-4 er valgt for skjær.
  //
  // Kjegle-/kantbrudd erstattes (fjernes fra `primary`, og dermed fra
  // styrende kontroll og samvirkning) bare for grupper som faktisk oppfyller
  // kravene (`qualifies`) OG som er ment å erstatte akkurat den bruddformen
  // (`bruddform`). Betongkontrollen forsvinner ikke - den flyttes til
  // `replacedConcreteChecks`, så rapporten kan vise hva som er erstattet og
  // hva som fortsatt kontrolleres (pry-out erstattes aldri, jf. spesifikasjonen).
  const replacedConcreteChecks = [];
  const reinforcements = m.reinforcements || [];
  if (reinforcements.length) {
    const supplementary = [];
    for (const r of reinforcements) {
      const isTension = r.purpose === 'tension';
      const fn = isTension ? tensionSupplementary : shearSupplementary;
      if (!isTension && scStd !== 'EN1992-4') continue;
      const { checks: rc, qualifies } = fn(m, res, r, tcStd);
      supplementary.push(...rc);
      const bruddform = bruddformFor(r);
      if (qualifies && bruddform) {
        // B19 samler kjegle og heft i N-conc. Bare når kjegla styrer der er
        // det kjeglebrudd armeringa erstatter; styrer heften, gjelder den.
        const targetId = bruddform === 'edge' ? 'V-edge'
          : tcStd === 'B19' ? 'N-conc' : 'N-cone';
        const idx = primary.findIndex(c => c.id === targetId &&
          (targetId !== 'N-conc' || c.showCone));
        if (idx >= 0) {
          replacedConcreteChecks.push({ ...primary[idx],
            replacedBy: reinforcementLabel(r), group: r.id });
          primary = primary.filter(c => c.id !== targetId);
        }
      }
    }
    primary = [...primary, ...supplementary.map(c => tag([c], c.standardId || 'EN1992-4')[0])];
  }

  const interactionChecks = general === 'B19'
    ? tag(b19Interaction(m, res, primary), 'B19')
    : tag(interaction(primary), 'EN1992-4');

  const checks = [...primary, ...interactionChecks];

  const gamma = general === 'B19'
    ? (() => {
        const cd = b19Concrete(m), st = b19Steel(m);
        return { gc: cd.gc, gM0: 1.05, gM2: 1.25, gS: 1.15, steel: st.kind };
      })()
    : gEN;

  // Infinite utilization is a failed check, not a reason to omit it.
  const invalid = checks.filter(c => !Number.isFinite(c.util) && c.util !== Infinity);
  if (invalid.length)
    issues.push({ level: 'error', text: `Ugyldig beregningsresultat: ${invalid.map(c => c.mode).join(', ')}.` });
  const valid = checks.filter(c => Number.isFinite(c.util) || c.util === Infinity);
  const governing = valid.length
    ? valid.reduce((a, b) => (b.util > a.util ? b : a)) : null;
  const bearing = bearingCheck(m, res);

  return {
    model: m, res, standard: STD_LABEL[general],
    standards: {
      general, tcStd, scStd,
      generalLabel: STD_LABEL[general],
      tcLabel: STD_LABEL[tcStd],
      scLabel: STD_LABEL[scStd],
    },
    gamma,
    issues, bearing,
    checks, replacedConcreteChecks, governing,
    maxUtil: governing ? governing.util : NaN,
    ok: !!governing && governing.util <= 1.0 && res.converged &&
      !issues.some(i => i.level === 'error') && (!bearing || bearing.ok),
  };
}
