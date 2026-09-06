// ---------------------------------------------------------------------------
//  Datamodell for forbindelsen.
//  Enheter overalt:  lengde = mm,  kraft = N,  moment = Nmm,  spenning = MPa.
//  Fortegn:  +N = strekk (plata trekkes av betongen),  z = ut av betongen.
// ---------------------------------------------------------------------------

// fckCube = terningfasthet f_ck,cube, fctk = f_ctk,0,05.  Begge etter
// NS-EN 1992-1-1 tab. 3.1 (parene C20/25 ... C55/67).  B65-B85 har ingen
// standardpar; der er terningfastheten satt til f_ck + 15 og f_ctk,0,05
// regnet av 0,7 * 2,12 * ln(1 + f_cm/10) som for fasthetsklasser over C50.
// Betongelementboka B19 bruker f_ck,cube i kjegle- og kantbruddformlene, og
// f_ctk,0,05 i heftformlene.  Boka dekker selv bare B25-B55.
export const CONCRETE_GRADES = [
  { id: 'B20', fck: 20, fckCube: 25,  fctk: 1.5 },
  { id: 'B25', fck: 25, fckCube: 30,  fctk: 1.8 },
  { id: 'B30', fck: 30, fckCube: 37,  fctk: 2.0 },
  { id: 'B35', fck: 35, fckCube: 45,  fctk: 2.2 },
  { id: 'B45', fck: 45, fckCube: 55,  fctk: 2.7 },
  { id: 'B55', fck: 55, fckCube: 67,  fctk: 3.0 },
  { id: 'B65', fck: 65, fckCube: 80,  fctk: 3.1 },
  { id: 'B75', fck: 75, fckCube: 90,  fctk: 3.3 },
  { id: 'B85', fck: 85, fckCube: 100, fctk: 3.5 },
];

export const grade = id => CONCRETE_GRADES.find(g => g.id === id) || CONCRETE_GRADES[3];

// Ecm etter NS-EN 1992-1-1 tab. 3.1 (normalvekt betong)
export function Ecm(fck) { return 22000 * Math.pow((fck + 8) / 10, 0.3); }

// kind styrer hvilke formler som gjelder i Betongelementboka B19 pkt. 19.5:
//   'stud'/'struct'  konstruksjonsstål   N_Rd,s = f_sd0 * A_s,  V_Rd,s = f_sd0 * A_s / √3
//   'rebar'          kamstål B500NC      f_yd = f_yk / 1,15
//   'bolt'           skrue/gjengestang   N_Rd,s = f_sd2 * A_sp,  V_Rd,s = k_v * f_sd2 * A_sp
// kv = 0,6 for K4.6, K5.6 og K8.8;  0,5 for K4.8, K5.8, K6.8 og K10.9 (19.5).
// nEdge = kantavstanden n * ⌀ som gir øvre grense for dybelskjær, tab. B 19.4.2.
export const STUD_STEELS = [
  { id: 'SD1 (S235J2+C450)', label: 'SD1 (S235J2+C450) – sveisebolt',
    fyk: 350, fuk: 450, ductile: true,  kind: 'stud',   kv: 0.6, nEdge: 12 },
  { id: 'S235J2',            label: 'S235J2 – konstruksjonsstål',
    fyk: 235, fuk: 360, ductile: true,  kind: 'struct', kv: 0.6, nEdge: 10 },
  { id: 'S355J2',            label: 'S355J2 – konstruksjonsstål',
    fyk: 355, fuk: 490, ductile: true,  kind: 'struct', kv: 0.6, nEdge: 12 },
  { id: 'B500NC (kamstål)',  label: 'B500NC – kamstål',
    fyk: 500, fuk: 550, ductile: true,  kind: 'rebar',  kv: 0.6, nEdge: 14 },
  { id: 'K4.6',              label: 'K4.6 – skrue/gjengestang',
    fyk: 240, fuk: 400, ductile: true,  kind: 'bolt',   kv: 0.6, nEdge: 11 },
  { id: 'K4.8',              label: 'K4.8 – skrue/gjengestang',
    fyk: 320, fuk: 400, ductile: true,  kind: 'bolt',   kv: 0.5, nEdge: 11 },
  { id: 'K5.6',              label: 'K5.6 – skrue/gjengestang',
    fyk: 300, fuk: 500, ductile: true,  kind: 'bolt',   kv: 0.6, nEdge: 11 },
  { id: '8.8',               label: 'K8.8 – skrue/gjengestang',
    fyk: 640, fuk: 800, ductile: true,  kind: 'bolt',   kv: 0.6, nEdge: 16 },
  { id: '10.9',              label: 'K10.9 – skrue/gjengestang',
    fyk: 900, fuk: 1000, ductile: false, kind: 'bolt',  kv: 0.5, nEdge: 16 },
];

