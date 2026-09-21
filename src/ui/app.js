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
         syncPlan, migratePlan } from '../core/model.js';
import { newReinforcement, nextReinforcementId, requirementIssues,
         PURPOSE_LABEL, PURPOSES, migrateReinforcements,
         reinforcementLabel } from '../core/reinforcement.js';
import { verify } from '../engine/verify.js';
import { buildScene } from '../viz/scene-builder.js';
import { FIELDS, barSizes, get, set, reinforcementFields,
         REINF_SECTIONS } from './fields.js';
import { planShapes, shapeLoop, shapeZ, loopArea, isShaped,
         SHAPE_LABEL, OP_LABEL } from '../engine/solid.js';
import { PlanEditor, TOOLS } from './plan-editor.js';
import { n, kN } from '../engine/calc.js';
import { saveFile, saveError } from '../core/download.js';
import { figureFor } from './figures.js';
import { reportPdf } from './report.js';
import { groupGeometry } from '../engine/supplementary-reinforcement.js';
import '../viz/three-d-stage.js';

const $ = s => document.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c;
                          if (h != null) e.innerHTML = h; return e; };
const pct = u => u === Infinity ? '∞ %' : Number.isFinite(u) ? Math.round(u * 100) + ' %' : '–';
const esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

const MOUNT_TXT = { direct: 'direkte mot betong', grout: 'undergyting',
                    standoff: 'avstandsmontert' };
const BAR_TXT = { stud: 'Sveisebolt', rebar: 'Kamstål', rod: 'Gjengestang/bolt' };
const END_TXT = { nut: 'endemutter', plate: 'felles endeplate',
                  hook: 'endekrok', none: 'uten endemutter (heft)' };

let model = defaultModel();
let showOpts = { cone: false, wedge: false, loads: false, labels: false, concrete: true,
                 rebar: true, surfaceMesh: true, dims: false,
                 renderMode: 'solid', concreteOpacity: 0.28,
                 colorMode: 'material', shape: null };
let hudItems = [];        // {el, pos, quat, scale} – sendes til stage.setLabels
let activeGroup = 'Betongdel';
let activeCheck = null;
let viewTab = '3d';
let resultsTab = 'summary';
// Åpen/lukket pr. undergruppe (fam:kategori) i utnyttelseslista - resultatet
// bygges helt om ved hver kontrollrad-klikk, så tilstanden må holdes for seg
// og gjenopprettes, ellers slår et klikk alle gruppene opp igjen.
const groupOpen = {};

// Kort sammendrag pr. gruppe, så velgeren viser tilstanden uten at du åpner den.
const SUMMARY = {
  'Regelverk': m => m.code.standard === 'EN1992-4' ? 'EN 1992-4' : 'B19',
  'Betongdel': m => m.concrete.grade,
  'Forankringsplate': m => m.plate.present
    ? `${m.plate.bx}×${m.plate.by}` : 'uten plate',
  'Bolter': m => `${m.anchors.nx * m.anchors.ny} × ` +
    `${m.anchors.barType === 'rod' ? 'M' : '⌀'}${m.anchors.d} · ` +
    `${END_TXT[m.anchors.endType]}`,
  'Tilleggsarmering': m => m.reinforcements.length
    ? m.reinforcements.map(r => `${r.count}×⌀${r.ds}`).join(' · ')
    : 'ingen',
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

  syncLoad(m);                  // `load` peker på den aktive kombinasjonen
  // Sveiste bolter har ingen hullklaring, så alle tar skjær. Uten plate er det
  // ingen hull i det hele tatt.
  if (!m.plate.present || a.attachment === 'welded') m.code.holeClearanceFilled = true;
  return m;
}

