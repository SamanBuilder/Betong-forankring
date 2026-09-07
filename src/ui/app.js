// ---------------------------------------------------------------------------
//  Applikasjonslag: skjema -> modell -> beregning -> 3D + resultat.
//
//  Tre ruter: inndata med gruppevelger, visning (3D eller utregningsark),
//  og resultatlista som alltid står. Klikker du en kontroll, viser midtruta
//  hele utregninga for den - resultatlista blir stående ved siden av.
// ---------------------------------------------------------------------------

import { defaultModel, CONCRETE_GRADES, STUD_STEELS, studSize, rodSize,
         autoSpacing, boltsOutside, syncLoad, combo, nextComboId,
         LIMIT_STATES, anchorFoot, steelsFor, defaultSteel, endsFor,
         syncPlan, migratePlan, setPlanBox } from '../core/model.js';
import { verify } from '../engine/verify.js';
import { buildScene } from '../viz/scene-builder.js';
import { FIELDS, barSizes, get, set, shapeFields, shapeName } from './fields.js';
import { planShapes, shapeLoop, shapeZ, loopArea, isShaped,
         SHAPE_LABEL, OP_LABEL } from '../engine/solid.js';
import { PlanEditor, TOOLS } from './plan-editor.js';
import { n, kN } from '../engine/calc.js';
import { saveFile, saveError } from '../core/download.js';
import '../viz/three-d-stage.js';

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c;
                          if (h != null) e.innerHTML = h; return e; };
const pct = u => Number.isFinite(u) ? Math.round(u * 100) + ' %' : '–';
const esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

const MOUNT_TXT = { direct: 'direkte mot betong', grout: 'undergyting',
                    standoff: 'avstandsmontert' };
const BAR_TXT = { stud: 'Sveisebolt', rebar: 'Kamstål', rod: 'Gjengestang/bolt' };
const END_TXT = { nut: 'endemutter', plate: 'felles endeplate',
                  hook: 'endekrok', none: 'uten endemutter (heft)' };

const REINF_DEFAULT = () =>
  ({ ds: 12, n: 4, l1: 300, hooked: true, goodBond: true, fyk: 500, nV: 0, dsV: 12, fykV: 500 });

let model = Object.assign(defaultModel(), { reinf: REINF_DEFAULT() });
let showOpts = { cone: true, wedge: true, loads: true, labels: false, concrete: true,
                 rebar: true, dims: true, colorMode: 'material', shape: null };
let hudItems = [];        // {el, pos, quat, scale} – sendes til stage.setLabels
let activeGroup = 'Betongdel';
let activeCheck = null;
let viewTab = '3d';

// Kort sammendrag pr. gruppe, så velgeren viser tilstanden uten at du åpner den.
const SUMMARY = {
  'Regelverk': m => m.code.standard === 'EN1992-4' ? 'EN 1992-4' : 'B19',
  'Betongdel': m => m.concrete.grade,
  'Betongform': m => {
    const list = planShapes(m);
    if (!isShaped(m)) return 'rett kloss';
    return `${list.length} form${list.length > 1 ? 'er' : ''}`;
  },
  'Forankringsplate': m => m.plate.present
    ? `${m.plate.bx}×${m.plate.by}` : 'uten plate',
  'Bolter': m => `${m.anchors.nx * m.anchors.ny} × ` +
    `${m.anchors.barType === 'rod' ? 'M' : '⌀'}${m.anchors.d} · ` +
    `${END_TXT[m.anchors.endType]}`,
  'Forankringsarmering': m => `${m.reinf.n} × ⌀${m.reinf.ds}`,
  'Laster': m => `N ${kN(m.load.N)} kN`,
};

function sync(m) {
  const g = CONCRETE_GRADES.find(x => x.id === m.concrete.grade);
  if (g) m.concrete.fck = g.fck;
  syncPlan(m);                  // L_x/L_y mot plantegninga

  const a = m.anchors;
  // Stangtypen er styrende: stålkvalitet, forankringsende og innfesting må
  // høre til typen. Ugyldige kombinasjoner rettes opp her - også når de
  // kommer fra ei prosjektfil som er lagra før reglene ble strammet inn.
  if (!steelsFor(a.barType).some(x => x.id === a.steel))
    a.steel = defaultSteel(a.barType);
  if (!endsFor(a.barType).includes(a.endType))
    a.endType = endsFor(a.barType)[0];
  // Sveisebolt er sveist per definisjon, og kamstål festes sveist til plata.
  if (a.barType !== 'rod') a.attachment = 'welded';

  const s = STUD_STEELS.find(x => x.id === a.steel);
  if (s) { a.fyk = s.fyk; a.fuk = s.fuk; a.ductile = s.ductile; }

  // Stangtypen bestemmer hvilke diametre som finnes. Bytter du type, flyttes
  // valget til nærmeste dimensjon i den nye tabellen.
  if (a._barLast !== a.barType) {
    const sizes = barSizes(m).map(o => o[0]);
    if (!sizes.includes(a.d))
      a.d = sizes.reduce((b, v) => (Math.abs(v - a.d) < Math.abs(b - a.d) ? v : b));
    a._barLast = a.barType;
    a._dLast = null;            // tving nye fotmål fra tabellen
  }
  // Foten settes fra standardtabellen når diameteren endres, men en verdi
  // brukeren selv har skrevet får stå til diameteren endres igjen.
  if (a._dLast !== a.d) {
    if (a.barType === 'rod') { a.dh = rodSize(a.d).NV; a.k = Math.round(0.8 * a.d); }
    else if (a.barType === 'rebar') {
      // Kamstål er ikke gjenget: mutteren sveises på, dimensjonert som en
      // vanlig sekskantmutter for stanga - samme nøkkelviddeformel som
      // gjengestangas fallback utenfor tabellen.
      a.dh = Math.round(1.6 * a.d); a.k = Math.round(0.8 * a.d);
    } else { const ss = studSize(a.d); a.dh = ss.dh; a.k = ss.k; }
    a._dLast = a.d;
  }

  m.reinf.fykV = m.reinf.fyk;
  syncLoad(m);                  // `load` peker på den aktive kombinasjonen
  // Sveiste bolter har ingen hullklaring, så alle tar skjær. Uten plate er det
  // ingen hull i det hele tatt.
  if (!m.plate.present || a.attachment === 'welded') m.code.holeClearanceFilled = true;
  return m;
}

