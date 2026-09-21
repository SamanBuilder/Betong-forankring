// ---------------------------------------------------------------------------
//  Beregningsrapport som PDF.
//
//  Appen samler innholdet (modell, resultat, innstillinger, bilder) og gir det
//  hit ferdig tolket; denne modulen står bare for oppsettet. PDF-en lages med
//  pdfmake, som gir ekte tekst (søkbar, skarp på utskrift), tabeller som
//  brytes over sider, og innholdsfortegnelse med sidetall.
//
//  pdfmake lastes fra cdnjs første gang rapporten lages - samme vei som three
//  hentes fra CDN - så resten av verktøyet ikke betaler for den.
//
//  Utregningene settes opp som i utregningsarket i appen: symbol, forklaring
//  og henvisning på første linje, så «= formel = innsatt = verdi» under.
//  Figurene er de samme SVG-ene, rastrert med stilene fra appen.
// ---------------------------------------------------------------------------
import { n, kN } from '../engine/calc.js';

const PDFMAKE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.23/';

// Fargene fra style.css, som faste verdier - PDF-en kjenner ikke CSS-variabler.
const RCOL = {
  tx: '#22292d', tx2: '#505c62', tx3: '#68747a', acc: '#087d78',
  ok: '#6e9e4f', warn: '#c79030', bad: '#c0524a',
  line: '#e0e4e6', line2: '#c6ced2', panel2: '#f6f7f8', panel3: '#e8ebed',
  okBg: '#f1f6ec', okLine: '#d7e5c9', badBg: '#fbeceb', badLine: '#f0cfcc',
};
const PAGE_W = 595.28 - 2 * 50;       // A4 minus sidemarger

// === pdfmake ==============================================================
let pdfLib = null;
function loadScript(src) {
  return new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => bad(new Error('Kunne ikke hente PDF-biblioteket. Sjekk nettforbindelsen.'));
    document.head.appendChild(s);
  });
}
function pdfMakeLib() {
  pdfLib ??= (async () => {
    if (!window.pdfMake?.createPdf) await loadScript(PDFMAKE_URL + 'pdfmake.min.js');
    if (!window.pdfMake.vfs?.['Roboto-Regular.ttf'])
      await loadScript(PDFMAKE_URL + 'vfs_fonts.min.js');
    return window.pdfMake;
  })().catch(e => { pdfLib = null; throw e; });
  return pdfLib;
}

// === tekst ================================================================
// Roboto (pdfmakes innebygde font) mangler noen få tegn verktøyet bruker.
// De byttes mot det nærmeste som finnes, så det ikke står tomme ruter.
const GLYPH = { '⌀': 'Ø', 'ϕ': 'φ', '→': '->', '✓': '', '✕': '', ' ': ' ' };
const clean = s => String(s ?? '').replace(/[⌀ϕ→✓✕ ]/g, ch => GLYPH[ch]);

// Symbolene er skrevet som N_Rk,c og h_ef^1,5 i beregningsmodulene. I PDF-en
// settes det som ekte senket/hevet skrift. Et avsluttende komma eller punktum
// hører til setningen, ikke til indeksen.
const SUBSUP = /_([\p{L}\p{Nd},.′]+)|\^(\([^)]*\)|[\p{Nd},./]+)/gu;
function rich(s, style = {}) {
  const str = clean(s), out = [];
  let last = 0;
  for (const m of str.matchAll(SUBSUP)) {
    let tok = m[1] ?? m[2], tail = '';
    const trail = /[,.]+$/.exec(tok);
    if (trail) { tail = trail[0]; tok = tok.slice(0, -tail.length); }
    if (!tok) continue;
    if (m.index > last) out.push({ text: str.slice(last, m.index), ...style });
    if (m[2] && tok.startsWith('(') && tok.endsWith(')')) tok = tok.slice(1, -1);
    out.push({ text: tok, ...style, [m[1] != null ? 'sub' : 'sup']: true });
    if (tail) out.push({ text: tail, ...style });
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push({ text: str.slice(last), ...style });
  return out.length ? out : [{ text: '', ...style }];
}

const pctTxt = u => u === Infinity ? '∞ %' : Number.isFinite(u) ? Math.round(u * 100) + ' %' : '–';
const rUtilColor = u => u === Infinity ? RCOL.bad : !Number.isFinite(u) ? RCOL.tx3
  : u > 1 ? RCOL.bad : u > 0.7 ? RCOL.warn : RCOL.ok;

// Utnyttelsesstolpe, som i resultatlista.
function utilBar(u, w, h = 5) {
  const f = u === Infinity ? 1 : Number.isFinite(u) ? Math.min(1, u) : 0;
  return { canvas: [
    { type: 'rect', x: 0, y: 0, w, h, r: h / 2, color: RCOL.panel3 },
    ...(f > 0 ? [{ type: 'rect', x: 0, y: 0, w: Math.max(h, w * f), h, r: h / 2, color: rUtilColor(u) }] : []),
  ] };
}

// Tynn strek i full bredde.
const rule = (color = RCOL.line, w = PAGE_W, m = [0, 0, 0, 0]) =>
  ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: w, y2: 0, lineWidth: 0.6, lineColor: color }], margin: m });

