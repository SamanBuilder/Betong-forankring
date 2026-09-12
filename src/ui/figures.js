// ---------------------------------------------------------------------------
//  Figurer til utregningsarket.
//
//  Hver kontroll kan ha en målsatt prinsippfigur som viser nøyaktig de lengdene
//  som står i formlene. Figurene tegnes av modellen, ikke som faste bilder, så
//  de følger geometrien brukeren har lagt inn: endrer h_ef seg, endrer kjegla
//  seg. Alt tegnes i målestokk, og de samme lengdene heter det samme her som i
//  utregninga under.
//
//  Betongkjegla har tre visninger - snitt i x, snitt i y og plan - som brukeren
//  veksler mellom. Valget ligger i modulen, så det står fast når arket tegnes
//  om ved hver endring.
//
//  Koordinater: platas system (bolter symmetrisk om origo), x og y i mm på
//  tvers, z mm nedover med z = 0 i betongoverflata. SVG-en settes opp i piksler
//  skalert av mm, så skrift og strektykkelser holder seg like uansett hvor stor
//  modellen er.
// ---------------------------------------------------------------------------
import { anchorPositions, anchorFoot, endPlate } from '../core/model.js';
import { baseBox, solidSlabs, anchorDepth } from '../engine/solid.js';
import { tensionLayout, minInsideLength, buildBars, buildBendBars,
         buildSurfaceMesh } from '../engine/reinforcement-geometry.js';
import { minAnchorageFactor } from '../core/reinforcement.js';

const FIGURES = {
  'N-cone': coneFigure,
};

// Kontroller som gjelder én tilleggsarmeringsgruppe heter N-sre-<hva>-<id>, så
// de treffes på prefiks i stedet for på fullt navn.
const PREFIX_FIGURES = [
  [/^N-sre-(placement|steel|anchorage|lbd|cone)-/, sreFigure],
];

// Returnerer ferdig <figure>-blokk, eller tom streng når kontrollen ikke har
// noen figur enda.
export function figureFor(check, m) {
  const id = check?.id;
  if (!id) return '';
  const f = FIGURES[id] || (PREFIX_FIGURES.find(([re]) => re.test(id)) || [])[1];
  if (!f) return '';
  try { bindTabs(); return f(m, check); } catch { return ''; }
}

// === faner ================================================================
// Arket bygges med innerHTML ved hver endring, så knappene er nye hver gang.
// Én delegert lytter overlever det, og valget ligger i modulen.
// Ett valg pr. figurtype: kjeglefigurens snitt/plan og armeringsfigurens
// snitt/plan er to uavhengige valg som begge skal stå fast mellom tegningene.
const views = { cone: 'x', sre: 'sec' };
let bound = false;

function bindTabs() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('[data-figview]');
    if (!btn) return;
    const fig = btn.closest('.fig');
    const kind = fig?.dataset.figkind || 'cone';
    views[kind] = btn.dataset.figview;
    showView(fig, views[kind]);
  });
}

function showView(fig, v) {
  if (!fig) return;
  for (const b of fig.querySelectorAll('[data-figview]'))
    b.setAttribute('aria-pressed', String(b.dataset.figview === v));
  for (const p of fig.querySelectorAll('[data-figpanel]'))
    p.hidden = p.dataset.figpanel !== v;
}

// Faneknapp + panel, felles for begge figurtypene.
function tabsAndPanels(kind, panels, label) {
  const v = views[kind];
  const tabs = panels.map(([id, lab]) =>
    `<button class="btn" type="button" data-figview="${id}" ` +
    `aria-pressed="${v === id}">${enc(lab)}</button>`).join('');
  const body = panels.map(([id, , html]) =>
    `<div class="fig-panel" data-figpanel="${id}"${v === id ? '' : ' hidden'}>` +
    html + '</div>').join('');
  return `<figure class="fig" data-figkind="${kind}">
  <div class="fig-tabs btn-row">${tabs}</div>
  ${body}
</figure>`;
}