// Slår ei lagra prosjektfil sammen med standardmodellen, ett nivå djupt, så
// felt som er lagt til etter fila blei lagra likevel får ein fornuftig verdi.
function mergeModel(loaded) {
  const base = Object.assign(defaultModel(), { reinf: REINF_DEFAULT() });
  for (const k of Object.keys(base)) {
    const v = loaded[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(base[k], v);
    else if (v !== undefined) base[k] = v;
  }
  // Ei fil lagra før plantegninga har «snitt i flatene» i stedet for former.
  // Den gjøres om, så gamle prosjekt åpner med den samme geometrien.
  if (loaded.concrete && !Array.isArray(loaded.concrete.plan)) {
    base.concrete.plan = null;
    base.concrete.features = loaded.concrete.features || [];
    migratePlan(base);
  }
  return syncPlan(base);
}

// Antall bolter er endret: velg en senteravstand som holder dem innenfor plata
// med jevn deling og kantavstand i [30, 50] mm. Skriver brukeren en egen verdi
// etterpå, står den - til antallet endres igjen.
function applyAutoSpacing(axis) {
  const a = model.anchors, p = model.plate;
  if (!p.present) return;
  if (axis === 'x') a.sx = autoSpacing(p.bx, a.nx) || a.sx;
  else a.sy = autoSpacing(p.by, a.ny) || a.sy;
}

const visibleGroups = () => FIELDS.filter(g => !g.when || g.when(model));

// === inndata ==============================================================
function renderGroups() {
  const host = $('#groups');
  host.innerHTML = '';
  const groups = visibleGroups();
  if (!groups.some(g => g.group === activeGroup)) activeGroup = groups[0].group;
  for (const g of groups) {
    const b = el('button', null,
      `${g.group}<i>${SUMMARY[g.group] ? esc(SUMMARY[g.group](model)) : ''}</i>`);
    b.setAttribute('aria-current', String(g.group === activeGroup));
    b.onclick = () => { activeGroup = g.group; renderGroups(); renderForm(); };
    host.appendChild(b);
  }
}

function renderForm() {
  const host = $('#form');
  host.innerHTML = '';
  const grp = visibleGroups().find(g => g.group === activeGroup);
  if (!grp) return;
  host.appendChild(el('h3', null, grp.group));
  if (grp.custom === 'shapes') { renderShapes(host); return; }
  for (const f of grp.items) {
    if (f.when && !f.when(model)) continue;
    host.appendChild(field(f));
  }

  if (activeGroup === 'Bolter' && !model.code.supplementaryReinf)
    host.appendChild(el('p', 'hint',
      'Forankringsarmering slås på under Regelverk. Da erstatter armerings­kontrollen ' +
      'betongkjeglebruddet.'));
  if (activeGroup === 'Bolter' && model.anchors.endType === 'none')
    host.appendChild(el('p', 'hint',
      'Uten endemutter finnes ingen kjeglebruddmodell i NS-EN 1992-4. ' +
      'Heftforankringen er dekket av Betongelementboka B19 pkt. 19.3.3 ' +
      '(kamstål) og 19.3.4 (gjengestang) – velg B19 under Regelverk.'));
  if (activeGroup === 'Forankringsplate' && !model.plate.present)
    host.appendChild(el('p', 'hint',
      'Uten plate regnes boltene som dybler: skjærkapasiteten i betongen ' +
      'faller til ⌀²·√(f_cd·f_yd), og stålets bøyning over utkraginga blir ' +
      'ofte begrensende (B19 pkt. 19.4.2).'));
}

// === betongform ===========================================================
//  Formene i plantegninga. Lista er ikke fast som de andre gruppene - den
//  vokser med det du tegner - saa den bygges her i stedet for i fields.js.
//
//  Ruta og plantegninga er to vindu inn i den samme lista: velger du en form
//  her, staar den fram i tegninga og i 3D, og omvendt.
// ===========================================================================
let selectedShape = null;
let planner = null;

function selectShape(id) {
  selectedShape = id;
  showOpts.shape = id;
}

// Den minste forma som dekker punktet - saa en liten form oppi en stor kan
// velges ved aa klikke paa den.
function pickShapeAt(p) {
  let best = null, bestA = Infinity;
  for (const sh of planShapes(model)) {
    const pts = shapeLoop(sh);
    if (pts.length < 3) continue;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x)) inside = !inside;
    }
    if (!inside) continue;
    const A = Math.abs(loopArea(pts));
    if (A < bestA) { bestA = A; best = sh; }
  }
  return best;
}

function renderShapes(host) {
  host.appendChild(el('p', 'hint',
    'Betongdelen er tegnet i plan. Hver form er et rektangel, en sirkel ' +
    'eller ei lukka linjefigur, og legger betong til eller tar den bort. ' +
    'Ligger flere former oppi hverandre, blir de skåret der linjene møtes: ' +
    'det er omrisset som er delen. Tegn og mål i <b>Plan</b>-fana.'));

  const row = el('div', 'feat-add');
  const goPlan = el('button', 'btn', 'Åpne plantegninga');
  goPlan.onclick = () => { setViewTab('plan'); };
  const box = el('button', 'btn ghost', 'Tilbake til rektangel');
  box.title = 'Erstatter hele tegninga med ett rektangel på dagens utstrekning';
  box.onclick = () => {
    setPlanBox(model, model.concrete.Lx, model.concrete.Ly);
    selectShape(null);
    refresh(true);
  };
  row.append(goPlan, box);
  host.appendChild(row);

  const list = planShapes(model);
  list.forEach((sh, i) => {
    const card = el('div', 'feat' + (sh.id === selectedShape ? ' on' : ''));
    const head = el('div', 'feat-head');
    const nm = el('button', 'nm', esc(shapeName(sh, i)));
    nm.onclick = () => { selectShape(sh.id === selectedShape ? null : sh.id); refresh(true); };
    head.appendChild(nm);
    head.appendChild(el('span', 'kind',
      esc(sh.op === 'cut' ? 'tar betong bort' : 'legger betong')));
    const del = el('button', 'btn ghost', 'Slett');
    del.title = 'Fjern denne forma';
    del.onclick = () => {
      model.concrete.plan.splice(i, 1);
      if (selectedShape === sh.id) selectShape(null);
      refresh(true);
    };
    head.appendChild(del);
    card.appendChild(head);

    // Høyda: enten følger forma tykkelsen, eller så har den sin egen
    // over- og underkant. Boksen er inngangen til begge deler.
    const [z0, z1] = shapeZ(model, sh);
    const auto = sh.z0 == null && sh.z1 == null;
    const fld = el('label', 'fld bool');
    fld.appendChild(el('span', 'lbl', 'Gjennom hele tykkelsen'));
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = auto;
    cb.onchange = () => {
      if (cb.checked) { sh.z0 = null; sh.z1 = null; }
      else { sh.z0 = z0; sh.z1 = z1; }
      refresh(true);
    };
    fld.appendChild(cb);
    card.appendChild(fld);

    for (const f of shapeFields(model, i)) card.appendChild(field(f));
    if (sh.kind === 'poly')
      card.appendChild(el('p', 'hint',
        `${sh.pts.length} hjørner. Målene på linjene redigeres i plantegninga.`));
    host.appendChild(card);
  });

  host.appendChild(el('p', 'hint',
    'Den valgte forma står fram i 3D med to piler: dra i dem for å flytte ' +
    'over- og underkanten. Da får forma sin egen høyde i stedet for å følge ' +
    'tykkelsen h.'));
}