export const steelGrade = id => STUD_STEELS.find(s => s.id === id) || STUD_STEELS[0];

// Hodebolt-geometri, ca. EN ISO 13918 type SD.  dh = hodediameter, k = hodetykkelse.
export const STUD_SIZES = [
  { d: 10, dh: 19, k: 7 },  { d: 12, dh: 22, k: 7 },
  { d: 16, dh: 32, k: 8 },  { d: 19, dh: 32, k: 10 },
  { d: 22, dh: 35, k: 10 }, { d: 25, dh: 41, k: 12 },
];

export function studSize(d) {
  return STUD_SIZES.find(s => s.d === d) || { d, dh: 2 * d, k: 0.5 * d };
}

// Kamstål B500NC - vanlige dimensjoner.
export const REBAR_SIZES = [8, 10, 12, 16, 20, 25, 32];

// Gjengestang.  Asp = spenningsareal, dekv = ekvivalent diameter (til W_p),
// NV = nøkkelvidde på sekskantmutteren som brukes som endemutter.
// Tallene er tab. B 19.7.1 i Betongelementboka bind B kap. B19.
export const ROD_SIZES = [
  { d: 10, Asp: 58,   dekv: 8.6,  NV: 17 },
  { d: 12, Asp: 84,   dekv: 10.4, NV: 19 },
  { d: 16, Asp: 157,  dekv: 14.1, NV: 24 },
  { d: 20, Asp: 245,  dekv: 17.7, NV: 30 },
  { d: 24, Asp: 353,  dekv: 21.2, NV: 36 },
  { d: 30, Asp: 561,  dekv: 26.7, NV: 46 },
  { d: 33, Asp: 694,  dekv: 29.7, NV: 50 },
  { d: 36, Asp: 817,  dekv: 32.2, NV: 55 },
  { d: 39, Asp: 976,  dekv: 35.3, NV: 60 },
  { d: 42, Asp: 1121, dekv: 37.8, NV: 65 },
];

export function rodSize(d) {
  return ROD_SIZES.find(s => s.d === d) ||
         { d, Asp: 0.78 * shaftArea(d), dekv: 0.9 * d, NV: 1.6 * d };
}

export function shaftArea(d) { return Math.PI * d * d / 4; }

// Lastopptakende areal under hodet
export function headArea(d, dh) { return Math.PI * (dh * dh - d * d) / 4; }

// ---------------------------------------------------------------------------
//  Stanga: hvilket tverrsnitt som gjelder, og hvilke stålformler som brukes.
//
//  barType  'stud'   sveist hodebolt / sveisebolt - glatt skaft, ingen heft
//           'rebar'  kamstål B500NC                - heft langs hele stanga
//           'rod'    gjengestang                   - heft langs hele stanga,
//                                                    gjenget tverrsnitt (A_sp)
//
//  d     nominell diameter (⌀_nom) - den som brukes i dybelformlene
//  dEff  ekvivalent diameter til W_p (gjengestang: ⌀_ekv, ellers ⌀_nom)
//  As    tverrsnitt som tar strekk (gjengestang: spenningsarealet A_sp)
//  Wp    plastisk motstandsmoment ⌀_ekv³ / 6  (B19 pkt. 19.5)
//  bond  om stanga har heftforankring langs skaftet
// ---------------------------------------------------------------------------
export function shaftProps(m) {
  const a = m.anchors;
  if (a.barType === 'rod') {
    const r = rodSize(a.d);
    return { d: a.d, dEff: r.dekv, As: r.Asp, Wp: Math.pow(r.dekv, 3) / 6,
             bond: true, threaded: true, NV: r.NV };
  }
  return { d: a.d, dEff: a.d, As: shaftArea(a.d), Wp: Math.pow(a.d, 3) / 6,
           bond: a.barType === 'rebar', threaded: false };
}