// === små hjelpere =========================================================
const enc = s => String(s).replace(/[&<>"]/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Norsk tallformat: desimalkomma, ingen etterhengte nuller.
function num(v, dec = 0) {
  if (!Number.isFinite(v)) return '–';
  return (+v.toFixed(dec)).toLocaleString('nb-NO');
}

const f1 = v => v.toFixed(1);

// Grupperer sorterte posisjoner i klynger som overlapper hverandre. To kjegler
// med senteravstand under 2*c_cr,N flyter sammen til ett bruddlegeme; ligger de
// lenger fra hverandre, rives det ut hver sin kjegle. Hver klynge kommer ut som
// [første, siste].
function clusters(vals, gap) {
  const out = [];
  for (const v of [...vals].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && v - last[1] <= gap) last[1] = v;
    else out.push([v, v]);
  }
  return out;
}

// ===========================================================================
//  Betongkjegle, 7.2.1.4
// ===========================================================================
//
//  Kjegla starter i trykkflata - overkant fot - og sprer seg opp og ut til
//  betongoverflata, c_cr,N = 1,5*h_ef fra hver boltakse, som i clippedSquares().
//
function coneGeo(m) {
  const hef = m.anchors.hef;
  const foot = anchorFoot(m);
  const zTop = hef; // h_ef ends at the bearing face on top of the head.
  const pl = foot.common ? endPlate(m) : null;
  return {
    hef, foot, pl, zTop, plateProjection: false,
    ccr: 1.5 * hef, scr: 3 * hef,
    pts: anchorPositions(m),
    box: baseBox(m),
    h: Math.abs(+m.concrete.h || 0),
  };
}

function coneFigure(m, check) {
  const geo = coneGeo(m);
  if (check?.tensionAnchorIds)
    geo.pts = geo.pts.filter(p => check.tensionAnchorIds.includes(p.id));
  if (!geo.pts.length) return '';
  return tabsAndPanels('cone', [
    ['x', 'Snitt x', sectionPanel(m, geo, 'x')],
    ['y', 'Snitt y', sectionPanel(m, geo, 'y')],
    ['plan', 'Plan', planPanel(m, geo)],
  ]);
}

// Tilleggsarmeringa som er lagt inn for kjeglebrudd - brukes både av kjegle-
// figuren (der den viser hva som griper inn i bruddlegemet) og av armerings-
// figurene. Tom liste når ingen strekkarmering er lagt inn.
function tensionGroups(m) {
  return (m.reinforcements || []).filter(r => r.purpose === 'tension')
    .map(r => { try { return { r, L: tensionLayout(m, r) }; } catch { return null; } })
    .filter(g => g && g.L.legLen > 0);
}

// === snitt ================================================================
// Aksegenerisk: u er retningen snittet går i, v er den vi ser inn mot.
function axisData(m, geo, ax) {
  const A = m.anchors, C = m.concrete, isX = ax === 'x';
  const us = [...new Set(geo.pts.map(p => (isX ? p.x : p.y)))].sort((a, b) => a - b);
  return {
    us,
    label: isX ? 's_x' : 's_y',
    other: isX ? 'y' : 'x',
    nOther: isX ? A.ny : A.nx,
    plateB: m.plate.present ? (isX ? m.plate.bx : m.plate.by) : null,
    // Endeplata i snittets retning.
    foot0: geo.pl ? (isX ? geo.pl.x0 : geo.pl.y0) : null,
    foot1: geo.pl ? (isX ? geo.pl.x1 : geo.pl.y1) : null,
    // Frie kanter i platas system; null = ikke fri, betongen fortsetter.
    e0: (isX ? C.freeEdges.xNeg : C.freeEdges.yNeg) ? (isX ? geo.box.x0 : geo.box.y0) : null,
    e1: (isX ? C.freeEdges.xPos : C.freeEdges.yPos) ? (isX ? geo.box.x1 : geo.box.y1) : null,
  };
}

function sectionPanel(m, geo, ax) {
  const { hef, ccr, zTop, foot, h } = geo;
  const a = axisData(m, geo, ax);
  const uL = a.us[0], uR = a.us[a.us.length - 1];

  // Kjeglene grupperes der projeksjonene overlapper.
  const cones = geo.plateProjection ? [[a.foot0, a.foot1]] : clusters(a.us, 2 * ccr);
  const coneL = cones[0][0] - ccr;
  const coneR = cones[cones.length - 1][1] + ccr;

  const span = coneR - coneL, pad = 0.10 * span;
  const concL = a.e0 === null ? coneL - pad : Math.max(a.e0, coneL - pad);
  const concR = a.e1 === null ? coneR + pad : Math.min(a.e1, coneR + pad);
  const viewL = Math.min(concL, coneL) - 0.02 * span;
  const viewR = Math.max(concR, coneR) + 0.02 * span;

  // Er betongdelen mye dypere enn kjegla, avkortes snittet: resten av
  // tverrsnittet sier ikke noe om denne bruddformen.
  const zBot = h <= 2.2 * hef ? h : 2.2 * hef;
  const cutBot = zBot < h - 1;

  const W = 760, padL = 70, padR = 96, padB = 54;
  const d = m.anchors.d, tp = m.plate.present ? m.plate.t : 0;
  const s = (W - padL - padR) / (viewR - viewL);
  const ARR = 46, ROW = 24;
  const padT = tp * s + ARR + 2 * ROW + 26;
  const H = padT + padB + zBot * s;
  const X = x => padL + (x - viewL) * s;
  const Z = z => padT + z * s;

  const g = [];

  // --- betongen ---
  g.push(`<rect class="conc" x="${f1(X(concL))}" y="${f1(Z(0))}" ` +
    `width="${f1((concR - concL) * s)}" height="${f1(zBot * s)}"/>`);
  if (a.e0 === null) g.push(brk(X(concL), Z(0), X(concL), Z(zBot)));
  if (a.e1 === null) g.push(brk(X(concR), Z(0), X(concR), Z(zBot)));
  if (cutBot) {
    g.push(brk(X(concL), Z(zBot), X(concR), Z(zBot)));
    g.push(txt('ann', X((concL + concR) / 2), Z(zBot) + 16,
      `snittet er avkortet · h = ${num(h)} mm`));
  }

  // --- kjegla ---
  if (foot.hasFoot)
    for (const [u0, u1] of cones)
      g.push(`<path class="cone" d="${
        conePath(geo, a, u0, u1, concL, concR, X, Z)}"/>`);

  // --- bolter, fot og plate ---
  for (const u of a.us) {
    g.push(`<rect class="steel" x="${f1(X(u) - d * s / 2)}" y="${f1(Z(-tp))}" ` +
      `width="${f1(d * s)}" height="${f1((hef + tp) * s)}"/>`);
    if (!geo.pl && foot.hasFoot)
      g.push(`<rect class="steel" x="${f1(X(u) - foot.size * s / 2)}" ` +
        `y="${f1(Z(zTop))}" width="${f1(foot.size * s)}" height="${f1(foot.t * s)}"/>`);
  }
  if (geo.pl)
    g.push(`<rect class="steel" x="${f1(X(a.foot0))}" y="${f1(Z(zTop))}" ` +
      `width="${f1((a.foot1 - a.foot0) * s)}" height="${f1(foot.t * s)}"/>`);
  if (a.plateB !== null)
    g.push(`<rect class="steel" x="${f1(X(-a.plateB / 2))}" y="${f1(Z(-tp))}" ` +
      `width="${f1(a.plateB * s)}" height="${f1(tp * s)}"/>`);

  // --- tilleggsarmering, projisert inn i snittet ---
  // Rosa = den delen som ligger inne i kjeglebruddsona (l_1).
  const isX = ax === 'x';
  g.push(...reinfSplit(m, p => [X(isX ? p.x : p.y), Z(-p.z)], Z));

  g.push(arrowUp(X(0), Z(-tp), ARR,
    'N<tspan baseline-shift="sub" font-size="0.78em">Ed,g</tspan>'));
  g.push(`<line class="surf" x1="${f1(X(concL))}" y1="${f1(Z(0))}" ` +
    `x2="${f1(X(concR))}" y2="${f1(Z(0))}"/>`);

  // --- mål ---
  const yTop = Z(-tp) - ARR - ROW;
  g.push(dimH(X(coneL), X(cones[0][0]), yTop, `c_cr,N = ${num(ccr)}`));
  g.push(dimH(X(cones[cones.length - 1][1]), X(coneR), yTop, `c_cr,N = ${num(ccr)}`));
  if (a.us.length > 1) g.push(dimH(X(uL), X(uR), yTop, `${a.label} = ${num(uR - uL)}`));
  g.push(dimH(X(coneL), X(coneR), yTop - ROW, `2·c_cr,N + ${a.label} = ${num(coneR - coneL)}`));

  g.push(dimV(X(concR) + 26, Z(0), Z(hef), `h_ef = ${num(hef)}`));
  if (!cutBot) g.push(dimV(X(concL) - 26, Z(0), Z(h), `h = ${num(h)}`, true));

  // Trykkflata er der kjegla starter - overkant fot, ikke underkant.
  if (foot.hasFoot && zTop < hef - 0.5) {
    const tL = cones[0][0] - 0.45 * ccr, tR = cones[cones.length - 1][1] + 0.45 * ccr;
    g.push(brk(X(tL), Z(zTop), X(tR), Z(zTop), 'thin'));
    g.push(txt('ann', X(tL) - 6, Z(zTop) + 4,
      `trykkflate = overkant ${geo.pl ? 'endeplate' : 'fot'}`, 'end'));
  }

  // Vinkelen mellom kjegleflata og overflata, i det toppunktet som står fritt.
  if (foot.hasFoot && zTop > 1) {
    if (concR >= coneR - 1)
      g.push(angleMark(X(coneR), Z(0), [-1, 0], [-ccr * s, zTop * s]));
    else if (concL <= coneL + 1)
      g.push(angleMark(X(coneL), Z(0), [1, 0], [ccr * s, zTop * s]));
  }

  // Kantavstand når kanten ligger nær nok til å slå inn i ψ_s,N.
  const yEdge = Z(zBot) + (cutBot ? 34 : 26);
  if (a.e1 !== null && a.e1 - uR <= 1.8 * ccr)
    g.push(dimH(X(uR), X(a.e1), yEdge, `c = ${num(a.e1 - uR)}`));
  if (a.e0 !== null && uL - a.e0 <= 1.8 * ccr)
    g.push(dimH(X(a.e0), X(uL), yEdge, `c = ${num(uL - a.e0)}`));

  const cap = foot.hasFoot
    ? `Snitt i ${ax}-retning gjennom boltegruppa, sett mot ${a.other}-aksen.
       Kjegla starter i trykkflata på overkant ${geo.pl ? 'endeplate' : 'fot'} og
       sprer seg opp mot overflata med c<sub>cr,N</sub> = 1,5·h<sub>ef</sub> til
       side.${geo.plateProjection ? ' Kjegla sprer seg fra endeplata.' : ' Beregningsarealet projiseres fra boltakser.'}${
         tensionGroups(m).length ? ' Tilleggsarmeringa er tegnet med i snittet: den krysser kjegleflata og fører lasta ned under bruddlegemet.' : ''}`
    : `Snitt i ${ax}-retning. Uten forankringsfot er det ingen trykkflate å
       spre en kjegle fra - forankringen regnes som heftforankring.`;
  return svg(W, H, g, `Snitt i ${ax}-retning gjennom bruddkjegla`) + caption(cap);
}

// Kjeglene i én klynge, tegnet som ei sammenhengende sløyfe fra venstre
// fotpunkt til høgre. Mellom to bolter som flyter sammen, dykker flata ned til
// skjæringspunktet - det er den virkelige formen på bruddlegemet, ikke en
// omhyllende trapes. Sløyfa klippes der betongen slutter.
function conePath(geo, a, u0, u1, limL, limR, X, Z) {
  const { ccr, zTop } = geo;
  const us = geo.plateProjection ? [[u0, u1]] : a.us.filter(u => u >= u0 && u <= u1).map(u => [u, u]);
  const p = [];

  // venstre skråflate opp fra overflata
  const topL = us[0][0] - ccr;
  if (limL > topL) {
    const z = zTop * (us[0][0] - limL) / ccr;
    p.push([limL, 0], [limL, Math.min(z, zTop)]);
  } else p.push([topL, 0]);

  for (let i = 0; i < us.length; i++) {
    p.push([us[i][0], zTop], [us[i][1], zTop]);
    if (i < us.length - 1) {
      // Bunnpunktet mellom to nabokjegler: der de to skråflatene møtes.
      const gap = us[i + 1][0] - us[i][1];
      p.push([us[i][1] + gap / 2, zTop * (1 - gap / (2 * ccr))]);
    }
  }

  // høgre skråflate ned mot overflata
  const topR = us[us.length - 1][1] + ccr;
  if (limR < topR) {
    const z = zTop * (limR - us[us.length - 1][1]) / ccr;
    p.push([limR, Math.min(z, zTop)], [limR, 0]);
  } else p.push([topR, 0]);

  return 'M' + p.map(q => `${f1(X(q[0]))} ${f1(Z(q[1]))}`).join(' L') + ' Z';
}

// === plan =================================================================
function planPanel(m, geo) {
  const { ccr, scr, pts, foot, pl, box } = geo;
  const A = m.anchors;

  // Ett kvadrat per strekkbolt; ikke fyll inn eventuelle manglende ruter.
  const rects = pts.map(p => ({ x0: p.x - ccr, x1: p.x + ccr,
    y0: p.y - ccr, y1: p.y + ccr }));

  const rx0 = Math.min(...rects.map(r => r.x0)), rx1 = Math.max(...rects.map(r => r.x1));
  const ry0 = Math.min(...rects.map(r => r.y0)), ry1 = Math.max(...rects.map(r => r.y1));

  // Betongdelen sett ovenfra. Ligger kanten langt utenfor kjegla, sier den
  // ikke noe om denne bruddformen: da kappes tegninga et stykke utenfor
  // arealet og snittkanten merkes stiplet. Kanter som er nær nok til å klippe
  // A_c,N eller slå inn i ψ_s,N blir alltid med.
  const C = m.concrete;
  const far = 2.2 * ccr;        // så langt utenfor arealet tas en fri kant med
  const near = 0.6 * ccr;       // en side som ikke er fri, vises bare som stubb
  const side = (free, edge, r, dir) => {
    const lim = r + dir * (free ? far : near);
    if (free && (dir > 0 ? edge <= lim : edge >= lim)) return { at: edge, cut: false };
    return { at: lim, cut: true };
  };
  const wx0 = side(C.freeEdges.xNeg, box.x0, rx0, -1);
  const wx1 = side(C.freeEdges.xPos, box.x1, rx1, +1);
  const wy0 = side(C.freeEdges.yNeg, box.y0, ry0, -1);
  const wy1 = side(C.freeEdges.yPos, box.y1, ry1, +1);

  const spanX = Math.max(wx1.at - wx0.at, wy1.at - wy0.at);
  const viewX0 = wx0.at - 0.03 * spanX, viewX1 = wx1.at + 0.03 * spanX;
  const viewY0 = wy0.at - 0.03 * spanX, viewY1 = wy1.at + 0.03 * spanX;

  // Målestokk: samme i x og y, tilpasset både bredda og ei øvre høgde.
  const W = 760, padL = 118, padR = 96, padT = 92, padB = 62, HMAX = 560;
  const s = Math.min((W - padL - padR) / (viewX1 - viewX0),
                     (HMAX - padT - padB) / (viewY1 - viewY0));
  const H = padT + padB + (viewY1 - viewY0) * s;
  // Er høgda det trange, blir tegninga smalere enn ruta - da sentreres den.
  const ox = padL + ((W - padL - padR) - (viewX1 - viewX0) * s) / 2;
  const X = x => ox + (x - viewX0) * s;
  // y peker oppover i modellen, nedover i SVG.
  const Y = y => padT + (viewY1 - y) * s;

  const g = [];
  const uid = Math.random().toString(36).slice(2, 8);
  const idM = 'cone-mask-' + uid, idW = 'cone-win-' + uid;

  // --- betongen, med hull der det er skåret ut ---
  const loops = memberLoops(m);
  const dMember = loops.length
    ? loops.map(l => loopPath(l, X, Y)).join(' ')
    : rectPath(wx0.at, wy0.at, wx1.at, wy1.at, X, Y);
  g.push(`<clipPath id="${idM}" clip-rule="evenodd"><path d="${dMember}"/></clipPath>`);
  g.push(`<clipPath id="${idW}"><path d="${
    rectPath(wx0.at, wy0.at, wx1.at, wy1.at, X, Y)}"/></clipPath>`);
  g.push(`<g clip-path="url(#${idW})">` +
    `<path class="conc" fill-rule="evenodd" d="${dMember}"/></g>`);
  // Kappede kanter: der fortsetter betongen utenfor figuren.
  if (wx0.cut) g.push(brk(X(wx0.at), Y(wy0.at), X(wx0.at), Y(wy1.at)));
  if (wx1.cut) g.push(brk(X(wx1.at), Y(wy0.at), X(wx1.at), Y(wy1.at)));
  if (wy0.cut) g.push(brk(X(wx0.at), Y(wy0.at), X(wx1.at), Y(wy0.at)));
  if (wy1.cut) g.push(brk(X(wx0.at), Y(wy1.at), X(wx1.at), Y(wy1.at)));

  // --- A_c,N: union av rektanglene, klippet mot betongen ---
  if (foot.hasFoot)
    g.push(`<g clip-path="url(#${idM})">` + rects.map(r =>
      `<path class="cone" d="${rectPath(r.x0, r.y0, r.x1, r.y1, X, Y)}"/>`).join('') +
      '</g>');

  // --- referansearealet A⁰_c,N = s_cr,N x s_cr,N om den første bolten ---
  const p0 = pts[0];
  g.push(`<rect class="ref" x="${f1(X(p0.x - scr / 2))}" y="${f1(Y(p0.y + scr / 2))}" ` +
    `width="${f1(scr * s)}" height="${f1(scr * s)}"/>`);
  g.push(symText('ann', X(p0.x - scr / 2) + 4, Y(p0.y - scr / 2) + 14,
    'A⁰_c,N = s_cr,N²', 'start'));

  // --- plate, endeplate og bolter ---
  if (m.plate.present)
    g.push(`<rect class="plate" x="${f1(X(-m.plate.bx / 2))}" y="${f1(Y(m.plate.by / 2))}" ` +
      `width="${f1(m.plate.bx * s)}" height="${f1(m.plate.by * s)}"/>`);
  if (pl)
    g.push(`<rect class="foot" x="${f1(X(pl.x0))}" y="${f1(Y(pl.y1))}" ` +
      `width="${f1(pl.bx * s)}" height="${f1(pl.by * s)}"/>`);
  for (const p of pts)
    g.push(`<circle class="steel" cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" ` +
      `r="${f1(Math.max(2.5, A.d * s / 2))}"/>`);

  // --- tilleggsarmering, sett ovenfra ---
  g.push(...reinfPaths(m, p => [X(p.x), Y(p.y)]));

  // --- snittlinjene, så de tre visningene henger sammen ---
  g.push(cutLine(X(viewX0) + 6, Y(0), X(viewX1) - 6, Y(0), 'snitt x'));
  g.push(cutLine(X(0), Y(viewY1) - 6, X(0), Y(viewY0) + 6, 'snitt y'));

  // --- mål ---
  const xs = [...new Set(pts.map(p => p.x))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map(p => p.y))].sort((a, b) => a - b);
  // c_cr,N og senteravstanden legges i hver sin rad, ellers går påskriftene
  // i hverandre når boltegruppa er liten.
  const yTop = padT - 24, xLeft = X(viewX0) - 26;
  g.push(dimH(X(rx0), X(pl ? pl.x0 : xs[0]), yTop - 24, `c_cr,N = ${num(ccr)}`));
  g.push(dimH(X(pl ? pl.x1 : xs[xs.length - 1]), X(rx1), yTop - 24, `c_cr,N = ${num(ccr)}`));
  if (xs.length > 1)
    g.push(dimH(X(xs[0]), X(xs[xs.length - 1]), yTop, `s_x = ${num(xs[xs.length - 1] - xs[0])}`));
  g.push(dimV(xLeft - 26, Y(ry1), Y(pl ? pl.y1 : ys[ys.length - 1]), `c_cr,N = ${num(ccr)}`, true));
  g.push(dimV(xLeft - 26, Y(pl ? pl.y0 : ys[0]), Y(ry0), `c_cr,N = ${num(ccr)}`, true));
  if (ys.length > 1)
    g.push(dimV(xLeft, Y(ys[ys.length - 1]), Y(ys[0]), `s_y = ${num(ys[ys.length - 1] - ys[0])}`, true));

  // Kantavstander der kanten er fri og nær nok til å klippe arealet.
  const yBelow = Y(wy0.at) + 30;
  if (!wx1.cut && box.x1 - xs[xs.length - 1] <= 1.8 * ccr)
    g.push(dimH(X(xs[xs.length - 1]), X(box.x1), yBelow, `c = ${num(box.x1 - xs[xs.length - 1])}`));
  if (!wx0.cut && xs[0] - box.x0 <= 1.8 * ccr)
    g.push(dimH(X(box.x0), X(xs[0]), yBelow, `c = ${num(xs[0] - box.x0)}`));

  // Påskrifta legges i hjørnefeltet mellom arealkanten og ytterste bolt, der
  // verken snittlinjene eller referansekvadratet står.
  g.push(symText('area', X((rx0 + xs[0]) / 2), Y((ry1 + ys[ys.length - 1]) / 2) + 4, 'A_c,N'));

  return svg(W, H, g, 'Plan: utbruddsarealet A_c,N') + caption(
    `Sett ovenfra. Det fargede feltet er utbruddsarealet A<sub>c,N</sub> i
     formelen: kjeglene lagt sammen og klippet mot frie kanter og utsparinger.
     Det stiplede kvadratet er referansearealet A⁰<sub>c,N</sub> = s<sub>cr,N</sub>²
     for én bolt uten nabo eller kant - forholdet mellom de to er hele
     gruppevirkningen.${tensionGroups(m).length
       ? ' Tilleggsarmeringa er tegnet med, sett ovenfra.' : ''}`);
}

