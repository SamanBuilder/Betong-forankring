// Datadrevet inndatadefinisjon. Nye parametre legges til her - ikke i HTML.
//
// `o` kan vaere en fast liste, eller en funksjon av modellen naar valgene
// avhenger av noe annet - som boltdiameteren, der utvalget foelger stangtypen.
import { CONCRETE_GRADES, STUD_SIZES, REBAR_SIZES, ROD_SIZES,
         steelsFor, endsFor, soleBox } from '../core/model.js';
import { planShapes, shapeZ, SHAPE_LABEL } from '../engine/solid.js';
import { REINF_DIAMETERS, PURPOSE_LABEL, GEOMETRY_LABEL,
         GEOMETRY_FOR } from '../core/reinforcement.js';
import { groupGeometry } from '../engine/supplementary-reinforcement.js';

// Diameterne som finnes for hver stangtype.
export function barSizes(m) {
  if (m.anchors.barType === 'rod')
    return ROD_SIZES.map(s => [s.d, `M${s.d}  (A_sp ${s.Asp} mm²)`]);
  if (m.anchors.barType === 'rebar')
    return REBAR_SIZES.map(d => [d, `⌀${d}`]);
  return STUD_SIZES.map(s => [s.d, `⌀${s.d}  (hode ⌀${s.dh})`]);
}

// Navnet på forankringsenden. Hodet på en sveisebolt er påsmidd. Gjengestang
// får en mutter skrudd på gjengene. Kamstål er ikke gjenget, så mutteren må
// sveises på i stedet - eller enden bøyes til en krok.
const END_LABEL = {
  nut: m => m.anchors.barType === 'stud' ? 'Påsmidd bolthode'
       : m.anchors.barType === 'rebar' ? 'Sveist endemutter' : 'Endemutter',
  plate: () => 'Felles endeplate over hele gruppa',
  hook: () => 'Endekrok',
  none: () => 'Uten endemutter (heftforankring)',
};