// Tabelloppsett: bare vannrette streker, som tabellene i appen.
const LAYOUT_LINES = {
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.5,
  vLineWidth: () => 0,
  hLineColor: () => RCOL.line,
  paddingLeft: i => (i === 0 ? 0 : 6), paddingRight: () => 6,
  paddingTop: () => 3.5, paddingBottom: () => 3.5,
};
const LAYOUT_HEAD = {
  ...LAYOUT_LINES,
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : i === 1 ? 0.8 : 0.5,
  hLineColor: (i) => (i === 1 ? RCOL.line2 : RCOL.line),
  fillColor: (i) => (i === 0 ? RCOL.panel2 : null),
  paddingLeft: () => 5,
};
const LAYOUT_BOX = (fill, line) => ({
  hLineWidth: () => 0.7, vLineWidth: () => 0.7,
  hLineColor: () => line, vLineColor: () => line,
  fillColor: () => fill,
  paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8,
});

const th = (t, extra = {}) => ({ text: rich(t), style: 'th', ...extra });

// === figurer ==============================================================
// Figurene er SVG styrt av klassene i style.css. For å få dem inn i PDF-en
// monteres de usynlig i sida (så CSS-en treffer), de beregnede stilene
// skrives inn på hvert element, og SVG-en tegnes til et PNG-bilde.
const SVG_PROPS = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-dasharray', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'letter-spacing'];

async function svgToPng(svg, scale = 2.5) {
  const vb = svg.viewBox.baseVal;
  // Påskrifter kan stikke utenfor viewBox (appen tegner med overflow:visible),
  // så utsnittet utvides til å ta med alt som faktisk er tegnet.
  let box = { x: vb.x, y: vb.y, width: vb.width, height: vb.height };
  try {
    // Bildet tegnes med systemets skrift (webfonten når ikke inn i et
    // SVG-bilde), og den kan være litt bredere - derav luft til sidene.
    const b = svg.getBBox(), px = 0.04 * b.width + 12;
    const x0 = Math.min(box.x, b.x - px), y0 = Math.min(box.y, b.y - 4);
    const x1 = Math.max(box.x + box.width, b.x + b.width + px);
    const y1 = Math.max(box.y + box.height, b.y + b.height + 4);
    box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  } catch { /* uten bbox brukes viewBox */ }

  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const style = SVG_PROPS.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';');
    dst[i].setAttribute('style', style + (cs.display === 'none' ? ';display:none' : ''));
    dst[i].removeAttribute('class');
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  clone.setAttribute('width', box.width);
  clone.setAttribute('height', box.height);

  const url = 'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image();
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
  const cv = document.createElement('canvas');
  cv.width = Math.round(box.width * scale);
  cv.height = Math.round(box.height * scale);
  const g = cv.getContext('2d');
  g.fillStyle = RCOL.panel2;
  g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  return { png: cv.toDataURL('image/png'), w: box.width, h: box.height };
}

// Alle fanene i en figur (snitt x, snitt y, plan …) blir hvert sitt bilde.
async function figureImages(html) {
  if (!html) return [];
  const host = document.createElement('div');
  host.className = 'sheet';
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;visibility:visible';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    const fig = host.querySelector('.fig');
    if (!fig) return [];
    const labels = Object.fromEntries([...fig.querySelectorAll('[data-figview]')]
      .map(b => [b.dataset.figview, b.textContent.trim()]));
    const panels = [...fig.querySelectorAll('[data-figpanel]')];
    for (const p of panels) p.hidden = false;
    const out = [];
    for (const p of (panels.length ? panels : [fig])) {
      const svg = p.querySelector('svg');
      if (!svg) continue;
      const img = await svgToPng(svg);
      const cap = p.querySelector('figcaption')?.textContent.trim().replace(/\s+/g, ' ');
      out.push({ ...img, label: labels[p.dataset.figpanel] || '', caption: cap || '' });
    }
    return out;
  } finally {
    host.remove();
  }
}