// ===========================================================================
//  Tilleggsarmering ved kjeglebrudd, 7.2.1.2 (jf. B19.3.2.6)
// ===========================================================================
//
//  To visninger:
//    Snitt  langs bøyleretninga gjennom bolten. Viser hvor mye av beinet som
//           ligger INNE i kjeglebruddsona (l_1) og hvor mye som er igjen som
//           forankring UTENFOR den (l_bd), pluss overflatearmeringa bøyen
//           omslutter.
//    Plan   bolten med sona 0,75·h_ef om seg, og den FAKTISKE avstanden ut
//           til hvert loddrett bein - det er den avstanden kravet gjelder.
//
const REINF_CLS = 'reinf';

// Alle armeringsbanene i en gruppe, projisert med `project(punkt) -> [x, y]`.
// `cls` gjør det mulig å tegne den samme banen to ganger med hver sin farge,
// klippet mot kjeglesona - se reinfSplit().
function reinfPaths(m, project, only = null, cls = REINF_CLS) {
  const out = [];
  for (const r of (m.reinforcements || []).filter(x => x.purpose === 'tension')) {
    if (only && r.id !== only) continue;
    let bars = [];
    try { bars = buildBars(m, r); } catch { bars = []; }
    for (const bar of bars)
      for (const path of bar.paths) {
        const d = 'M' + path.points.map(project)
          .map(q => `${f1(q[0])} ${f1(q[1])}`).join(' L') + (path.closed ? ' Z' : '');
        out.push(`<path class="${cls}" d="${d}"/>`);
      }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Armeringa i et LODDRETT snitt, delt i to på underkant bruddkjegle.
//
//  Den delen som ligger inne i kjeglebruddsona er l_1 - forankringa som må
//  til for at armeringa i det hele tatt skal ta over for kjegla. Den tegnes
//  rosa; resten, som er forankringa utenfor bruddlegemet, står i den vanlige
//  fargen. Delinga gjøres med klipperektangler, så streken blir nøyaktig like
//  lang som lengden som står i formelen.
//
//  Grensa oppe er kronen (den vannrette delen teller ikke som l_1, bare beina
//  og hjørnebøyene), nede er h_ef. For rett stang er det stangenden oppe.
// ---------------------------------------------------------------------------
function reinfSplit(m, project, Z, only = null) {
  const out = [];
  const uid = Math.random().toString(36).slice(2, 8);
  for (const r of (m.reinforcements || []).filter(x => x.purpose === 'tension')) {
    if (only && r.id !== only) continue;
    let L;
    try { L = tensionLayout(m, r); } catch { continue; }
    // Utenfor sona først, så den rosa biten legger seg oppå i overgangen.
    out.push(...reinfPaths(m, project, r.id));
    const id = `l1-${r.id}-${uid}`;
    const d = l1ClipPath(m, L, project, Z);
    if (!d) continue;
    out.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`,
      `<g clip-path="url(#${id})">` +
      reinfPaths(m, project, r.id, 'reinf-in').join('') + '</g>');
  }
  return out;
}

// Klippeflata for l_1: ett felt om HVERT loddrett bein, fra kronenivå ned til
// h_ef. Feltet er akkurat bredt nok til å ta med hjørnebøyen (en mandrel-
// radius pluss stangas egen tykkelse til hver side). Den vannrette delen av
// bøylen mellom beina blir dermed liggende utenfor - den er ikke en del av
// l_1, som bare teller beina og kvartbøyene.
function l1ClipPath(m, L, project, Z) {
  const zTop = Z(L.bent ? L.dCrown : L.dLegTop);
  const half = (L.bent ? L.rm : 0) + L.ds;
  const parts = [];
  for (const bar of L.bars)
    for (const leg of L.legs.filter(g => g.bar === bar)) {
      // Nedre grense er der KJEGLEFLATA krysser akkurat dette beinet - den
      // ligger grunnere jo lenger fra bolten beinet står. Ikke h_ef.
      const zBot = Z(leg.zCone);
      if (!(zBot > zTop)) continue;
      // Beinet projisert inn i figuren; bredda tas fra et punkt forskjøvet
      // like langt langs den samme aksen, så den følger målestokken.
      const a = project({ x: leg.x, y: leg.y, z: 0 });
      const b = project({ x: leg.x + L.u.x * half, y: leg.y + L.u.y * half, z: 0 });
      const w = Math.max(Math.abs(b[0] - a[0]), 2);
      parts.push(`M${f1(a[0] - w)} ${f1(zTop)} H${f1(a[0] + w)} ` +
                 `V${f1(zBot)} H${f1(a[0] - w)} Z`);
    }
  return parts.join(' ');
}

function sreFigure(m, check) {
  const r = (m.reinforcements || []).find(x => x.id === check.group);
  if (!r || r.purpose !== 'tension') return '';
  const L = tensionLayout(m, r);
  if (!(L.legLen > 0)) return '';
  const geo = coneGeo(m);
  return tabsAndPanels('sre', [
    // Samme to visningene som B19 fig. 19.19/19.20: opprisset langs armeringa,
    // og snittet på tvers av den. Begge viser HELE forbindelsen - alle boltene
    // og hele bruddkjegla - for det er kjegla mellom boltene som avgjør hvor
    // mye av bøylen som ligger inne i bruddlegemet.
    ['sec', 'Oppriss langs armeringa', srePanelView(m, r, L, geo, 'u')],
    ['cut', 'Snitt på tvers', srePanelView(m, r, L, geo, 'n')],
    ['plan', 'Plan · 0,75·h_ef', srePanelPlan(m, r, L)],
  ]);
}

// ---------------------------------------------------------------------------
//  Kjeglas silhuett i et oppriss/snitt.
//
//  Kjegla sprer seg fra hver bolt for seg. I en projeksjon er det den ytterste
//  flata man ser: for hver koordinat t langs visningsaksen er kjegla så dyp
//  som den NÆRMESTE bolten tilsier. Mellom to bolter møtes de to skråflatene i
//  en RYGG - kjegla er ikke flat der inne, den stiger opp fra hver fot og
//  treffer nabokjegla på midten. Det er nettopp den ryggen som avgjør hvor
//  djupt et bøylebein står inne i bruddlegemet.
//
//  Kilder angis som intervaller; boltaksene har lik start- og sluttkoordinat.
// ---------------------------------------------------------------------------
function coneProfile(geo, sources, ccr) {
  const zTop = geo.zTop;
  return t => {
    let z = 0;
    for (const [a, b] of sources) {
      const s = Math.max(a - t, t - b, 0);
      if (s < ccr) z = Math.max(z, zTop * (1 - s / ccr));
    }
    return z;
  };
}

// --- oppriss / snitt ------------------------------------------------------
//  axis 'u' = langs bøyleretninga (opprisset: bøylene vises i sin fulle form)
//  axis 'n' = på tvers (snittet: beina står som par på hver side av bolten)
function srePanelView(m, r, L, geo, axis) {
  const hef = geo.hef, h = geo.h, foot = geo.foot;
  const along = axis === 'u' ? L.u : L.n;
  const T = p => p.x * along.x + p.y * along.y;
  const pts = L.perAnchor;
  const bent = L.bent;

  // Kildene kjegla sprer seg fra, projisert på visningsaksen.
  const sources = pts.map(p => [T(p), T(p)]);
  const prof = coneProfile(geo, sources, geo.ccr);

  // Utsnitt: hele kjegla, all armering og hele boltegruppa.
  const ts = pts.map(T);
  let t0 = Math.min(...ts) - geo.ccr, t1 = Math.max(...ts) + geo.ccr;
  for (const b of L.bars)
    for (const q of [...b.legs, ...b.endPoints]) {
      t0 = Math.min(t0, T(q) - 40); t1 = Math.max(t1, T(q) + 40);
    }
  const pad = 0.04 * (t1 - t0);
  t0 -= pad; t1 += pad;
  const zBot = Math.min(h, Math.max(L.dBot + 70, 1.25 * hef));
  const cutBot = zBot < h - 1;

  const W = 760, padL = 82, padR = 108, padB = 56;
  const sc = Math.min((W - padL - padR) / (t1 - t0), 430 / zBot);
  const ARR = 40, ROW = 24, padT = 34 + ARR + ROW;
  const H = padT + padB + zBot * sc;
  const X = t => padL + (t - t0) * sc;
  const Z = z => padT + z * sc;
  const d = m.anchors.d, tp = m.plate.present ? m.plate.t : 0;

  const g = [];
  g.push(`<rect class="conc" x="${f1(X(t0))}" y="${f1(Z(0))}" ` +
    `width="${f1((t1 - t0) * sc)}" height="${f1(zBot * sc)}"/>`);
  g.push(brk(X(t0), Z(0), X(t0), Z(zBot)));
  g.push(brk(X(t1), Z(0), X(t1), Z(zBot)));
  if (cutBot) {
    g.push(brk(X(t0), Z(zBot), X(t1), Z(zBot)));
    g.push(txt('ann', X((t0 + t1) / 2), Z(zBot) + 16, `snittet er avkortet · h = ${num(h)} mm`));
  }

  // --- bruddkjegla, tegnet med ryggene mellom boltene ---
  if (foot.hasFoot) {
    const N = 240, p = [];
    for (let i = 0; i <= N; i++) {
      const t = t0 + (t1 - t0) * (i / N);
      p.push(`${f1(X(t))} ${f1(Z(prof(t)))}`);
    }
    g.push(`<path class="cone" d="M${f1(X(t0))} ${f1(Z(0))} L` + p.join(' L') +
      ` L${f1(X(t1))} ${f1(Z(0))} Z"/>`);
  }

  // --- bolter, fot og plate ---
  for (const p of pts) {
    const t = T(p);
    g.push(`<rect class="steel" x="${f1(X(t) - d * sc / 2)}" y="${f1(Z(-tp))}" ` +
      `width="${f1(d * sc)}" height="${f1((hef + tp) * sc)}"/>`);
    if (!geo.pl && foot.hasFoot)
      g.push(`<rect class="steel" x="${f1(X(t) - foot.size * sc / 2)}" ` +
        `y="${f1(Z(geo.zTop))}" width="${f1(foot.size * sc)}" ` +
        `height="${f1(foot.t * sc)}"/>`);
  }
  if (geo.pl) {
    const a = Math.min(...sources[0]), b = Math.max(...sources[0]);
    g.push(`<rect class="steel" x="${f1(X(a))}" y="${f1(Z(geo.zTop))}" ` +
      `width="${f1((b - a) * sc)}" height="${f1(foot.t * sc)}"/>`);
  }
  if (m.plate.present) {
    const pb = axis === 'u' ? m.plate.bx : m.plate.by;   // tilnærmet ved dreining
    g.push(`<rect class="steel" x="${f1(X(-pb / 2))}" y="${f1(Z(-tp))}" ` +
      `width="${f1(pb * sc)}" height="${f1(tp * sc)}"/>`);
  }
  g.push(arrowUp(X(0), Z(-tp), ARR,
    'N<tspan baseline-shift="sub" font-size="0.78em">Ed,g</tspan>'));
  g.push(`<line class="surf" x1="${f1(X(t0))}" y1="${f1(Z(0))}" ` +
    `x2="${f1(X(t1))}" y2="${f1(Z(0))}"/>`);

  // --- stanga i bøyen ---
  // Sett langs armeringa (axis 'u') ligger stanga inn/ut av papiret - vi ser
  // enden av henne, som en sirkel. Sett på tvers (axis 'n') ligger hun derimot
  // I papirplanet, på tvers av beina - da skal hun tegnes som ei linje mellom
  // de bøylene hun går gjennom, ikke som gjentatte sirkler oppå hverandre.
  if (bent && L.dtBend > 0) {
    const rb = Math.max(2.2, L.dtBend * sc / 2);
    if (axis === 'n') {
      // Ekte lengde, samme strek som selve bøylen: stanga er rett og ligger i
      // tegningsplanet her, med endene ute i sin egen forankring - ikke bare
      // strekt mellom beina. Klippes mot betongdelen, så den ikke stikker inn
      // i påskriftene utenfor snittet - forankringa kan gå langt utover det
      // som er tegnet her.
      const projectBend = p => [X(T(p)), Z(-p.z)];
      for (const bb of bendBarsFor(m, r))
        for (const path of bb.paths) {
          const pts = path.points.map(projectBend)
            .map(([x, y]) => [Math.max(X(t0), Math.min(X(t1), x)), y]);
          const d = 'M' + pts.map(q => `${f1(q[0])} ${f1(q[1])}`).join(' L');
          g.push(`<path class="reinf" d="${d}"/>`);
        }
    } else {
      const seen = new Set();
      for (const b of L.bars)
        for (const uu of [b.uStart + L.rm, b.uEnd - L.rm]) {
          const q = { x: L.u.x * uu + L.n.x * b.v, y: L.u.y * uu + L.n.y * b.v };
          const k = Math.round(T(q));
          if (seen.has(k)) continue;
          seen.add(k);
          g.push(`<circle class="mesh" cx="${f1(X(T(q)))}" cy="${f1(Z(L.dBend))}" ` +
            `r="${f1(rb)}"/>`);
        }
    }
    // I 'n'-visninga går streken helt ut til kanten der påskrifta står -
    // den må derfor heves over streken, ikke ligge midt i den.
    g.push(txt('ann', X(t1) - 6, Z(L.dBend) + (axis === 'n' ? -10 : 4), L.bendBarMode === 'own'
      ? `egen stang ⌀${num(L.dtBend)} i bøyen` : `overflatearmering i bøyen`, 'end'));
  }

  // --- armeringa, med den delen inne i bruddlegemet i rosa ---
  const project = p => [X(T(p)), Z(-p.z)];
  g.push(...reinfPaths(m, project, r.id));
  const clipD = l1ClipPath(m, L, project, Z);
  if (clipD) {
    const cid = 'l1-' + axis + '-' + Math.random().toString(36).slice(2, 8);
    g.push(`<clipPath id="${cid}"><path d="${clipD}"/></clipPath>`);
    g.push(`<g clip-path="url(#${cid})">` +
      reinfPaths(m, project, r.id, 'reinf-in').join('') + '</g>');
  }

  // --- mål ---
  // To rader over figuren: den ytterste (yTop) tar kjeglebredda og
  // senteravstanden, den innerste (yTop2) tar avstanden bolt -> styrende bein
  // - ellers legger den seg oppå l_1/l_bd-kolonnen midt i figuren.
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const yTop = Z(-tp) - ARR - 4 - ROW;
  const yTop2 = yTop + ROW;
  g.push(dimH(X(tMax), X(tMax + geo.ccr), yTop, `1,5·h_ef = ${num(geo.ccr)}`));
  if (tMax > tMin + 1) g.push(dimH(X(tMin), X(tMax), yTop, `${num(tMax - tMin)}`));

  g.push(dimV(X(t0) + 30, Z(0), Z(hef), `h_ef = ${num(hef)}`));

  // Beinet som styrer l_1, og krysningspunktet på det.
  const counted = L.legs.filter(q => q.serves.length > 0);
  const gov = (counted.length ? counted : L.legs)
    .reduce((a, b) => (!a || b.l1 < a.l1 ? b : a), null);
  if (gov) {
    const tg = T(gov);
    g.push(brk(X(t0) + 6, Z(gov.zCone), X(t1) - 6, Z(gov.zCone), 'thin'));
    g.push(txt('ann', X(t0) + 10, Z(gov.zCone) + 15,
      'her krysser kjegla armeringa – slutt på l₁', 'start'));
    const xd = X(tg) + Math.max(26, L.ds * sc + 20);
    g.push(dimV(xd, Z(L.bent ? L.dCrown : L.dLegTop), Z(Math.min(L.legBottom, gov.zCone)),
      `l_1 = ${num(L.insideLen)}`));
    if (L.legBottom > gov.zCone + 0.5)
      g.push(dimV(xd, Z(gov.zCone), Z(L.legBottom), `l_bd = ${num(L.outsideLen)}`));

    // Avstanden bolt -> bein, projisert inn i denne visninga. Selve kravet
    // gjelder den faktiske avstanden i planet - se planvisningen.
    const near = pts.reduce((a, b) =>
      (Math.hypot(gov.x - b.x, gov.y - b.y) < Math.hypot(gov.x - a.x, gov.y - a.y) ? b : a));
    const off = Math.abs(tg - T(near));
    if (off > 1)
      g.push(dimH(X(T(near)), X(tg), yTop2,
        `${axis === 'u' ? 'a' : 'd'} = ${num(off)} < 0,75·h_ef = ${num(L.dMax)}`));
  }

  g.push(txt('ann', X((t0 + t1) / 2), Z(zBot) - 12,
    'rosa = l₁, armeringa inne i bruddlegemet · grønt = forankring utenfor'));

  const fac = minAnchorageFactor(r.geometryType);
  const l1min = minInsideLength(r.ds, r.geometryType);
  const viewTxt = axis === 'u'
    ? `Oppriss langs armeringsretninga – bøylene vises i sin fulle form.`
    : `Snitt på tvers av armeringa – beina står som par på hver side av boltene.`;
  const cap = `${viewTxt} Hele forbindelsen er tegnet – ${pts.length === 1
      ? 'bolten' : `alle ${pts.length} boltene i gruppa, projisert inn i tegningsplanet`} –
    sammen med hele bruddkjegla.
    ${foot.hasFoot && sources.length > 1
      ? `Kjegla er <b>ikke flat mellom boltene</b>: den sprer seg fra hver fot for
         seg og møter nabokjegla i en rygg på midten. Det er den ryggen som
         bestemmer hvor djupt bøylebeina står inne i bruddlegemet, og dermed
         l<sub>1</sub>.` : ''}
    Den <b>rosa</b> delen er <b>l<sub>1</sub> = ${num(L.insideLen)} mm</b>${
      bent ? ' (inkludert kvartbøyen i hjørnet)' : ''}: armeringa inne i
    bruddlegemet, ned til der kjegleflata krysser beinet
    ${gov ? num(gov.zCone) + ' mm nede' : ''} – ikke til h<sub>ef</sub> = ${num(hef)} mm.
    Kravet er ${fac}·⌀ = ${num(l1min)} mm for ${bent ? 'bøyd armering' : 'rett stang'}.
    Under kjegleflata ligger forankringa utenfor bruddlegemet:
    ${num(L.anchorageAvail)} mm mot l<sub>bd</sub> = ${num(L.lbd)} mm
    (NS-EN 1992-1-1 8.4). Avstanden fra bolt til bein er målt i planet
    – se planvisningen; her vises bare komponenten i tegningsplanet.`;
  return svg(W, H, g, `Tilleggsarmering, ${axis === 'u' ? 'oppriss' : 'snitt'}`) +
    caption(cap);
}

// --- plan -----------------------------------------------------------------
//  Sett ovenfra, med nok av omgivelsene til at bildet gir mening: stålplata,
//  ALLE boltene gruppa betjener, armeringa slik den ligger, og sona
//  0,75*h_ef om den bolten som styrer. Uten plate og nabobolter blir
//  bøylestrekene bare løse streker uten sammenheng.
function srePanelPlan(m, r, L) {
  const A = m.anchors;
  const pts = L.perAnchor;
  // Styrende bolt: den som har det lengste spranget ut til sitt eget bein.
  const govOf = p => {
    let worst = 0;
    for (const b of L.bars) {
      if (!b.anchors.some(q => q.id === p.id)) continue;
      let near = Infinity;
      for (const g of b.legs) near = Math.min(near, Math.hypot(g.x - p.x, g.y - p.y));
      if (Number.isFinite(near)) worst = Math.max(worst, near);
    }
    return worst;
  };
  const p0 = pts.reduce((a, b) => (govOf(b) > govOf(a) ? b : a), pts[0]);
  const R = L.dMax;

  // Utsnittet: alt som hører til - bolter, plate, armering og hele sona.
  let x0 = p0.x - R, x1 = p0.x + R, y0 = p0.y - R, y1 = p0.y + R;
  const grow = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x);
                           y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const p of pts) grow(p.x, p.y);
  for (const b of L.bars) for (const q of [...b.legs, ...b.endPoints]) grow(q.x, q.y);
  if (m.plate.present) {
    grow(-m.plate.bx / 2, -m.plate.by / 2); grow(m.plate.bx / 2, m.plate.by / 2);
  }
  const pad = 0.12 * Math.max(x1 - x0, y1 - y0);
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  // Kvadratisk utsnitt, så en sirkel blir en sirkel.
  const span = Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  x0 = cx - span / 2; y0 = cy - span / 2;

  const W = 760, padL = 56, padR = 56, padT = 46, padB = 62, HMAX = 500;
  const sc = Math.min((W - padL - padR) / span, (HMAX - padT - padB) / span);
  const H = padT + padB + span * sc;
  const ox = padL + ((W - padL - padR) - span * sc) / 2;
  const X = x => ox + (x - x0) * sc;
  const Y = y => padT + (span - (y - y0)) * sc;

  const g = [];
  // Alt klippes til utsnittet: stanga i bøyen er l_bd lang og ville ellers
  // stukket langt utenfor figuren. Utsnittet er valgt for å vise sona, ikke
  // hele den stanga - lengden hennes står i sin egen kontroll.
  const clip = 'plan-' + Math.random().toString(36).slice(2, 8);
  g.push(`<clipPath id="${clip}"><rect x="${f1(X(x0))}" y="${f1(Y(y0 + span))}" ` +
    `width="${f1(span * sc)}" height="${f1(span * sc)}"/></clipPath>`);

  // Betongkanten, der den er nær nok til å komme med.
  const box = baseBox(m);
  const e = m.concrete.freeEdges;
  const edge = (a, b, c, d) =>
    `<line class="brk" x1="${f1(a)}" y1="${f1(b)}" x2="${f1(c)}" y2="${f1(d)}"/>`;
  if (e.xNeg && box.x0 > x0) g.push(edge(X(box.x0), Y(y0), X(box.x0), Y(y0 + span)));
  if (e.xPos && box.x1 < x0 + span) g.push(edge(X(box.x1), Y(y0), X(box.x1), Y(y0 + span)));
  if (e.yNeg && box.y0 > y0) g.push(edge(X(x0), Y(box.y0), X(x0 + span), Y(box.y0)));
  if (e.yPos && box.y1 < y0 + span) g.push(edge(X(x0), Y(box.y1), X(x0 + span), Y(box.y1)));

  // Sona 0,75*h_ef om den styrende bolten.
  g.push(`<circle class="zone" cx="${f1(X(p0.x))}" cy="${f1(Y(p0.y))}" r="${f1(R * sc)}"/>`);
  g.push(symText('ann', X(p0.x), Y(p0.y - R) + 15, `0,75·h_ef = ${num(R)} mm`));

  // Stålplata, så bildet henger sammen med resten av modellen.
  if (m.plate.present)
    g.push(`<rect class="plate" x="${f1(X(-m.plate.bx / 2))}" y="${f1(Y(m.plate.by / 2))}" ` +
      `width="${f1(m.plate.bx * sc)}" height="${f1(m.plate.by * sc)}"/>`);

  // Stanga i bøyen, sett ovenfra: den går på TVERS av bøylene, gjennom bøyene.
  // Tegnes under bøylene, så det er tydelig at bøylene ligger over den.
  {
    const lines = [];
    for (const bb of bendBarsFor(m, r))
      for (const path of bb.paths)
        lines.push(`<path class="mesh-line" d="M` + path.points
          .map(q => `${f1(X(q.x))} ${f1(Y(q.y))}`).join(' L') + '"/>');
    if (lines.length) g.push(`<g clip-path="url(#${clip})">${lines.join('')}</g>`);
  }

  // Armeringa sett ovenfra: den vannrette delen som strek, beina som ringer.
  g.push(...reinfPaths(m, p => [X(p.x), Y(p.y)], r.id));
  for (const q of L.legs)
    g.push(`<circle class="leg" cx="${f1(X(q.x))}" cy="${f1(Y(q.y))}" ` +
      `r="${f1(Math.max(2.6, r.ds * sc / 2))}"/>`);

  // Boltene. Bare den styrende får påskrift - med en bøyle på hver side av
  // hver bolt blir det ikke plass til fire navn uten at de legger seg oppå
  // armeringa, og det er den styrende bolten figuren handler om.
  for (const p of pts) {
    const rr = Math.max(3.5, A.d * sc / 2);
    g.push(`<circle class="steel" cx="${f1(X(p.x))}" cy="${f1(Y(p.y))}" ` +
      `r="${f1(rr)}"/>`);
  }
  // Den styrende bolten merkes med en ring i stedet for en påskrift: med
  // bøyler på begge sider av hver bolt er det ikke ledig plass til tekst.
  g.push(`<circle class="gov" cx="${f1(X(p0.x))}" cy="${f1(Y(p0.y))}" ` +
    `r="${f1(Math.max(9, A.d * sc / 2 + 6))}"/>`);

  // Målet ut til gruppas eget nærmeste og ytterste bein om den styrende bolten.
  const own = L.bars.filter(b => b.anchors.some(q => q.id === p0.id));
  const legs = L.legs.filter(q => own.includes(q.bar))
    .map(q => ({ ...q, dist: Math.hypot(q.x - p0.x, q.y - p0.y) }))
    .sort((a, b) => a.dist - b.dist);
  if (legs.length) {
    g.push(dimDiag(X(p0.x), Y(p0.y), X(legs[0].x), Y(legs[0].y),
      `d_1 = ${num(legs[0].dist)}`));
    const far = legs[legs.length - 1];
    if (far.dist - legs[0].dist > 1)
      g.push(dimDiag(X(p0.x), Y(p0.y), X(far.x), Y(far.y), `d_n = ${num(far.dist)}`));
  }

  const rowMode = L.barLayout === 'row';
  const cap = `Sett ovenfra. Grå sirkler er boltene, den stiplede sirkelen er sona
    0,75·h<sub>ef</sub> = ${num(R)} mm om den bolten som styrer –
    <b>bolt ${enc(String(p0.id))}</b>, ringet inn i rødt.
    Grønt er tilleggsarmeringa: streken er den vannrette delen av bøylen, og de
    fylte ringene er de <b>loddrette beina</b> – det er avstanden ut til dem
    kravet gjelder, målt som den <b>faktiske avstanden i planet</b>
    √(Δx² + Δy²), ikke langs x eller y hver for seg. De tynne strekene på tvers
    er ${L.bendBarMode === 'own' ? 'de egne stengene' : 'nettlaget'} som ligger
    <b>i bøyene</b>, under bøylene.
    ${rowMode
      ? `Her spenner én bøyle hele boltraden, så beina står bare i endene – bolter
         midt i raden får ikke noe bein nær seg.`
      : `Her ligger ${L.nSide} bøyle${L.nSide > 1 ? 'r' : ''} på hver side av hver bolt,
         pakket utover fra bolten med minste senteravstand ${num(L.sMin)} mm
         (NS-EN 1992-1-1 8.2) – ikke spredt ut til sonegrensa.`}
    Nærmeste bein ligger ${num(L.dNearest)} mm fra boltaksen.`;
  return svg(W, H, g, 'Plan: avstand fra bolt til armeringsbein') + caption(cap);
}