export const FIELDS = [
  { group: 'Regelverk', items: [
    { p: 'code.standard', l: 'Regelverk (stål og samvirkning)', t: 'select', o: [
      ['EN1992-4', 'NS-EN 1992-4:2018'], ['B19', 'Betongelementboka B19']],
      hint: 'Styrer hvilket regelverk stålbrudd og samvirkningskontrollene ' +
            'regnes etter. De to kontrollene under lar deg i tillegg velge ' +
            'regelverk for hver av bruddformene mot betong for seg.' },
    { p: 'code.tensionConcreteStandard', l: 'Strekk mot betong', t: 'select', o: [
      ['EN1992-4', 'NS-EN 1992-4:2018 – kjeglebrudd'],
      ['B19', 'Betongelementboka B19 – kjeglebrudd/heft']],
      hint: 'NS-EN 1992-4 dekker bare forankring med fot (kjeglebrudd, ' +
            'uttrekk, utblåsing, spalting). B19 dekker i tillegg ' +
            'heftforankring uten fot (kamstål/gjengestang).' },
    { p: 'code.shearConcreteStandard', l: 'Skjær mot betong', t: 'select', o: [
      ['EN1992-4', 'NS-EN 1992-4:2018 – kantbrudd/pry-out'],
      ['B19', 'Betongelementboka B19 – dybelskjær']],
      hint: 'NS-EN 1992-4 har ingen formel for lokal betongknusing under en ' +
            'dybel uten trykkflate (uten plate, eller med avstandsmontert ' +
            'plate) – den forutsetter en produktgodkjenning (ETA). Velg B19 ' +
            'for å få dybelskjærformelen (pkt. 19.4.2.3) i det tilfellet.' },
    { p: 'code.cracked', l: 'Opprisset betong', t: 'bool' },
    { p: 'code.gammaC', l: 'γ_c', t: 'num', step: 0.05 },
    { p: 'code.denseReinf', l: 'Tett armering (c/c < 150)', t: 'bool' },
    { p: 'code.edgeReinf', l: 'Kantarmering (ψ_re,V)', t: 'select', o: [
      ['none', 'Ingen'], ['bars', 'Kantjern ⌀ ≥ 12'], ['bars+stirrups', 'Kantjern + bøyler']] },
    { p: 'code.holeClearanceFilled', l: 'Alle bolter tar skjær', t: 'bool',
      when: m => m.plate.present && m.anchors.attachment === 'bolted',
      hint: 'Krever at hullklaringen er fylt. Sveiste bolter har ingen klaring ' +
            'og tar alltid skjær.' },
  ] },

  { group: 'Betongdel', items: [
    { p: 'concrete.grade', l: 'Fasthetsklasse', t: 'select',
      o: CONCRETE_GRADES.map(g => [g.id, `${g.id}  (f_ck = ${g.fck})`]) },
    // L_x og L_y ER rektangelet saa lenge delen bare er ett rektangel. Er den
    // tegnet til noe annet, viser feltene hvor stor delen har blitt - da er
    // det plantegninga som bestemmer.
    { p: 'concrete.Lx', l: 'Lengde L_x', t: 'num', u: 'mm', step: 50,
      ro: m => !soleBox(m),
      hint: 'Delas utstrekning i x. Kan skrives i så lenge delen er ett ' +
            'rektangel; ellers leses den av plantegninga.' },
    { p: 'concrete.Ly', l: 'Lengde L_y', t: 'num', u: 'mm', step: 50,
      ro: m => !soleBox(m),
      hint: 'Delas utstrekning i y. Kan skrives i så lenge delen er ett ' +
            'rektangel; ellers leses den av plantegninga.' },
    { p: 'concrete.h', l: 'Tykkelse h', t: 'num', u: 'mm', step: 10,
      hint: 'Tykkelsen former som følger tykkelsen får. Former med egen ' +
            'over- og underkant står i ro når h endres.' },
    { p: 'concrete.ex', l: 'Plate offset e_x', t: 'num', u: 'mm', step: 10,
      hint: 'Hvor plata står i betongdelens eget system. Formene du har ' +
            'tegnet står stille når plata flyttes.' },
    { p: 'concrete.ey', l: 'Plate offset e_y', t: 'num', u: 'mm', step: 10 },
    { p: 'concrete.freeEdges.xNeg', l: 'Fri kant −x', t: 'bool' },
    { p: 'concrete.freeEdges.xPos', l: 'Fri kant +x', t: 'bool' },
    { p: 'concrete.freeEdges.yNeg', l: 'Fri kant −y', t: 'bool' },
    { p: 'concrete.freeEdges.yPos', l: 'Fri kant +y', t: 'bool' },
  ] },

  { group: 'Forankringsplate', items: [
    { p: 'plate.present', l: 'Stålplate i overflata', t: 'bool',
      hint: 'Uten plate står boltene som enkeltstående dybler. Plata holder ' +
            'betongen foran bolten på plass og gir friksjon, så B19 regner ' +
            'dybelskjæret 1,8 ganger så høyt for innstøpt plate med påsveiste ' +
            'forankringer (pkt. 19.4.4) som for dybel uten plate (19.4.2.3).' },
    { p: 'plate.e', l: 'Utkraging e', t: 'num', u: 'mm', step: 5,
      when: m => !m.plate.present,
      hint: 'Avstand fra betongoverflata opp til der skjærkrafta angriper. ' +
            'Maksimalmomentet i stanga blir M = V · (e + 0,75·⌀).' },
    { p: 'plate.bx', l: 'Bredde b_x', t: 'num', u: 'mm', step: 10,
      when: m => m.plate.present },
    { p: 'plate.by', l: 'Bredde b_y', t: 'num', u: 'mm', step: 10,
      when: m => m.plate.present },
    { p: 'plate.t', l: 'Tykkelse t', t: 'num', u: 'mm', step: 1,
      when: m => m.plate.present },
    { p: 'plate.mount', l: 'Montasje', t: 'select',
      when: m => m.plate.present, o: [
      ['direct', 'Direkte mot betong'],
      ['grout', 'Undergyting'],
      ['standoff', 'Avstandsmontert'],
    ] },
    { p: 'plate.tGrout', l: 'Gytetykkelse', t: 'num', u: 'mm', step: 5,
      when: m => m.plate.present && m.plate.mount === 'grout' },
    { p: 'plate.fckGrout', l: 'Gytemasse f_ck', t: 'num', u: 'MPa', step: 5,
      when: m => m.plate.present && m.plate.mount === 'grout',
      hint: 'Må være minst like fast som betongen, og minst 30 N/mm², for at ' +
            'undergytingen skal regnes som fast anlegg.' },
    { p: 'plate.gap', l: 'Fri avstand', t: 'num', u: 'mm', step: 5,
      when: m => m.plate.present && m.plate.mount === 'standoff' },
  ] },

  { group: 'Bolter', items: [
    // Stangtype er hovedvalget: den styrer hvilke stålkvaliteter, diametre og
    // forankringsender som i det hele tatt finnes, så listene under er alltid
    // bare det som kan leveres for typen du har valgt.
    { p: 'anchors.barType', l: 'Stangtype', t: 'select', o: [
      ['stud', 'Sveisebolt (hodebolt)'],
      ['rod', 'Gjengestang / bolt'],
      ['rebar', 'Kamstål'],
    ], auto: 'bar',
      hint: 'Gjengestang og bolt er samme sak her: gjenget skaft, ' +
            'spenningsareal A_sp og skruekvalitet. Sveisebolt har påsmidd ' +
            'hode og glatt skaft uten heft. Kamstål har heft langs kammene.' },
    { p: 'anchors.steel', l: 'Stålkvalitet', t: 'select',
      o: m => steelsFor(m.anchors.barType).map(s => [s.id, s.label || s.id]) },
    { p: 'anchors.d', l: 'Diameter', t: 'select', o: m => barSizes(m), num: true },

    // Sveiseboltens hode er påsmidd i fabrikken, så da er det ikke noe å velge.
    { p: 'anchors.endType', l: 'Forankringsende', t: 'select',
      o: m => endsFor(m.anchors.barType).map(k => [k, END_LABEL[k](m)]),
      when: m => endsFor(m.anchors.barType).length > 1, auto: 'end',
      hint: 'Med fot regnes kjeglebrudd (B19 pkt. 19.3.2). Uten fot regnes ' +
            'heftforankring (19.3.3 / 19.3.4). Har stanga både fot og heft, ' +
            'bruker B19 den modellen som gir størst kapasitet (19.3.1.2).' },
    { p: 'anchors.hef',
      l: m => m.anchors.endType === 'nut' || m.anchors.endType === 'plate'
        ? 'h_ef' : 'Innstøpt lengde',
      t: 'num', u: 'mm', step: 5,
      hint: 'Med fot: dybden ned til underkant fot. Uten fot: hele den ' +
            'innstøpte lengda. Heftlengda l_b er den delen som faktisk ' +
            'utvikler heft – for gjengestang: den gjengede delen.' },
    // Bolter er sjelden gjenget helt opp: skaftet er glatt fra hodet, og
    // gjengene begynner et stykke nede. Det flytter både heften og skjæret.
    { p: 'anchors.lSmooth', l: 'Glatt skaft', t: 'num', u: 'mm', step: 5, min: 0,
      when: m => m.anchors.barType === 'rod',
      hint: 'Lengden av det glatte skaftet ned fra betongoverflata før ' +
            'gjengene begynner. 0 = gjenget hele veien. Det glatte skaftet ' +
            'utvikler ingen heft, så heftlengda blir kortere – men det er ' +
            'grovere enn gjengene, så skjærkapasiteten øker.' },
    { p: 'anchors.dh', l: m => m.anchors.barType === 'stud'
        ? 'Hodediameter ⌀_h' : 'Nøkkelvidde NV',
      t: 'num', u: 'mm', step: 1, when: m => m.anchors.endType === 'nut',
      hint: 'Settes fra EN ISO 13918 (sveisebolt) eller mutter­tabellen ' +
            '(gjengestang/kamstål) når du velger diameter. Egen verdi står ' +
            'til du endrer diameteren igjen. Styrer trykket mot foten.' },
    { p: 'anchors.k', l: 'Høyde på fot', t: 'num', u: 'mm', step: 1,
      when: m => m.anchors.endType === 'nut',
      hint: 'Hode- eller mutterhøyde. Settes fra tabell når du velger diameter.' },

    // Den felles endeplata følger boltemønsteret, så utstikket er inndata og
    // sidekanten er avledet - da kan plata aldri bli mindre enn gruppa.
    { p: 'anchors.up', l: 'Endeplate, utstikk u_p', t: 'num', u: 'mm', step: 5,
      when: m => m.anchors.endType === 'plate',
      hint: 'Hvor langt plata stikker utenfor de ytterste boltene. Sidekanten ' +
            'følger av boltemønsteret pluss to utstikk. Plata må være stiv: ' +
            'bare ⌀ + 2·t_p rundt hver bolt regnes som trykkflate ' +
            '(B19 fig. B 19.18), men hele plata sprer bruddkjegla.' },
    { p: 'anchors.tp', l: 'Endeplate, tykkelse t_p', t: 'num', u: 'mm', step: 1,
      when: m => m.anchors.endType === 'plate' },

    // Sveisebolt er sveist per definisjon, og kamstål festes sveist til plata.
    { p: 'anchors.attachment', l: 'Innfesting til plate', t: 'select',
      when: m => m.plate.present && m.anchors.barType === 'rod', o: [
      ['welded', 'Sveist til plata'],
      ['bolted', 'Gjennomboltet (skive + mutter)'],
    ] },
    { p: 'anchors.nx', l: 'Antall i x', t: 'num', step: 1, min: 1, auto: 'x' },
    { p: 'anchors.ny', l: 'Antall i y', t: 'num', step: 1, min: 1, auto: 'y' },
    { p: 'anchors.sx', l: 'c/c i x', t: 'num', u: 'mm', step: 10,
      hint: 'Settes automatisk når antallet endres. Egen verdi står til du ' +
            'endrer antallet igjen.' },
    { p: 'anchors.sy', l: 'c/c i y', t: 'num', u: 'mm', step: 10,
      hint: 'Settes automatisk når antallet endres. Egen verdi står til du ' +
            'endrer antallet igjen.' },
  ] },

  // Innholdet er dynamisk (én gruppe pr. valgt tilleggsarmering) og bygges av
  // reinforcementFields() nedenfor, rendret i ui/app.js - samme mønster som
  // formene i plantegninga (shapeFields).
  { group: 'Tilleggsarmering', items: [] },

];

