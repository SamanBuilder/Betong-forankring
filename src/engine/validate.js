// ---------------------------------------------------------------------------
//  Inndatakontroll.  Fanger geometri som ikke gir mening, og minstekrav til
//  kant-/senteravstand.  'error' stopper ikke beregningen, men resultatet skal
//  ikke brukes.
// ---------------------------------------------------------------------------

import { anchorPositions, edgeDistances, mounting, boltsOutside, EDGE_MIN,
         shaftProps, anchorFoot, grade, endsFor,
         memberThickness } from '../core/model.js';
import { planShapes, shapeZ, shapeLoop, loopArea, surfaceZ,
         SHAPE_LABEL, OP_LABEL } from './solid.js';
import { requirementIssues } from '../core/reinforcement.js';
import { groupGeometry } from './supplementary-reinforcement.js';

export function validate(m) {
  const out = [];
  const err = t => out.push({ level: 'error', text: t });
  const warn = t => out.push({ level: 'warn', text: t });

  const a = m.anchors, c = m.concrete, p = m.plate;
  const pos = anchorPositions(m);

  // --- entydig gal geometri ---------------------------------------------
  for (const q of pos) {
    const e = edgeDistances(m, q.x, q.y);
    const cmin = Math.min(e.xNeg, e.xPos, e.yNeg, e.yPos);
    if (cmin <= 0) {
      err(`Bolt ${q.id} ligger utenfor betongdelen (kantavstand ${Math.round(cmin)} mm). ` +
          `Utvid formen i plantegninga, eller flytt plata med e_x / e_y.`);
      break;
    }
  }
  // Tykkelsen som gjelder er den lokale: en utsparing i over- eller underflata
  // gjoer betongen tynnere akkurat der forankringen staar.
  const hLoc = memberThickness(m, pos);
  const hTxt = hLoc === c.h ? `h = ${c.h} mm`
    : `lokal tykkelse ${Math.round(hLoc)} mm (h = ${c.h} mm utenfor formene)`;
  if (a.hef >= hLoc) err(`h_ef = ${a.hef} mm er ikke mindre enn ${hTxt}.`);
  else if (a.hef > 0.8 * hLoc)
    warn(`h_ef = ${a.hef} mm er over 80 % av tykkelsen (${hTxt}) – kontroller ` +
         `gjennomlokking og plass til hodet.`);
  if (p.present && (p.bx > c.Lx || p.by > c.Ly))
    warn('Forankringsplata er større enn betongdelen.');
  if (a.nx * a.ny < 1) err('Minst én bolt kreves.');

  // --- formene i plantegninga -------------------------------------------
  const list = planShapes(m);
  if (!list.some(sh => sh.op !== 'cut'))
    err('Plantegninga har ingen form som legger betong. Tegn minst ett ' +
        'rektangel, en sirkel eller en lukka linjefigur.');
  list.forEach((sh, i) => {
    const nm = `Form ${i + 1} (${SHAPE_LABEL[sh.kind] || sh.kind}, ` +
               `${(OP_LABEL[sh.op] || OP_LABEL.add).toLowerCase()})`;
    const pts = shapeLoop(sh);
    if (pts.length < 3 || Math.abs(loopArea(pts)) < 1e-6) {
      warn(`${nm} har ingen utstrekning og endrer ingenting.`);
      return;
    }
    const [z0, z1] = shapeZ(m, sh);
    if (!(z1 > z0 + 1e-6))
      warn(`${nm} har ingen høyde: overkant og underkant ligger i samme nivå.`);
  });
  const zRef = surfaceZ(m);
  if (zRef < 0)
    warn(`Plata står i en utsparing: betongoverflata under plata ligger ` +
         `${Math.round(-zRef)} mm under overkant av delen. h_ef og ` +
         `bruddkjegla regnes fra den flata som faktisk finnes der.`);
  else if (zRef > 0)
    warn(`Plata står på en pute som er ${Math.round(zRef)} mm høyere enn ` +
         `overkant av delen. h_ef regnes fra puta si overflate.`);

  // --- forankringsende og stangtype -------------------------------------
  const sh = shaftProps(m), foot = anchorFoot(m);
  if (!foot.hasFoot && !sh.bond)
    err('«Uten endemutter» krever heftforankring: velg kamstål eller ' +
        'gjengestang som stangtype, eller sett på endemutter/endeplate.');

  // Det glatte skaftet utvikler ingen heft. Er hele den innstøpte lengda
  // glatt, finnes det ingen heftforankring å regne på.
  if (sh.smooth >= a.hef)
    err(`Det glatte skaftet (${a.lSmooth} mm) er like langt som den innstøpte ` +
        `lengda (${a.hef} mm) – da er det ingen gjenger i betongen.`);
  else if (!foot.hasFoot && sh.smooth > 0)
    warn(`Bare den gjengede delen gir heft: l_b = ${Math.round(sh.lBond)} mm ` +
         `av ${a.hef} mm innstøpt lengde. Det glatte skaftet på ` +
         `${Math.round(sh.smooth)} mm overfører ingen strekk til betongen.`);
  if (foot.hasFoot && foot.Ah <= 0)
    err('Forankringsfoten er ikke større enn stangtverrsnittet – ' +
        `netto trykkareal A_h = ${Math.round(foot.Ah)} mm².`);
  if (a.endType === 'plate' && !endsFor(a.barType).includes('plate'))
    err(`Felles endeplate finnes ikke for ${a.barType === 'rebar'
      ? 'kamstål' : 'denne stangtypen'} – bruk endemutter eller heftforankring.`);
  if (a.endType === 'plate' && foot.limited) {
    const pl = foot.plate;
    warn(`Endeplata er ${Math.round(pl.bx)} × ${Math.round(pl.by)} mm, men bare ` +
         `${Math.round(foot.Aeff)} mm² av den regnes som trykkflate: plata må ` +
         `være stiv, så utstikket u kan ikke være større enn tykkelsen ` +
         `t_p = ${a.tp} mm (B19 fig. B 19.18). Øk t_p, eller reduser utstikket.`);
  }

  // --- forutsetninger for skjærmodellene --------------------------------
  if (p.present && a.hef < 6 * sh.d)
    warn(`h_ef = ${a.hef} mm < 6·⌀ = ${6 * sh.d} mm. Den forenklede ` +
         `dybelformelen for stålplate (B19 pkt. 19.4.4) forutsetter minst 6·⌀.`);
  if (foot.hasFoot && a.hef < 4.5 * sh.d)
    warn(`h_ef/⌀ = ${(a.hef / sh.d).toFixed(1)} < 4,5. Da er betongutstøting ` +
         `(pry-out) en aktuell bruddform – se B19 pkt. 19.4.1.2.`);

  // --- boltgruppa må kunne ta momentet ----------------------------------
  // Uten trykkflate under plata er det bare boltene som gir rotasjonsstivhet.
  // Én bolt, eller én boltrad, kan da ikke ta moment om sin egen akse.
  if (!mounting(m).contact) {
    const L = m.load;
    if (a.ny === 1 && Math.abs(L.Mx) > 1)
      err(`M_x kan ikke tas opp: boltene ligger på én linje i x, og det er ` +
          `ingen trykkflate under plata. Legg til en boltrad i y, eller før ` +
          `momentet inn som utkraging e med skjærkraft.`);
    if (a.nx === 1 && Math.abs(L.My) > 1)
      err(`M_y kan ikke tas opp: boltene ligger på én linje i y, og det er ` +
          `ingen trykkflate under plata. Legg til en boltrad i x, eller før ` +
          `momentet inn som utkraging e med skjærkraft.`);
  }

  // --- regelverket mot forbindelsen -------------------------------------
  if (m.code.tensionConcreteStandard === 'EN1992-4' && !foot.hasFoot)
    warn('NS-EN 1992-4 dekker bare forankringer med fot. Uten endemutter ' +
         'faller strekkontrollene mot betong bort – velg Betongelementboka ' +
         'B19 for «Strekk mot betong», som har heftforankring av kamstål og ' +
         'gjengestang (pkt. 19.3.3/19.3.4).');
  if (m.code.shearConcreteStandard === 'EN1992-4' && !mounting(m).contact)
    warn('NS-EN 1992-4 har ingen formel for lokal betongknusing under en ' +
         'dybel uten trykkflate mot betongen (verken uten plate, eller med ' +
         'avstandsmontert plate) – det forutsettes dekket av produkt-' +
         'godkjenningen (ETA) for det valgte ankersystemet. Velg ' +
         'Betongelementboka B19 for «Skjær mot betong» for å få denne ' +
         'kontrollen (pkt. 19.4.2.3).');
  if (m.code.tensionConcreteStandard === 'B19' || m.code.shearConcreteStandard === 'B19') {
    const g = grade(c.grade);
    if (g.fck < 25 || g.fck > 55)
      warn(`B19 gir formler og tabeller for B25–B55. ${g.id} ligger utenfor; ` +
           `f_ck,cube = ${g.fckCube} N/mm² er ekstrapolert.`);
  }
  const reinforcements = m.reinforcements || [];
  if (m.code.tensionConcreteStandard === 'B19' &&
      reinforcements.some(r => r.purpose === 'tension'))
    warn('Tilleggsarmering regnes etter NS-EN 1992-4 pkt. 7.2.1.2. B19 ' +
         'dimensjonerer tilsvarende armering med stavmodell (pkt. 19.3.2.6 ' +
         'og 19.4.3.5) – den er ikke lagt inn, så armeringa teller ikke med her.');
  if (m.code.shearConcreteStandard === 'B19' &&
      reinforcements.some(r => r.purpose === 'shear' || r.purpose === 'generic'))
    warn('Tilleggsarmering regnes etter NS-EN 1992-4 pkt. 7.2.2.2. B19 ' +
         'dimensjonerer tilsvarende armering med stavmodell (pkt. 19.4.3.5) ' +
         '– den er ikke lagt inn, så armeringa teller ikke med her.');

  // --- minstekrav (veiledende, skal hentes fra ETA/produktdata) ----------
  const sMin = 5 * a.d, cMin = 5 * a.d;
  if (a.nx > 1 && a.sx < sMin)
    warn(`Senteravstand s_x = ${a.sx} mm < veiledende s_min = ${sMin} mm (5·⌀).`);
  if (a.ny > 1 && a.sy < sMin)
    warn(`Senteravstand s_y = ${a.sy} mm < veiledende s_min = ${cMin} mm (5·⌀).`);
  let cAbs = Infinity;
  for (const q of pos) {
    const e = edgeDistances(m, q.x, q.y);
    cAbs = Math.min(cAbs, e.xNeg, e.xPos, e.yNeg, e.yPos);
  }
  if (Number.isFinite(cAbs) && cAbs > 0 && cAbs < cMin)
    warn(`Minste kantavstand ${Math.round(cAbs)} mm < veiledende c_min = ${cMin} mm (5·⌀).`);

  if (boltsOutside(m))
    warn(`Boltene ligger nærmere platekanten enn ${EDGE_MIN} mm, eller utenfor ` +
         `plata. Endre antallet for å sette senteravstanden automatisk.`);

  // --- kontakttrykk mot betong ------------------------------------------
  const mnt = mounting(m);
  if (mnt.kind === 'noplate' && p.e > 0)
    warn(`Boltene kraker ${p.e} mm ut av betongen uten plate. Skjæret virker ` +
         `da med momentarm e + 0,75·⌀, og stålets bøyning blir fort ` +
         `begrensende (B19 pkt. 19.4.2.2).`);
  if (mnt.kind === 'standoff')
    warn(`Plata står ${p.gap} mm fra betongen – skjær regnes med momentarm ` +
         `og boltene tar også trykk.`);
  if (mnt.kind === 'grout' && !mnt.groutOk)
    warn(`Gytemassen (${p.fckGrout} N/mm²) er svakere enn betongen eller under ` +
         `30 N/mm². Undergytingen regnes da ikke som fast anlegg, og skjæret ` +
         `får momentarm gjennom gytesjiktet.`);

  // --- tilleggsarmering ---------------------------------------------------
  for (const r of reinforcements) {
    const tag = `Tilleggsarmering ${r.id}`;
    for (const issue of requirementIssues(r)) warn(`${tag}: ${issue}`);
    const G = groupGeometry(m, null, r);
    if (G.geo && G.geo.kind === 'shear-u' && !G.geo.edgeDir)
      warn(`${tag}: ingen fri kant å legge kantbruddarmeringa langs.`);
    else if (G.geo && !G.geo.fits)
      warn(`${tag}: trenger ${Math.round(G.geo.wanted)} mm ` +
           (G.geo.kind === 'shear-u'
             ? `innover fra kanten, men det er bare ${Math.round(G.geo.available)} mm ` +
               'til motsatt kant (minus overdekning).'
             : `dybde (h_ef + l_bd), men det er bare ${Math.round(G.geo.available)} mm ` +
               '(betongtykkelse − overdekning).'));
    if (G.geo && G.insideLen < G.insideMin)
      warn(`${tag}: lengde inne i bruddlegemet ${Math.round(G.insideLen)} mm er kortere enn ` +
           `kravet ${Math.round(G.insideMin)} mm.`);
    if (G.effCount < r.count)
      warn(`${tag}: bare ${G.effCount} av ${r.count} bein ligger innenfor ` +
           `0,75·${r.purpose === 'tension' ? 'h_ef' : 'c_1'} og telles med.`);
  }
  return out;
}

// Kontakttrykk mot betongens dimensjonerende trykkfasthet
export function bearingCheck(m, res) {
  if (!res.compression) return null;
  const fcd = 0.85 * m.concrete.fck / m.code.gammaC;
  return {
    sigma: res.compression.sigmaMax, fcd,
    util: res.compression.sigmaMax / fcd,
    ok: res.compression.sigmaMax <= fcd,
  };
}