function field(f) {
  const wrap = el('label', 'fld');
  const label = typeof f.l === 'function' ? f.l(model) : f.l;
  wrap.appendChild(el('span', 'lbl', esc(label) + (f.u ? ` <i>${esc(f.u)}</i>` : '')));
  let input;
  if (f.t === 'bool') {
    input = el('input'); input.type = 'checkbox'; input.checked = !!get(model, f.p);
    wrap.classList.add('bool');
    input.onchange = () => { set(model, f.p, input.checked); refresh(true); };
  } else if (f.t === 'select') {
    input = el('select');
    const opts = typeof f.o === 'function' ? f.o(model) : f.o;
    for (const [v, t] of opts) { const o = el('option', null, esc(t)); o.value = v; input.appendChild(o); }
    input.value = String(get(model, f.p));
    input.onchange = () => { set(model, f.p, f.num ? +input.value : input.value); refresh(true); };
  } else {
    input = el('input'); input.type = 'number'; input.step = f.step ?? 1;
    if (f.min != null) input.min = f.min;
    // `val` er den verdien feltet skal VISE når modellen ikke har et tall selv
    // - som over- og underkanten på en form som følger tykkelsen.
    const raw = f.val != null ? f.val : get(model, f.p);
    input.value = f.t === 'kn' ? raw / 1000 : f.t === 'knm' ? raw / 1e6 : raw;
    // Avledede felt vises, men kan ikke skrives i: da er det tydelig hvor
    // verdien kommer fra.
    if (typeof f.ro === 'function' ? f.ro(model) : f.ro) {
      input.disabled = true;
      wrap.classList.add('ro');
    }
    const commit = () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      set(model, f.p, f.t === 'kn' ? v * 1000 : f.t === 'knm' ? v * 1e6 : v);
      if (f.auto) applyAutoSpacing(f.auto);
      refresh(!!f.auto);
    };
    // Felt som bygger om skjemaet må vente til du er ferdig å skrive, ellers
    // rives feltet vekk under fingrene på deg midt i et tall.
    if (f.auto) input.onchange = commit; else input.oninput = commit;
  }
  input.autocomplete = 'off';
  if (f.hint) input.title = f.hint;
  wrap.appendChild(input);
  return wrap;
}

// === resultat =============================================================
const utilCss = u => !Number.isFinite(u) ? 'var(--tx3)'
  : u > 1 ? 'var(--bad)' : u > 0.7 ? 'var(--warn)' : 'var(--ok)';

const family = c => c.id.startsWith('IA') ? 'Samvirkning'
  : c.id.startsWith('N') ? 'Strekk' : 'Skjær';

const applicable = c => c.expr ? Number.isFinite(c.util)
  : Number.isFinite(c.util) && Number.isFinite(c.NRd);

function bar(u, cls = '') {
  const w = Number.isFinite(u) ? Math.min(100, u * 100) : 0;
  return `<div class="track ${u > 1 ? 'full' : ''} ${cls}">` +
         `<i style="width:${w}%;background:${utilCss(u)}"></i></div>`;
}

// Kortere navn enn c.mode, kun for den trange stolpeoversikten.
const SHORT_NAME = { 'V-pryout': 'Pry-out' };
// Uten mellomrom foran %-tegnet - kun her, resten av appen bruker pct().
const pctTight = u => Number.isFinite(u) ? Math.round(u * 100) + '%' : '–';

// Alle utnyttelsene i ett samlet oversiktsbilde: loddrette stolper med navnet
// loddrett til venstre for stolpen, prosenten vannrett rett under, og en
// felles 100 %-strek på tvers. Trykk for å hoppe til utregningsarket,
// akkurat som radene lenger ned i lista.
const USUM_CAP = 1.3;      // stolpen klippes ved 130 % av grensa
const USUM_H = 84;         // px – høyden som tilsvarer 100 %

function renderUtilSummary(v) {
  const list = v.checks.filter(applicable);
  if (!list.length) return null;
  const wrap = el('div', 'usum');
  const track = el('div', 'usum-track');
  const plot = el('div', 'usum-plot');
  plot.appendChild(el('div', 'usum-100', `<b>100%</b>`));
  for (const c of list) {
    const item = el('button', 'usum-item' + (c.util > 1 ? ' over' : ''));
    item.setAttribute('aria-current', String(activeCheck === c.id));
    item.title = `${c.mode} · ${pct(c.util)}`;
    const h = Math.round(Math.min(c.util, USUM_CAP) * USUM_H);
    item.innerHTML =
      `<span class="nm">${esc(SHORT_NAME[c.id] ?? c.mode)}</span>` +
      `<span class="stack">` +
        `<span class="col"><i style="height:${h}px;background:${utilCss(c.util)}"></i></span>` +
        `<span class="pc">${pctTight(c.util)}</span>` +
      `</span>`;
    item.onclick = () => { activeCheck = c.id; setViewTab('calc'); refresh(false); };
    plot.appendChild(item);
  }
  track.appendChild(plot);
  wrap.appendChild(track);
  return wrap;
}

// Formen på betongdelen hører hjemme i forutsetningene: leseren av en
// beregning må se at kapasitetene ikke er regnet av en rett kloss.
function concreteShapeTxt(m) {
  const c = m.concrete;
  const base = `${c.Lx}×${c.Ly}×${c.h} mm`;
  if (!isShaped(m)) return base;
  const list = planShapes(m);
  const cuts = list.filter(f => f.op === 'cut').length;
  const adds = list.length - cuts;
  const kinds = [...new Set(list.map(f => SHAPE_LABEL[f.kind]))]
    .join(' + ').toLowerCase();
  const txt = [`${adds} form${adds > 1 ? 'er' : ''}`,
               cuts ? `${cuts} utsparing${cuts > 1 ? 'er' : ''}` : null]
    .filter(Boolean).join(' · ');
  return `tegnet i plan (${txt}: ${kinds}) · omriss ${base}`;
}

