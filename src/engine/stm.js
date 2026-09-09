// ---------------------------------------------------------------------------
//  Stavmodell (strut-and-tie model), NS-EN 1992-1-1 pkt. 6.5.
//
//  Generelle byggeklosser - node, trykkstav, strekkstag - uavhengig av
//  hvilken lastvei de settes sammen til, slik at flere konfigurasjoner kan
//  gjenbruke dem seinere (spesifikasjonens pkt. 5: modulen skal kunne
//  utvides). Denne fila leverer én konfigurert lastvei ("første versjon"):
//
//    endeplate/endemutter -> trykkstav -> node ved bøylas bøy -> strekk i
//    tilleggsarmeringen -> videre kraftoverføring til konstruksjonen
//    (forankringen utenfor selve STM-regionen kontrolleres for seg, se
//    supplementary-reinforcement.js).
//
//  VIKTIG - forenkling som må kontrolleres: trykkstavens/nodens bredde er
//  ikke gitt av spesifikasjonen, og settes her til to ganger overdekningen
//  som en dokumentert, konservativ antakelse - IKKE en verdi hentet fra
//  standarden. Se note på kontrollen.
// ---------------------------------------------------------------------------
import { Calc, n } from './calc.js';
import { clamp } from './geometry.js';

const NODE_K = { CCC: 1.0, CCT: 0.85, CTT: 0.75 };   // EN 1992-1-1 6.5.4(4), NA-anbefalte verdier

// Vinkelen mellom trykkstaven og strekkstaget den går inn i. For flat en stav
// blir strekket i staget urimelig stort, for bratt får ikke trykkfeltet
// utviklet seg - stavmodeller holdes derfor i dette intervallet, med 45° som
// mål. Geometrien til kjeglebruddbøylene dimensjoneres etter dette
// (se reinforcement-geometry.js).
export const STRUT_ANGLE = { min: 35, target: 45, max: 55 };

export const nuPrime = fck => clamp(1 - fck / 250, 0, 1);   // (6.57N)

// Trykkstav uten tverrstrekk: sigma_Rd,max = f_cd. Med antatt oppsprekking
// langs staven (det vanlige for en stav fra fot til bøyle): 0,6·ν'·f_cd.
export function strutCapacity(fcd, fck, cracked = true) {
  return cracked ? 0.6 * nuPrime(fck) * fcd : fcd;
}

export function nodeCapacity(kind, fcd, fck) {
  return (NODE_K[kind] ?? NODE_K.CTT) * nuPrime(fck) * fcd;
}

export function newNode(id, x, y, z, kind) { return { id, x, y, z, kind }; }
export function newStrut(id, from, to, force) { return { id, from, to, force }; }
export function newTie(id, from, to, force) { return { id, from, to, force }; }

// ---------------------------------------------------------------------------
//  Konfigurert lastvei: kraft fra fot/endeplate til tilleggsarmeringen.
//
//  hStrut = stavens sprang på TVERS av strekkstaget (loddrett fra fotnivå opp
//           til bøylen, kombinert med sideveis avstand ut til bøylen)
//  wTie   = stavens sprang LANGS strekkstaget (utstikket forbi bolten)
//  bStrut = antatt effektiv stavbredde (dokumentert antakelse, se fil-hode)
// ---------------------------------------------------------------------------
export function endplateToLoopSTM(m, opts) {
  const { NEd, hStrut, wTie, bStrut, dBolt, fck, fcd, cracked = true } = opts;
  const c = new Calc('EN 1992-1-1 6.5');
  c.in('N_Ed', NEd, 'N', 'Kraft pr. bøylehjørne, ført fra endeplata opp i bøylen');
  c.in('h', hStrut, 'mm', 'Trykkstav · sprang på tvers av bøylen (loddrett + sideveis)');
  c.in('w', wTie, 'mm', 'Trykkstav · sprang langs bøylen (utstikk forbi ytterste bolt)');

  const theta = Math.atan2(hStrut, wTie);
  const thetaDeg = c.step({ sym: 'θ', desc:
      'Vinkelen mellom trykkstaven og den vannrette delen av bøylen',
    formula: 'atan(h / w)', subst: `atan(${n(hStrut, 0)} / ${n(wTie, 0)})`,
    value: theta * 180 / Math.PI, unit: '°',
    note: `Holdes i ${STRUT_ANGLE.min}–${STRUT_ANGLE.max}° ved å regne utstikket ` +
          `forbi ytterste bolt; ${STRUT_ANGLE.target}° er målet.` });
  const Fc = c.step({ sym: 'F_c', desc: 'Trykkraft i staven',
    formula: 'N_Ed / sin θ', subst: `${n(NEd)} / sin(${n(thetaDeg, 1)}°)`,
    value: NEd / Math.sin(theta), unit: 'N' });
  const Ft = c.step({ sym: 'F_t', desc: 'Strekkraft i tilleggsarmeringen (fra stavmodellen)',
    formula: 'N_Ed / tan θ', subst: `${n(NEd)} / tan(${n(thetaDeg, 1)}°)`,
    value: NEd / Math.tan(theta), unit: 'N' });

  const sigmaC = strutCapacity(fcd, fck, cracked);
  c.step({ sym: 'σ_Rd,max', desc: cracked
      ? 'Trykkfeltkapasitet - oppsprekking langs staven forutsatt (vanlig for denne lastveien)'
      : 'Trykkfeltkapasitet - ingen tverrstrekk',
    formula: cracked ? '0,6 · ν´ · f_cd' : 'f_cd',
    subst: cracked ? `0,6 · ${n(nuPrime(fck))} · ${n(fcd)}` : `${n(fcd)}`,
    value: sigmaC, unit: 'N/mm²', ref: 'EN 1992-1-1 (6.56)/(6.60)' });
  const b = c.in('b_strut', bStrut, 'mm',
    'Antatt effektiv stavbredde = 2 · overdekning - IKKE en standardverdi, se note');
  const d = c.in('⌀_bolt', dBolt, 'mm', 'Bolter - stavens tverrsnitt i den andre retningen');
  const area = c.step({ sym: 'A_strut', desc: 'Antatt tverrsnitt av trykkstaven',
    formula: 'b_strut · ⌀_bolt', subst: `${n(b, 0)} · ${n(d, 0)}`,
    value: b * d, unit: 'mm²' });
  const sigmaEd = c.step({ sym: 'σ_Ed', desc: 'Trykkspenning i staven',
    formula: 'F_c / A_strut',
    subst: `${n(Fc)} / ${n(area, 0)}`, value: Fc / area, unit: 'N/mm²' });
  const utilStrut = sigmaEd / sigmaC;
  c.util({ formula: 'σ_Ed / σ_Rd,max', subst: `${n(sigmaEd)} / ${n(sigmaC)}`, value: utilStrut });

  const nodeCap = nodeCapacity('CCT', fcd, fck);

  return {
    id: 'N-sre-stm', mode: 'Stavmodell, kraftoverføring til armering',
    clause: 'EN 1992-1-1 6.5', scope: 'STM',
    NRk: NaN, NRd: NaN, NEd: NaN, util: utilStrut, calc: c,
    expr: 'σ_Ed / σ_Rd,max ≤ 1,0',
    Fc, Ft, theta: theta * 180 / Math.PI, nodeCapacity: nodeCap,
    note: 'Forenklet: stavbredden b_strut = 2 · overdekning er en dokumentert ' +
          'antakelse, ikke hentet fra spesifikasjonen eller standarden direkte. ' +
          'Kontroller mot faktisk noderegion (EN 1992-1-1 6.5.4) før bruk i prosjektering.',
  };
}