// === byggeklosser =========================================================
const h1 = (num, text) => ({
  text: `${num}   ${clean(text)}`, style: 'h1', headlineLevel: 1,
  tocItem: true, tocStyle: { bold: true, fontSize: 10.5 }, tocMargin: [0, 7, 0, 0],
});
const h2 = (num, text, extra = {}) => ({
  text: [{ text: `${num}   ` }, ...rich(text)], style: 'h2', headlineLevel: 2,
  tocItem: true, tocStyle: { fontSize: 9.5, color: RCOL.tx2 }, tocMargin: [18, 2, 0, 0], ...extra,
});
const h3 = text => ({ text: clean(text).toUpperCase(), style: 'h3' });

function kvTable(rows, widths = [170, '*']) {
  return {
    table: { widths, body: rows.map(([k, v]) => [
      { text: clean(k), color: RCOL.tx2 },
      { text: rich(v), color: RCOL.tx },
    ]) },
    layout: LAYOUT_LINES,
  };
}

function note(text, kind = 'info') {
  const [fill, line, color] = kind === 'err' ? [RCOL.badBg, RCOL.badLine, RCOL.bad]
    : kind === 'warn' ? ['#fbf4e6', '#eedcb6', '#8a6414'] : [RCOL.panel2, RCOL.line, RCOL.tx2];
  return {
    table: { widths: ['*'], body: [[{ text: rich(text), color, fontSize: 8.5 }]] },
    layout: { ...LAYOUT_BOX(fill, line), paddingTop: () => 5, paddingBottom: () => 5 },
    margin: [0, 6, 0, 0],
  };
}

// Én linje i utregninga: symbol · forklaring · henvisning, så likhetskjeden.
function stepBlock(s, kind = '') {
  const val = `${n(s.value)}${s.unit ? ' ' + s.unit : ''}`;
  const eq = [[{ text: '=', color: RCOL.tx3, alignment: 'right' },
               { text: rich(s.formula), color: RCOL.tx2 }]];
  if (s.subst && s.subst !== '–')
    eq.push([{ text: '=', color: RCOL.tx3, alignment: 'right' },
             { text: rich(s.subst), color: RCOL.tx2 }]);
  eq.push([{ text: '=', color: RCOL.tx3, alignment: 'right' },
           { text: rich(val), color: RCOL.tx, bold: true, fontSize: kind === 'res' ? 10.5 : 9 }]);
  const body = {
    stack: [
      { columns: [
        { text: rich(s.sym), bold: true, width: 'auto', fontSize: 9.5, noWrap: true },
        { text: rich(s.desc || ''), color: RCOL.tx2, fontSize: 8.5, margin: [10, 0.8, 0, 0] },
        { text: clean(s.ref || ''), color: RCOL.tx3, fontSize: 7.5, width: 'auto',
          alignment: 'right', margin: [10, 1.5, 0, 0] },
      ] },
      { table: { widths: [10, '*'], body: eq },
        layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0,
                  paddingRight: () => 4, paddingTop: () => 1, paddingBottom: () => 1 },
        margin: [8, 3, 0, 0] },
      ...(s.note ? [note(s.note)] : []),
    ],
  };
  if (kind === 'res')
    return { table: { widths: ['*'], body: [[body]] }, layout: LAYOUT_BOX(RCOL.panel2, RCOL.line),
             unbreakable: true, margin: [0, 2, 0, 4] };
  return { stack: [rule(), { ...body, margin: [0, 6, 0, 6] }], unbreakable: true };
}

function finalBlock(check) {
  const pass = check.value <= 1;
  const body = { stack: [
    { columns: [
      { text: 'Utnyttelse', bold: true, width: 'auto', fontSize: 9.5 },
      { text: pass ? 'Kapasiteten holder' : 'Kapasiteten er overskredet',
        alignment: 'right', fontSize: 8, color: pass ? RCOL.ok : RCOL.bad, bold: true },
    ] },
    { table: { widths: [10, '*'], body: [
      [{ text: '=', color: RCOL.tx3, alignment: 'right' },
       { text: [...rich(check.formula), { text: ' ≤ 1,0' }], color: RCOL.tx2 }],
      [{ text: '=', color: RCOL.tx3, alignment: 'right' }, { text: rich(check.subst), color: RCOL.tx2 }],
      [{ text: '=', color: RCOL.tx3, alignment: 'right' },
       { text: `${n(check.value, 3)}   (${pctTxt(check.value)})`, bold: true, fontSize: 11,
         color: rUtilColor(check.value) }],
    ] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0,
                   paddingRight: () => 4, paddingTop: () => 1, paddingBottom: () => 1 },
      margin: [8, 3, 0, 0] },
  ] };
  return { table: { widths: ['*'], body: [[body]] },
           layout: LAYOUT_BOX(pass ? RCOL.okBg : RCOL.badBg, pass ? RCOL.okLine : RCOL.badLine),
           unbreakable: true, margin: [0, 2, 0, 4] };
}

