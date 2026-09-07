// ---------------------------------------------------------------------------
//  Betongdelen som et legeme, ikke bare en kloss.
//
//  Grunnformen er fortsatt L_x x L_y x h. Oppaa den ligger en liste med
//  «snitt»: et rektangel tegnet i en av de seks flatene og dratt ut eller inn.
//  Dratt ut legger betong til (konsoll, fortanning, forsterkning), dratt inn
//  tar betong bort (utsparing, spor, avtrapping). Det er samme prinsipp som
//  pull/push i SpaceClaim.
//
//  Uttrekket maales alltid fra GRUNNFORMENS flate, ikke fra der betongen
//  tilfeldigvis slutter naa. Da er hvert maal absolutt og leses av tegninga
//  uten aa kjenne de andre formene - men det betyr ogsaa at et tillegg alltid
//  legger seg utenpaa klossen og aldri kan fylle igjen en utsparing: tillegg
//  gaar utover, utsparinger innover, og de to moetes ikke.
//
//  Alle formene er akseparallelle kasser. Da kan legemet beskrives EKSAKT med
//  koordinatkompresjon: hver kasse deler opp x-, y- og z-aksen, og hver celle
//  i rutenettet som oppstaar er enten helt full eller helt tom. Ingen
//  triangulering og ingen toleranser - og alt beregninga trenger av geometri
//  kan leses rett ut av rutenettet:
//
//    planMask()          hvilke soeyler som har betong gjennom en dybde
//    maskArea()          bruddareal A_c,N klippet mot den virkelige formen
//    edgeDistancesAt()   kantavstand ved aa gaa utover til betongen slutter
//    thicknessAt()       lokal tykkelse under en bolt
//    solidBoxes()        legemet som faa kasser, til 3D-visninga
//    boundaryEdges()     bare de ekte kantene, ikke sømmene i rutenettet
//
//  Koordinatene er platas system, som resten av motoren: (0,0) = platesenter,
//  z = 0 i overkant av grunnformen, negativ nedover. Snittene angis i
//  betongdelens eget system (0,0 = delas senter), saa de staar stille naar
//  plata flyttes med e_x / e_y.
// ---------------------------------------------------------------------------

const R6 = v => Math.round(v * 1e6) / 1e6;
const TOL = 1e-6;

// ---------------------------------------------------------------------------
//  Flatene.  Hver flate har et eget 2D-system (u, v) som snittet tegnes i, og
//  en utoverrettet normal som uttrekket foelger.
//
//    xNeg/xPos   u = y i betongdelen,  v = z (0 i overkant, negativ nedover)
//    yNeg/yPos   u = x,                v = z
//    top/bottom  u = x,                v = y
//
//  `n` er utovernormalen i platas system. Positiv uttrekksdybde foelger den,
//  negativ gaar motsatt vei og tar betong bort.
// ---------------------------------------------------------------------------
export const FACE_INFO = {
  xNeg:   { axis: 'x', sign: -1, n: [-1, 0, 0], uAxis: 'y', vAxis: 'z' },
  xPos:   { axis: 'x', sign: +1, n: [+1, 0, 0], uAxis: 'y', vAxis: 'z' },
  yNeg:   { axis: 'y', sign: -1, n: [0, -1, 0], uAxis: 'x', vAxis: 'z' },
  yPos:   { axis: 'y', sign: +1, n: [0, +1, 0], uAxis: 'x', vAxis: 'z' },
  top:    { axis: 'z', sign: +1, n: [0, 0, +1], uAxis: 'x', vAxis: 'y' },
  bottom: { axis: 'z', sign: -1, n: [0, 0, -1], uAxis: 'x', vAxis: 'y' },
};

export const FACES = Object.keys(FACE_INFO);

export const FACE_LABEL = {
  xNeg: 'Sideflate −x', xPos: 'Sideflate +x',
  yNeg: 'Sideflate −y', yPos: 'Sideflate +y',
  top: 'Overflata', bottom: 'Underflata',
};

// Grunnformen i platas system.  Samme tall som memberLimits() gir, men uten
// uendelighetene: her er det den fysiske klossen som gjelder.
export function baseBox(m) {
  const c = m.concrete;
  return { x0: R6(-(c.Lx / 2 + c.ex)), x1: R6(c.Lx / 2 - c.ex),
           y0: R6(-(c.Ly / 2 + c.ey)), y1: R6(c.Ly / 2 - c.ey),
           z0: R6(-c.h), z1: 0, add: true };
}