function renderResults(v) {
  const m = model, a = m.anchors, g = v.gamma;
  const foot = anchorFoot(m);
  $('#verdict').innerHTML = Number.isFinite(v.maxUtil)
    ? `<span style="color:${utilCss(v.maxUtil)}">maks ${pct(v.maxUtil)}</span> · ${esc(v.governing.mode)}`
    : 'ingen kontroller';

  const host = $('#results');
  host.innerHTML = '';

  const rows = [
    ['Lastkombinasjon', `${model.load.name} · ${
      model.load.limit === 'uls' ? 'bruddgrense' : 'bruksgrense'}`],
    ['Regelverk (stål/samvirkning)', v.standards.generalLabel],
    ['— strekk mot betong', v.standards.tcLabel],
    ['— skjær mot betong', v.standards.scLabel],
    ['Betong', `${m.concrete.grade} · f_ck ${m.concrete.fck} N/mm²`],
    ['Betongdel', concreteShapeTxt(m)],
    ['Tilstand', m.code.cracked ? 'Opprisset' : 'Uopprisset'],
    ['Bolter', `${a.nx}×${a.ny} ${a.barType === 'rod' ? 'M' : '⌀'}${a.d} · ` +
      `${a.endType === 'none' ? 'l_b' : 'h_ef'} ${a.hef} mm`],
    ['Stangtype', `${BAR_TXT[a.barType]} · ${END_TXT[a.endType]}`],
    ['Forankringsfot', foot.hasFoot
      ? `${n(foot.eff, 0)} mm · netto A_h = ${n(foot.Ah, 0)} mm²` +
        (foot.limited ? ' (begrenset av u ≤ t)' : '')
      : 'ingen – heftforankring langs stanga'],
    ['Stål', `${a.steel}`],
    ['Plate', m.plate.present
      ? `${m.plate.bx}×${m.plate.by}×${m.plate.t} mm · ${MOUNT_TXT[m.plate.mount]}`
      : `ingen plate · utkraging e = ${m.plate.e} mm`],
    ['Innfesting', !m.plate.present ? 'Fritt stående dybler'
      : a.attachment === 'welded' ? 'Sveist til plata' : 'Gjennomboltet'],
    ['Materialfaktorer', g.gMsN
      ? `γ_Ms,N ${n(g.gMsN, 2)} · γ_Ms,V ${n(g.gMsV, 2)} · γ_Mc ${n(g.gMc, 2)}`
      : g.gc ? `γ_c ${n(g.gc, 2)} · γ_M0 ${n(g.gM0, 2)} · γ_M2 ${n(g.gM2, 2)}` +
               (g.steel === 'rebar' ? ` · γ_s ${n(g.gS, 2)}` : '') : '–'],
  ];
  const ass = el('div', 'assump');
  for (const [k, val] of rows)
    ass.appendChild(el('div', 'row', `<span class="k">${esc(k)}</span><span class="v">${esc(val)}</span>`));
  host.appendChild(ass);

  const usum = renderUtilSummary(v);
  if (usum) host.appendChild(usum);

  for (const i of v.issues)
    host.appendChild(el('div', 'msg ' + (i.level === 'error' ? 'err' : 'warn'), esc(i.text)));
  if (v.bearing && !v.bearing.ok)
    host.appendChild(el('div', 'msg warn',
      `Kontakttrykk ${n(v.bearing.sigma, 2)} N/mm² > f_cd ${n(v.bearing.fcd, 2)} N/mm². ` +
      'Øk plata eller betongfastheten.'));
  for (const fam of ['Strekk', 'Skjær', 'Samvirkning']) {
    const list = v.checks.filter(c => family(c) === fam)
      .sort((x, y) => (applicable(y) ? y.util : -1) - (applicable(x) ? x.util : -1));
    if (!list.length) continue;
    host.appendChild(el('h3', 'sect', fam));
    for (const c of list) host.appendChild(checkRow(c));
  }

  host.appendChild(el('h3', 'sect', 'Kraftfordeling i boltegruppa'));
  const wrap = el('div', 'pad');
  const t = el('table', 'anchors');
  t.innerHTML = '<thead><tr><th>Bolt</th><th>x</th><th>y</th><th>N</th><th>V</th></tr></thead>' +
    '<tbody>' + v.res.anchors.map(an =>
      `<tr><td>${an.id}</td><td>${an.x}</td><td>${an.y}</td>` +
      `<td>${an.N > 1 ? kN(an.N) : '–'}</td><td>${kN(an.V)}</td></tr>`).join('') + '</tbody>';
  wrap.appendChild(t);
  wrap.appendChild(el('p', 'hint', m.plate.present
    ? 'x, y i mm fra platesenter. N, V i kN.'
    : 'x, y i mm fra boltgruppas senter. N, V i kN.'));
  const cp = v.res.compression;
  wrap.appendChild(el('p', 'hint', cp
    ? `Trykkresultant ${kN(cp.C)} kN i (${n(cp.x, 0)}, ${n(cp.y, 0)}) mm, ` +
      `maks kontakttrykk ${n(cp.sigmaMax, 2)} N/mm².`
    : m.plate.present
      ? 'Ingen kontakt mot betongen – plata er avstivet, og boltene tar trykk i bøyning.'
      : 'Ingen plate, altså ingen trykkflate – boltene tar både strekk og trykk.'));
  host.appendChild(wrap);
}

function checkRow(c) {
  const ok = applicable(c);
  const row = el('button', 'chk' + (ok ? (c.util > 1 ? ' over' : '') : ' na'));
  row.setAttribute('aria-current', String(activeCheck === c.id));
  const sub = !ok ? esc(c.note || 'Ikke aktuell for denne geometrien')
    : c.expr ? `<b>${n(c.util, 2)}</b> / 1,00 · ${esc(c.expr)}`
    : `<b>${kN(c.NEd)} kN</b> / ${kN(c.NRd)} kN · pkt. ${esc(c.clause)}`;
  row.innerHTML =
    `<div class="top"><span class="name">${esc(c.mode)}</span>` +
    `<span class="pc">${ok ? pct(c.util) : '–'}</span></div>` +
    (ok ? bar(c.util) : '<div style="height:8px"></div>') +
    `<div class="sub">${sub}</div>`;
  row.onclick = () => { activeCheck = c.id; setViewTab('calc'); refresh(false); };
  return row;
}

// === lastkombinasjoner ====================================================
// Tabellen er hele grensesnittet for lastene: én rad pr. kombinasjon, med
// grensetilstand, de seks komponentene og utnyttelsen. Radioknappen velger
// hvilken som vises i 3D og regnes ut i kontrollruta.
const LOAD_COLS = [
  ['N', 'N', 1000, 'kN'], ['Vx', 'V_x', 1000, 'kN'], ['Vy', 'V_y', 1000, 'kN'],
  ['Mx', 'M_x', 1e6, 'kNm'], ['My', 'M_y', 1e6, 'kNm'], ['Mz', 'M_z', 1e6, 'kNm'],
];