// Stengene som ligger i bøyene - egen stang, eller det nettlaget som går på
// tvers. Begge tegnes likt: én strek gjennom bøyene, på tvers av bøylene.
function bendBarsFor(m, r) {
  try {
    if (r.bendBar === 'own') return buildBendBars(m, r);
    return buildSurfaceMesh(m, r).filter(b => b.layer === 2);
  } catch { return []; }
}

// Skrått mål mellom to punkt, med pil i begge ender.
function dimDiag(x1, y1, x2, y2, label) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 6) return '';
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const head = (x, y, sx, sy) =>
    `<path d="M${f1(x)} ${f1(y)} l${f1(6 * sx - 2.6 * sy)} ${f1(6 * sy + 2.6 * sx)} ` +
    `l${f1(5.2 * sy)} ${f1(-5.2 * sx)} z"/>`;
  // Avstandene er små i forhold til sona, så påskrifta settes utenfor beinet
  // langs samme linje - midt på ville den havnet oppå bolten.
  const mx = x2 + ux * 12, my = y2 + uy * 12 + 4;
  return `<g class="dim">` +
    `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>` +
    head(x1, y1, ux, uy) + head(x2, y2, -ux, -uy) +
    `<text x="${f1(mx)}" y="${f1(my)}" text-anchor="${ux < -0.3 ? 'end' : 'start'}">` +
    `${sub(label)}</text></g>`;
}