// Flatas eget rektangel, uttrykt i (u, v).  Snittet klippes mot dette, slik at
// betong som legges til alltid henger fast i flata den er tegnet paa.
export function faceRect(m, face) {
  const c = m.concrete, f = FACE_INFO[face];
  if (!f) return null;
  if (f.axis === 'z') return { u0: -c.Lx / 2, u1: c.Lx / 2, v0: -c.Ly / 2, v1: c.Ly / 2 };
  const w = f.axis === 'x' ? c.Ly : c.Lx;
  return { u0: -w / 2, u1: w / 2, v0: -c.h, v1: 0 };
}

// Flateplanet i platas system: koordinaten langs flatas akse.
export function facePlane(m, face) {
  const b = baseBox(m), f = FACE_INFO[face];
  if (!f) return 0;
  if (f.axis === 'x') return f.sign > 0 ? b.x1 : b.x0;
  if (f.axis === 'y') return f.sign > 0 ? b.y1 : b.y0;
  return f.sign > 0 ? b.z1 : b.z0;
}

// ---------------------------------------------------------------------------
//  Snittet som kasse i platas system.
//
//  Rektangelet klippes mot flata det er tegnet i - ellers kunne et uttrekk
//  legge betong som ikke henger sammen med noe. Uttrekket gaar fra flateplanet
//  og `depth` millimeter langs normalen: positivt utover (mer betong),
//  negativt innover (utsparing).
// ---------------------------------------------------------------------------
export function featureBox(m, ft) {
  const f = FACE_INFO[ft.face];
  if (!f) return null;
  const c = m.concrete;
  const d = +ft.depth || 0;
  if (Math.abs(d) < TOL) return null;

  const rect = faceRect(m, ft.face);
  const bu = Math.max(0, +ft.bu || 0), bv = Math.max(0, +ft.bv || 0);
  const u0 = Math.max(rect.u0, (+ft.u || 0) - bu / 2);
  const u1 = Math.min(rect.u1, (+ft.u || 0) + bu / 2);
  const v0 = Math.max(rect.v0, (+ft.v || 0) - bv / 2);
  const v1 = Math.min(rect.v1, (+ft.v || 0) + bv / 2);
  if (!(u1 > u0 + TOL) || !(v1 > v0 + TOL)) return null;

  const plane = facePlane(m, ft.face);
  const a0 = Math.min(plane, plane + f.sign * d);
  const a1 = Math.max(plane, plane + f.sign * d);
  const add = d > 0;

  // (u, v) er i betongdelens system; platas system er forskjoevet med e.
  if (f.axis === 'x')
    return { x0: R6(a0), x1: R6(a1), y0: R6(u0 - c.ey), y1: R6(u1 - c.ey),
             z0: R6(v0), z1: R6(v1), add };
  if (f.axis === 'y')
    return { x0: R6(u0 - c.ex), x1: R6(u1 - c.ex), y0: R6(a0), y1: R6(a1),
             z0: R6(v0), z1: R6(v1), add };
  return { x0: R6(u0 - c.ex), x1: R6(u1 - c.ex), y0: R6(v0 - c.ey), y1: R6(v1 - c.ey),
           z0: R6(a0), z1: R6(a1), add };
}

export const features = m => (m.concrete && m.concrete.features) || [];

// ---------------------------------------------------------------------------
//  Rutenettet.
// ---------------------------------------------------------------------------
function axisCuts(boxes, k0, k1) {
  const s = new Set();
  for (const b of boxes) { s.add(b[k0]); s.add(b[k1]); }
  return [...s].sort((a, b) => a - b);
}

function buildSolid(m) {
  const base = baseBox(m);
  const boxes = [base];
  for (const ft of features(m)) {
    const b = featureBox(m, ft);
    if (b) boxes.push(b);
  }
  const xs = axisCuts(boxes, 'x0', 'x1');
  const ys = axisCuts(boxes, 'y0', 'y1');
  const zs = axisCuts(boxes, 'z0', 'z1');
  const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
  const occ = new Uint8Array(Math.max(0, nx * ny * nz));

  // Grunnformen foerst, saa hvert snitt i rekkefoelge. Med uttrekk maalt fra
  // grunnformens flater overlapper aldri to snitt, saa rekkefoelgen betyr
  // ingenting i praksis - men den gjoer resultatet entydig uansett.
  for (const b of boxes) {
    const i0 = xs.indexOf(b.x0), i1 = xs.indexOf(b.x1);
    const j0 = ys.indexOf(b.y0), j1 = ys.indexOf(b.y1);
    const k0 = zs.indexOf(b.z0), k1 = zs.indexOf(b.z1);
    const val = b.add ? 1 : 0;
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++)
          occ[(k * ny + j) * nx + i] = val;
  }
  return { xs, ys, zs, nx, ny, nz, occ, base,
           at: (i, j, k) => occ[(k * ny + j) * nx + i] };
}