function renderCombos() {
  const host = $('#combos');
  host.innerHTML =
    '<thead><tr><th></th><th class="l">Navn</th><th class="l">Grensetilstand</th>' +
    LOAD_COLS.map(([, sym, , u]) => `<th>${esc(sym)}<i>${u}</i></th>`).join('') +
    '<th>Utnyttelse</th><th></th></tr></thead>';
  const body = el('tbody');

  for (const c of model.combos) {
    const tr = el('tr');
    if (c.id === model.activeCombo) tr.className = 'on';

    const pick = el('input');
    pick.type = 'radio'; pick.name = 'combo'; pick.checked = c.id === model.activeCombo;
    pick.title = 'Vis denne i 3D og regn den ut';
    pick.onchange = () => { model.activeCombo = c.id; refresh(false, true); };
    tr.appendChild(el('td')).appendChild(pick);

    const nm = el('input');
    nm.type = 'text'; nm.value = c.name;
    nm.oninput = () => { c.name = nm.value; refresh(false); };
    tr.appendChild(el('td', 'l')).appendChild(nm);

    const lim = el('select');
    for (const [v, t] of LIMIT_STATES) {
      const o = el('option', null, t); o.value = v; lim.appendChild(o);
    }
    lim.value = c.limit;
    lim.onchange = () => { c.limit = lim.value; refresh(false, true); };
    tr.appendChild(el('td', 'l')).appendChild(lim);

    for (const [key, , scale] of LOAD_COLS) {
      const inp = el('input');
      inp.type = 'number'; inp.step = scale === 1000 ? 1 : 0.5;
      inp.value = String(+(c[key] / scale).toFixed(scale === 1000 ? 2 : 3));
      inp.oninput = () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v)) return;
        c[key] = v * scale;
        refresh(false);
      };
      tr.appendChild(el('td')).appendChild(inp);
    }

    const u = el('td');
    u.appendChild(el('span', 'util', '–'));
    u.dataset.combo = c.id;
    tr.appendChild(u);

    const del = el('button', 'del', '✕');
    del.title = 'Slett kombinasjonen';
    del.disabled = model.combos.length < 2;
    del.onclick = () => {
      model.combos = model.combos.filter(x => x.id !== c.id);
      refresh(false, true);
    };
    tr.appendChild(el('td')).appendChild(del);

    body.appendChild(tr);
  }
  host.appendChild(body);
}

// Kjører alle kombinasjonene, ikke bare den aktive, så tabellen viser hvilken
// som styrer. Bruksgrense kontrolleres ikke: NS-EN 1992-4 dekker bruddgrense.
function utilForCombos() {
  const out = new Map();
  for (const c of model.combos) {
    if (c.limit !== 'uls') { out.set(c.id, null); continue; }
    try { out.set(c.id, verify({ ...model, load: c })); }
    catch { out.set(c.id, undefined); }
  }
  return out;
}

function paintComboUtils(res) {
  let govId = null, govU = -1;
  for (const [id, v] of res)
    if (v && Number.isFinite(v.maxUtil) && v.maxUtil > govU) { govU = v.maxUtil; govId = id; }

  for (const td of document.querySelectorAll('#combos td[data-combo]')) {
    const v = res.get(td.dataset.combo);
    const span = td.querySelector('.util');
    if (!v) {
      span.className = 'util na'; span.textContent = '–';
      span.title = 'Bruksgrense kontrolleres ikke – NS-EN 1992-4 dekker bruddgrense.';
      continue;
    }
    span.className = 'util';
    span.style.color = utilCss(v.maxUtil);
    span.textContent = pct(v.maxUtil);
    span.title = v.governing?.mode ?? '';
  }
  const gov = model.combos.find(c => c.id === govId);
  $('#combo-note').textContent = gov
    ? `styrende: ${gov.name} · ${pct(govU)}`
    : 'ingen bruddgrensekombinasjon';
}

// === utregningsark ========================================================
function renderSheet(v) {
  const host = $('#sheet');
  const c = v.checks.find(x => x.id === activeCheck);
  if (!c) {
    host.innerHTML = '<p class="empty">Velg en kontroll i resultatlista for å se hele utregninga.</p>';
    return;
  }
  const cal = c.calc, ok = applicable(c);
  const H = [];
  H.push(`<div class="hdr"><h2>${esc(c.mode)}</h2>` +
    `<div class="ref">${esc(c.standard ?? v.standard)}<br>pkt. ${esc(c.clause)}</div></div>`);

  if (ok) {
    H.push(`<div class="verdict"><span class="pc" style="color:${utilCss(c.util)}">` +
      `${pct(c.util)}</span>${bar(c.util)}</div>`);
  }
  if (cal?.skipped) {
    H.push(`<p class="note">${esc(cal.skipped)}</p>`);
    host.innerHTML = H.join('');
    return;
  }
  if (!cal) { host.innerHTML = H.join('') + '<p class="empty">Ingen utregning registrert.</p>'; return; }

  if (cal.inputs.length) {
    H.push('<h3>Inndata</h3><table class="io"><thead><tr>' +
      '<th>Symbol</th><th style="text-align:right">Verdi</th><th></th><th>Hentet fra</th>' +
      '</tr></thead><tbody>');
    for (const i of cal.inputs)
      H.push(`<tr><td class="sym">${esc(i.sym)}</td>` +
        `<td class="num">${esc(n(i.value))}</td>` +
        `<td class="unit">${esc(i.unit)}</td><td class="src">${esc(i.source)}</td></tr>`);
    H.push('</tbody></table>');
  }

  if (cal.steps.length) {
    H.push('<h3>Utregning</h3>');
    for (const s of cal.steps) H.push(stepHtml(s));
  }

  if (cal.result) {
    H.push('<h3>Kapasitet</h3>');
    H.push(stepHtml(cal.result, 'res'));
  }

  if (cal.check) {
    H.push('<h3>Kontroll</h3>');
    const pass = cal.check.value <= 1;
    H.push(`<div class="step final ${pass ? 'ok' : 'bad'}">` +
      `<div class="l1"><span class="sym">Utnyttelse</span>` +
      `<span class="ref">${pass ? '✓ Kapasiteten holder' : '✕ Kapasiteten er overskredet'}</span></div>` +
      `<div class="eq"><span>=</span><span class="f">${esc(cal.check.formula)} ≤ 1,0</span>` +
      `<span>=</span><span class="s">${esc(cal.check.subst)}</span>` +
      `<span>=</span><span class="v" style="color:${utilCss(cal.check.value)}">` +
      `${esc(n(cal.check.value, 3))}   (${pct(cal.check.value)})</span></div></div>`);
  }
  if (c.note) H.push(`<p class="note">${esc(c.note)}</p>`);
  host.innerHTML = H.join('');
}

