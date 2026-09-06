// Datadrevet inndatadefinisjon. Nye parametre legges til her - ikke i HTML.
import { CONCRETE_GRADES, STUD_STEELS, STUD_SIZES } from '../core/model.js';

export const FIELDS = [
  { group: 'Regelverk', items: [
    { p: 'code.standard', l: 'Regelverk', t: 'select', o: [
      ['EN1992-4', 'NS-EN 1992-4:2018'], ['B19', 'Betongelementboka B19']] },
    { p: 'code.cracked', l: 'Opprisset betong', t: 'bool' },
    { p: 'code.gammaC', l: 'γ_c', t: 'num', step: 0.05 },
    { p: 'code.denseReinf', l: 'Tett armering (c/c < 150)', t: 'bool' },
    { p: 'code.supplementaryReinf', l: 'Forankringsarmering', t: 'bool' },
    { p: 'code.edgeReinf', l: 'Kantarmering (ψ_re,V)', t: 'select', o: [
      ['none', 'Ingen'], ['bars', 'Kantjern ⌀ ≥ 12'], ['bars+stirrups', 'Kantjern + bøyler']] },
    { p: 'code.holeClearanceFilled', l: 'Alle bolter tar skjær', t: 'bool',
      when: m => m.anchors.attachment === 'bolted',
      hint: 'Krever at hullklaringen er fylt. Sveiste bolter har ingen klaring ' +
            'og tar alltid skjær.' },
  ] },

  { group: 'Betongdel', items: [
    { p: 'concrete.grade', l: 'Fasthetsklasse', t: 'select',
      o: CONCRETE_GRADES.map(g => [g.id, `${g.id}  (f_ck = ${g.fck})`]) },
    { p: 'concrete.Lx', l: 'Lengde L_x', t: 'num', u: 'mm', step: 50 },
    { p: 'concrete.Ly', l: 'Lengde L_y', t: 'num', u: 'mm', step: 50 },
    { p: 'concrete.h', l: 'Tykkelse h', t: 'num', u: 'mm', step: 10 },
    { p: 'concrete.ex', l: 'Plate offset e_x', t: 'num', u: 'mm', step: 10 },
    { p: 'concrete.ey', l: 'Plate offset e_y', t: 'num', u: 'mm', step: 10 },
    { p: 'concrete.freeEdges.xNeg', l: 'Fri kant −x', t: 'bool' },
    { p: 'concrete.freeEdges.xPos', l: 'Fri kant +x', t: 'bool' },
    { p: 'concrete.freeEdges.yNeg', l: 'Fri kant −y', t: 'bool' },
    { p: 'concrete.freeEdges.yPos', l: 'Fri kant +y', t: 'bool' },
  ] },

  { group: 'Forankringsplate', items: [
    { p: 'plate.bx', l: 'Bredde b_x', t: 'num', u: 'mm', step: 10 },
    { p: 'plate.by', l: 'Bredde b_y', t: 'num', u: 'mm', step: 10 },
    { p: 'plate.t', l: 'Tykkelse t', t: 'num', u: 'mm', step: 1 },
    { p: 'plate.mount', l: 'Montasje', t: 'select', o: [
      ['direct', 'Direkte mot betong'],
      ['grout', 'Undergyting'],
      ['standoff', 'Avstandsmontert'],
    ] },
    { p: 'plate.tGrout', l: 'Gytetykkelse', t: 'num', u: 'mm', step: 5,
      when: m => m.plate.mount === 'grout' },
    { p: 'plate.fckGrout', l: 'Gytemasse f_ck', t: 'num', u: 'MPa', step: 5,
      when: m => m.plate.mount === 'grout',
      hint: 'Må være minst like fast som betongen, og minst 30 N/mm², for at ' +
            'undergytingen skal regnes som fast anlegg.' },
    { p: 'plate.gap', l: 'Fri avstand', t: 'num', u: 'mm', step: 5,
      when: m => m.plate.mount === 'standoff' },
  ] },

  { group: 'Bolter', items: [
    { p: 'anchors.d', l: 'Diameter', t: 'select',
      o: STUD_SIZES.map(s => [s.d, `⌀${s.d}  (hode ⌀${s.dh})`]), num: true },
    { p: 'anchors.attachment', l: 'Innfesting til plate', t: 'select', o: [
      ['welded', 'Sveist til plata'],
      ['bolted', 'Gjennomboltet (skive + mutter)'],
    ] },
    { p: 'anchors.hef', l: 'h_ef', t: 'num', u: 'mm', step: 5 },
    { p: 'anchors.dh', l: 'Hodediameter ⌀_h', t: 'num', u: 'mm', step: 1,
      hint: 'Settes fra EN ISO 13918 når du velger boltdiameter. Egen verdi ' +
            'står til du endrer diameteren igjen. Styrer uttrekkskapasiteten.' },
    { p: 'anchors.k', l: 'Hodetykkelse k', t: 'num', u: 'mm', step: 1,
      hint: 'Settes fra EN ISO 13918 når du velger boltdiameter.' },
    { p: 'anchors.steel', l: 'Stålkvalitet', t: 'select', o: STUD_STEELS.map(s => [s.id, s.id]) },
    { p: 'anchors.nx', l: 'Antall i x', t: 'num', step: 1, min: 1, auto: 'x' },
    { p: 'anchors.ny', l: 'Antall i y', t: 'num', step: 1, min: 1, auto: 'y' },
    { p: 'anchors.sx', l: 'c/c i x', t: 'num', u: 'mm', step: 10,
      hint: 'Settes automatisk når antallet endres. Egen verdi står til du ' +
            'endrer antallet igjen.' },
    { p: 'anchors.sy', l: 'c/c i y', t: 'num', u: 'mm', step: 10,
      hint: 'Settes automatisk når antallet endres. Egen verdi står til du ' +
            'endrer antallet igjen.' },
  ] },

  { group: 'Forankringsarmering', when: m => m.code.supplementaryReinf, items: [
    { p: 'reinf.ds', l: 'Diameter ⌀', t: 'num', u: 'mm', step: 2 },
    { p: 'reinf.n', l: 'Antall bein', t: 'num', step: 1 },
    { p: 'reinf.l1', l: 'Forankringslengde l₁', t: 'num', u: 'mm', step: 10 },
    { p: 'reinf.fyk', l: 'f_yk', t: 'num', u: 'MPa', step: 50 },
    { p: 'reinf.hooked', l: 'Kroket / bøyd ende', t: 'bool' },
    { p: 'reinf.goodBond', l: 'Gode heftforhold', t: 'bool' },
    { p: 'reinf.nV', l: 'Kantarmering, antall', t: 'num', step: 1 },
    { p: 'reinf.dsV', l: 'Kantarmering ⌀', t: 'num', u: 'mm', step: 2 },
  ] },

];

export const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
export function set(o, p, v) {
  const ks = p.split('.'), last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  t[last] = v;
}