// Kort tekst for E_d/R_d i oversikten - samme som i resultatlista.
function demandTxt(c, applicable) {
  if (!applicable) return clean(c.note || 'Ikke aktuell');
  if (c.requirements)
    return `${c.requirements.filter(it => it.checked !== false && it.ok).length} / ` +
      `${c.requirements.filter(it => it.checked !== false).length} krav oppfylt`;
  if (c.expr) return `${n(c.util, 2)} / 1,00 · ${c.expr}`;
  return `${kN(c.NEd)} / ${kN(c.NRd)} kN`;
}
function utilCell(c, applicable) {
  if (!applicable) return { text: '–', color: RCOL.tx3, alignment: 'right' };
  if (c.binary)
    return { text: c.util > 1 ? 'Ikke OK' : 'OK', bold: true, alignment: 'right',
             color: c.util > 1 ? RCOL.bad : RCOL.ok };
  return { stack: [
    { text: pctTxt(c.util), bold: true, alignment: 'right', color: rUtilColor(c.util) },
    { ...utilBar(c.util, 56, 3.5), margin: [0, 2, 0, 0] },
  ] };
}

// === kapitlene ============================================================
function titlePage(D) {
  const ok = D.verdict.ok;
  const status = D.verdict.invalid || (ok ? 'OK' : 'IKKE OK');
  return [
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 46, h: 4, color: RCOL.acc }], margin: [0, 10, 0, 14] },
    { text: 'BEREGNINGSRAPPORT', fontSize: 9, bold: true, color: RCOL.acc, characterSpacing: 1.6 },
    { text: 'Forankring i betong', fontSize: 30, bold: true, color: RCOL.tx, margin: [0, 6, 0, 0] },
    { text: clean(D.meta.prosjekt || 'Uten prosjektnavn'), fontSize: 16, color: RCOL.tx, margin: [0, 14, 0, 0] },
    ...(D.meta.del ? [{ text: clean(D.meta.del), fontSize: 12, color: RCOL.tx2, margin: [0, 3, 0, 0] }] : []),
    ...(D.images.iso ? [{ image: D.images.iso, width: PAGE_W, margin: [0, 22, 0, 0] }] : []),
    { margin: [0, 18, 0, 0], columns: [
      { width: '*', ...kvTable([
        ['Regelverk', D.standards.generalLabel],
        ['Strekk mot betong', D.standards.tcLabel],
        ['Skjær mot betong', D.standards.scLabel],
        ['Beregnet lastkombinasjon', D.activeCombo],
        ['Styrende kontroll', D.verdict.governing || '–'],
      ], [120, '*']) },
      { width: 130, margin: [18, 0, 0, 0], table: { widths: ['*'], body: [[{ stack: [
        { text: 'MAKS UTNYTTELSE', fontSize: 7, color: RCOL.tx3, bold: true, characterSpacing: 0.6 },
        { text: pctTxt(D.verdict.maxUtil), fontSize: 24, bold: true,
          color: D.verdict.invalid ? RCOL.bad : rUtilColor(D.verdict.maxUtil), margin: [0, 2, 0, 4] },
        utilBar(D.verdict.maxUtil, 108, 5),
        { text: status, bold: true, fontSize: 11, margin: [0, 6, 0, 0],
          color: ok && !D.verdict.invalid ? RCOL.ok : RCOL.bad },
      ] }]] }, layout: LAYOUT_BOX(RCOL.panel2, RCOL.line) },
    ] },
    { margin: [0, 26, 0, 0], table: {
      widths: ['*', '*', '*', 70, 40],
      body: [
        ['Utført av', 'Kontrollert av', 'Godkjent av', 'Dato', 'Rev.'].map(t =>
          ({ text: t, fontSize: 7, color: RCOL.tx3, bold: true })),
        ['', '', '', { text: D.date, fontSize: 9 }, { text: '', fontSize: 9 }].map(c =>
          (typeof c === 'string' ? { text: c, margin: [0, 8, 0, 8] } : { ...c, margin: [0, 8, 0, 8] })),
      ],
    }, layout: {
      hLineWidth: () => 0.6, vLineWidth: () => 0.6,
      hLineColor: () => RCOL.line2, vLineColor: () => RCOL.line2,
      paddingLeft: () => 6, paddingTop: () => 4, paddingBottom: () => 2,
    } },
    { text: '', pageBreak: 'after' },
  ];
}

function tocPage() {
  return [
    { toc: { title: { text: 'Innhold', style: 'h1' }, numberStyle: { color: RCOL.tx2 } } },
    { text: '', pageBreak: 'after' },
  ];
}