// ---------------------------------------------------------------------------
//  Forankringsenden.
//
//   'nut'    endemutter / bolthode - rund for sveisebolt, sekskantet for
//            gjengestang.  ⌀_h er hodediameter (rund) eller nøkkelvidde (mutter).
//   'plate'  innstøpt plate i boltenden.  Samme virkemåte som endemutter, men
//            firkantet, og foten må være stiv: utstikket u ≤ tykkelsen t,
//            så medvirkende sidekant er begrenset til ⌀ + 2·t
//            (Betongelementboka B19 fig. B 19.18 og B 19.57).
//   'none'   uten endemutter - forankringen er ren heftforankring langs
//            kamstålet eller gjengestanga (B19 pkt. 19.3.3 og 19.3.4).
//
//  Ah = netto trykkareal mot betongen, A_fot − π/4·⌀²  (B19 fig. B 19.16).
// ---------------------------------------------------------------------------
export function anchorFoot(m) {
  const a = m.anchors, sh = shaftProps(m);
  const core = Math.PI * sh.d * sh.d / 4;
  if (a.endType === 'none')
    return { kind: 'none', hasFoot: false, Ah: 0, t: 0, shape: 'none' };

  if (a.endType === 'plate') {
    const bEff = Math.min(a.bp, sh.d + 2 * a.tp);   // u ≤ t
    return { kind: 'plate', hasFoot: true, shape: 'square',
             size: a.bp, eff: bEff, t: a.tp, limited: bEff < a.bp,
             Agross: a.bp * a.bp, Aeff: bEff * bEff, Ah: bEff * bEff - core };
  }
  if (a.barType === 'rod') {                        // sekskantet endemutter
    const A = 0.866 * a.dh * a.dh;                  // NV over nøkkelvidde
    return { kind: 'nut', hasFoot: true, shape: 'hex', size: a.dh, eff: a.dh,
             t: a.k, limited: false, Agross: A, Aeff: A, Ah: A - core };
  }
  const A = Math.PI * a.dh * a.dh / 4;              // rundt bolthode
  return { kind: 'head', hasFoot: true, shape: 'round', size: a.dh, eff: a.dh,
           t: a.k, limited: false, Agross: A, Aeff: A, Ah: A - core };
}