// Legemet bygges om bare naar betonggeometrien faktisk endrer seg. Motoren
// spoer om kantavstander mange ganger pr. beregning, saa dette teller.
let CACHE = { key: null, S: null, masks: null };

function solidKey(m) {
  const c = m.concrete;
  return JSON.stringify([c.Lx, c.Ly, c.h, c.ex, c.ey, c.freeEdges,
    features(m).map(f => [f.face, f.u, f.v, f.bu, f.bv, f.depth])]);
}

export function solid(m) {
  const key = solidKey(m);
  if (CACHE.key !== key) CACHE = { key, S: buildSolid(m), masks: new Map() };
  return CACHE.S;
}

// Cellen et punkt ligger i. -1 naar punktet er utenfor rutenettet.
function cellOf(arr, v) {
  if (v < arr[0] - TOL || v > arr[arr.length - 1] + TOL) return -1;
  let lo = 0, hi = arr.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (v >= arr[mid] - TOL) lo = mid; else hi = mid - 1; }
  return lo;
}

// ---------------------------------------------------------------------------
//  Planmaske: soeylene som har betong gjennom HELE dybdeintervallet [z0, z1].
//
//  Det er den maska bruddflatene skal klippes mot. En kjegle som paa veien opp
//  passerer et hull har ingen betong aa rive ut der, saa soeyla teller ikke -
//  konservativt, og eksakt naar formen er hel.
// ---------------------------------------------------------------------------
export function planMask(m, z0, z1) {
  const S = solid(m);
  const zb = Math.max(Math.min(z0, z1), S.zs[0]);
  const zt = Math.min(Math.max(z0, z1), S.zs[S.nz]);
  const key = `${R6(zb)}:${R6(zt)}`;
  if (CACHE.masks.has(key)) return CACHE.masks.get(key);

  const ks = [];
  for (let k = 0; k < S.nz; k++)
    if (S.zs[k + 1] > zb + TOL && S.zs[k] < zt - TOL) ks.push(k);

  const cells = new Uint8Array(S.nx * S.ny);
  if (ks.length) {
    for (let j = 0; j < S.ny; j++)
      for (let i = 0; i < S.nx; i++)
        cells[j * S.nx + i] = ks.every(k => S.at(i, j, k)) ? 1 : 0;
  }
  // Sider som ikke er frie: der fortsetter konstruksjonen, saa bruddflata skal
  // ikke stoppe ved grunnklossens ytterplan. Utenfor klossen paa en slik side
  // regnes betongen som hel - det er den samme forutsetninga som de gamle
  // uendelige kantene i memberLimits().
  const b = S.base, fe = m.concrete.freeEdges, BIG = 1e9;
  const ext = { x0: fe.xNeg ? b.x0 : -BIG, x1: fe.xPos ? b.x1 : BIG,
                y0: fe.yNeg ? b.y0 : -BIG, y1: fe.yPos ? b.y1 : BIG };
  const inBase = (x, y) => x > b.x0 - TOL && x < b.x1 + TOL &&
                           y > b.y0 - TOL && y < b.y1 + TOL;
  const inExt = (x, y) => x > ext.x0 && x < ext.x1 && y > ext.y0 && y < ext.y1;

  const mask = { xs: S.xs, ys: S.ys, nx: S.nx, ny: S.ny, cells, base: b, ext,
                 at: (i, j) => cells[j * S.nx + i],
                 has: (x, y) => {
                   const i = cellOf(S.xs, x), j = cellOf(S.ys, y);
                   if (i >= 0 && j >= 0 && cells[j * S.nx + i]) return true;
                   return inExt(x, y) && !inBase(x, y);
                 } };
  CACHE.masks.set(key, mask);
  return mask;
}