function summarySection(D) {
  const out = [h1(1, 'Sammendrag')];
  const ok = D.verdict.ok && !D.verdict.invalid;
  out.push({
    table: { widths: ['*', 'auto'], body: [[
      { stack: [
        { text: D.verdict.invalid || (ok ? 'Alle kontroller er oppfylt' : 'Én eller flere kontroller er ikke oppfylt'),
          bold: true, fontSize: 11, color: ok ? RCOL.ok : RCOL.bad },
        { text: rich(`Styrende: ${D.verdict.governing || '–'} · ` + (D.mode === 'gov'
            ? 'hver kontroll med sin dimensjonerende lastkombinasjon'
            : `lastkombinasjon ${D.activeCombo}`)),
          color: RCOL.tx2, margin: [0, 3, 0, 0] },
      ] },
      { text: pctTxt(D.verdict.maxUtil), fontSize: 20, bold: true,
        color: D.verdict.invalid ? RCOL.bad : rUtilColor(D.verdict.maxUtil), alignment: 'right', noWrap: true },
    ]] },
    layout: LAYOUT_BOX(ok ? RCOL.okBg : RCOL.badBg, ok ? RCOL.okLine : RCOL.badLine),
    margin: [0, 0, 0, 8],
  });
  if (D.comboNote) out.push(note(D.comboNote, 'warn'));
  for (const i of D.issues) out.push(note(i.text, i.level === 'error' ? 'err' : 'warn'));

  out.push(h3('Utnyttelser'));
  // Med dimensjonerende kombinasjon pr. kontroll står kombinasjonen i en egen
  // kolonne - ellers er den den samme for alle, og står i overskrifta.
  const gov = D.mode === 'gov';
  const cols = gov ? 5 : 4;
  const span = (cell) => [{ ...cell, colSpan: cols }, ...Array(cols - 1).fill({})];
  const comboCell = (it, color = RCOL.tx2) => gov ? [{ text: clean(it.combo), color, fontSize: 8 }] : [];
  const body = [[th('Kontroll'), th('Pkt.'), ...(gov ? [th('Lastkomb.')] : []), th('E_d / R_d'),
                 th('Utnyttelse', { alignment: 'right' })]];
  for (const fam of D.families) {
    body.push(span({ text: fam.name.toUpperCase(), bold: true, fontSize: 8,
                     color: RCOL.acc, margin: [0, 5, 0, 0] }));
    for (const cat of fam.categories) {
      if (cat.name) body.push(span({ text: cat.name, color: RCOL.tx2, bold: true,
                                     fontSize: 8, margin: [6, 1, 0, 0] }));
      for (const it of cat.checks)
        body.push([
          { text: [{ text: `${it.num}  `, color: RCOL.tx3 }, ...rich(it.c.mode)],
            margin: [cat.name ? 12 : 0, 0, 0, 0], linkToDestination: it.dest },
          { text: clean(it.c.clause), color: RCOL.tx2, fontSize: 8 },
          ...comboCell(it),
          { text: rich(demandTxt(it.c, it.applicable)), color: RCOL.tx2, fontSize: 8 },
          utilCell(it.c, it.applicable),
        ]);
    }
  }
  if (D.replaced.length) {
    body.push(span({ text: 'ERSTATTET AV TILLEGGSARMERING', bold: true, fontSize: 8,
                     color: RCOL.tx3, margin: [0, 5, 0, 0] }));
    for (const it of D.replaced)
      body.push([
        { text: [{ text: `${it.num}  `, color: RCOL.tx3 }, ...rich(it.c.mode)], color: RCOL.tx3,
          linkToDestination: it.dest },
        { text: clean(it.c.clause), color: RCOL.tx3, fontSize: 8 },
        ...comboCell(it, RCOL.tx3),
        { text: rich(it.c.replacedBy || ''), color: RCOL.tx3, fontSize: 8 },
        { text: pctTxt(it.c.util), color: RCOL.tx3, alignment: 'right' },
      ]);
  }
  out.push({ table: { headerRows: 1, body,
                      widths: gov ? ['*', 48, 48, 130, 58] : ['*', 52, 150, 62] },
             layout: LAYOUT_HEAD });

  if (D.reinforcements.length) {
    out.push(h3('Tilleggsarmering'));
    const rb = [[th('Gruppe'), th('Nødvendig'), th('Valgt'), th('Utnyttelse', { alignment: 'right' }),
                 th('Status', { alignment: 'right' })]];
    for (const r of D.reinforcements)
      rb.push([
        { stack: [{ text: rich(r.label), bold: true },
                  ...r.lines.map(l => ({ text: rich(l), fontSize: 7.5, color: RCOL.tx2, margin: [0, 1, 0, 0] }))] },
        { text: rich(r.need) }, { text: rich(r.chosen) },
        { text: pctTxt(r.worst), alignment: 'right', color: rUtilColor(r.worst), bold: true },
        { text: r.ok ? 'OK' : 'IKKE OK', alignment: 'right', bold: true, color: r.ok ? RCOL.ok : RCOL.bad },
      ]);
    out.push({ table: { headerRows: 1, widths: ['*', 60, 60, 55, 45], body: rb }, layout: LAYOUT_HEAD });
  }
  return out;
}

