// ---------------------------------------------------------------------------
//  Betongelementboka, bind B - kapittel B19.
//
//  STATUS: ikke implementert.  Modulen viser hvordan et regelverk kobles inn i
//  motoren (samme grensesnitt som en1992-4.js), men formlene er IKKE lagt inn,
//  fordi de maa hentes ordrett fra boka. Ingen tall er gjettet.
//
//  For aa fylle den ut trengs pr. kontroll:
//    - formel med alle faktorer og gyldighetsomraade
//    - materialfaktorer boka bruker
//    - hvilke geometrigrenser som gjelder (kantavstand, senteravstand, tykkelse)
//
//  Grensesnitt en kontroll skal returnere:
//    { id, mode, clause, scope, NRk, NRd, NEd, util, terms:[[navn,verdi,enhet]], note }
// ---------------------------------------------------------------------------

import { skipped } from './calc.js';

export const B19_PLANNED_CHECKS = [
  { id: 'B19-kjegle',   mode: 'Bruddkjegle i betong',            status: 'mangler formelgrunnlag' },
  { id: 'B19-kant',     mode: 'Kantbrudd',                       status: 'mangler formelgrunnlag' },
  { id: 'B19-armering', mode: 'Forankring med armeringssløyfer', status: 'mangler formelgrunnlag' },
  { id: 'B19-sveis',    mode: 'Sveis bolt/plate',                 status: 'mangler formelgrunnlag' },
  { id: 'B19-plate',    mode: 'Bøyning i forankringsplata',      status: 'mangler formelgrunnlag' },
];

export function runB19(m, res) {
  return {
    standard: 'Betongelementboka bind B, kap. B19 (ikke implementert)',
    gamma: {},
    checks: B19_PLANNED_CHECKS.map(c => ({
      id: c.id, mode: c.mode, clause: 'B19', scope: 'gruppe',
      NRk: NaN, NRd: NaN, NEd: NaN, util: NaN,
      calc: skipped('B19', c.status),
      note: c.status,
    })),
  };
}
