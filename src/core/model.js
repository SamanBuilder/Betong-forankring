// ---------------------------------------------------------------------------
//  Datamodell for forbindelsen.
//  Enheter overalt:  lengde = mm,  kraft = N,  moment = Nmm,  spenning = MPa.
//  Fortegn:  +N = strekk (plata trekkes av betongen),  z = ut av betongen.
// ---------------------------------------------------------------------------

export const CONCRETE_GRADES = [
  { id: 'B20', fck: 20 }, { id: 'B25', fck: 25 }, { id: 'B30', fck: 30 },
  { id: 'B35', fck: 35 }, { id: 'B45', fck: 45 }, { id: 'B55', fck: 55 },
  { id: 'B65', fck: 65 }, { id: 'B75', fck: 75 }, { id: 'B85', fck: 85 },
];

// Ecm etter NS-EN 1992-1-1 tab. 3.1 (normalvekt betong)
export function Ecm(fck) { return 22000 * Math.pow((fck + 8) / 10, 0.3); }

export const STUD_STEELS = [
  { id: 'SD1 (S235J2+C450)', fyk: 350, fuk: 450, ductile: true },
  { id: 'S355J2',            fyk: 355, fuk: 490, ductile: true },
  { id: 'B500NC (kamstål)',  fyk: 500, fuk: 550, ductile: true },
  { id: '8.8',               fyk: 640, fuk: 800, ductile: true },
  { id: '10.9',              fyk: 900, fuk: 1000, ductile: false },
];

// Hodebolt-geometri, ca. EN ISO 13918 type SD.  dh = hodediameter, k = hodetykkelse.
export const STUD_SIZES = [
  { d: 10, dh: 19, k: 7 },  { d: 12, dh: 22, k: 7 },
  { d: 16, dh: 32, k: 8 },  { d: 19, dh: 32, k: 10 },
  { d: 22, dh: 35, k: 10 }, { d: 25, dh: 41, k: 12 },
];

export function studSize(d) {
  return STUD_SIZES.find(s => s.d === d) || { d, dh: 2 * d, k: 0.5 * d };
}

export function shaftArea(d) { return Math.PI * d * d / 4; }

// Lastopptakende areal under hodet
export function headArea(d, dh) { return Math.PI * (dh * dh - d * d) / 4; }

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
      bx: 300,
      by: 300,
      t: 20,
      fy: 355,
      mount: 'direct',   // 'direct' | 'grout' | 'standoff'
      tGrout: 30,        // undergytingstykkelse
      fckGrout: 50,      // gytemassens trykkfasthet
      gap: 40,           // fri avstand ved avstandsmontasje
    },

    // ---- Forankring ------------------------------------------------------
    anchors: {
      type: 'headed_stud',  // prototypen dekker innstøpte hodebolter
      d: 16,
      dh: 32,
      k: 8,
      hef: 150,             // effektiv forankringsdybde til underkant hode
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

export function minEdgeDistance(m, positions) {
  let cmin = Infinity;
  for (const p of positions) {
    const e = edgeDistances(m, p.x, p.y);
    cmin = Math.min(cmin, e.xNeg, e.xPos, e.yNeg, e.yPos);
  }
  return cmin;
}