// ---------------------------------------------------------------------------
//  Betongoverflata under plata.
//
//  Er det skaaret en grop der plata staar, er det gropas bunn forankringene
//  gaar ned fra: h_ef maales fra den betongoverflata som faktisk finnes, ikke
//  fra et plan som er skaaret vekk. Ligger det en pute under plata, hever den
//  referansen tilsvarende.  Maalt i platesenter - det er der plata ligger an.
// ---------------------------------------------------------------------------
export function surfaceZ(m) {
  const S = solid(m);
  const i = cellOf(S.xs, 0), j = cellOf(S.ys, 0);
  if (i < 0 || j < 0) return 0;
  for (let k = S.nz - 1; k >= 0; k--) if (S.at(i, j, k)) return S.zs[k + 1];
  return 0;
}

// Dybdeintervallet en forankring staar i: fra underkant fot og opp til
// betongoverflata. Det er der betongen maa vaere hel for at kjegla skal ha noe
// aa rive i.
export function anchorDepth(m) {
  const z = surfaceZ(m);
  return [z - Math.abs(m.anchors.hef), z];
}

// ---------------------------------------------------------------------------
//  Areal av (union av rektangler) klippet mot maska.
//  Erstatter clippedSquares(): kanten er ikke lenger fire tall, men formen.
// ---------------------------------------------------------------------------
export function maskArea(mask, rects) {
  const rs = rects.filter(r => r.x1 > r.x0 + TOL && r.y1 > r.y0 + TOL);
  if (!rs.length) return 0;
  const xs = grid(mask.xs, rs.flatMap(r => [r.x0, r.x1]));
  const ys = grid(mask.ys, rs.flatMap(r => [r.y0, r.y1]));
  let A = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2, dx = xs[i + 1] - xs[i];
    for (let j = 0; j < ys.length - 1; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (!mask.has(cx, cy)) continue;
      if (rs.some(r => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1))
        A += dx * (ys[j + 1] - ys[j]);
    }
  }
  return A;
}