function stepHtml(s, cls = '') {
  const val = `${esc(n(s.value))}${s.unit ? ' ' + esc(s.unit) : ''}`;
  return `<div class="step ${cls}">` +
    `<div class="l1"><span class="sym">${esc(s.sym)}</span>` +
    `<span class="desc">${esc(s.desc || '')}</span>` +
    `<span class="ref">${s.ref ? esc(s.ref) : ''}</span></div>` +
    `<div class="eq">` +
    `<span>=</span><span class="f">${esc(s.formula)}</span>` +
    (s.subst && s.subst !== '–'
      ? `<span>=</span><span class="s">${esc(s.subst)}</span>` : '') +
    `<span>=</span><span class="v">${val}</span></div>` +
    (s.note ? `<p class="note">${esc(s.note)}</p>` : '') + '</div>';
}

// === påskrifter i 3D ======================================================
// Mål og lastverdier tegnes som HTML over lerretet, ikke som sprites i scenen.
// Da holder de fast skriftstørrelse, står alltid rett på skjermen uansett
// kameravinkel, og verdiene kan redigeres direkte i modellen.
function buildHud(items, scale) {
  hudItems = [];
  for (const it of items) {
    let node;
    if (it.kind === 'dim') {
      node = el('div', 'dim');
      if (it.path) {
        // Mål som styrer modellen kan skrives i; de øvrige er avledet og vises
        // som tall, slik at det er tydelig hva du faktisk kan endre.
        const inp = el('input');
        inp.type = 'number'; inp.step = it.step; inp.min = it.min;
        inp.value = it.value;
        inp.onchange = () => {
          const val = parseFloat(inp.value);
          if (!Number.isFinite(val) || val < it.min) { inp.value = it.value; return; }
          set(model, it.path, val);
          refresh(true);
        };
        node.appendChild(inp);
      } else {
        node.classList.add('ro');
        node.textContent = it.value;
      }
    } else if (it.kind === 'load') {
      // Bare tallet og enheten - hvilken komponent det er, framgår av hvor
      // verdien står i forhold til pila.
      node = el('div', 'hload');
      node.style.color = it.color;
      const inp = el('input');
      inp.type = 'number'; inp.step = it.step;
      // Ingen etterhengte nuller: 25 blir «25», ikke «25,0». Skriver brukeren
      // desimaler, blir de stående - dec setter bare øvre presisjon.
      inp.value = String(+(it.value / it.scale).toFixed(it.dec));
      inp.onchange = () => {
        const val = parseFloat(inp.value);
        if (!Number.isFinite(val)) return;
        set(model, it.path, val * it.scale);
        refresh(true);
      };
      node.append(inp, el('span', 'u', it.unit));
    } else {
      node = el('div', 'hval', esc(it.text));
      node.style.color = it.color;
    }
    hudItems.push({ el: node, pos: it.p, quat: it.quat, scale });
  }
  $('#stage').setLabels(hudItems);
}

// === visning ==============================================================
function setViewTab(t) {
  viewTab = t;
  for (const [id, want] of [['#tab-3d', '3d'], ['#tab-plan', 'plan'], ['#tab-calc', 'calc']])
    $(id).setAttribute('aria-pressed', String(t === want));
  $('#wrap-3d').hidden = t !== '3d';
  $('#hud').hidden = t !== '3d';
  $('#wrap-plan').hidden = t !== 'plan';
  $('#wrap-calc').hidden = t !== 'calc';
  $('#viewsub').hidden = t !== '3d';
  $('#plansub').hidden = t !== 'plan';
  for (const b of document.querySelectorAll('#viewbtns .btn, #exportbtns .btn'))
    b.disabled = t !== '3d';
  $('#ortho').disabled = t !== '3d';
  if (t === '3d') $('#stage').frameAll?.();
  // Lerretet har null størrelse mens ruta er skjult, så tegninga må tas om
  // igjen - og passes inn første gang den vises.
  if (t === 'plan' && planner) requestAnimationFrame(() => planner.draw());
}

// === draghåndtak ==========================================================
// Hver rute kan dras i én kant: venstre rute i høyre kant, høyre rute i
// venstre, lastruta i overkant. Størrelsene ligger i CSS-variabler, så selve
// dragingen bare skriver et tall - resten følger av oppsettet, og 3D-ruta
// oppdaterer seg selv gjennom sin egen ResizeObserver.
const SPLITS = {
  left:  { v: '--w-left',  axis: 'x', sign:  1, min: 210, def: 300, other: '--w-right' },
  right: { v: '--w-right', axis: 'x', sign: -1, min: 260, def: 404, other: '--w-left' },
  loads: { v: '--h-loads', axis: 'y', sign: -1, min: 84,  def: 206 },
};
const MID_MIN = 340;      // minste bredde på visninga
const STAGE_MIN = 200;    // minste høyde på visninga

function splitLimit(s) {
  const cs = getComputedStyle(document.documentElement);
  const num = k => parseFloat(cs.getPropertyValue(k)) || 0;
  if (s.axis === 'x') return window.innerWidth - num(s.other) - MID_MIN;
  const chrome = num('--h-top') + num('--h-status');
  return window.innerHeight - chrome - STAGE_MIN;
}

function setSplit(s, value) {
  const v = Math.min(splitLimit(s), Math.max(s.min, value));
  document.documentElement.style.setProperty(s.v, Math.round(v) + 'px');
}

function initSplitters() {
  const cs = () => getComputedStyle(document.documentElement);
  for (const el of document.querySelectorAll('[data-split]')) {
    const s = SPLITS[el.dataset.split];
    if (!s) continue;

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const start = s.axis === 'x' ? e.clientX : e.clientY;
      const base = parseFloat(cs().getPropertyValue(s.v));
      el.classList.add('on');
      document.body.classList.add(s.axis === 'x' ? 'rs-col' : 'rs-row');

      const move = ev =>
        setSplit(s, base + s.sign * ((s.axis === 'x' ? ev.clientX : ev.clientY) - start));
      const up = () => {
        el.classList.remove('on');
        document.body.classList.remove('rs-col', 'rs-row');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });

    el.ondblclick = () => setSplit(s, s.def);

    el.onkeydown = ev => {
      const step = ev.shiftKey ? 40 : 10;
      const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[ev.key];
      if (d === undefined) return;
      const horiz = ev.key.startsWith('ArrowL') || ev.key.startsWith('ArrowR');
      if (horiz !== (s.axis === 'x')) return;
      ev.preventDefault();
      setSplit(s, parseFloat(cs().getPropertyValue(s.v)) + s.sign * d * step);
    };
  }
  // Krymper vinduet, kan en rute bli for bred - klem dem inn igjen.
  addEventListener('resize', () => {
    for (const s of Object.values(SPLITS))
      setSplit(s, parseFloat(cs().getPropertyValue(s.v)));
  });
}