// ---------------------------------------------------------------------------
//  Feltene for én form i plantegninga.
//
//  Rektangelet har senter og to sidekanter, sirkelen senter og radius, og ei
//  linjefigur har hjoernene sine - dem redigerer du i plantegninga, ikke som
//  tall. Alle tre har det samme hoeydeintervallet.
//
//  z1/z0 vises som tall naar forma har sitt eget intervall. Foelger den
//  tykkelsen, staar avkryssingsboksen i skjemaet i stedet (se renderShapes).
// ---------------------------------------------------------------------------
export function shapeFields(m, i) {
  const sh = planShapes(m)[i];
  const P = k => `concrete.plan.${i}.${k}`;
  const out = [
    { p: P('op'), l: 'Virkning', t: 'select', o: [
      ['add', 'Legger betong'], ['cut', 'Utsparing – tar betong bort']],
      hint: 'To former som legger betong og overlapper, blir til én: det er ' +
            'unionen som teller, så de indre linjene forsvinner av seg selv.' },
  ];
  if (sh.kind === 'rect')
    out.push(
      { p: P('bx'), l: 'Bredde x', t: 'num', u: 'mm', step: 10, min: 0 },
      { p: P('by'), l: 'Bredde y', t: 'num', u: 'mm', step: 10, min: 0 },
      { p: P('x'), l: 'Senter x', t: 'num', u: 'mm', step: 10 },
      { p: P('y'), l: 'Senter y', t: 'num', u: 'mm', step: 10 });
  else if (sh.kind === 'circle')
    out.push(
      { p: P('r'), l: 'Radius', t: 'num', u: 'mm', step: 10, min: 0 },
      { p: P('x'), l: 'Senter x', t: 'num', u: 'mm', step: 10 },
      { p: P('y'), l: 'Senter y', t: 'num', u: 'mm', step: 10 });
  if (!(sh.z0 == null && sh.z1 == null)) {
    const [z0, z1] = shapeZ(m, sh);
    out.push(
      { p: P('z1'), l: 'Overkant', t: 'num', u: 'mm', step: 10, val: z1,
        hint: '0 er overkant av betongdelen, og negative tall ligger under. ' +
              'En form som stikker over 0 er en pute eller en konsoll.' },
      { p: P('z0'), l: 'Underkant', t: 'num', u: 'mm', step: 10, val: z0 });
  }
  return out;
}