export function defaultModel() {
  return {
    meta: {
      prosjekt: 'Prototype - forankringsplate',
      del: 'Konsoll i vegg',
      dato: new Date().toISOString().slice(0, 10),
    },

    // ---- Regelverk -------------------------------------------------------
    code: {
      standard: 'EN1992-4',      // 'EN1992-4' | 'B19'
      cracked: true,             // opprisset betong i strekksonen
      gammaC: 1.5,               // NA: Norge
      gammaInst: 1.0,            // støpt inn -> 1.0
      denseReinf: false,         // tett armering (senteravst. < 150 mm)
      supplementaryReinf: false, // egen forankringsarmering (tillegg C)
      edgeReinf: 'none',         // 'none' | 'bars' | 'bars+stirrups'  (psi_re,V)
      holeClearanceFilled: true, // alle bolter tar skjærkraft
    },

    // ---- Betongdel -------------------------------------------------------
    concrete: {
      grade: 'B35',
      fck: 35,
      Lx: 1200,   // utstrekning i x
      Ly: 1200,   // utstrekning i y
      h: 300,     // tykkelse
      // Plassering av platas senter i betongdelens lokale system (0,0 = senter)
      ex: 0,
      ey: 0,
      // Hvilke sider som er frie kanter. Er en side ikke fri, regnes den uendelig.
      freeEdges: { xNeg: true, xPos: true, yNeg: true, yPos: true },
    },

    // ---- Stålplate -------------------------------------------------------
    plate: {
      present: true,     // false = enkeltstående bolter uten stålplate (dybler)
      bx: 300,
      by: 300,
      t: 20,
      fy: 355,
      mount: 'direct',   // 'direct' | 'grout' | 'standoff'
      tGrout: 30,        // undergytingstykkelse
      fckGrout: 50,      // gytemassens trykkfasthet
      gap: 40,           // fri avstand ved avstandsmontasje
      e: 0,              // utkraging over betongen når det ikke er plate
    },

    // ---- Forankring ------------------------------------------------------
    anchors: {
      barType: 'stud',      // 'stud' | 'rebar' | 'rod'   (se shaftProps)
      endType: 'nut',       // 'nut' | 'plate' | 'none'   (se anchorFoot)
      d: 16,
      dh: 32,               // hodediameter, eller nøkkelvidde på endemutteren
      k: 8,                 // hode-/mutterhøyde
      bp: 60,               // innstøpt plate i boltenden: sidekant
      tp: 10,               //                             tykkelse
      hef: 150,             // forankringsdybde til underkant fot; uten fot er
                            // dette heftlengden l_b langs stanga
      attachment: 'welded',   // 'welded' = sveist til plata | 'bolted' = gjennomboltet
      steel: 'SD1 (S235J2+C450)',
      fyk: 350,
      fuk: 450,
      ductile: true,
      nx: 2, ny: 2,
      sx: 200, sy: 200,     // senteravstand
    },

    // ---- Laster ----------------------------------------------------------
    // Lastkombinasjonene er selve lastobjektene. `load` peker på den aktive
    // (se syncLoad), så motoren trenger ikke vite at det finnes flere.
    combos: [
      combo('1', 'ULS 1', 'uls', { N: 40000, Vx: 25000, My: 4.0e6 }),
      combo('2', 'ULS 2', 'uls', { N: 25000, Vy: 30000, Mx: -3.0e6 }),
      combo('3', 'SLS 1', 'sls', { N: 18000, Vx: 11000, My: 1.8e6 }),
    ],
    activeCombo: '1',
    load: null,          // settes av syncLoad()

    // ---- Numerikk --------------------------------------------------------
    solver: { nGrid: 24, bearingDepthFactor: 1.0 },
  };
}

// Hvordan plata står an mot betongen.
//
//   direct    plata ligger rett på betongen - ingen momentarm i boltene
//   grout     undergyting; med tilstrekkelig fast masse regnes det som
//             direkte anlegg, ellers som fri avstand (NS-EN 1992-4 6.2.2.3)
//   standoff  plata står av fra betongen - ingen kontaktflate, og skjæret
//             virker med momentarm
//
// offset  = høyden fra betongoverflata opp til platas underside
// contact = om det finnes en trykkflate under plata
export function mounting(m) {
  const p = m.plate;
  // Uten stålplate står boltene fritt opp av betongen. Da finnes ingen
  // trykkflate, og skjæret virker med utkraginga e som momentarm - det er
  // dybeltilfellet i Betongelementboka B19 pkt. 19.4.2.
  if (!p.present)
    return { kind: 'noplate', offset: 0, contact: false, leverArm: Math.max(0, p.e) };
  if (p.mount === 'standoff')
    return { kind: 'standoff', offset: p.gap, contact: false,
             leverArm: p.gap + p.t / 2 };
  if (p.mount === 'grout') {
    // Gytemassen må være minst like fast som betongen, og minst C30.
    const ok = p.fckGrout >= 30 && p.fckGrout >= m.concrete.fck;
    return { kind: 'grout', offset: p.tGrout, contact: true, groutOk: ok,
             leverArm: ok ? 0 : p.tGrout + p.t / 2 };
  }
  return { kind: 'direct', offset: 0, contact: true, leverArm: 0 };
}

export const LIMIT_STATES = [
  ['uls', 'Bruddgrense'],
  ['sls', 'Bruksgrense'],
];