// Maskas egne snitt pluss rektanglenes. Ingen klipping: rektangler som stikker
// utenfor rutenettet kan ligge paa en side som ikke er fri, og der teller
// betongen med (se planMask).
function grid(base, extra) {
  const s = new Set(base);
  for (const v of extra) s.add(R6(v));
  return [...s].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
//  Betongens utstrekning tvers paa en linje.
//
//  Kantbruddflata er like brei som betongen tillater. Med en utsparing i kanten
//  er ikke det lenger «fra sidekant til sidekant», men de intervallene der det
//  faktisk staar betong i boltradens plan.
//    axis  aksen intervallene maales langs ('x' eller 'y')
//    at    posisjonen paa den andre aksen
// ---------------------------------------------------------------------------
export function spansAlong(mask, axis, at) {
  const alongX = axis === 'x';
  const other = alongX ? mask.ys : mask.xs;
  const idx = cellOf(other, at);
  if (idx < 0) return [];
  const cuts = alongX ? mask.xs : mask.ys;
  const nA = (alongX ? mask.nx : mask.ny);
  const solidAt = a => alongX ? mask.at(a, idx) : mask.at(idx, a);
  const out = [];
  let run = null;
  for (let a = 0; a < nA; a++) {
    if (solidAt(a)) { if (!run) run = [cuts[a], cuts[a + 1]]; else run[1] = cuts[a + 1]; }
    else if (run) { out.push(run); run = null; }
  }
  if (run) out.push(run);
  if (!out.length) return out;
  // Sider som ikke er frie fortsetter - der stopper ikke bruddflata i
  // grunnklossens ytterplan.
  const lo = alongX ? mask.ext.x0 : mask.ext.y0;
  const hi = alongX ? mask.ext.x1 : mask.ext.y1;
  const b0 = alongX ? mask.base.x0 : mask.base.y0;
  const b1 = alongX ? mask.base.x1 : mask.base.y1;
  if (out[0][0] <= b0 + TOL) out[0][0] = Math.min(out[0][0], lo);
  const last = out[out.length - 1];
  if (last[1] >= b1 - TOL) last[1] = Math.max(last[1], hi);
  return out;
}

// Snitt av to intervallsett. Overlappende par gir overlappende resultater -
// vil du ha dem slaatt sammen til en flate uten hull, kjoer resultatet
// gjennom mergeSpans().
export function intersectSpans(a, b) {
  const out = [];
  for (const p of a) for (const q of b) {
    const lo = Math.max(p[0], q[0]), hi = Math.min(p[1], q[1]);
    if (hi > lo + TOL) out.push([lo, hi]);
  }
  return out;
}

// Slaar sammen overlappende/tilstoetende intervaller til den korteste lista
// som daekker det samme. Brukes der resultatet skal tegnes som geometri (ett
// legeme, ikke flere overlappende) - unionLength() gir bare summen, ikke
// intervallene selv.
export function mergeSpans(ivs) {
  const s = ivs.filter(i => i[1] > i[0] + TOL).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + TOL) last[1] = Math.max(last[1], iv[1]);
    else out.push([...iv]);
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Kantavstand: gaa utover fra bolten til betongen slutter.
//
//  For den rette klossen gir dette noeyaktig de samme tallene som foer. Med et
//  snitt i kanten gir det avstanden til den virkelige kanten - en utsparing
//  foran bolten flytter kanten naermere, en konsoll flytter den lengre ut.
//
//  Sider som ikke er frie regnes uendelige: der fortsetter konstruksjonen.
// ---------------------------------------------------------------------------
export function edgeDistancesAt(m, x, y, z0, z1) {
  const S = solid(m), mask = planMask(m, z0, z1), fe = m.concrete.freeEdges;
  const b = S.base;
  const i0 = cellOf(S.xs, x), j0 = cellOf(S.ys, y);
  const out = { xNeg: 0, xPos: 0, yNeg: 0, yPos: 0 };
  if (i0 < 0 || j0 < 0 || !mask.at(i0, j0)) return out;

  const walk = (dir) => {
    const alongX = dir[0] === 'x';
    const pos = dir.endsWith('Pos');
    const cuts = alongX ? S.xs : S.ys;
    const nA = alongX ? S.nx : S.ny;
    let a = alongX ? i0 : j0;
    while (a + (pos ? 1 : -1) >= 0 && a + (pos ? 1 : -1) < nA) {
      const nxt = a + (pos ? 1 : -1);
      if (!(alongX ? mask.at(nxt, j0) : mask.at(i0, nxt))) break;
      a = nxt;
    }
    const exit = pos ? cuts[a + 1] : cuts[a];
    // Naar betongen slutter i grunnformens ytterplan og sida ikke er fri,
    // fortsetter konstruksjonen: ingen kant aa rive ut mot.
    const limit = alongX ? (pos ? b.x1 : b.x0) : (pos ? b.y1 : b.y0);
    if (!fe[dir] && (pos ? exit >= limit - TOL : exit <= limit + TOL)) return Infinity;
    return pos ? exit - (alongX ? x : y) : (alongX ? x : y) - exit;
  };
  for (const dir of ['xNeg', 'xPos', 'yNeg', 'yPos']) out[dir] = walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
//  Lokal tykkelse i en soeyle: den sammenhengende betongen som omslutter
//  dybden zRef. En utsparing i overflata gjoer betongen tynnere akkurat der,
//  og det er den tykkelsen psi_h og utstoetingsformlene skal ha.
// ---------------------------------------------------------------------------
export function thicknessAt(m, x, y, zRef) {
  const S = solid(m);
  const i = cellOf(S.xs, x), j = cellOf(S.ys, y);
  if (i < 0 || j < 0) return 0;
  const k0 = cellOf(S.zs, zRef ?? -m.concrete.h / 2);
  if (k0 < 0 || !S.at(i, j, k0)) return 0;
  let lo = k0, hi = k0;
  while (lo - 1 >= 0 && S.at(i, j, lo - 1)) lo--;
  while (hi + 1 < S.nz && S.at(i, j, hi + 1)) hi++;
  return S.zs[hi + 1] - S.zs[lo];
}

// Minste lokale tykkelse under et sett punkter - den som styrer.
export function minThickness(m, pts) {
  const zRef = surfaceZ(m) - Math.min(Math.abs(m.anchors.hef), m.concrete.h) / 2;
  let t = Infinity;
  for (const p of pts) t = Math.min(t, thicknessAt(m, p.x, p.y, zRef));
  return Number.isFinite(t) && t > 0 ? t : m.concrete.h;
}

// Har betongdelen andre former enn grunnklossen?
export const isShaped = m => features(m).some(f => featureBox(m, f));

// ---------------------------------------------------------------------------
//  Legemet som faa kasser - til 3D-visninga.
//  Cellene slaas sammen graadig i x, saa y, saa z, saa en enkel form fortsatt
//  blir én kasse og en trappeform blir noen faa.
// ---------------------------------------------------------------------------
export function solidBoxes(m) {
  const S = solid(m);
  const used = new Uint8Array(S.occ.length);
  const at = (i, j, k) => S.at(i, j, k) && !used[(k * S.ny + j) * S.nx + i];
  const out = [];
  for (let k = 0; k < S.nz; k++)
    for (let j = 0; j < S.ny; j++)
      for (let i = 0; i < S.nx; i++) {
        if (!at(i, j, k)) continue;
        let i1 = i;
        while (i1 + 1 < S.nx && at(i1 + 1, j, k)) i1++;
        let j1 = j;
        while (j1 + 1 < S.ny && rowFree(i, i1, j1 + 1, k, k, at)) j1++;
        let k1 = k;
        while (k1 + 1 < S.nz && slabFree(i, i1, j, j1, k1 + 1, at)) k1++;
        for (let kk = k; kk <= k1; kk++)
          for (let jj = j; jj <= j1; jj++)
            for (let ii = i; ii <= i1; ii++)
              used[(kk * S.ny + jj) * S.nx + ii] = 1;
        out.push({ x0: S.xs[i], x1: S.xs[i1 + 1], y0: S.ys[j], y1: S.ys[j1 + 1],
                   z0: S.zs[k], z1: S.zs[k1 + 1] });
      }
  return out;
}

function rowFree(i0, i1, j, k0, k1, at) {
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) if (!at(i, j, k)) return false;
  return true;
}
function slabFree(i0, i1, j0, j1, k, at) {
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!at(i, j, k)) return false;
  return true;
}