// Betongdelens omriss sett ovenfra, i platas system: ytterkanter og hull i
// skiva som ligger under boltene.
function memberLoops(m) {
  const [z0, z1] = anchorDepth(m);
  const zm = (z0 + z1) / 2;
  const slabs = solidSlabs(m);
  const slab = slabs.find(sl => sl.z0 <= zm && zm <= sl.z1) || slabs[0];
  if (!slab) return [];
  const out = [];
  for (const f of slab.faces) { out.push(f.outer); for (const h of f.holes) out.push(h); }
  return out;
}

const loopPath = (loop, X, Y) =>
  'M' + loop.map(p => `${f1(X(p.x))} ${f1(Y(p.y))}`).join(' L') + ' Z';

const rectPath = (x0, y0, x1, y1, X, Y) =>
  `M${f1(X(x0))} ${f1(Y(y0))} L${f1(X(x1))} ${f1(Y(y0))} ` +
  `L${f1(X(x1))} ${f1(Y(y1))} L${f1(X(x0))} ${f1(Y(y1))} Z`;

// === strektegning =========================================================
function svg(W, H, g, label) {
  return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" width="100%" role="img"
       aria-label="${enc(label)}">
    ${g.join('\n    ')}
  </svg>`;
}

const caption = html => `<figcaption>${html}</figcaption>`;

const txt = (cls, x, y, s, anchor = 'middle') =>
  `<text class="${cls}" x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}">${enc(s)}</text>`;

