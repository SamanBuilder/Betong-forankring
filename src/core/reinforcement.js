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

// Hvordan kjeglebruddbøylene fordeles på boltene:
//
//   anchor  Én bøyle (pr. side) om HVER bolt, så trangt om boltaksen som
//           bøyeradien tillater. Hvert bein ligger da like ved sin egen bolt,
//           og avstandskravet 0,75*h_ef er oppfylt for alle boltene.
//   row     Én bøyle spenner hele boltraden, med beina rett utenfor de
//           ytterste boltene i raden. Færre stenger og enklere bøyeskjema,
//           men bare hjørneboltene får et bein nær seg - bolter midt i raden
//           kan havne utenfor 0,75*h_ef, og det flagges av plasserings-
//           kontrollen.
export const TENSION_LAYOUTS = ['anchor', 'row'];
export const TENSION_LAYOUT_LABEL = {
  anchor: 'Bøyle om hver bolt',
  row: 'Bøyle over hele boltraden',
};

// ---------------------------------------------------------------------------
//  Stanga i bøyen på bøylen.
//
//  Bøyen på en U-bøyle krøller seg RUNDT en stang på tvers: stanga ligger inne
//  i bøyen, og bøylen ligger altså OVER den. Stanga tar radialtrykket fra
//  bøyen og fører strekkraften videre ut i konstruksjonen.
//
//   surface  Overflatearmeringa brukes som stang i bøyen. Da er det nettet som
//            bestemmer hvor bøylen ligger: bøylen legges rett over det laget i
//            nettet som går på TVERS av bøyleretninga, så bøyen omslutter det.
//   own      Egen stang legges i bøyen. Da er bøylen uavhengig av nettet, og
//            overflatearmeringa tegnes ikke. Stanga skal være minst like tjukk
//            som bøylen, og forankres etter NS-EN 1992-1-1 pkt. 8.4.
// ---------------------------------------------------------------------------
export const BEND_BARS = ['surface', 'own'];
export const BEND_BAR_LABEL = {
  surface: 'Overflatearmeringa i bøyen',
  own: 'Egen stang i bøyen',
};

// Egen stang i bøyen kan ikke være tynnere enn bøylen den skal bære.
export const bendBarDiameter = r => Math.max(r.ds, r.bendBarDs || 0);

// Alle tre utformingene er tillatt for kjeglebrudd, men de forankres på hver
// sin måte (NS-EN 1992-4 pkt. 7.2.1.2, jf. B19.3.2.6):
//
//   U-bøyle/løkke  bøyen i toppen skal fortrinnsvis omslutte overflate-
//                  armeringa, slik at strekkraften føres videre inn i
//                  konstruksjonens eget armeringsnett. l_1 >= 4*⌀.
//   Lukket bøyle   som U-bøyla, men lukket i begge ender.
//   Rett stang     skal IKKE omslutte overflatearmeringa. Den må i stedet ha
//                  nødvendig forankring inne i kjeglebruddsona (l_1 >= 10*⌀)
//                  og kobles til konstruksjonens armering med overlapp eller
//                  annen dokumentert lastoverføring.
export const GEOMETRY_FOR = {
  tension: ['ubar', 'closed', 'straight'],
  shear: ['ubar', 'closed', 'straight'],
  generic: ['ubar', 'closed', 'straight'],
};

// Bøylene ligger symmetrisk om bolten - minst én på hver side, og alltid et
// like antall, så halvparten havner på hver side.
export const MIN_BARS_PER_ANCHOR = 2;
export const barsPerAnchor = r =>
  Math.max(MIN_BARS_PER_ANCHOR, 2 * Math.round(r.count / 2));