// === oppdatering ==========================================================
let t0;
function refresh(rebuildForm, rebuildCombos) {
  sync(model);
  // Regelverket kan velges to steder - i verktøylinja og i skjemaet. Holder
  // verktøylinja i takt med modellen uansett hvor valget ble gjort.
  $('#code').value = model.code.standard;
  if (rebuildForm) { renderGroups(); renderForm(); } else { renderGroups(); }
  if (rebuildCombos) renderCombos();
  const v = verify(model);
  window.__v = v;               // for feilsøking i konsollet
  window.__m = model;
  renderResults(v);
  renderSheet(v);
  paintComboUtils(utilForCombos());
  $('#st-anchors').textContent = `${model.anchors.nx * model.anchors.ny} bolter`;
  $('#st-solver').textContent = v.res.converged
    ? `løst · ${v.res.iter} iterasjoner` : 'løseren konvergerte ikke';
  $('#st-max').innerHTML = Number.isFinite(v.maxUtil)
    ? `maks utnyttelse <span style="color:${utilCss(v.maxUtil)}">${pct(v.maxUtil)}</span>` : '–';
  if (planner && viewTab === 'plan') planner.draw();
  clearTimeout(t0);
  t0 = setTimeout(() => {
    const { root, hud, hudScale } = buildScene(v, showOpts);
    $('#stage').setContent(root);
    buildHud(hud, hudScale);
  }, 30);
}

export function boot() {
  for (const cb of document.querySelectorAll('[data-show]')) {
    cb.checked = showOpts[cb.dataset.show];
    cb.onchange = () => { showOpts[cb.dataset.show] = cb.checked; refresh(false); };
  }
  const cm = $('#colormode');
  cm.checked = false;
  cm.onchange = () => {
    showOpts.colorMode = cm.checked ? 'utilisation' : 'material';
    const l = $('#legend');
    l.hidden = !cm.checked;
    l.innerHTML = '&lt; 70 % · 70–100 % · &gt; 100 %';
    refresh(false);
  };
  for (const b of document.querySelectorAll('#viewbtns .btn'))
    b.onclick = () => b.dataset.view === 'fit'
      ? $('#stage').frameAll() : $('#stage').setView(b.dataset.view);
  for (const b of document.querySelectorAll('#exportbtns .btn'))
    b.onclick = () => b.dataset.exp === 'obj'
      ? $('#stage').exportOBJ('forankring') : $('#stage').exportGLB('forankring');

  $('#add-combo').onclick = () => {
    const n = model.combos.length + 1;
    model.combos.push(combo(nextComboId(model), `ULS ${n}`, 'uls'));
    model.activeCombo = model.combos[model.combos.length - 1].id;
    refresh(false, true);
  };

  const ortho = $('#ortho');
  ortho.onclick = () => {
    const on = !($('#stage').isOrtho);
    $('#stage').setProjection(on ? 'ortho' : 'persp');
    ortho.setAttribute('aria-pressed', String(on));
  };

  $('#tab-3d').onclick = () => setViewTab('3d');
  $('#tab-plan').onclick = () => setViewTab('plan');
  $('#tab-calc').onclick = () => setViewTab('calc');

  // ---- plantegninga ------------------------------------------------------
  // Tegninga skriver rett i modellen og ber om ny beregning. `rebuild` sier om
  // skjemaet må bygges om - under et dra gjør det ikke det, ellers ville lista
  // hoppe for hver piksel.
  planner = new PlanEditor($('#wrap-plan'), {
    model: () => model,
    selected: () => selectedShape,
    onSelect: id => { selectShape(id); renderForm(); },
    onChange: rebuild => refresh(!!rebuild),
  });
  const tools = $('#plantools');
  const setTool = t => {
    planner.setTool(t);
    for (const b of tools.children) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    $('#plan-hint').textContent = (TOOLS.find(x => x[0] === t) || [])[2] || '';
  };
  const HIDDEN_TOOLS = new Set(['circle', 'poly']);
  for (const [id, label, hint] of TOOLS) {
    if (HIDDEN_TOOLS.has(id)) continue;
    const b = el('button', 'btn', esc(label));
    b.dataset.tool = id;
    b.title = hint;
    b.onclick = () => setTool(id);
    tools.appendChild(b);
  }
  setTool('select');
  const cut = $('#plan-cut');
  cut.hidden = true;
  cut.onclick = () => {
    planner.cutMode = !planner.cutMode;
    cut.setAttribute('aria-pressed', String(planner.cutMode));
  };
  $('#plan-fit').onclick = () => { planner.fit(); planner.draw(); };

  // ---- geometri rett i 3D ------------------------------------------------
  // Uttrekkspilene er drahaandtak. Under draget skrives verdien rett i
  // modellen og alt regnes om; naar du slipper, bygges skjemaet om saa
  // tallfeltet viser det samme som pila.
  const stage = $('#stage');
  stage.addEventListener('handle', e => {
    set(model, e.detail.path, e.detail.value);
    refresh(false);
  });
  stage.addEventListener('handle-end', () => refresh(true));

  const code = $('#code');
  code.value = model.code.standard;
  code.onchange = () => { model.code.standard = code.value; refresh(true); };

  $('#reset').onclick = () => {
    model = Object.assign(defaultModel(), { reinf: REINF_DEFAULT() });
    activeCheck = null; activeGroup = 'Betongdel';
    selectShape(null);
    if (planner) planner.touched = false;
    $('#code').value = model.code.standard;
    setViewTab('3d');
    refresh(true, true);
  };
  $('#save-project').onclick = async (e) => {
    const b = e.currentTarget, old = b.textContent;
    const navn = (model.meta.prosjekt || 'prosjekt').trim() || 'prosjekt';
    const filnavn = navn.replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/\s+/g, '-') + '.json';
    try {
      const r = await saveFile(JSON.stringify(model, null, 2), filnavn);
      b.textContent = r.renamed ? 'Lagret – se filnavn' : 'Lagret';
    } catch (err) { b.textContent = saveError(err); }
    setTimeout(() => (b.textContent = old), 3000);
  };
  $('#open-project').onclick = () => $('#open-project-file').click();
  $('#open-project-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const loaded = JSON.parse(await file.text());
      model = mergeModel(loaded);
      activeCheck = null; activeGroup = 'Betongdel';
      selectShape(null);
      if (planner) planner.touched = false;
      $('#code').value = model.code.standard;
      setViewTab('3d');
      refresh(true, true);
    } catch (err) {
      alert('Kunne ikke åpne prosjektfila: ' + (err?.message || err));
    }
  };
  $('#report').onclick = async (e) => {
    const b = e.currentTarget, old = b.textContent;
    try {
      const r = await saveFile(buildReport(window.__v), 'forankring-beregning.txt');
      b.textContent = r.renamed ? 'Lagret – se filnavn' : 'Lagret';
    } catch (err) { b.textContent = saveError(err); }
    setTimeout(() => (b.textContent = old), 3000);
  };

  initSplitters();
  $('#stage').attachLabelLayer($('#hud'));
  setViewTab('3d');
  refresh(true, true);
}