const brk = (x1, y1, x2, y2, cls = '') =>
  `<line class="brk ${cls}" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>`;

// Snittlinje med påskrift i enden.
function cutLine(x1, y1, x2, y2, label) {
  const horiz = Math.abs(y2 - y1) < 1;
  return `<g class="cut"><line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>` +
    `<text x="${f1(horiz ? x2 : x2 + 6)}" y="${f1(horiz ? y2 - 6 : y2 - 4)}" ` +
    `text-anchor="${horiz ? 'end' : 'start'}">${enc(label)}</text></g>`;
}

function arrowUp(x, yBase, len, label) {
  const y2 = yBase - len;
  return `<g class="load"><line x1="${f1(x)}" y1="${f1(yBase)}" ` +
    `x2="${f1(x)}" y2="${f1(y2 + 7)}"/>` +
    `<path d="M${f1(x)} ${f1(y2)} l-4.5 9 h9 z"/>` +
    `<text x="${f1(x + 9)}" y="${f1(y2 + 11)}">${label}</text></g>`;
}

// Vinkelbue mellom to retninger ut fra samme punkt, med gradtallet utenfor
// buen. Retningene er i pikselkoordinater (y nedover).
function angleMark(px, py, v1, v2, r = 42) {
  const u = v => { const L = Math.hypot(v[0], v[1]); return [v[0] / L, v[1] / L]; };
  const a = u(v1), b = u(v2);
  const deg = Math.round(Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])))
    * 180 / Math.PI);
  const sweep = a[0] * b[1] - a[1] * b[0] > 0 ? 1 : 0;
  const bis = u([a[0] + b[0], a[1] + b[1]]);
  return `<g><path class="arc" d="M${f1(px + r * a[0])} ${f1(py + r * a[1])} ` +
    `A${r} ${r} 0 0 ${sweep} ${f1(px + r * b[0])} ${f1(py + r * b[1])}"/>` +
    `<text class="ann" x="${f1(px + (r + 15) * bis[0])}" ` +
    `y="${f1(py + (r + 15) * bis[1] + 4)}">${deg}°</text></g>`;
}

