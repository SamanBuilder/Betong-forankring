// ---------------------------------------------------------------------------
//  Kraftfordeling i boltegruppa.
//
//  Modell:  stiv stålplate (rigid baseplate), som i EN 1992-4 pkt. 6.2.
//    * boltene er strekkfjærer  (tar ikke trykk - trykket går via kontakt)
//    * betongen under plata er en trykk-kun kontaktflate, diskretisert i celler
//    * 3 frihetsgrader:  w (translasjon z), thx (rotasjon om x), thy (om y)
//
//  Likevekt loeses med Newton-Raphson. Fjaerkarakteristikken er stykkevis
//  lineaer, saa loesningen konvergerer typisk paa 5-15 iterasjoner.
//
//  Er plata avstivet fra betongen (standoff > 0) finnes ingen kontaktflate,
//  og boltene tar baade strekk og trykk.
// ---------------------------------------------------------------------------

import { anchorPositions, shaftArea, Ecm, mounting } from '../core/model.js';

const Es = 210000; // MPa

export function solvePlate(m) {
  const pos = anchorPositions(m);
  const As = shaftArea(m.anchors.d);
  const ka = Es * As / Math.max(m.anchors.hef, 1);     // N/mm pr. bolt
  const mnt = mounting(m);
  const contact = mnt.contact;

  // Kontaktceller
  const cells = [];
  if (contact) {
    const n = Math.max(6, m.solver.nGrid | 0);
    const dx = m.plate.bx / n, dy = m.plate.by / n, A = dx * dy;
    const kcArea = Ecm(m.concrete.fck) /
                   Math.max(m.anchors.hef * m.solver.bearingDepthFactor, 1); // N/mm pr. mm2
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        cells.push({
          x: -m.plate.bx / 2 + (i + 0.5) * dx,
          y: -m.plate.by / 2 + (j + 0.5) * dy,
          k: kcArea * A, A,
        });
      }
    }
  }

  const L = m.load;
  const target = [L.N, L.Mx, L.My];

  // u = [w, thx, thy];  forskyvning i z for punkt (x,y):  d = w + thx*y - thy*x
  const EPS = 1e-3;
  let u = [0, 0, 0];

  const state = (u) => {
    const [w, thx, thy] = u;
    const R = [0, 0, 0];
    const K = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const aF = [], cF = [];

    const add = (x, y, k, F) => {
      // Fz = F, bidrag til R og tangentstivhet
      const g = [1, y, -x];                 // dFz/du-retning  og momentarmer
      R[0] += F; R[1] += y * F; R[2] += -x * F;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) K[a][b] += g[a] * k * g[b];
    };

    // Inaktive fjaerer beholder en liten restsstivhet (EPS) slik at tangent-
    // matrisa aldri blir singulaer naar kontaktflaten skifter.
    for (const p of pos) {
      const d = w + thx * p.y - thy * p.x;
      let F = 0, k = ka * EPS;
      if (!contact) { F = ka * d; k = ka; }                      // avstivet: begge veier
      else if (d > 0) { F = ka * d; k = ka; }                    // strekk-kun
      aF.push({ ...p, delta: d, N: F });
      add(p.x, p.y, k, F);
    }
    for (const c of cells) {
      const d = w + thx * c.y - thy * c.x;
      let F = 0, k = c.k * EPS;
      if (d < 0) { F = c.k * d; k = c.k; }                       // trykk-kun (F < 0)
      cF.push({ ...c, delta: d, F });
      add(c.x, c.y, k, F);
    }
    return { R, K, aF, cF };
  };

  // Startgjett: lineaer loesning der alle fjaerer er aktive begge veier.
  {
    const K = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const addK = (x, y, k) => {
      const g = [1, y, -x];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) K[a][b] += g[a] * k * g[b];
    };
    for (const p of pos) addK(p.x, p.y, ka);
    for (const c of cells) addK(c.x, c.y, c.k);
    const u0 = solve3(K, target);
    if (u0) u = u0;
  }

  let s = state(u), iter = 0, converged = false;
  const scale = Math.max(1, Math.abs(L.N), Math.abs(L.Mx) / 100, Math.abs(L.My) / 100);

  for (; iter < 200; iter++) {
    const res = [s.R[0] - target[0], s.R[1] - target[1], s.R[2] - target[2]];
    const norm = Math.max(Math.abs(res[0]), Math.abs(res[1]) / 100, Math.abs(res[2]) / 100);
    if (norm < 1e-6 * scale) { converged = true; break; }
    const du = solve3(s.K, res.map(v => -v));
    if (!du) break;
    // dempet Newton for robusthet naar kontaktflaten endrer seg
    const relax = iter < 3 ? 1.0 : 0.9;
    u = [u[0] + relax * du[0], u[1] + relax * du[1], u[2] + relax * du[2]];
    s = state(u);
  }

  // --- Skjaerfordeling ----------------------------------------------------
  // EN 1992-4 6.2.2: er hullklaringen fylt / bolten sveist, tar alle boltene
  // skjaer. Torsjon Mz fordeles med polart treghetsmoment om boltegruppas tp.
  const nA = pos.length;
  const cx = pos.reduce((a, p) => a + p.x, 0) / nA;
  const cy = pos.reduce((a, p) => a + p.y, 0) / nA;
  const Ip = pos.reduce((a, p) => a + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0);
  const nShear = m.code.holeClearanceFilled ? nA : Math.max(1, Math.ceil(nA / 2));

  const anchors = s.aF.map((a, i) => {
    let vx = L.Vx / nShear, vy = L.Vy / nShear;
    if (Ip > 0 && L.Mz) { vx += -L.Mz * (a.y - cy) / Ip; vy += L.Mz * (a.x - cx) / Ip; }
    return {
      id: a.id, x: a.x, y: a.y,
      N: Math.max(0, a.N),            // strekk (negativ = trykk tas av betong)
      Ncomp: Math.min(0, a.N),
      Vx: vx, Vy: vy, V: Math.hypot(vx, vy),
      delta: a.delta,
    };
  });

  // --- Trykkresultant og kontakttrykk ------------------------------------
  let C = 0, Cx = 0, Cy = 0, sigMax = 0, Acontact = 0;
  for (const c of s.cF) {
    if (c.F < 0) {
      const f = -c.F;
      C += f; Cx += f * c.x; Cy += f * c.y; Acontact += c.A;
      sigMax = Math.max(sigMax, f / c.A);
    }
  }
  const compression = C > 1e-9
    ? { C, x: Cx / C, y: Cy / C, sigmaMax: sigMax, area: Acontact }
    : null;

  // --- Strekkgruppa: resultant og eksentrisitet ---------------------------
  const tens = anchors.filter(a => a.N > 1e-6);
  const Ntot = tens.reduce((a, t) => a + t.N, 0);
  let eNx = 0, eNy = 0;
  if (Ntot > 0) {
    const rx = tens.reduce((a, t) => a + t.N * t.x, 0) / Ntot;
    const ry = tens.reduce((a, t) => a + t.N * t.y, 0) / Ntot;
    const gx = tens.reduce((a, t) => a + t.x, 0) / tens.length;
    const gy = tens.reduce((a, t) => a + t.y, 0) / tens.length;
    eNx = rx - gx; eNy = ry - gy;
  }

  const Vres = Math.hypot(L.Vx, L.Vy);

  return {
    converged, iter,
    u: { w: u[0], thx: u[1], thy: u[2] },
    anchors,
    tension: { anchors: tens, Ntot, eNx: Math.abs(eNx), eNy: Math.abs(eNy) },
    shear: { Vres, Vx: L.Vx, Vy: L.Vy, nShear },
    compression,
    contact,
    mounting: mnt,
    leverArm: mnt.leverArm,
  };
}

// 3x3 loeser med delvis pivotering
function solve3(A, b) {
  const M = [[A[0][0], A[0][1], A[0][2], b[0]],
             [A[1][0], A[1][1], A[1][2], b[1]],
             [A[2][0], A[2][1], A[2][2], b[2]]];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return null;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = M[r][i] / M[i][i];
      for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}
