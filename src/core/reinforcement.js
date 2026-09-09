// ---------------------------------------------------------------------------
//  Tilleggsarmering rundt bolter/stenger - datastruktur, uavhengig av
//  beregningsmotor, UI og grafikk (se README-prinsippet: motoren skal ikke
//  kjenne skjermbildet, og skjermbildet skal ikke gjøre beregninger).
//
//  Basert på NS-EN 1992-4:2018 pkt. 7.2.1.2 (strekk/kjeglebrudd), 7.2.2.2
//  (skjær/kantbrudd) og 7.2.2.6 (felles krav til bøyler/løkker):
//    - ribbearmering (kamstål) - ikke glatt stål
//    - f_yk <= 600 N/mm²
//    - diameter <= 16 mm
//  Kravene begrenser diameterutvalget til en delmengde av REBAR_SIZES.
// ---------------------------------------------------------------------------
import { REBAR_SIZES } from './model.js';

export const MAX_DS = 16;
export const MAX_FYK = 600;

// Diametrene tilleggsarmering kan velges blant - ribbet stål, ⌀ <= 16 mm.
export const REINF_DIAMETERS = REBAR_SIZES.filter(d => d <= MAX_DS);

export const PURPOSES = ['tension', 'shear', 'generic'];
export const GEOMETRY_TYPES = ['ubar', 'closed', 'straight'];

export const PURPOSE_LABEL = {
  tension: 'Strekk / kjeglebrudd',
  shear: 'Skjær / kantbrudd',
  generic: 'Bøyle direkte rundt bolten',
};
export const GEOMETRY_LABEL = {
  ubar: 'U-bøyle', closed: 'Lukket bøyle', straight: 'Rett stang',
};

// Kjeglebruddarmering MÅ ha bøyen i toppen: det er den som tar imot trykket
// fra trykkstaven mellom endeplata og bøylehjørnet. Rett stang finnes derfor
// ikke for strekk.
export const GEOMETRY_FOR = {
  tension: ['ubar', 'closed'],
  shear: ['ubar', 'closed', 'straight'],
  generic: ['ubar', 'closed', 'straight'],
};

// Bøylene ligger symmetrisk om bolten - minst én på hver side.
export const MIN_BARS_PER_ROW = 2;
export const barsPerRow = r => Math.max(MIN_BARS_PER_ROW, 2 * Math.round(r.count / 2));

// Hvilket betongbrudd gruppa er ment å erstatte, jf. spesifikasjonens pkt. 8:
// bare kjegle- og kantbrudd kan erstattes - pry-out og øvrige kontrolleres
// alltid, uansett tilleggsarmering. Avledet av purpose, ikke lagret - da kan
// den ikke komme i utakt om purpose endres etter at gruppa er opprettet.
const BRUDDFORM_FOR = { tension: 'cone', shear: 'edge', generic: null };
export const bruddformFor = r => BRUDDFORM_FOR[r.purpose] ?? null;

// Minste effektive forankringslengde i bruddlegemet, pkt. 2/3:
//   >= 4·⌀  for bøyle/krok/løkke
//   >= 10·⌀ for rett armering
export function minAnchorageFactor(geometryType) {
  return geometryType === 'straight' ? 10 : 4;
}

// Mandreldiameter for bøyd armering, NS-EN 1992-1-1 tab. 8.1N. Kravet
// ⌀ <= 16 mm her gjør at bare øverste rad i tabellen (⌀ <= 16 -> 4⌀) er
// aktuell i praksis; 7⌀ tas med for regnestykkets skyld om grensa noen gang
// heves.
export function mandrelDiameter(ds) {
  return ds <= 16 ? 4 * ds : 7 * ds;
}

export function newReinforcement(id, purpose = 'tension', over = {}) {
  return {
    id,
    purpose,                          // 'tension' | 'shear' | 'generic'
    geometryType: 'ubar',             // 'ubar' | 'closed' | 'straight'
    ds: 12,
    count: 2,                         // bøyler pr. boltrad, symmetrisk om raden
    direction: 0,                     // bøylenes retning i planet, grader om z
    fyk: 500,
    anchorIds: 'all',                 // 'all' eller liste med bolt-id-er
    placement: 'auto',                // 'auto' | 'manual'
    clearance: 10,                    // innvendig avstand til bolt, §4
    cover: 30,                        // overdekning til bøylen
    height: null,                     // bein-lengde; null = autogenerert
    width: null,                      // avstand mellom beina; null = autogenerert
    lapToExisting: { present: false, lapLength: 0 },   // §2/§7
    ...over,
  };
}

export function nextReinforcementId(m) {
  const list = m.reinforcements || [];
  const num = Math.max(0, ...list.map(r => parseInt(String(r.id).replace(/\D/g, ''), 10) || 0));
  return `r${num + 1}`;
}

// Kravene i pkt. 2/3/7.2.2.6 som avgjør om gruppa i det hele tatt er
// tilleggsarmering etter denne modellen (ellers: se §7 - egen mekanisme, ikke
// implementert her).
export function requirementIssues(r) {
  const issues = [];
  if (!(r.ds > 0 && r.ds <= MAX_DS))
    issues.push(`⌀ ${r.ds} mm > ${MAX_DS} mm (maks. tillatt for tilleggsarmering, pkt. 7.2.2.6).`);
  if (!(r.fyk > 0 && r.fyk <= MAX_FYK))
    issues.push(`f_yk ${r.fyk} N/mm² > ${MAX_FYK} N/mm² (maks. tillatt for tilleggsarmering, pkt. 7.2.2.6).`);
  if (!(r.count > 0))
    issues.push('Antall er 0.');
  return issues;
}

export const reinforcementsFor = (m, purpose) =>
  (m.reinforcements || []).filter(r => r.purpose === purpose);

// ---------------------------------------------------------------------------
//  Migrering fra den gamle, flate `m.reinf`-forma (én global strekk- og
//  skjærgruppe, satt sammen i ui/app.js før denne datastrukturen fantes).
//  Idempotent, som migratePlan(): gjør ingenting når fila allerede har
//  m.reinforcements.
// ---------------------------------------------------------------------------
const GEOMETRY_ALIAS = { loop: 'ubar', stirrup: 'closed' };

export function migrateReinforcements(m) {
  if (!Array.isArray(m.reinforcements)) {
    const out = [];
    const old = m.reinf;
    if (old && old.n > 0) {
      out.push(newReinforcement('r1', 'tension', {
        geometryType: old.hooked ? 'ubar' : 'straight',
        ds: old.ds, count: old.n, fyk: old.fyk,
      }));
    }
    if (old && old.nV > 0) {
      out.push(newReinforcement('r2', 'shear', {
        geometryType: 'closed',
        ds: old.dsV, count: old.nV, fyk: old.fykV ?? old.fyk,
        placement: 'manual',
      }));
    }
    m.reinforcements = out;
    delete m.reinf;
  }
  // Eldre navn på utforminga, og kombinasjoner som ikke finnes for formålet.
  for (const r of m.reinforcements) {
    r.geometryType = GEOMETRY_ALIAS[r.geometryType] ?? r.geometryType;
    const allowed = GEOMETRY_FOR[r.purpose] || GEOMETRY_TYPES;
    if (!allowed.includes(r.geometryType)) r.geometryType = allowed[0];
  }
  return m;
}
