// Areal av unionen av akseparallelle rektangler, via koordinatkompresjon.
// rects: [{x0,x1,y0,y1}]  -> areal (mm2).  Brukes til A_c,N og A_c,V.
export function unionRectArea(rects) {
  const rs = rects.filter(r => r.x1 > r.x0 && r.y1 > r.y0);
  if (!rs.length) return 0;
  const xs = [...new Set(rs.flatMap(r => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rs.flatMap(r => [r.y0, r.y1]))].sort((a, b) => a - b);
  let A = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (rs.some(r => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1))
        A += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return A;
}

// Union av 1D-intervaller -> samlet lengde
export function unionLength(ivs) {
  const s = ivs.filter(i => i[1] > i[0]).sort((a, b) => a[0] - b[0]);
  let L = 0, cur = null;
  for (const i of s) {
    if (!cur || i[0] > cur[1]) { if (cur) L += cur[1] - cur[0]; cur = [...i]; }
    else cur[1] = Math.max(cur[1], i[1]);
  }
  if (cur) L += cur[1] - cur[0];
  return L;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