// Slår ei lagra prosjektfil sammen med standardmodellen, ett nivå djupt, så
// felt som er lagt til etter fila blei lagra likevel får ein fornuftig verdi.
function mergeModel(loaded) {
  const base = defaultModel();
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
  // Ei fil lagra før tilleggsarmering var ei liste (flat m.reinf) - gjøres om
  // til m.reinforcements. migrateReinforcements() er idempotent og gjør
  // ingenting når reinforcements allerede er ei liste (default), så det
  // gamle feltet må stå igjen først.
  if (loaded.reinf && !loaded.reinforcements) {
    base.reinf = loaded.reinf;
    base.reinforcements = null;
    migrateReinforcements(base);
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
  for (const f of grp.items) {
    if (f.when && !f.when(model)) continue;
    host.appendChild(field(f));
  }

  if (activeGroup === 'Bolter' && !model.reinforcements.length)
    host.appendChild(el('p', 'hint',
      'Tilleggsarmering legges til i fanen «Tilleggsarmering». Der velger du type, ' +
      'antall, diameter og plassering - armeringskontrollen kan da erstatte ' +
      'kjegle- eller kantbruddet når kravene i pkt. 7.2.2.6 er oppfylt.'));
  if (activeGroup === 'Tilleggsarmering') renderReinforcementGroups(host);
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

// === tilleggsarmering ======================================================
//  Velg type/antall/diameter/plassering i stedet for å tegne armeringa
//  manuelt (spesifikasjonens pkt. 9). Ett kort pr. gruppe, samme felt-
//  byggeklosser (field()) som resten av skjemaet.
//
//  Kravene som avgjør «nødvendig antall» er lineære i antall bein så lenge
//  ingen bein faller utenfor 0,75·h_ef/0,75·c_1-sona (se
//  supplementary-reinforcement.js) - da holder det å skalere det valgte
//  antallet med styrende utnyttelse i stedet for å gjenta formlene her.
function reinforcementSummary(v, r) {
  const rc = (v.checks || []).filter(c => c.group === r.id);
  // «Nødvendig antall» skaleres bare fra kontroller som faktisk er lineære i
  // antall bein (stål, forankring). STM- og overlappskontrollen avhenger av
  // geometrien, ikke av antallet, så flere bein løser ikke et STM-/
  // overlappsproblem - de tas med i status (worstAny), men ikke i skaleringa.
  const scalable = rc.filter(c => /-(steel|anchorage)-/.test(c.id));
  const worstScalable = scalable.reduce(
    (a, c) => Number.isFinite(c.util) ? Math.max(a, c.util) : a, 0);
  const worstAny = rc.reduce((a, c) => Number.isFinite(c.util) ? Math.max(a, c.util) : a, 0);
  const need = worstScalable > 0 ? Math.max(2, Math.ceil((r.count * worstScalable) / 2) * 2) : r.count;
  const replaced = (v.replacedConcreteChecks || []).some(c => c.group === r.id);
  return { need, worst: worstAny, ok: need <= r.count && worstAny <= 1, replaced };
}

// Innholdet i statuskortet under skjemaet - bygges både når kortet lages og
// hver gang tallene endrer seg (se updateReinforcementStatus). Selve
// skjemafeltene røres ikke da: patcher du dem inn på nytt for hvert tastetrykk
// mister feltet fokus midt i tallet du skriver.
function reinforcementOk(v, r) {
  const s = reinforcementSummary(v, r), issues = requirementIssues(r);
  return { s, issues, ok: s.ok && !issues.length };
}

function reinforcementStatusHtml(v, r) {
  const { s, issues, ok } = reinforcementOk(v, r);
  const cell = (k, val, style = '') =>
    `<div><span class="k">${k}</span><span class="v"${style}>${val}</span></div>`;
  let html = `<div class="reinf-over">` +
    cell('Nødvendig', `${s.need}×⌀${r.ds}`) +
    cell('Valgt', `${r.count}×⌀${r.ds}`) +
    cell('Utnyttelse', pct(s.worst), ` style="color:${utilCss(s.worst)}"`) +
    cell('Status', ok ? 'OK' : 'IKKE OK', ` style="color:${ok ? 'var(--ok)' : 'var(--bad)'}"`) +
    `</div>`;
  if (issues.length) html += `<p class="msg err">${esc(issues.join(' '))}</p>`;
  if (s.replaced)
    html += `<p class="hint">Erstatter ${r.purpose === 'tension' ? 'betongkjeglebrudd' : 'kantbrudd'} ` +
      'som dimensjonerende bruddform for boltene denne gruppa betjener.</p>';
  return html;
}

// Kort linje i korthodet - det som står igjen når kortet er lukket.
const reinforcementTitle = r =>
  `${PURPOSE_LABEL[r.purpose]} · ${r.count}×⌀${r.ds} · ${REINF_SECTIONS[0].sum(model, r)}`;

// Kalles fra refresh() på HVER endring (også de som ikke bygger skjemaet om).
// Går rett i DOM-en, uavhengig av om «Tilleggsarmering»-fanen er åpen - da
// finnes ingen elementer å treffe, og løkkene er no-op.
function updateReinforcementStatus(v) {
  const byId = id => model.reinforcements.find(x => x.id === id);
  for (const node of document.querySelectorAll('[data-reinf-status]')) {
    const r = byId(node.dataset.reinfStatus);
    if (r) node.innerHTML = reinforcementStatusHtml(v, r);
  }
  for (const node of document.querySelectorAll('[data-reinf-badge]')) {
    const r = byId(node.dataset.reinfBadge);
    if (!r) continue;
    const { ok } = reinforcementOk(v, r);
    node.className = 'badge ' + (ok ? 'ok' : 'bad');
    node.textContent = ok ? 'OK' : 'IKKE OK';
  }
  for (const node of document.querySelectorAll('[data-reinf-title]')) {
    const r = byId(node.dataset.reinfTitle);
    if (r) node.textContent = reinforcementTitle(r);
  }
  for (const node of document.querySelectorAll('[data-reinf-sec]')) {
    const [id, sec] = node.dataset.reinfSec.split(':');
    const r = byId(id), S = REINF_SECTIONS.find(x => x.id === sec);
    if (r && S) node.textContent = S.sum(model, r);
  }
}

// Åpen/lukket pr. kort og pr. seksjon - skjemaet bygges helt om ved hvert
// valg, så tilstanden holdes her (som groupOpen for resultatlista).
const reinfOpen = {};
const isOpen = key => reinfOpen[key] ?? true;

// Type velges FØR gruppa opprettes, i menyen under - resten av skjemaet
// (utforming, armering, osv.) tilpasser seg formålet fra første stund i
// stedet for å starte som «Strekk / kjeglebrudd» og måtte endres om det
// egentlig skulle vært kantarmering. Valget er dermed alt gjort når kortet
// vises, og har ikke noe felt å endre det i (se reinforcementFields()).
function renderReinforcementGroups(host) {
  const menu = el('details', 'menu reinf-add');
  menu.appendChild(el('summary', null, '+ Legg til tilleggsarmering'));
  const content = el('div', 'menu-content actions');
  for (const purpose of PURPOSES) {
    const add = el('button', 'btn', esc(PURPOSE_LABEL[purpose]));
    add.onclick = () => {
      menu.open = false;
      const id = nextReinforcementId(model);
      model.reinforcements.push(newReinforcement(id, purpose));
      reinfOpen[id] = true;
      refresh(true);
      // Navnefeltet er det naturlige neste steget - marker det med én gang.
      requestAnimationFrame(() => {
        const input = host.querySelector(`[data-reinf-name="${id}"]`);
        if (input) { input.focus(); input.select(); }
      });
    };
    content.appendChild(add);
  }
  menu.appendChild(content);
  host.appendChild(menu);

  const v = verify(model);   // fersk - skjemaet bygges før refresh() sitt eget kall
  for (let i = 0; i < model.reinforcements.length; i++) {
    const r = model.reinforcements[i];
    const card = el('details', 'feat reinf-card');
    card.open = isOpen(r.id);
    card.ontoggle = () => { reinfOpen[r.id] = card.open; };

    // Korthodet er oversikten når kortet er lukket: navn, type, armering og
    // status. Navnet er fritt tekstfelt - tomt betyr «bruk standardnavnet»
    // (reinforcementLabel), så det alltid står noe fornuftig i rapporten.
    const hdr = el('summary', 'feat-head');
    const name = el('div', 'nm');
    const nameInput = el('input', 'rname');
    nameInput.type = 'text';
    nameInput.value = r.name || '';
    nameInput.placeholder = reinforcementLabel(r);
    nameInput.autocomplete = 'off';
    nameInput.title = 'Eget navn på gruppa, f.eks. «Kantarmering nord». ' +
      'Tomt bruker et standardnavn.';
    nameInput.dataset.reinfName = r.id;
    // Klikk i feltet skal redigere teksten, ikke åpne/lukke kortet - samme
    // knep som «Fjern»-knappen under bruker.
    nameInput.onclick = e => e.preventDefault();
    nameInput.oninput = () => { r.name = nameInput.value; refresh(false); };
    name.appendChild(nameInput);
    const sub = el('span', 'sub');
    sub.dataset.reinfTitle = r.id;
    sub.textContent = reinforcementTitle(r);
    name.appendChild(sub);
    hdr.appendChild(name);
    const { ok } = reinforcementOk(v, r);
    const badge = el('span', 'badge ' + (ok ? 'ok' : 'bad'), ok ? 'OK' : 'IKKE OK');
    badge.dataset.reinfBadge = r.id;
    hdr.appendChild(badge);
    const del = el('button', 'btn', 'Fjern');
    del.title = 'Fjern gruppa';
    del.onclick = e => {
      e.preventDefault();          // ellers lukkes/åpnes kortet også
      model.reinforcements.splice(i, 1); refresh(true);
    };
    hdr.appendChild(del);
    card.appendChild(hdr);

    const status = el('div');
    status.dataset.reinfStatus = r.id;
    status.innerHTML = reinforcementStatusHtml(v, r);
    card.appendChild(status);

    const fields = reinforcementFields(model, i);
    for (const S of REINF_SECTIONS) {
      const own = fields.filter(f => f.sec === S.id);
      if (!own.length) continue;
      const key = `${r.id}:${S.id}`;
      const sec = el('details', 'rsec');
      sec.open = isOpen(key);
      sec.ontoggle = () => { reinfOpen[key] = sec.open; };
      const sh = el('summary', null, `<span>${esc(S.l)}</span>`);
      const sum = el('i');
      sum.dataset.reinfSec = key;
      sum.textContent = S.sum(model, r);
      sh.appendChild(sum);
      sec.appendChild(sh);
      for (const f of own) sec.appendChild(field(f));
      card.appendChild(sec);
    }

    host.appendChild(card);
  }
  if (!model.reinforcements.length)
    host.appendChild(el('p', 'hint', 'Ingen tilleggsarmering lagt til.'));
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

function field(f) {
  // Få, lange alternativer: radioknapper under hverandre, så alle valgene
  // kan leses på én gang i den smale ruta.
  if (f.t === 'choice') {
    const wrap = el('div', 'fld choice');
    wrap.setAttribute('role', 'radiogroup');
    wrap.appendChild(el('span', 'lbl', esc(typeof f.l === 'function' ? f.l(model) : f.l)));
    const cur = String(get(model, f.p));
    for (const [v, t] of (typeof f.o === 'function' ? f.o(model) : f.o)) {
      const opt = el('label', 'opt');
      const input = el('input');
      input.type = 'radio'; input.name = f.p; input.value = v;
      input.checked = String(v) === cur;
      input.onchange = () => { set(model, f.p, f.num ? +v : v); refresh(true); };
      opt.appendChild(input);
      opt.appendChild(el('span', null, esc(t)));
      wrap.appendChild(opt);
    }
    if (f.hint) wrap.title = f.hint;
    return wrap;
  }
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
const utilCss = u => u === Infinity ? 'var(--bad)' : !Number.isFinite(u) ? 'var(--tx3)'
  : u > 1 ? 'var(--bad)' : u > 0.7 ? 'var(--warn)' : 'var(--ok)';

const family = c => c.id.startsWith('IA') ? 'Samvirkning'
  : c.id.startsWith('N') ? 'Strekk' : 'Skjær';

// Undergruppering innad i Strekk/Skjær: betong, stål eller (tilleggs-)armering.
// Rekkefølgen her er vist-rekkefølgen i lista.
const CATEGORY_ORDER = ['Betong', 'Stål', 'Armering'];
const category = c => /-sre-/.test(c.id) ? 'Armering'
  : c.id === 'N-steel' || c.id === 'V-steel' || c.id === 'V-bend' ? 'Stål'
  : 'Betong';
const CAT_CLS = { 'Betong': 'conc', 'Stål': 'steel', 'Armering': 'reinf' };

const applicable = c => c.expr ? !Number.isNaN(c.util)
  : !Number.isNaN(c.util) && Number.isFinite(c.NRd);

function bar(u, cls = '') {
  const w = u === Infinity ? 100 : Number.isFinite(u) ? Math.min(100, u * 100) : 0;
  return `<div class="track ${u > 1 ? 'full' : ''} ${cls}">` +
         `<i style="width:${w}%;background:${utilCss(u)}"></i></div>`;
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

function setResultsTab(t) {
  resultsTab = t;
  $('#tab-summary').setAttribute('aria-pressed', String(t === 'summary'));
  $('#tab-util').setAttribute('aria-pressed', String(t === 'util'));
  const summary = $('#results-summary'), util = $('#results-util');
  if (summary) summary.hidden = t !== 'summary';
  if (util) util.hidden = t !== 'util';
}

// Forutsetningene øverst i oppsummeringa - de samme radene står i rapporten.
function assumptionRows(v) {
  const m = model, a = m.anchors, g = v.gamma;
  const foot = anchorFoot(m);
  return [
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
}

// Tekstene under krafttabellen - også i rapporten.
function anchorNotes(v) {
  const m = model, cp = v.res.compression;
  return [
    m.plate.present
      ? 'x, y i mm fra platesenter. N, V i kN.'
      : 'x, y i mm fra boltgruppas senter. N, V i kN.',
    cp
      ? `Trykkresultant ${kN(cp.C)} kN i (${n(cp.x, 0)}, ${n(cp.y, 0)}) mm, ` +
        `maks kontakttrykk ${n(cp.sigmaMax, 2)} N/mm².`
      : m.plate.present
        ? 'Ingen kontakt mot betongen – plata er avstivet, og boltene tar trykk i bøyning.'
        : 'Ingen plate, altså ingen trykkflate – boltene tar både strekk og trykk.',
  ];
}

// Kontrollene i den rekkefølgen resultatlista viser dem: Strekk/Skjær/
// Samvirkning, og innad betong/stål/armering med høyeste utnyttelse først.
function checkFamilies(v) {
  const out = [];
  for (const fam of ['Strekk', 'Skjær', 'Samvirkning']) {
    const list = v.checks.filter(c => family(c) === fam)
      .sort((x, y) => (applicable(y) ? y.util : -1) - (applicable(x) ? x.util : -1));
    if (!list.length) continue;
    const categories = fam === 'Samvirkning' ? [{ name: null, checks: list }]
      : CATEGORY_ORDER.map(cat => ({ name: cat, checks: list.filter(c => category(c) === cat) }))
          .filter(x => x.checks.length);
    out.push({ name: fam, categories });
  }
  return out;
}

function renderResults(v) {
  const m = model;
  $('#verdict').innerHTML = !v.res.converged || v.issues.some(i => i.level === 'error')
    ? '<span style="color:var(--bad)">Ugyldig beregning</span>'
    : v.bearing && !v.bearing.ok
    ? '<span style="color:var(--bad)">Kontakttrykk overskredet</span>'
    : v.governing
    ? `<span style="color:${utilCss(v.maxUtil)}">maks ${pct(v.maxUtil)}</span> · ${esc(v.governing.mode)}`
    : 'ingen kontroller';

  const host = $('#results');
  host.innerHTML = '';
  const summary = el('div', 'tabpane');
  summary.id = 'results-summary';
  const util = el('div', 'tabpane');
  util.id = 'results-util';
  host.appendChild(summary);
  host.appendChild(util);

  const ass = el('div', 'assump');
  for (const [k, val] of assumptionRows(v))
    ass.appendChild(el('div', 'row', `<span class="k">${esc(k)}</span><span class="v">${esc(val)}</span>`));
  summary.appendChild(ass);

  for (const i of v.issues)
    summary.appendChild(el('div', 'msg ' + (i.level === 'error' ? 'err' : 'warn'), esc(i.text)));

  summary.appendChild(el('h3', 'sect', 'Kraftfordeling i boltegruppa'));
  const wrap = el('div', 'pad');
  const t = el('table', 'anchors');
  t.innerHTML = '<thead><tr><th>Bolt</th><th>x</th><th>y</th><th>N</th><th>V</th></tr></thead>' +
    '<tbody>' + v.res.anchors.map(an =>
      `<tr><td>${an.id}</td><td>${an.x}</td><td>${an.y}</td>` +
      `<td>${an.N > 1 ? kN(an.N) : '–'}</td><td>${kN(an.V)}</td></tr>`).join('') + '</tbody>';
  wrap.appendChild(t);
  for (const txt of anchorNotes(v)) wrap.appendChild(el('p', 'hint', txt));
  summary.appendChild(wrap);

  if (v.bearing && !v.bearing.ok)
    util.appendChild(el('div', 'msg warn',
      `Kontakttrykk ${n(v.bearing.sigma, 2)} N/mm² > f_cd ${n(v.bearing.fcd, 2)} N/mm². ` +
      'Øk plata eller betongfastheten.'));
  for (const fam of ['Strekk', 'Skjær', 'Samvirkning']) {
    const list = v.checks.filter(c => family(c) === fam)
      .sort((x, y) => (applicable(y) ? y.util : -1) - (applicable(x) ? x.util : -1));
    if (!list.length) continue;
    // Betong/stål/armering-boksene ligger INNI denne boksen, så det er
    // synlig at de hører til Strekk/Skjær - ikke bare en overskrift over dem.
    // Fargen skal bare skille materialene fra hverandre, så denne boksen er
    // med vilje fargeløs.
    const famBox = el('section', `fam-box fam-${family2cls(fam)}`);
    famBox.appendChild(el('h3', 'fam-head', fam));
    // Samvirkning har bare ett par kontroller og skiller ikke betong/stål/
    // armering fra hverandre - undergruppert blir den bare tre ett-linjers
    // overskrifter for like mange rader.
    if (fam === 'Samvirkning') {
      for (const c of list) famBox.appendChild(checkRow(c));
      util.appendChild(famBox);
      continue;
    }
    for (const cat of CATEGORY_ORDER) {
      const sub = list.filter(c => category(c) === cat);
      if (!sub.length) continue;
      // Åpne/lukkbar gruppe pr. kontrolltype - <details> gir det gratis.
      // Resultatet bygges om ved hvert klikk på en kontrollrad et annet sted
      // i lista, så tilstanden må huskes i groupOpen og settes tilbake her -
      // ellers hopper alle gruppene opp igjen for hver rad brukeren åpner.
      // Verste utnyttelse i gruppa vises i overskriften, så den er lesbar
      // lukket også.
      const worst = sub.reduce((a, b) =>
        (applicable(b) && (!a || b.util > a.util) ? b : a), null);
      const key = `${fam}:${cat}`;
      const grp = el('details', `grp cat-${CAT_CLS[cat]}`);
      grp.open = groupOpen[key] ?? true;
      grp.addEventListener('toggle', () => { groupOpen[key] = grp.open; });
      const worstTxt = worst
        ? worst.binary ? (worst.util > 1 ? 'Ikke OK' : 'OK') : pct(worst.util) : '';
      const head = el('summary', 'grp-head',
        `<span class="name">${esc(cat)}</span>` +
        `<span class="count">${sub.length}</span>` +
        (worst ? `<span class="pc" style="color:${utilCss(worst.util)}">${worstTxt}</span>` : ''));
      grp.appendChild(head);
      for (const c of sub) grp.appendChild(checkRow(c));
      famBox.appendChild(grp);
    }
    util.appendChild(famBox);
  }

  // Betongbrudd som tilleggsarmering har erstattet som dimensjonerende - vist
  // for seg, så det er tydelig hva som er byttet ut og hva som fortsatt
  // kontrolleres (spesifikasjonens pkt. 8/11). Kontrollen er fortsatt regnet
  // fullt ut, bare ikke styrende lenger.
  if (v.replacedConcreteChecks?.length) {
    util.appendChild(el('h3', 'sect', 'Erstattet av tilleggsarmering'));
    for (const c of v.replacedConcreteChecks) {
      const row = checkRow(c);
      row.classList.add('na');
      row.title = c.replacedBy;
      util.appendChild(row);
    }
  }

  setResultsTab(resultsTab);
}

const FAM_CLS = { 'Strekk': 'tension', 'Skjær': 'shear', 'Samvirkning': 'combo' };
function family2cls(fam) { return FAM_CLS[fam] || ''; }

// Noen kontroller er detaljeringssjekker - enten er det nok av noe (plass,
// forankring) eller ikke, ikke en gradert utnyttelse med margin å vurdere.
// De vises som OK/Ikke OK i stedet for prosent og stolpe, markert med
// c.binary på kontrollobjektet.
function checkRow(c) {
  const ok = applicable(c);
  const bin = !!c.binary;
  const row = el('button', 'chk' + (ok ? (c.util > 1 ? ' over' : '') : ' na'));
  row.setAttribute('aria-current', String(activeCheck === c.id));
  const sub = !ok ? esc(c.note || 'Ikke aktuell for denne geometrien')
    : c.requirements ? `<b>${c.requirements.filter(it => it.checked !== false && it.ok).length}</b> / ` +
      `${c.requirements.filter(it => it.checked !== false).length} krav oppfylt · pkt. ${esc(c.clause)}`
    : c.expr ? `<b>${n(c.util, 2)}</b> / 1,00 · ${esc(c.expr)}`
    : `<b>${kN(c.NEd)} kN</b> / ${kN(c.NRd)} kN · pkt. ${esc(c.clause)}`;
  const pc = !ok ? '–' : bin ? (c.util > 1 ? 'Ikke OK' : 'OK') : pct(c.util);
  const pcStyle = bin && ok ? ` style="color:${c.util > 1 ? 'var(--bad)' : 'var(--ok)'}"` : '';
  row.innerHTML =
    `<div class="top"><span class="name">${esc(c.mode)}</span>` +
    `<span class="pc"${pcStyle}>${pc}</span></div>` +
    (ok && !bin ? bar(c.util) : '<div style="height:8px"></div>') +
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
    if (v && v.maxUtil > govU) { govU = v.maxUtil; govId = id; }

  for (const td of document.querySelectorAll('#combos td[data-combo]')) {
    const v = res.get(td.dataset.combo);
    const span = td.querySelector('.util');
    if (!v) {
      span.className = 'util na'; span.textContent = '–';
      span.title = 'Bruksgrense kontrolleres ikke – NS-EN 1992-4 dekker bruddgrense.';
      continue;
    }
    span.className = 'util';
    const invalid = !v.res.converged || v.issues.some(i => i.level === 'error');
    span.style.color = invalid || (v.bearing && !v.bearing.ok) ? 'var(--bad)' : utilCss(v.maxUtil);
    span.textContent = invalid ? 'Ugyldig' : v.bearing && !v.bearing.ok ? 'Trykk > 100 %' : pct(v.maxUtil);
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
  const c = v.checks.find(x => x.id === activeCheck) ||
    v.replacedConcreteChecks?.find(x => x.id === activeCheck);
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
  if (c.replacedBy)
    H.push(`<p class="note">Erstattet av ${esc(c.replacedBy)} som dimensjonerende ` +
      'bruddform, men fortsatt regnet ut i sin helhet under.</p>');
  if (cal?.skipped) {
    H.push(`<p class="note">${esc(cal.skipped)}</p>`);
    host.innerHTML = H.join('');
    return;
  }

  if (c.requirements) {
    H.push('<h3>Enkeltkrav</h3><table class="io reqs"><thead><tr>' +
      '<th>Pkt</th><th>Krav (ordrett, NS-EN 1992-4:2018 (E))</th><th>Vurdering</th>' +
      '<th>Kommentar</th></tr></thead><tbody>');
    for (const it of c.requirements) {
      const verdict = it.checked === false ? 'Kontrolleres separat'
        : it.ok ? 'OK' : 'Ikke OK';
      const color = it.checked === false ? 'var(--warn)' : it.ok ? 'var(--ok)' : 'var(--bad)';
      H.push(`<tr><td class="sym">${esc(it.letter)})</td><td>${esc(it.quote)}</td>` +
        `<td style="color:${color};font-weight:600">${verdict}</td>` +
        `<td>${esc(it.comment || '')}</td></tr>`);
    }
    H.push('</tbody></table>');
  }

  if (!cal) { host.innerHTML = H.join('') + '<p class="empty">Ingen utregning registrert.</p>'; return; }

  const fig = figureFor(c, model);
  if (fig) H.push('<h3>Figur</h3>', fig);

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
let sceneResult;
function refreshScene() {
  if (!sceneResult) return;
  clearTimeout(t0);
  t0 = setTimeout(() => {
    const { root, hud, hudScale } = buildScene(sceneResult, showOpts);
    $('#stage').setContent(root);
    buildHud(hud, hudScale);
  }, 30);
}

function refresh(rebuildForm, rebuildCombos) {
  sync(model);
  // Regelverket kan velges to steder - i verktøylinja og i skjemaet. Holder
  // verktøylinja i takt med modellen uansett hvor valget ble gjort.
  $('#code').value = model.code.standard;
  if (rebuildForm) { renderGroups(); renderForm(); } else { renderGroups(); }
  if (rebuildCombos) renderCombos();
  const v = verify(model);
  sceneResult = v;
  window.__v = v;               // for feilsøking i konsollet
  window.__m = model;
  updateReinforcementStatus(v);
  renderResults(v);
  renderSheet(v);
  paintComboUtils(utilForCombos());
  $('#st-anchors').textContent = `${model.anchors.nx * model.anchors.ny} bolter`;
  $('#st-solver').textContent = v.res.converged
    ? `løst · ${v.res.iter} iterasjoner` : 'løseren konvergerte ikke';
  $('#st-max').innerHTML = !v.res.converged || v.issues.some(i => i.level === 'error')
    ? '<span style="color:var(--bad)">Ugyldig beregning</span>'
    : v.bearing && !v.bearing.ok ? '<span style="color:var(--bad)">Kontakttrykk overskredet</span>'
    : v.governing
    ? `maks utnyttelse <span style="color:${utilCss(v.maxUtil)}">${pct(v.maxUtil)}</span>` : '–';
  if (planner && viewTab === 'plan') planner.draw();
  refreshScene();
}

export function boot() {
  for (const cb of document.querySelectorAll('[data-show]')) {
    cb.checked = showOpts[cb.dataset.show];
    cb.onchange = () => { showOpts[cb.dataset.show] = cb.checked; refreshScene(); };
  }
  const syncViewControls = () => {
    const mode = $('#render-mode');
    mode.value = showOpts.renderMode;
    $('#concrete-opacity').disabled = showOpts.renderMode !== 'xray';
  };
  $('#render-mode').onchange = e => {
    showOpts.renderMode = e.target.value;
    syncViewControls(); refreshScene();
  };
  $('#concrete-opacity').value = showOpts.concreteOpacity * 100;
  $('#concrete-opacity').oninput = e => {
    showOpts.concreteOpacity = Number(e.target.value) / 100; refreshScene();
  };
  syncViewControls();
  // Bare verktøylinjas nedtrekksmenyer (.menu) skal lukkes av utenfor-klikk/
  // Escape - de fungerer som popovere. Utnyttelsesgruppene (.grp) er faste
  // seksjoner brukeren åpner/lukker selv, og skal stå slik til neste klikk
  // på selve overskriften, uansett hva ellers på sida blir klikket.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach(d => d.open = false);
  });
  document.addEventListener('click', e => {
    document.querySelectorAll('details.menu[open]').forEach(d => {
      if (!d.contains(e.target)) d.open = false;
    });
  });
  const cm = $('#colormode');
  cm.checked = false;
  cm.onchange = () => {
    showOpts.colorMode = cm.checked ? 'utilisation' : 'material';
    const l = $('#legend');
    l.hidden = !cm.checked;
    l.innerHTML = '&lt; 70 % · 70–100 % · &gt; 100 %';
    refreshScene();
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

  $('#tab-summary').onclick = () => setResultsTab('summary');
  $('#tab-util').onclick = () => setResultsTab('util');

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
    model = defaultModel();
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
  // To rapporter: alt regnet med den valgte lastkombinasjonen (det du ser i
  // programmet), eller hver kontroll med sin egen dimensjonerende kombinasjon.
  const makeReport = mode => async (e) => {
    const b = e.currentTarget, old = b.textContent;
    if (b.disabled) return;
    b.disabled = true;
    b.textContent = 'Lager PDF …';
    try {
      const pdf = await reportPdf(await reportData(mode));
      const navn = (model.meta.prosjekt || 'forankring').trim() || 'forankring';
      const filnavn = navn.replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/[\s-]+/g, '-') +
        (mode === 'gov' ? '-beregningsrapport-dimensjonerende.pdf' : '-beregningsrapport.pdf');
      await saveFile(pdf, filnavn);
      b.textContent = 'Lagret';
    } catch (err) {
      console.error(err);
      b.textContent = saveError(err);
    }
    b.disabled = false;
    setTimeout(() => (b.textContent = old), 3000);
  };
  $('#report').onclick = makeReport('active');
  $('#report-gov').onclick = makeReport('gov');

  initSplitters();
  $('#stage').attachLabelLayer($('#hud'));
  setViewTab('3d');
  refresh(true, true);
}

// === rapport ==============================================================
// Samler alt rapporten skal vise, tolket ferdig til tekst og tall. Selve
// oppsettet til PDF-en ligger i ui/report.js.

// Verdien et felt viser i skjemaet, som tekst.
function settingValue(f) {
  const raw = f.val != null ? f.val : get(model, f.p);
  if (f.t === 'bool') return raw ? 'Ja' : 'Nei';
  if (f.t === 'select' || f.t === 'choice') {
    const opts = typeof f.o === 'function' ? f.o(model) : f.o;
    const hit = opts.find(([val]) => String(val) === String(raw));
    return hit ? hit[1] : String(raw ?? '–');
  }
  const val = f.t === 'kn' ? raw / 1000 : f.t === 'knm' ? raw / 1e6 : raw;
  // Tallet slik det står i feltet - uten utfylte desimaler.
  return (Number.isFinite(val) ? (+val.toFixed(4)).toLocaleString('nb-NO') : String(val ?? '–')) +
    (f.u ? ' ' + f.u : '');
}
const settingLabel = f => (typeof f.l === 'function' ? f.l(model) : f.l);

function settingsGroups() {
  const out = [];
  for (const g of visibleGroups()) {
    if (g.group === 'Tilleggsarmering') continue;
    out.push({ title: g.group, rows: g.items.filter(f => !f.when || f.when(model))
      .map(f => [settingLabel(f), settingValue(f)]) });
  }
  model.reinforcements.forEach((r, i) => {
    const fields = reinforcementFields(model, i);
    const rows = [['Type', PURPOSE_LABEL[r.purpose]]];
    for (const S of REINF_SECTIONS) {
      const own = fields.filter(f => f.sec === S.id);
      if (!own.length) continue;
      rows.push({ section: S.l });
      for (const f of own) rows.push([settingLabel(f), settingValue(f)]);
    }
    out.push({ title: `Tilleggsarmering – ${reinforcementLabel(r)}`, rows });
  });
  if (!model.reinforcements.length)
    out.push({ title: 'Tilleggsarmering', rows: [], empty: 'Ingen tilleggsarmering lagt inn.' });
  return out;
}

function reinforcementRows(v) {
  return model.reinforcements.map(r => {
    const { s, issues, ok } = reinforcementOk(v, r);
    const lines = [`${PURPOSE_LABEL[r.purpose]} · ${r.geometryType}`];
    // Plasseringa er selve kravet i pkt. 7.2.1.2 - den hører hjemme i
    // sammendraget, ikke bare nede i den enkelte kontrollen.
    if (r.purpose === 'tension') {
      const g = groupGeometry(model, null, r).geo;
      if (g) lines.push(`Avstand bolt–bein ${n(g.dNearest, 0)}–${n(g.dOwn, 0)} mm ` +
        `(maks. 0,75·h_ef = ${n(g.dMax, 0)} mm), c/c ${n(g.sMin, 0)} mm, ` +
        `l_1 = ${n(g.insideLen, 0)} mm, forankring utenfor kjegla ` +
        `${n(g.anchorageAvail, 0)}/${n(g.lbd, 0)} mm`);
    }
    if (issues.length) lines.push(issues.join(' '));
    if (s.replaced)
      lines.push(`Erstatter ${r.purpose === 'tension' ? 'betongkjeglebrudd' : 'kantbrudd'} ` +
        'som dimensjonerende bruddform.');
    return { label: reinforcementLabel(r), need: `${s.need}×⌀${r.ds}`,
             chosen: `${r.count}×⌀${r.ds}`, worst: s.worst, ok, lines };
  });
}

function comboRows(res) {
  let govId = null, govU = -1;
  for (const [id, cv] of res)
    if (cv && cv.maxUtil > govU) { govU = cv.maxUtil; govId = id; }
  const rows = model.combos.map(c => {
    const cv = res.get(c.id);
    const invalid = cv && (!cv.res.converged || cv.issues.some(i => i.level === 'error'));
    const bearing = cv && cv.bearing && !cv.bearing.ok;
    return {
      ...c, active: c.id === model.activeCombo, governing: c.id === govId,
      limitLabel: (LIMIT_STATES.find(([k]) => k === c.limit) || [, c.limit])[1],
      util: cv ? cv.maxUtil : NaN,
      utilText: !cv ? '–' : invalid ? 'Ugyldig' : bearing ? 'Trykk > 100 %' : pct(cv.maxUtil),
      utilColor: invalid || bearing ? '#c0524a' : undefined,
      governingMode: cv?.governing?.mode ?? '',
    };
  });
  return { rows, gov: model.combos.find(c => c.id === govId), govU };
}

// Én beregning pr. kombinasjon som er brukt i rapporten. `run.combo` er
// kombinasjonen, `run.v` resultatet av verify() med den som last.
const comboLoadsTxt = c =>
  `N = ${kN(c.N)} kN · V_x = ${kN(c.Vx)} kN · V_y = ${kN(c.Vy)} kN · ` +
  `M_x = ${n(c.Mx / 1e6, 2)} kNm · M_y = ${n(c.My / 1e6, 2)} kNm · M_z = ${n(c.Mz / 1e6, 2)} kNm`;
const runInvalid = v => !v.res.converged || v.issues.some(i => i.level === 'error');

// mode: 'active' - alt regnes med den valgte kombinasjonen.
//       'gov'    - hver kontroll hentes fra den bruddgrensekombinasjonen som
//                  gir høyest utnyttelse for akkurat den kontrollen.
async function reportData(mode) {
  const m = model;
  const stage = $('#stage');
  // Scenen bygges med et lite opphold etter hver endring - vent den ut, så
  // bildet viser det samme som tallene.
  await new Promise(r => setTimeout(r, 60));
  const images = { iso: stage.snapshot(1800, 1100, 'iso'), view: stage.snapshot(1800, 1100) };

  const res = utilForCombos();
  const activeRun = { combo: m.load, v: verify(m) };
  const runs = m.combos.filter(c => res.get(c.id)).map(c => ({ combo: c, v: res.get(c.id) }));
  // Uten bruddgrensekombinasjoner finnes ingen dimensjonerende - da blir det
  // den valgte, som før.
  const gov = mode === 'gov' && runs.length > 0;
  const used = gov ? runs : [activeRun];

  // Hvilken beregning hver kontroll hentes fra. Ved lik utnyttelse vinner
  // den første kombinasjonen i tabellen.
  const pick = key => {
    const best = new Map();
    for (const run of used)
      for (const c of run.v[key] || []) {
        const u = applicable(c) ? c.util : -1;
        const cur = best.get(c.id);
        if (!cur || u > cur.u) best.set(c.id, { c, run, u });
      }
    return [...best.values()];
  };
  const chosen = pick('checks'), rep = pick('replacedConcreteChecks');
  const runOf = new Map([...chosen, ...rep].map(x => [x.c, x.run]));

  let k = 0;
  const item = c => {
    const nr = `5.${++k}`, run = runOf.get(c);
    return { c, num: nr, dest: `kontroll-${nr}`, applicable: applicable(c),
             figure: figureFor(c, { ...m, load: run.combo }),
             combo: run.combo.name, comboLoads: comboLoadsTxt(run.combo) };
  };
  const fams = checkFamilies({ checks: chosen.map(x => x.c) }).map(f => ({
    name: f.name,
    categories: f.categories.map(cat => ({ name: cat.name, checks: cat.checks.map(item) })),
  }));
  const replaced = rep.map(x => item(x.c));
  const allChecks = [...fams.flatMap(f => f.categories.flatMap(cat => cat.checks)), ...replaced];

  // Samlet resultat: verste kombinasjon avgjør.
  const worstRun = used.reduce((a, r) => (r.v.maxUtil > a.v.maxUtil ? r : a));
  const bad = used.find(r => runInvalid(r.v)) ?? used.find(r => r.v.bearing && !r.v.bearing.ok);
  const invalid = !bad ? null
    : (runInvalid(bad.v) ? 'Ugyldig beregning' : 'Kontakttrykk overskredet') +
      (gov ? ` (${bad.combo.name})` : '');
  const govCheck = worstRun.v.governing;

  // Avvik som bare gjelder noen av kombinasjonene, merkes med hvilke.
  const issueMap = new Map();
  for (const r of used)
    for (const i of r.v.issues) {
      const key = i.level + '|' + i.text;
      if (!issueMap.has(key)) issueMap.set(key, { ...i, combos: [] });
      issueMap.get(key).combos.push(r.combo.name);
    }
  const issues = [...issueMap.values()].map(i => ({ level: i.level,
    text: i.combos.length < used.length ? `${i.text} (${i.combos.join(', ')})` : i.text }));

  // Tilleggsarmeringa: verste kombinasjon for hver gruppe.
  const reinfRuns = used.map(r => reinforcementRows(r.v));
  const reinforcements = model.reinforcements.map((_, i) => {
    const rows = reinfRuns.map(rr => rr[i]);
    const worst = rows.reduce((a, r) => (r.worst > a.worst ? r : a));
    return { ...worst, ok: rows.every(r => r.ok) };
  });

  const combos = comboRows(res);
  if (gov)
    for (const row of combos.rows)
      row.governs = allChecks.filter(it => it.applicable && runOf.get(it.c).combo.id === row.id)
        .map(it => it.num);

  const assumptions = assumptionRows(activeRun.v);
  if (gov) assumptions[0] = ['Lastkombinasjon',
    'dimensjonerende for hver kontroll, blant alle bruddgrensekombinasjonene'];

  return {
    mode: gov ? 'gov' : 'active',
    meta: m.meta,
    date: new Date().toLocaleDateString('nb-NO'),
    standard: activeRun.v.standard,
    standards: activeRun.v.standards,
    activeCombo: gov ? 'Dimensjonerende for hver kontroll'
      : `${m.load.name} (${m.load.limit === 'uls' ? 'bruddgrense' : 'bruksgrense'})`,
    verdict: { ok: used.every(r => r.v.ok), maxUtil: worstRun.v.maxUtil, invalid,
               governing: govCheck ? govCheck.mode + (gov ? ` (${worstRun.combo.name})` : '') : null },
    comboNote: !gov && combos.gov && combos.gov.id !== m.activeCombo
      ? `Styrende lastkombinasjon er ${combos.gov.name} (${pct(combos.govU)}), men utregningene ` +
        `i rapporten gjelder ${m.load.name}. Velg ${combos.gov.name} i lasttabellen, eller lag ` +
        'rapporten med dimensjonerende lastkombinasjon pr. kontroll.'
      : null,
    issues,
    images,
    assumptions,
    shapes: isShaped(m) ? planShapes(m).map((sh, i) => {
      const [z0, z1] = shapeZ(m, sh);
      const geo = sh.kind === 'rect' ? `${sh.bx} × ${sh.by} mm i (${sh.x}, ${sh.y})`
        : sh.kind === 'circle' ? `⌀${2 * sh.r} mm i (${sh.x}, ${sh.y})`
        : `${sh.pts.length} hjørner`;
      return `${i + 1}. ${SHAPE_LABEL[sh.kind]}, ` +
        `${(OP_LABEL[sh.op] || OP_LABEL.add).toLowerCase()}: ${geo}, ` +
        `kote ${Math.round(z0)} til ${Math.round(z1)}`;
    }) : [],
    anchorSets: used.map(r => ({ title: r.combo.name, loads: comboLoadsTxt(r.combo),
                                 anchors: r.v.res.anchors, notes: anchorNotes(r.v) })),
    reinforcements,
    settings: settingsGroups(),
    combos: combos.rows,
    combosNote: 'Bruksgrense kontrolleres ikke – NS-EN 1992-4 dekker bruddgrense. ' +
      'Utnyttelsen er høyeste utnyttelse over alle kontrollene i kombinasjonen; ' +
      'styrende kombinasjon er markert med farget bakgrunn.',
    families: fams,
    replaced,
    allChecks,
  };
}