function modelSection(D) {
  const out = [h1(2, 'Modell og forutsetninger')];
  if (D.images.iso || D.images.view) {
    out.push(h2('2.1', '3D-modell'));
    const imgs = [
      D.images.iso && { image: D.images.iso, label: 'Isometrisk visning' },
      D.images.view && { image: D.images.view, label: 'Visning slik den er stilt inn i programmet' },
    ].filter(Boolean);
    for (const im of imgs)
      out.push({ stack: [
        { image: im.image, width: PAGE_W },
        { text: im.label, fontSize: 8, color: RCOL.tx2, italics: true, margin: [0, 3, 0, 10] },
      ], unbreakable: true });
  }
  out.push(h2('2.2', 'Forutsetninger'));
  out.push(kvTable(D.assumptions));
  if (D.shapes.length) {
    out.push(h3('Betongform tegnet i plan'));
    out.push({ ul: D.shapes.map(s => ({ text: rich(s) })), color: RCOL.tx, margin: [4, 0, 0, 0] });
  }
  out.push(h2('2.3', 'Kraftfordeling i boltegruppa'));
  for (const set of D.anchorSets) {
    const body = [[th('Bolt'), th('x [mm]', { alignment: 'right' }), th('y [mm]', { alignment: 'right' }),
                   th('N [kN]', { alignment: 'right' }), th('V [kN]', { alignment: 'right' })]];
    for (const a of set.anchors)
      body.push([String(a.id), { text: String(a.x), alignment: 'right' }, { text: String(a.y), alignment: 'right' },
                 { text: a.N > 1 ? kN(a.N) : '–', alignment: 'right' }, { text: kN(a.V), alignment: 'right' }]);
    out.push({ stack: [
      { text: clean(set.title), bold: true, margin: [0, 8, 0, 1] },
      { text: rich(set.loads), fontSize: 7.5, color: RCOL.tx2, margin: [0, 0, 0, 4] },
      { table: { headerRows: 1, widths: [40, '*', '*', '*', '*'], body }, layout: LAYOUT_HEAD },
      ...set.notes.map(t => ({ text: rich(t), fontSize: 8, color: RCOL.tx2, margin: [0, 4, 0, 0] })),
    ], unbreakable: true });
  }
  return out;
}

function settingsSection(D) {
  const out = [h1(3, 'Innstillinger')];
  out.push({ text: 'Alle valg og inndata slik de er satt i programmet.', color: RCOL.tx2, margin: [0, 0, 0, 4] });
  D.settings.forEach((g, i) => {
    out.push(h2(`3.${i + 1}`, g.title));
    if (!g.rows.length) {
      out.push({ text: g.empty || 'Ingen.', color: RCOL.tx2 });
      return;
    }
    const body = [];
    for (const r of g.rows) {
      if (r.section) {
        body.push([{ text: clean(r.section), colSpan: 2, bold: true, fontSize: 8, color: RCOL.acc,
                     margin: [0, 5, 0, 0] }, {}]);
        continue;
      }
      body.push([{ text: rich(r[0]), color: RCOL.tx2 }, { text: rich(r[1]) }]);
    }
    out.push({ table: { widths: [200, '*'], body, dontBreakRows: true }, layout: LAYOUT_LINES });
  });
  return out;
}