// ---------------------------------------------------------------------------
//  Minste avstand mellom parallelle stenger, NS-EN 1992-1-1 pkt. 8.2(2):
//  fri avstand >= max(k_1*⌀, d_g + k_2, 20 mm), med de anbefalte k_1 = 1 og
//  k_2 = 5 mm. Dette er nedre grense når tilleggsarmeringa legges «så nær
//  bolten som praktisk mulig»: bøylene pakkes fra bolten og utover med denne
//  senteravstanden, ikke spres ut til 0,75*h_ef.
// ---------------------------------------------------------------------------
export const SPACING_K1 = 1, SPACING_K2 = 5, SPACING_ABS = 20;
export const DEFAULT_DG = 16;

export function minClearSpacing(ds, dg = DEFAULT_DG) {
  return Math.max(SPACING_K1 * ds, (dg || DEFAULT_DG) + SPACING_K2, SPACING_ABS);
}
// Senter-senter = fri avstand + én diameter.
export function minBarSpacing(ds, dg = DEFAULT_DG) {
  return minClearSpacing(ds, dg) + ds;
}

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
    count: 2,                         // bøyler pr. bolt, symmetrisk om boltaksen
    direction: 0,                     // bøylenes retning i planet, grader om z
    fyk: 500,
    anchorIds: 'all',                 // 'all' eller liste med bolt-id-er
    placement: 'auto',                // 'auto' | 'manual'
    clearance: 10,                    // innvendig avstand til bolt, §4
    coverTop: 30,                     // overdekning fra overkant betong
    coverBottom: 30,                  // overdekning fra underkant betong
    endBend: false,                   // 90° bøy ut i enden av beina (U-bøyle)
    endBendLength: null,              // fotlengde; null = det forankringa krever
    height: null,                     // bein-lengde; null = autogenerert
    width: null,                      // avstand mellom beina; null = autogenerert
    // Kjeglebruddbøyle: avstanden mellom de to beina, målt langs bøyle-
    // retninga. null = så trang bøyen tillater (2 * mandrelradius), altså
    // beina så nær bolten som praktisk mulig.
    span: null,
    // Bøyle pr. bolt, eller én bøyle som spenner hele boltraden. Se
    // TENSION_LAYOUT_LABEL og tensionLayout() i reinforcement-geometry.js.
    barLayout: 'anchor',              // 'anchor' | 'row'
    // Hva som ligger i bøyen på bøylen - se BEND_BAR_LABEL.
    bendBar: 'surface',               // 'surface' | 'own'
    bendBarDs: null,                  // egen stang: ⌀; null = samme som bøylen
    // Overflatearmeringa U-bøyla/løkka skal omslutte, jf. pkt. 7.2.1.2 /
    // B19.3.2.6. Brukes bare når bendBar = 'surface'. Nettet tegnes i 3D med
    // denne diameteren og senteravstanden, og bøylen legges så bøyen omslutter
    // det innerste laget.
    surfaceReinf: { present: true, ds: 12, cover: 30, spacing: 150 },
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
  // Rett tilleggsarmering omslutter ingenting og har ingen bøy å forankre seg
  // med utenfor kjegla - lastoverføringa til konstruksjonens armering må
  // dokumenteres særskilt (overlapp eller annen løsning).
  if (r.purpose === 'tension' && r.geometryType === 'straight' && !r.lapToExisting?.present)
    issues.push('Rett tilleggsarmering må kobles til konstruksjonens armering med ' +
      'overlapp eller annen dokumentert lastoverføring - kryss av for overlapp ' +
      'og oppgi lengden.');
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
    // Overdekning var ett tall for begge sider - delt i overkant/underkant.
    if (r.cover != null) {
      r.coverTop ??= r.cover; r.coverBottom ??= r.cover;
      delete r.cover;
    }
    // Felt som kom til etter at fila kunne vaere lagra.
    r.span ??= null;
    r.barLayout ??= 'anchor';
    r.bendBar ??= 'surface';
    r.bendBarDs ??= null;
    r.surfaceReinf ??= { present: true, ds: 12, cover: 30, spacing: 150 };
    r.surfaceReinf.spacing ??= 150;
  }
  return m;
}