// === rapport ==============================================================
function buildReport(v) {
  const L = [], line = ch => ch.repeat(72);
  const m = model;
  L.push('BEREGNING – FORANKRING I BETONG', line('='), '',
    `Regelverk (stål/samvirkning):  ${v.standards.generalLabel}`,
    `Regelverk (strekk mot betong): ${v.standards.tcLabel}`,
    `Regelverk (skjær mot betong):  ${v.standards.scLabel}`,
    `Dato:       ${new Date().toLocaleString('no-NO')}`, '');
  L.push('GEOMETRI', line('-'));
  L.push(`Betong ${m.concrete.grade} (f_ck = ${m.concrete.fck} N/mm²), ` +
    `${concreteShapeTxt(m)}`);
  if (isShaped(m))
    for (const [i, sh] of planShapes(m).entries()) {
      const [z0, z1] = shapeZ(m, sh);
      const geo = sh.kind === 'rect'
        ? `${sh.bx} × ${sh.by} mm i (${sh.x}, ${sh.y})`
        : sh.kind === 'circle' ? `⌀${2 * sh.r} mm i (${sh.x}, ${sh.y})`
        : `${sh.pts.length} hjørner`;
      L.push(`  ${i + 1}. ${SHAPE_LABEL[sh.kind]}, ` +
        `${(OP_LABEL[sh.op] || OP_LABEL.add).toLowerCase()}: ${geo}, ` +
        `kote ${Math.round(z0)} til ${Math.round(z1)}`);
    }
  L.push(m.plate.present
    ? `Plate ${m.plate.bx} × ${m.plate.by} × ${m.plate.t} mm, ` +
      `montasje: ${MOUNT_TXT[m.plate.mount]}, ` +
      `${m.anchors.attachment === 'welded' ? 'sveiste' : 'gjennomboltede'} forankringer`
    : `Ingen stålplate – enkeltstående dybler, utkraging e = ${m.plate.e} mm`);
  const a = m.anchors, foot = anchorFoot(m);
  L.push(`Bolter ${a.nx}×${a.ny} ${a.barType === 'rod' ? 'M' : '⌀'}${a.d} ` +
    `${BAR_TXT[a.barType].toLowerCase()} ${a.steel}, ` +
    `${a.endType === 'none' ? 'l_b' : 'h_ef'} = ${a.hef} mm, ` +
    `c/c ${a.sx} × ${a.sy} mm`);
  L.push(`Forankringsende: ${END_TXT[a.endType]}` + (foot.hasFoot
    ? `, medvirkende fot ${n(foot.eff, 0)} mm, netto A_h = ${n(foot.Ah, 0)} mm²` : ''), '');
  L.push('LASTER', line('-'));
  const l = m.load;
  L.push(`N = ${kN(l.N)} kN    V_x = ${kN(l.Vx)} kN    V_y = ${kN(l.Vy)} kN`);
  L.push(`M_x = ${n(l.Mx / 1e6, 2)} kNm    M_y = ${n(l.My / 1e6, 2)} kNm    ` +
    `M_z = ${n(l.Mz / 1e6, 2)} kNm`, '');
  L.push('KRAFTFORDELING I BOLTEGRUPPA', line('-'));
  L.push('  # |      x |      y |     N [kN] |     V [kN]');
  for (const an of v.res.anchors)
    L.push(`${String(an.id).padStart(3)} | ${String(an.x).padStart(6)} | ` +
      `${String(an.y).padStart(6)} | ${kN(an.N).padStart(10)} | ${kN(an.V).padStart(10)}`);
  L.push('');

  for (const c of v.checks) {
    L.push(line('='), `${c.mode}   [${c.standard ?? v.standard} · pkt. ${c.clause}]`, line('='));
    const cal = c.calc;
    if (cal?.skipped) { L.push(`  ${cal.skipped}`, ''); continue; }
    if (!cal) { L.push('  (ingen utregning registrert)', ''); continue; }
    if (cal.inputs.length) {
      L.push('', 'Inndata');
      for (const i of cal.inputs)
        L.push(`  ${i.sym.padEnd(12)} ${n(i.value).padStart(12)} ${i.unit.padEnd(7)} ${i.source}`);
    }
    if (cal.steps.length) {
      L.push('', 'Utregning');
      for (const s of cal.steps) {
        L.push(`  ${s.sym}${s.desc ? '  – ' + s.desc : ''}${s.ref ? '   ' + s.ref : ''}`);
        L.push(`      = ${s.formula}`);
        if (s.subst && s.subst !== '–') L.push(`      = ${s.subst}`);
        L.push(`      = ${n(s.value)} ${s.unit || ''}`);
      }
    }
    if (cal.result) {
      const r = cal.result;
      L.push('', 'Kapasitet');
      L.push(`  ${r.sym} = ${r.formula}${r.ref ? '   ' + r.ref : ''}`);
      L.push(`      = ${r.subst}`);
      L.push(`      = ${n(r.value)} ${r.unit}`);
    }
    if (cal.check) {
      L.push('', 'Kontroll');
      L.push(`  ${cal.check.formula} ≤ 1,0`);
      L.push(`      = ${cal.check.subst}`);
      L.push(`      = ${n(cal.check.value, 3)}   (${pct(cal.check.value)})   ` +
        (cal.check.value <= 1 ? 'OK' : 'IKKE OK'));
    }
    if (c.note) L.push('', `  Merk: ${c.note}`);
    L.push('');
  }

  if (v.issues.length) {
    L.push('AVVIK I INNDATA', line('-'));
    for (const i of v.issues) L.push(`  [${i.level}] ${i.text}`);
    L.push('');
  }
  L.push(line('='));
  L.push(`STYRENDE: ${v.governing?.mode} – ${pct(v.maxUtil)}`);
  L.push(v.ok ? 'RESULTAT: OK' : 'RESULTAT: IKKE OK');
  return L.join('\n');
}