function combosSection(D) {
  const out = [h1(4, 'Lastkombinasjoner')];
  const gov = D.mode === 'gov';
  out.push({ text: rich('Laster i kN og kNm. Bruddgrensekombinasjonene er regnet ut hver for seg; ' +
    (gov ? 'hver kontroll i kapittel 5 er regnet med den kombinasjonen som gir høyest utnyttelse ' +
           'for den kontrollen. Under utnyttelsen står hvilke kontroller kombinasjonen er ' +
           'dimensjonerende for.'
         : 'utregningene i kapittel 5 gjelder kombinasjonen merket *.')),
    color: RCOL.tx2, margin: [0, 0, 0, 8] });
  const r = { alignment: 'right' };
  const body = [[th(''), th('Navn'), th('Grense'), th('N', r), th('V_x', r), th('V_y', r),
                 th('M_x', r), th('M_y', r), th('M_z', r), th('Utnyttelse', r)]];
  for (const c of D.combos) {
    const cell = (v, dec) => ({ text: n(v, dec), alignment: 'right' });
    body.push([
      { text: c.active && !gov ? '*' : '', bold: true, color: RCOL.acc },
      { text: clean(c.name), bold: (c.active && !gov) || c.governing },
      { text: c.limitLabel, color: RCOL.tx2 },
      cell(c.N / 1000, 1), cell(c.Vx / 1000, 1), cell(c.Vy / 1000, 1),
      cell(c.Mx / 1e6, 2), cell(c.My / 1e6, 2), cell(c.Mz / 1e6, 2),
      { stack: [
        { text: c.utilText, bold: true, alignment: 'right', color: c.utilColor ?? rUtilColor(c.util) },
        ...(c.governingMode ? [{ text: rich(c.governingMode), fontSize: 6.5, color: RCOL.tx3, alignment: 'right' }] : []),
        ...(gov && c.governs?.length ? [{ text: `dim. for ${c.governs.join(', ')}`, fontSize: 6.5,
                                          color: RCOL.acc, alignment: 'right' }] : []),
      ] },
    ]);
  }
  out.push({ table: { headerRows: 1, widths: [8, '*', 50, 34, 34, 34, 34, 34, 34, 72], body },
             layout: { ...LAYOUT_HEAD, fillColor: (i) => (i === 0 ? RCOL.panel2 : D.combos[i - 1]?.governing ? '#f3f8f7' : null) },
             fontSize: 8 });
  out.push({ text: rich(D.combosNote), fontSize: 8, color: RCOL.tx2, margin: [0, 6, 0, 0] });
  return out;
}

async function checksSection(D) {
  const out = [h1(5, 'Kontroller')];
  const gov = D.mode === 'gov';
  out.push({ text: rich(gov
    ? 'Hver kontroll er regnet med sin dimensjonerende lastkombinasjon – den ' +
      'bruddgrensekombinasjonen som gir høyest utnyttelse for akkurat den kontrollen. ' +
      'Kombinasjonen og lastene står under overskrifta til hver kontroll.'
    : `Full utregning for lastkombinasjon ${D.activeCombo}. ` +
      'Tallene er de samme som i programmets utregningsark.'), color: RCOL.tx2, margin: [0, 0, 0, 6] });

  for (const it of D.allChecks) {
    const c = it.c, cal = c.calc;
    const head = [
      h2(it.num, c.mode, { id: it.dest, margin: [0, 16, 0, 2] }),
      { text: clean(`${c.standard ?? D.standard} · pkt. ${c.clause}`), fontSize: 8, color: RCOL.tx3,
        margin: [0, 0, 0, gov ? 2 : 6] },
      ...(gov ? [{ text: [{ text: `Dimensjonerende lastkombinasjon: ${clean(it.combo)}`, bold: true,
                            color: RCOL.acc },
                          { text: '   ' }, ...rich(it.comboLoads)],
                   fontSize: 8, color: RCOL.tx2, margin: [0, 0, 0, 6] }] : []),
    ];
    if (it.applicable && !c.binary)
      head.push({ columns: [
        { text: pctTxt(c.util), fontSize: 16, bold: true, color: rUtilColor(c.util), width: 64 },
        { ...utilBar(c.util, PAGE_W - 64, 7), margin: [0, 7, 0, 0] },
      ], margin: [0, 0, 0, 4] });
    else if (it.applicable)
      head.push({ text: c.util > 1 ? 'Ikke OK' : 'OK', fontSize: 14, bold: true,
                  color: c.util > 1 ? RCOL.bad : RCOL.ok, margin: [0, 0, 0, 4] });
    out.push({ stack: head, unbreakable: true });

    if (c.replacedBy)
      out.push(note(`Erstattet av ${c.replacedBy} som dimensjonerende bruddform, men fortsatt regnet ut i sin helhet under.`));
    if (cal?.skipped) { out.push(note(cal.skipped)); continue; }

    if (c.requirements) {
      out.push(h3('Enkeltkrav'));
      const body = [[th('Pkt'), th('Krav (ordrett, NS-EN 1992-4:2018 (E))'), th('Vurdering'), th('Kommentar')]];
      for (const q of c.requirements) {
        const verdict = q.checked === false ? 'Kontrolleres separat' : q.ok ? 'OK' : 'Ikke OK';
        const color = q.checked === false ? RCOL.warn : q.ok ? RCOL.ok : RCOL.bad;
        body.push([{ text: clean(q.letter) + ')', bold: true }, { text: rich(q.quote), fontSize: 8 },
                   { text: verdict, bold: true, color },
                   { text: rich(q.comment || ''), fontSize: 8, color: RCOL.tx2 }]);
      }
      out.push({ table: { headerRows: 1, widths: [22, '*', 44, 150], body, dontBreakRows: true },
                 layout: LAYOUT_HEAD });
    }
    if (!cal) { out.push({ text: 'Ingen utregning registrert.', color: RCOL.tx2 }); continue; }

    const figs = await figureImages(it.figure);
    if (figs.length) {
      out.push(h3('Figur'));
      for (const f of figs) {
        const w = Math.min(PAGE_W * 0.85, f.w * 0.62);
        out.push({ stack: [
          ...(f.label ? [{ text: clean(f.label), bold: true, fontSize: 8, color: RCOL.tx2, margin: [0, 0, 0, 3] }] : []),
          { image: f.png, width: w, alignment: 'center' },
          ...(f.caption ? [{ text: rich(f.caption), fontSize: 7.5, color: RCOL.tx2, margin: [0, 3, 0, 0] }] : []),
        ], unbreakable: true, margin: [0, 0, 0, 10] });
      }
    }

    if (cal.inputs.length) {
      const body = [[th('Symbol'), th('Verdi', { alignment: 'right' }), th(''), th('Hentet fra')]];
      for (const i of cal.inputs)
        body.push([{ text: rich(i.sym), bold: true }, { text: n(i.value), alignment: 'right' },
                   { text: rich(i.unit), color: RCOL.tx2 }, { text: rich(i.source), color: RCOL.tx2, fontSize: 8 }]);
      // Overskrifta holdes sammen med det som står under, så den ikke blir
      // stående alene nederst på en side.
      out.push({ stack: [h3('Inndata'), { table: { headerRows: 1, widths: [80, 60, 40, '*'], body,
                 dontBreakRows: true }, layout: LAYOUT_HEAD }], unbreakable: true });
    }
    if (cal.steps.length) {
      cal.steps.forEach((s, i) => out.push(i ? stepBlock(s)
        : { stack: [h3('Utregning'), stepBlock(s)], unbreakable: true }));
    }
    if (cal.result) {
      out.push({ stack: [h3('Kapasitet'), stepBlock(cal.result, 'res')], unbreakable: true });
    }
    if (cal.check) {
      out.push({ stack: [h3('Kontroll'), finalBlock(cal.check)], unbreakable: true });
    }
    if (c.note) out.push(note(c.note));
  }
  return out;
}