// Navnet på forma i lista.
export const shapeName = (sh, i) =>
  `${i + 1} · ${SHAPE_LABEL[sh.kind] || sh.kind}`;

// ---------------------------------------------------------------------------
//  Feltene for én tilleggsarmeringsgruppe - "velg type, antall, diameter,
//  plassering" i stedet for å tegne armeringa manuelt (spesifikasjonens pkt. 9).
//  Samme per-indeks-mønster som shapeFields() over.
// ---------------------------------------------------------------------------
export function reinforcementFields(m, i) {
  const P = k => `reinforcements.${i}.${k}`;
  const r = m.reinforcements[i];
  const tension = r.purpose === 'tension';
  const out = [
    { p: P('purpose'), l: 'Type', t: 'select',
      o: Object.entries(PURPOSE_LABEL).map(([v, t]) => [v, t]) },
    { p: P('geometryType'), l: 'Utforming', t: 'select',
      o: (GEOMETRY_FOR[r.purpose] || Object.keys(GEOMETRY_LABEL))
        .map(v => [v, GEOMETRY_LABEL[v]]) },
    { p: P('count'), l: tension ? 'Bøyler pr. boltrad' : 'Antall bein',
      t: 'num', step: 2, min: 2, live: true,
      hint: tension
        ? 'Fordeles symmetrisk om boltraden, minst én bøyle på hver side, alle ' +
          'innenfor 0,75·h_ef fra bolten.' : undefined },
    { p: P('ds'), l: 'Diameter ⌀', t: 'select', num: true,
      o: REINF_DIAMETERS.map(d => [d, `⌀${d}`]) },
    { p: P('fyk'), l: 'f_yk', t: 'num', u: 'MPa', step: 50, live: true,
      hint: 'Ribbet armeringsstål, f_yk ≤ 600 N/mm² – pkt. 7.2.2.6.' },
  ];
  if (tension)
    out.push({ p: P('direction'), l: 'Retning', t: 'num', u: '°', step: 15, live: true,
      hint: 'Hvilken vei bøylene ligger, dreid om loddaksen. Boltene deles i ' +
            'rader på tvers av denne retninga, og hver rad spennes av sine ' +
            'egne bøyler.' });
  else
    out.push({ p: P('placement'), l: 'Plassering', t: 'select', o: [
      ['auto', 'Automatisk'], ['manual', 'Manuell']] });
  out.push(
    { p: P('clearance'), l: 'Innvendig avstand til bolt', t: 'num', u: 'mm', step: 5, live: true },
    { p: P('cover'), l: 'Overdekning', t: 'num', u: 'mm', step: 5, live: true,
      hint: tension
        ? 'Fra betongoverflata ned til den vannrette delen av bøylen. Styrer ' +
          'hvor langt bøylen må stikke ut forbi bolten for å få trykkstaven i 45°.'
        : 'Avstand fra betongoverflata og fra kanten til bøylen.' });
  if (!tension && r.placement === 'manual') {
    const G = groupGeometry(m, null, r);
    out.push(
      { p: P('height'), l: 'Bein-lengde', t: 'num', u: 'mm', step: 10, live: true,
        val: r.height ?? Math.round(G.geo?.legLen ?? 0),
        hint: r.purpose === 'shear'
          ? 'Hvor langt beina går innover fra bøyen.'
          : 'Hvor langt beina går nedover fra bøyen.' },
      { p: P('width'), l: 'Avstand mellom beina', t: 'num', u: 'mm', step: 10, live: true,
        val: r.width ?? Math.round(2 * (G.geo?.rOff ?? 0)) });
  }
  if (r.purpose === 'tension') {
    out.push(
      { p: P('lapToExisting.present'), l: 'Overlapp mot konstruksjonsarmering', t: 'bool' },
      { p: P('lapToExisting.lapLength'), l: 'Overlappslengde', t: 'num', u: 'mm', step: 10,
        live: true, when: () => r.lapToExisting?.present });
  }
  return out.filter(f => !f.when || f.when(m));
}

export const get = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
export function set(o, p, v) {
  const ks = p.split('.'), last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  t[last] = v;
}