// ---------------------------------------------------------------------------
//  De ekte kantene paa legemet.
//
//  Rutenettet er full av soemmer som ikke er kanter. En strek tegnes bare naar
//  flatene som moetes i den ligger i ULIKE plan - da er det et hjoerne. To
//  flater i samme plan deler bare en soem inne i en jevn flate.
// ---------------------------------------------------------------------------
export function boundaryEdges(m) {
  const S = solid(m);
  const segs = new Map();
  const add = (p, q, plane) => {
    const key = [p, q].map(v => v.map(t => R6(t)).join(',')).sort().join('|');
    let e = segs.get(key);
    if (!e) segs.set(key, e = { p, q, planes: new Set() });
    e.planes.add(plane);
  };
  const solidAt = (i, j, k) =>
    i >= 0 && j >= 0 && k >= 0 && i < S.nx && j < S.ny && k < S.nz && S.at(i, j, k);

  for (let k = 0; k < S.nz; k++)
    for (let j = 0; j < S.ny; j++)
      for (let i = 0; i < S.nx; i++) {
        if (!S.at(i, j, k)) continue;
        const x0 = S.xs[i], x1 = S.xs[i + 1];
        const y0 = S.ys[j], y1 = S.ys[j + 1];
        const z0 = S.zs[k], z1 = S.zs[k + 1];
        // x-flatene
        for (const [di, X] of [[-1, x0], [1, x1]])
          if (!solidAt(i + di, j, k)) {
            const pl = `x${R6(X)}`;
            add([X, y0, z0], [X, y1, z0], pl); add([X, y0, z1], [X, y1, z1], pl);
            add([X, y0, z0], [X, y0, z1], pl); add([X, y1, z0], [X, y1, z1], pl);
          }
        for (const [dj, Y] of [[-1, y0], [1, y1]])
          if (!solidAt(i, j + dj, k)) {
            const pl = `y${R6(Y)}`;
            add([x0, Y, z0], [x1, Y, z0], pl); add([x0, Y, z1], [x1, Y, z1], pl);
            add([x0, Y, z0], [x0, Y, z1], pl); add([x1, Y, z0], [x1, Y, z1], pl);
          }
        for (const [dk, Z] of [[-1, z0], [1, z1]])
          if (!solidAt(i, j, k + dk)) {
            const pl = `z${R6(Z)}`;
            add([x0, y0, Z], [x1, y0, Z], pl); add([x0, y1, Z], [x1, y1, Z], pl);
            add([x0, y0, Z], [x0, y1, Z], pl); add([x1, y0, Z], [x1, y1, Z], pl);
          }
      }

  const out = [];
  for (const e of segs.values()) if (e.planes.size > 1) out.push([e.p, e.q]);
  return out;
}