// === dokumentet ===========================================================
export async function reportPdf(D) {
  const pdfMake = await pdfMakeLib();
  const content = [
    ...titlePage(D),
    ...tocPage(),
    ...summarySection(D),
    ...modelSection(D),
    ...settingsSection(D),
    ...combosSection(D),
    ...(await checksSection(D)),
  ];
  const doc = {
    pageSize: 'A4',
    pageMargins: [50, 62, 50, 52],
    info: { title: `Beregningsrapport – ${clean(D.meta.prosjekt || 'forankring')}`,
            subject: 'Forankring i betong', creator: 'Bruddkjegle' },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: RCOL.tx, lineHeight: 1.2 },
    styles: {
      h1: { fontSize: 16, bold: true, color: RCOL.tx, margin: [0, 0, 0, 10] },
      h2: { fontSize: 11.5, bold: true, color: RCOL.tx, margin: [0, 14, 0, 6] },
      h3: { fontSize: 7.5, bold: true, color: RCOL.tx3, characterSpacing: 0.6, margin: [0, 12, 0, 4] },
      th: { fontSize: 7.5, bold: true, color: RCOL.tx2 },
    },
    header: (page) => page === 1 ? null : {
      margin: [50, 26, 50, 0],
      stack: [
        { columns: [
          { text: clean(D.meta.prosjekt || ''), fontSize: 7.5, color: RCOL.tx2, bold: true },
          { text: 'Beregningsrapport · forankring i betong', fontSize: 7.5, color: RCOL.tx3, alignment: 'right' },
        ] },
        { ...rule(RCOL.line, PAGE_W), margin: [0, 4, 0, 0] },
      ],
    },
    footer: (page, count) => page === 1 ? null : {
      margin: [50, 16, 50, 0],
      columns: [
        { text: clean(`${D.date} · ${D.standards.generalLabel}`), fontSize: 7.5, color: RCOL.tx3 },
        { text: `Side ${page} av ${count}`, fontSize: 7.5, color: RCOL.tx2, alignment: 'right' },
      ],
    },
    // Overskrift nederst på sida flyttes til neste side sammen med innholdet.
    // Hvert kapittel begynner på ny side.
    pageBreakBefore: (node) => node.headlineLevel === 1
      ? node.startPosition?.verticalRatio > 0.02
      : node.headlineLevel === 2 && node.startPosition?.verticalRatio > 0.8,
    content,
  };
  const pdf = pdfMake.createPdf(doc);
  return new Promise((ok, bad) => {
    try { pdf.getBlob(ok); } catch (e) { bad(e); }
  });
}