// Horisontalt mål med hjelpelinjer og piler i endene.
function dimH(x1, x2, y, label) {
  if (Math.abs(x2 - x1) < 1) return '';
  const mid = (x1 + x2) / 2;
  const narrow = Math.abs(x2 - x1) < 64;
  return `<g class="dim">` + tickV(x1, y) + tickV(x2, y) +
    `<line x1="${f1(x1)}" y1="${f1(y)}" x2="${f1(x2)}" y2="${f1(y)}"/>` +
    `<path d="M${f1(x1)} ${f1(y)} l6 -2.6 v5.2 z"/>` +
    `<path d="M${f1(x2)} ${f1(y)} l-6 -2.6 v5.2 z"/>` +
    `<text x="${f1(mid)}" y="${f1(y - 6)}" text-anchor="middle"` +
    (narrow ? ' class="sm"' : '') + `>${sub(label)}</text></g>`;
}

// Vertikalt mål. left = teksten står til venstre for linja.
function dimV(x, y1, y2, label, left = false) {
  if (Math.abs(y2 - y1) < 1) return '';
  const mid = (y1 + y2) / 2;
  const narrow = Math.abs(y2 - y1) < 30;
  return `<g class="dim">` + tickH(x, y1) + tickH(x, y2) +
    `<line x1="${f1(x)}" y1="${f1(y1)}" x2="${f1(x)}" y2="${f1(y2)}"/>` +
    `<path d="M${f1(x)} ${f1(y1)} l-2.6 6 h5.2 z"/>` +
    `<path d="M${f1(x)} ${f1(y2)} l-2.6 -6 h5.2 z"/>` +
    `<text x="${f1(left ? x - 7 : x + 7)}" y="${f1(mid + 4)}"` +
    ` text-anchor="${left ? 'end' : 'start'}"` +
    (narrow ? ' class="sm"' : '') + `>${sub(label)}</text></g>`;
}

const tickV = (x, y) => `<line class="ext" x1="${f1(x)}" y1="${f1(y + 5)}" ` +
  `x2="${f1(x)}" y2="${f1(y - 4)}"/>`;
const tickH = (x, y) => `<line class="ext" x1="${f1(x - 5)}" y1="${f1(y)}" ` +
  `x2="${f1(x + 4)}" y2="${f1(y)}"/>`;

// «h_ef = 150» -> h med senket ef. Alle symbol på formen x_yyy settes med
// senka indeks, resten står som det er.
const subs = str => enc(str).replace(/([A-Za-zΨψ⌀⁰])_([A-Za-z0-9,]+)/g,
  (_, a, b) => `${a}<tspan baseline-shift="sub" font-size="0.78em">${b}</tspan>`);
const sub = label => subs(label + ' mm');

// Symboltekst med senka indeks, plassert fritt i figuren.
const symText = (cls, x, y, str, anchor = 'middle') =>
  `<text class="${cls}" x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}">` +
  `${subs(str)}</text>`;