export function combo(id, name, limit, v = {}) {
  return { id, name, limit,
           N: 0, Vx: 0, Vy: 0, Mx: 0, My: 0, Mz: 0, ...v };
}

// Lar `load` peke på den aktive kombinasjonen. Da skriver alt som redigerer
// load - skjema, målpåskrifter i 3D - rett inn i kombinasjonen.
export function syncLoad(m) {
  if (!m.combos.length) m.combos.push(combo('1', 'ULS 1', 'uls'));
  let c = m.combos.find(x => x.id === m.activeCombo);
  if (!c) { c = m.combos[0]; m.activeCombo = c.id; }
  m.load = c;
  return c;
}

export function nextComboId(m) {
  return String(Math.max(0, ...m.combos.map(c => +c.id || 0)) + 1);
}

// Senteravstand som holder boltene innenfor plata med jevn deling og en
// kantavstand i [EDGE_MIN, EDGE_MAX]. Verdien rundes til hele 5 mm og klemmes
// deretter inn i det intervallet kantavstanden tillater.
export const EDGE_MIN = 30, EDGE_MAX = 50, EDGE_AIM = 40;

export function autoSpacing(b, n) {
  if (n < 2) return 0;
  const forEdge = e => (b - 2 * e) / (n - 1);
  const sMin = forEdge(EDGE_MAX);          // stor kantavstand -> liten c/c
  const sMax = forEdge(EDGE_MIN);
  let s = Math.round(forEdge(EDGE_AIM) / 5) * 5;
  s = Math.min(Math.max(s, Math.ceil(sMin / 5) * 5), Math.floor(sMax / 5) * 5);
  return Math.max(5, s);
}

// Ligger boltene utenfor plata slik den står nå?
export function boltsOutside(m) {
  const p = m.plate, a = m.anchors;
  if (!p.present) return false;
  return (a.nx - 1) * a.sx > p.bx - 2 * EDGE_MIN ||
         (a.ny - 1) * a.sy > p.by - 2 * EDGE_MIN;
}

// Boltposisjoner i platas lokale system (0,0 = platesenter)
export function anchorPositions(m) {
  const { nx, ny, sx, sy } = m.anchors;
  const out = [];
  const x0 = -(nx - 1) * sx / 2;
  const y0 = -(ny - 1) * sy / 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      out.push({ id: out.length + 1, x: x0 + i * sx, y: y0 + j * sy });
    }
  }
  return out;
}

// Kantavstander fra et punkt (x,y) i platas system til betongdelens frie kanter.
// Ikke-frie kanter returneres som Infinity.
export function edgeDistances(m, x, y) {
  const c = m.concrete;
  const X = x + c.ex, Y = y + c.ey;   // punkt i betongdelens system
  const big = Infinity;
  return {
    xNeg: c.freeEdges.xNeg ? c.Lx / 2 + X : big,
    xPos: c.freeEdges.xPos ? c.Lx / 2 - X : big,
    yNeg: c.freeEdges.yNeg ? c.Ly / 2 + Y : big,
    yPos: c.freeEdges.yPos ? c.Ly / 2 - Y : big,
  };
}

// Betongdelens ytterkanter i platas system. Ikke-frie sider regnes uendelige.
export function memberLimits(m) {
  const c = m.concrete, big = 1e9;
  return {
    x0: c.freeEdges.xNeg ? -(c.Lx / 2 + c.ex) : -big,
    x1: c.freeEdges.xPos ? (c.Lx / 2 - c.ex) : big,
    y0: c.freeEdges.yNeg ? -(c.Ly / 2 + c.ey) : -big,
    y1: c.freeEdges.yPos ? (c.Ly / 2 - c.ey) : big,
  };
}

export function minEdgeDistance(m, positions) {
  let cmin = Infinity;
  for (const p of positions) {
    const e = edgeDistances(m, p.x, p.y);
    cmin = Math.min(cmin, e.xNeg, e.xPos, e.yNeg, e.yPos);
  }
  return cmin;
}
