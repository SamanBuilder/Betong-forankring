// ---------------------------------------------------------------------------
//  Bygger Three.js-scenen fra modellen + resultatet.
//
//  Alt bygges i INGENIOERKOORDINATER (x, y, z opp ut av betongen, mm).
//  Rotgruppa roteres -90 grader om X slik at ingenioer-z blir Three sin Y.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { anchorPositions, edgeDistances, anchorFoot, mounting,
         shaftProps, memberThickness } from '../core/model.js';
import { solidBoxes, boundaryEdges, facePlane, faceRect, surfaceZ, planMask,
         spansAlong, intersectSpans, anchorDepth, FACE_INFO,
         FACE_LABEL } from '../engine/solid.js';
import { n } from '../engine/calc.js';

// ---------------------------------------------------------------------------
//  Gjenger.
//
//  Tegnes som ei skruelinje lagt utenpå skaftet - ekte geometri, ikke tekstur,
//  så gjengene skyggelegges og blir med i OBJ/GLB-eksporten som alt annet.
//  Skruelinja bygges rett i ingeniørkoordinater med z som akse, og skal derfor
//  ikke roteres slik sylindrene må.
//
//  Ei lang stang med fin stigning gir mange segmenter. Taket holder eksporten
//  liten uten at gjengene slutter å lese som gjenger.
// ---------------------------------------------------------------------------
function threadHelix(d, z0, z1, pitch, x, y) {
  const len = z1 - z0;
  if (!(len > 0) || !(pitch > 0)) return null;
  const turns = len / pitch;
  const seg = Math.max(8, Math.min(1600, Math.round(turns * 10)));
  const r = d / 2;
  const curve = new THREE.Curve();
  curve.getPoint = (t, target = new THREE.Vector3()) => {
    const ang = 2 * Math.PI * turns * t;
    return target.set(x + r * Math.cos(ang), y + r * Math.sin(ang), z0 + len * t);
  };
  return new THREE.TubeGeometry(curve, seg, Math.max(0.3, 0.3 * pitch), 5, false);
}

// ---------------------------------------------------------------------------
//  Kamstål-kammer.
//
//  Ikke et forsøk på å tegne det virkelige valsemønsteret (skrå kam-par i to
//  retninger) - bare et sett med smale ringer med jevne mellomrom, nok til at
//  stanga leses som kamstål og ikke glatt rundstål. Ringradiusen stikker
//  utenpå skaftet, som de virkelige kammene gjør.
// ---------------------------------------------------------------------------
function rebarRibs(d, z0, z1, x, y) {
  const len = z1 - z0;
  if (!(len > 0)) return [];
  const spacing = 0.7 * d;                 // omtrentlig kamavstand
  const count = Math.max(1, Math.min(40, Math.round(len / spacing)));
  const rings = [];
  for (let i = 0; i < count; i++) {
    const z = z0 + (i + 0.5) * len / count;
    const g = new THREE.TorusGeometry(0.55 * d, 0.09 * d, 5, 14);
    g.translate(x, y, z);
    rings.push(g);
  }
  return rings;
}

// ---------------------------------------------------------------------------
//  Endekrok på kamstål - halvsirkel med en rett hale, samme prinsipp som en
//  180°-krok på arbeidstegning. Bøyeradien og halelengden er antydninger for
//  bildet, ikke detaljering - kroken er verken dimensjonert eller kvantifisert
//  i beregninga (se anchorFoot()).
// ---------------------------------------------------------------------------
function rebarHook(d, zBot, x, y, mat) {
  // Bøyeradius og halelengde er en tegneskikk, ikke en dimensjonert detalj -
  // se merknaden i anchorFoot() om at kroken ikke gir tillegg i beregninga.
  const rb = 2.5 * d, tail = 4 * d;

  // Halvsirkelen: fra enden av hovedstanga (0, 0, zBot), et dropp under den
  // og tilbake opp til (2·rb, 0, zBot) - den klassiske krokformen på en
  // arbeidstegning. Bygd som skruelinjefunksjonen: én parametrisert kurve.
  const curve = new THREE.Curve();
  curve.getPoint = (t, target = new THREE.Vector3()) => {
    const phi = Math.PI * (1 - t);
    return target.set(x + rb + rb * Math.cos(phi), y, zBot - rb * Math.sin(phi));
  };
  const arc = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 24, d / 2, 10, false), mat);
  arc.name = 'krok_bue';

  const tailMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(d / 2, d / 2, tail), mat);
  tailMesh.rotation.x = Math.PI / 2;
  tailMesh.position.set(x + 2 * rb, y, zBot + tail / 2);
  tailMesh.name = 'krok_hale';

  const g = new THREE.Group();
  g.add(arc, tailMesh);
  return g;
}

// Betongkorn genereres i sida - ingen ekstern tekstur. Fin støy med noen få
// mørkere luftporer, brukt både som farge- og ujevnhetskart, gir overflata en
// støpt karakter i stedet for jevn plastgrå.
// Fullt dekkende, men malt i den gjennomskinnelige passeringa så stålet
// legger seg over betongen i stedet for å bli tonet ned av den.
const OVER_CONCRETE = { transparent: true, opacity: 1, depthWrite: true };
const ORDER = { body: 0, outline: 2, load: 3, steel: 4, tag: 10 };

let GRAIN = null;
function grainTexture() {
  if (GRAIN) return GRAIN;
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    let v = 224 + (Math.random() - 0.5) * 30;
    if (Math.random() < 0.0045) v -= 45 + Math.random() * 45;   // luftporer
    const k = i * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.max(0, Math.min(255, v));
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // Litt utsmøring, ellers blir kornet ren pikselstøy når kamera går nær.
  g.globalAlpha = 0.5;
  g.filter = 'blur(1px)';
  g.drawImage(c, 0, 0);
  g.filter = 'none'; g.globalAlpha = 1;

  GRAIN = new THREE.CanvasTexture(c);
  GRAIN.wrapS = GRAIN.wrapT = THREE.RepeatWrapping;
  GRAIN.colorSpace = THREE.SRGBColorSpace;
  GRAIN.anisotropy = 8;
  return GRAIN;
}

// Ekte materialfarger: grå betong, blåaktig konstruksjonsstål, rustrød armering.
// De semantiske fargene (grønn/gul/rød) brukes bare når visningen settes til
// utnyttelse - ellers holder modellen seg til materialene.
const MAT = {
  concrete: (Lx, Ly) => {
    const t = grainTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Lx / 350), Math.max(1, Ly / 350));  // ~1 flis pr. 350 mm
    return new THREE.MeshStandardMaterial({
      name: 'betong', color: 0xc3c0b8, map: t, bumpMap: t, bumpScale: 0.5,
      roughness: 1.0, metalness: 0.0,
      transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      depthWrite: false,
    });
  },
  // Valset konstruksjonsstål er matt, ikke forkrommet: lav metalness og høy
  // ruhet, ellers får plata speilglans som ikke finnes i virkeligheten.
  plate: () => new THREE.MeshStandardMaterial({
    name: 'staalplate', color: 0x54606e, roughness: 0.72, metalness: 0.3,
    ...OVER_CONCRETE,
  }),
  steel: () => new THREE.MeshStandardMaterial({
    name: 'bolt', color: 0xaeb6bd, roughness: 0.55, metalness: 0.45,
    ...OVER_CONCRETE,
  }),
  cone: () => new THREE.MeshStandardMaterial({
    name: 'bruddkjegle', color: 0xd99a2b, roughness: 0.9, metalness: 0,
    transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
  }),
  wedge: () => new THREE.MeshStandardMaterial({
    name: 'kantbrudd', color: 0xc0524a, roughness: 0.9, metalness: 0,
    transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false,
  }),
  grout: () => new THREE.MeshStandardMaterial({
    name: 'gytemasse', color: 0xc2baa8, roughness: 0.96, metalness: 0.0,
  }),
  rebar: () => new THREE.MeshStandardMaterial({
    name: 'armering', color: 0x9e5232, roughness: 0.82, metalness: 0.15,
    ...OVER_CONCRETE,
  }),
  // Kamstål som forankringsstang: lysbrun valsehud, skilt fra den rustrøde
  // forankringsarmeringa (reinf) så de to kamstål-elementene ikke blandes.
  rebarAnchor: () => new THREE.MeshStandardMaterial({
    name: 'kamstaal', color: 0xc19a6b, roughness: 0.85, metalness: 0.1,
    ...OVER_CONCRETE,
  }),
};

// Utnyttelsesfarger stemt for lys bakgrunn - samme tre som i resultatpanelet.
export function utilColor(u) {
  if (!Number.isFinite(u)) return new THREE.Color(0x9b958a);
  if (u <= 0.7) return new THREE.Color(0x6e9e4f);
  if (u <= 1.0) return new THREE.Color(0xc79030);
  return new THREE.Color(0xc0524a);
}

// --- smaa hjelpere ---------------------------------------------------------
function boxMesh(w, d, h, mat, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat);
  m.name = name; return m;
}

function polyMesh(verts, faces, mat, name) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
  g.setIndex(faces.flat());
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.name = name; return m;
}

// Konturlinjer gjør de gjennomsiktige bruddlegemene lesbare gjennom betongen.
function outline(mesh, hex, opacity = 0.85) {
  const l = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 1),
    new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity, depthTest: false }));
  l.userData.noExport = true;
  l.renderOrder = ORDER.outline;
  return l;
}

// Ingeniørkoordinat -> verdenskoordinat. Rotgruppa er rotert -90° om X,
// så (x, y, z) blir (x, z, -y). Påskriftene trenger punktet i verdensrommet
// for å kunne projiseres til skjerm.
const toW = (x, y, z) => new THREE.Vector3(x, z, -y);
const toWv = v => new THREE.Vector3(v.x, v.z, -v.y);

// Orientering for en påskrift som skal ligge i modellen. xA er lesretninga og
// yA er «opp» i tekstens eget plan; begge oppgis i ingeniørkoordinater.
function planeQuat(xA, yA) {
  const X = toWv(xA).normalize();
  const Y = toWv(yA).normalize();
  Y.addScaledVector(X, -Y.dot(X)).normalize();      // gjør Y vinkelrett på X
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(X, Y, Z));
}
const UP = new THREE.Vector3(0, 0, 1);

// --- målsetting ---------------------------------------------------------
// Målelinjene er geometri i modellen; selve verdien er en HTML-påskrift som
// verten plasserer, slik at den holder fast skriftstørrelse, står rett på
// skjermen uansett kameravinkel, og kan redigeres direkte.
const DIM_COLOR = 0x14120f;

// Skala for påskriftene: 1 CSS-piksel = 1 mm i modellen ved skala 1.
const HUD_SCALE = m => Math.max(m.concrete.Lx, m.concrete.Ly, 400) * 0.0026;
// Teksthøyden i modellens enheter (13 px skrift, linjehøyde 1,25, se style.css).
const TEXT_H = m => HUD_SCALE(m) * 16.25;

function dimension(group, hud, a0, b0, off, path, value, opts = {}) {
  // Snu målet så lesretninga alltid går mot +x, +y eller +z. Ellers står
  // teksten opp ned på halvparten av målene.
  const dv0 = b0.clone().sub(a0);
  const dom = Math.abs(dv0.x) >= Math.abs(dv0.y) && Math.abs(dv0.x) >= Math.abs(dv0.z)
    ? 'x' : Math.abs(dv0.y) >= Math.abs(dv0.z) ? 'y' : 'z';
  const [a, b] = dv0[dom] < 0 ? [b0, a0] : [a0, b0];

  const o = off.clone();
  const oN = o.clone().normalize();
  const L = o.length();
  const A2 = a.clone().add(o), B2 = b.clone().add(o);
  const dir = B2.clone().sub(A2).normalize();
  const span = B2.distanceTo(A2);
  const ah = opts.arrow;                       // pilspisslengde

  // Hjelpelinjer, fra litt utenfor målpunktet til litt forbi målelinja.
  const over = oN.clone().multiplyScalar(ah * 0.9);
  const gap = oN.clone().multiplyScalar(ah * 0.35);
  const pts = [
    a.clone().add(gap), A2.clone().add(over),
    b.clone().add(gap), B2.clone().add(over),
    A2, B2,
  ];
  const seg = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: DIM_COLOR, transparent: true, opacity: 0.85 }));
  seg.userData.noExport = true;
  seg.renderOrder = ORDER.tag - 1;
  group.add(seg);

  // Fylte pilspisser i målets eget plan, som på en arbeidstegning. Er målet
  // kortere enn to pilspisser, snus de utover slik at de får plass.
  const inn = span > ah * 2.6 ? 1 : -1;
  const w = ah * 0.32;
  const tri = [];
  for (const [tip, s] of [[A2, 1], [B2, -1]]) {
    const base = tip.clone().addScaledVector(dir, s * inn * ah);
    tri.push(tip.clone(),
             base.clone().addScaledVector(oN, w),
             base.clone().addScaledVector(oN, -w));
  }
  const head = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute('position',
      new THREE.Float32BufferAttribute(tri.flatMap(v => [v.x, v.y, v.z]), 3)),
    new THREE.MeshBasicMaterial({ color: DIM_COLOR, side: THREE.DoubleSide }));
  head.name = 'maalpil';
  head.renderOrder = ORDER.tag - 1;
  group.add(head);

  // Teksten står midt på målelinja - eksakt, ingen forskyvning langs den - og
  // løftes vinkelrett klar av streken. Avstanden regnes fra teksthøyden, ikke
  // fra pilspissen: påskrifta er festet i midten, så den må minst ut halve
  // høyden sin før den slipper linja.
  const mid = A2.clone().add(B2).multiplyScalar(0.5)
    .addScaledVector(oN, opts.textOff);
  hud.push({ kind: 'dim', p: toW(mid.x, mid.y, mid.z),
             quat: planeQuat(dir, oN),
             path, value: Math.round(value * 10) / 10,
             step: opts.step ?? 10, min: opts.min ?? 1 });
}

function buildDimensions(m, mnt, zTop, hud, dz = 0) {
  const g = new THREE.Group();
  g.name = 'maal';
  const c = m.concrete, p = m.plate, a = m.anchors;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const S = Math.max(c.Lx, c.Ly);
  const arrow = S * 0.011;
  const textOff = TEXT_H(m) * 0.88;      // halve teksthøyden + et lite mellomrom
  const opt = extra => ({ arrow, textOff, ...extra });

  const x0 = -(c.Lx / 2 + c.ex), x1 = c.Lx / 2 - c.ex;
  const y0 = -(c.Ly / 2 + c.ey), y1 = c.Ly / 2 - c.ey;
  const zc = -c.h + dz, D = S * 0.085;

  // Betongdelen måles for seg, ved underkant. Grunnformen måles alltid - de
  // formene som er lagt oppå den måler seg selv, se buildFeatures().
  dimension(g, hud, V(x0, y0, zc), V(x1, y0, zc), V(0, -D, 0),
    'concrete.Lx', c.Lx, opt());
  dimension(g, hud, V(x1, y0, zc), V(x1, y1, zc), V(D, 0, 0),
    'concrete.Ly', c.Ly, opt());
  dimension(g, hud, V(x1, y0, dz), V(x1, y0, zc), V(D * 0.75, -D * 0.75, 0),
    'concrete.h', c.h, opt());

  // Plata og boltavstandene hører sammen og måles i samme område, i platas
  // plan: plata innerst, boltkjeden like utenfor.
  const pos = anchorPositions(m);
  const bxs = [...new Set(pos.map(q => q.x))].sort((u, w) => u - w);
  const bys = [...new Set(pos.map(q => q.y))].sort((u, w) => u - w);
  // Uten plate finnes ingen platekant å måle fra. Da måles boltkjeden mot
  // boltgruppas egen ytterkant, og platemålene faller bort.
  const spanX = Math.max((a.nx - 1) * a.sx, 4 * a.d);
  const spanY = Math.max((a.ny - 1) * a.sy, 4 * a.d);
  const wx = p.present ? p.bx : spanX, wy = p.present ? p.by : spanY;
  const P = Math.max(wx, wy);
  const g1 = P * 0.30, g2 = P * 0.68;

  if (p.present) {
    dimension(g, hud, V(-p.bx / 2, -p.by / 2, zTop), V(p.bx / 2, -p.by / 2, zTop),
      V(0, -g1, 0), 'plate.bx', p.bx, opt());
    dimension(g, hud, V(p.bx / 2, -p.by / 2, zTop), V(p.bx / 2, p.by / 2, zTop),
      V(g1, 0, 0), 'plate.by', p.by, opt());
  }

  // Kjede fra platekant til platekant. Segmentet mellom to bolter er selve
  // senteravstanden og kan redigeres; kantsegmentene er avledet.
  const chain = (vals, boltSet, along, path, n) => {
    const c2 = [...new Set(vals)].sort((u, w) => u - w);
    for (let i = 0; i < c2.length - 1; i++) {
      const bolts = boltSet.includes(c2[i]) && boltSet.includes(c2[i + 1]);
      along(c2[i], c2[i + 1], (bolts && n > 1) ? path : null, c2[i + 1] - c2[i]);
    }
  };
  chain([-wx / 2, ...bxs, wx / 2], bxs,
    (u, w, path, val) => dimension(g, hud,
      V(u, -wy / 2, zTop), V(w, -wy / 2, zTop), V(0, -g2, 0), path, val, opt()),
    'anchors.sx', a.nx);
  chain([-wy / 2, ...bys, wy / 2], bys,
    (u, w, path, val) => dimension(g, hud,
      V(wx / 2, u, zTop), V(wx / 2, w, zTop), V(g2, 0, 0), path, val, opt()),
    'anchors.sy', a.ny);

  if (p.present)
    dimension(g, hud, V(-p.bx / 2, -p.by / 2, mnt.offset + p.t),
      V(-p.bx / 2, -p.by / 2, mnt.offset), V(-g1 * 0.5, -g1 * 0.5, 0),
      'plate.t', p.t, opt({ step: 1 }));
  else if (p.e > 0)
    dimension(g, hud, V(-wx / 2, -wy / 2, p.e), V(-wx / 2, -wy / 2, 0),
      V(-g1 * 0.5, -g1 * 0.5, 0), 'plate.e', p.e, opt({ step: 5 }));

  dimension(g, hud, V(bxs[0], bys[bys.length - 1], 0), V(bxs[0], bys[bys.length - 1], -a.hef),
    V(-P * 0.55, P * 0.55, 0), 'anchors.hef', a.hef, opt({ step: 5 }));

  return g;
}

function loadMat(hex, active) {
  return new THREE.MeshStandardMaterial({
    name: active ? 'last' : 'last_null', color: hex,
    roughness: 0.55, metalness: 0.05,
    transparent: !active, opacity: active ? 1 : 0.2, depthWrite: active,
  });
}

function forceArrow(tail, dir, len, hex, active = true) {
  const g = new THREE.Group();
  g.name = active ? 'kraftpil' : 'kraftpil_null';
  const mat = loadMat(hex, active);
  const headL = len * 0.34, shaftL = len - headL;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(len * 0.030, len * 0.030, shaftL, 16), mat);
  shaft.position.y = shaftL / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(len * 0.095, headL, 20), mat);
  head.position.y = shaftL + headL / 2;
  shaft.renderOrder = head.renderOrder = ORDER.load;
  g.add(shaft, head);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.position.copy(tail);
  return g;
}

// Momentpil: bue rundt aksen med kjegle tangentielt i enden. Omløpsretninga
// følger høyrehåndsregelen - negativt moment sendes inn som negativ akse.
function momentArrow(pos, axis, R, tube, hex, active = true) {
  const g = new THREE.Group();
  g.name = active ? 'momentpil' : 'momentpil_null';
  const mat = loadMat(hex, active);
  const sweep = Math.PI * 1.45;
  const arc = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 12, 56, sweep), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.2, tube * 9, 18), mat);
  head.position.set(R * Math.cos(sweep), R * Math.sin(sweep), 0);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-Math.sin(sweep), Math.cos(sweep), 0));
  arc.renderOrder = head.renderOrder = ORDER.load;
  g.add(arc, head);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
  g.position.copy(pos);
  return g;
}

// Stiplet akse: tynn svart strek uten tykkelse. Aksene ligger nå utenfor
// betongen, over lys bakgrunn, så en 1 px linje leses fint - og holder seg
// diskret slik en hjelpelinje skal.
function dashedAxis(origin, dir, len) {
  const l = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      [origin.clone(), origin.clone().addScaledVector(dir, len)]),
    new THREE.LineDashedMaterial({ color: 0x14120f, dashSize: len * 0.022,
      gapSize: len * 0.018, transparent: true, opacity: 0.75 }));
  l.computeLineDistances();
  l.name = 'akse';
  l.userData.noExport = true;
  return l;
}

// Aksetriade for lastene. Én stiplet linje pr. akse ut fra platesenteret, med
// kraft og moment for den aksen samlet ute ved enden - i stedet for store
// piler oppå selve forbindelsen.
const AXIS_COLOR = { x: 0x3f8f4a, y: 0xc0443c, z: 0x2f6fb5 };   // grønn, rød, blå
const AXIS_TEXT = { x: '#2f7038', y: '#a33a33', z: '#255a94' };

function loadTriad(m, zTop, hud) {
  const g = new THREE.Group();
  g.name = 'laster';
  const L = m.load, c = m.concrete;
  const S = Math.max(c.Lx, c.Ly);

  // Aksene i x og y føres forbi betongkanten, slik at pil og momentbue står
  // fritt utenfor klossen i stedet for å legge seg oppå den.
  const margin = S * 0.10;
  const lenX = (c.Lx / 2 - c.ex) + margin;
  const lenY = (c.Ly / 2 - c.ey) + margin;
  const lenZ = S * 0.30;

  const aL = S * 0.11;        // pillengde
  const R = S * 0.052;        // momentbuens radius
  const tube = S * 0.0055;

  const o = new THREE.Vector3(0, 0, zTop + Math.max(5, S * 0.006));

  const axes = [
    // mU/mV spenner ut planet momentbuen ligger i - det står vinkelrett på
    // aksen, så momentverdien legges i samme plan som buen den hører til.
    { k: 'x', dir: new THREE.Vector3(1, 0, 0), len: lenX,
      mU: new THREE.Vector3(0, 1, 0), mV: new THREE.Vector3(0, 0, 1),
      F: L.Vx, Fp: 'load.Vx', M: L.Mx, Mp: 'load.Mx' },
    { k: 'y', dir: new THREE.Vector3(0, 1, 0), len: lenY,
      mU: new THREE.Vector3(1, 0, 0), mV: new THREE.Vector3(0, 0, 1),
      F: L.Vy, Fp: 'load.Vy', M: L.My, Mp: 'load.My' },
    { k: 'z', dir: new THREE.Vector3(0, 0, 1), len: lenZ,
      mU: new THREE.Vector3(1, 0, 0), mV: new THREE.Vector3(0, 1, 0),
      F: L.N,  Fp: 'load.N',  M: L.Mz, Mp: 'load.Mz' },
  ];

  for (const a of axes) {
    const col = AXIS_COLOR[a.k];
    g.add(dashedAxis(o, a.dir, a.len));

    // Moment om aksen, plassert der kraftpila starter. Omløpet følger
    // høyrehåndsregelen; null vises bleknet i positiv retning.
    const mOn = Math.abs(a.M) > 1;
    g.add(momentArrow(o.clone().addScaledVector(a.dir, a.len),
      a.dir.clone().multiplyScalar(mOn && a.M < 0 ? -1 : 1), R, tube, col, mOn));

    const fOn = Math.abs(a.F) > 1;
    const fwd = !fOn || a.F > 0;
    g.add(forceArrow(o.clone().addScaledVector(a.dir, fwd ? a.len : a.len + aL),
      a.dir.clone().multiplyScalar(fwd ? 1 : -1), aL, col, fOn));

    // Bare tallet og enheten: hvilken komponent det er, framgår av hvor den
    // står. Kraftverdien legges i planet langs aksen, ved kraftpila.
    // Langs z ville lesretninga blitt loddrett. Da peker den nesten rett inn i
    // skjermen sett ovenfra, og snuingen vipper fram og tilbake. Teksten legges
    // derfor vannrett ved den loddrette pila.
    const X = new THREE.Vector3(1, 0, 0);
    const up = a.k === 'z' ? X : UP;
    const fq = a.k === 'z' ? planeQuat(X, UP) : planeQuat(a.dir, UP);
    const fp = o.clone().addScaledVector(a.dir, a.len + aL * 0.62)
      .addScaledVector(up, R * 0.85);
    hud.push({ kind: 'load', quat: fq, color: AXIS_TEXT[a.k],
      p: toW(fp.x, fp.y, fp.z),
      path: a.Fp, value: a.F, scale: 1000, unit: 'kN', dec: 2, step: 1 });

    // Momentverdien legges i buens eget plan, like utenfor buen.
    const mp = o.clone().addScaledVector(a.dir, a.len)
      .addScaledVector(a.mV, R * 1.55);
    hud.push({ kind: 'load', quat: planeQuat(a.mU, a.mV), color: AXIS_TEXT[a.k],
      p: toW(mp.x, mp.y, mp.z),
      path: a.Mp, value: a.M, scale: 1e6, unit: 'kNm', dec: 3, step: 0.5 });
  }
  return g;
}

// --- hovedbygger -----------------------------------------------------------
export function buildScene(v, opts = {}) {
  const show = { concrete: true, cone: true, wedge: true, loads: true,
                 labels: true, rebar: true, plate: true, dims: true,
                 colorMode: 'material', ...opts };
  const byUtil = show.colorMode === 'utilisation';
  const m = v.model, res = v.res;
  const hud = [];                     // HTML-påskrifter verten plasserer
  const root = new THREE.Group();
  root.name = 'forankring';
  root.rotation.x = -Math.PI / 2;      // ingenioer-z -> Three-y

  const c = m.concrete, p = m.plate, a = m.anchors;

  // ---- betongdel --------------------------------------------------------
  // Nullpunktet i visninga er betongoverflata under plata. Er det skaaret en
  // grop der plata staar, ligger grunnformens overkant over null - da flyttes
  // betongen, ikke stålet, saa alt det andre kan regne z = 0 som overflata.
  const dz = -surfaceZ(m);
  if (show.concrete) root.add(concreteBody(m, dz));

  // ---- undergyting ------------------------------------------------------
  const mnt = mounting(m);
  if (mnt.kind === 'grout' && mnt.offset > 0) {
    const ov = 25;   // gytesjiktet stikker litt utenfor plata
    const gr = boxMesh(p.bx + 2 * ov, p.by + 2 * ov, mnt.offset, MAT.grout(), 'gytemasse');
    gr.position.set(0, 0, mnt.offset / 2);
    root.add(gr);
  }

  // ---- stålplate --------------------------------------------------------
  if (show.plate && p.present) {
    const pl = boxMesh(p.bx, p.by, p.t, MAT.plate(), 'forankringsplate');
    pl.position.set(0, 0, mnt.offset + p.t / 2);
    pl.renderOrder = ORDER.steel;
    root.add(pl);
  }

  // ---- bolter -----------------------------------------------------------
  const utilByAnchor = anchorUtil(v);
  const zTop = p.present ? mnt.offset + p.t : mnt.offset + Math.max(p.e, 0);
  const steelMat = MAT.steel();
  const rebarMat = MAT.rebarAnchor();
  const foot = anchorFoot(m);
  const sh = shaftProps(m);
  for (const an of res.anchors) {
    const u = utilByAnchor.get(an.id) ?? 0;
    const mat = byUtil
      ? new THREE.MeshStandardMaterial({
          name: `bolt_u${Math.round(u * 100)}`, color: utilColor(u),
          roughness: 0.62, metalness: 0.2, ...OVER_CONCRETE })
      : a.barType === 'rebar' ? rebarMat : steelMat;
    const g = new THREE.Group();
    g.name = `bolt_${an.id}`;

    // Sveist bolt slutter ved platas underside og har en sveisekrage der.
    // Gjennomboltet bolt går gjennom plata og får skive og mutter over.
    // Uten plate går stanga rett opp forbi betongoverflata, med utkraginga e.
    const welded = a.attachment !== 'bolted';
    const nutH = 0.8 * a.d, nutR = 0.87 * a.d;      // sekskantmutter, ca. M-serie
    const washT = 0.16 * a.d, washR = 1.1 * a.d;
    const shaftTop = !p.present ? zTop
                   : welded ? mnt.offset
                            : zTop + washT + nutH + 0.3 * a.d;
    // Med fot starter skaftet på overkant fot; uten fot går det helt ned.
    const zBot = foot.hasFoot ? -a.hef + foot.t : -a.hef;
    const shaftLen = shaftTop - zBot;

    const cyl = (r, h, seg = 24) => new THREE.CylinderGeometry(r, r, h, seg);
    const put = (mesh, z, name) => {
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(an.x, an.y, z);
      mesh.renderOrder = ORDER.steel;
      mesh.name = `${name}_${an.id}`;
      g.add(mesh);
      return mesh;
    };

    put(new THREE.Mesh(cyl(a.d / 2, shaftLen), mat), zBot + shaftLen / 2, 'skaft');

    // Gjengene tegnes bare der stanga faktisk er gjenget. Er skaftet glatt et
    // stykke ned fra betongoverflata, begynner de først der - samme lengde som
    // heftberegningen bruker, så bildet og tallene forteller det samme.
    if (a.barType === 'rod') {
      const zones = [[zBot, sh.smooth > 0 ? -sh.smooth : shaftTop]];
      // Er skaftet glatt og plata gjennomboltet, må toppen likevel ha gjenger
      // til mutteren.
      if (sh.smooth > 0 && p.present && !welded)
        zones.push([zTop - 0.2 * a.d, shaftTop]);
      for (const [z0, z1] of zones) {
        const geo = threadHelix(a.d, z0, z1, sh.P, an.x, an.y);
        if (!geo) continue;
        const th = new THREE.Mesh(geo, mat);
        th.renderOrder = ORDER.steel;
        th.name = `gjenger_${an.id}`;
        g.add(th);
      }
    }
    // Kamstål er ikke glatt: kammer langs hele stanga gjør at den leses som
    // kamstål og ikke som gjengestang eller sveisebolt.
    if (a.barType === 'rebar') {
      for (const geo of rebarRibs(a.d, zBot, shaftTop, an.x, an.y)) {
        const rb = new THREE.Mesh(geo, mat);
        rb.renderOrder = ORDER.steel;
        rb.name = `kammer_${an.id}`;
        g.add(rb);
      }
    }
    // Foten tegnes fra modellens egne verdier, ikke fra standardtabellen, slik
    // at et redigert mål faktisk vises: rundt hode for sveisebolt, sekskantet
    // mutter for gjengestang/kamstål, krok for kamstål, og firkantet plate for
    // innstøpt endeplate. Den felles endeplata hører til gruppa, ikke til den
    // enkelte bolten, og tegnes derfor én gang etter løkka.
    if (foot.kind === 'nut') {
      // Sekskantmutter: nøkkelvidden er avstanden mellom flatene, altså
      // 2 * innskrevet radius. Sylinderradiusen er den omskrevne.
      put(new THREE.Mesh(cyl(a.dh / Math.sqrt(3), foot.t, 6), mat),
        -a.hef + foot.t / 2, 'endemutter');
    } else if (foot.kind === 'head') {
      put(new THREE.Mesh(cyl(a.dh / 2, foot.t), mat), -a.hef + foot.t / 2, 'hode');
    } else if (foot.kind === 'hook') {
      const hook = rebarHook(a.d, zBot, an.x, an.y, mat);
      hook.name = `krok_${an.id}`;
      g.add(hook);
    }

    if (!p.present) {
      // Ingen plate: bare stanga, med gjenger eller kammer antydet av at
      // enden står fritt. Ved gjengestang settes det på en mutter i toppen.
      if (a.barType === 'rod') {
        put(new THREE.Mesh(cyl(washR, washT), mat), zTop - nutH - washT / 2, 'skive');
        put(new THREE.Mesh(cyl(nutR, nutH, 6), mat), zTop - nutH / 2, 'mutter');
      }
    } else if (welded) {
      // Sveisekrage: videst inntil plata, smalner av nedover.
      const wh = 0.35 * a.d;
      put(new THREE.Mesh(
        new THREE.CylinderGeometry(0.85 * a.d, 0.55 * a.d, wh, 20), mat),
        mnt.offset - wh / 2, 'sveis');
    } else {
      put(new THREE.Mesh(cyl(washR, washT), mat), zTop + washT / 2, 'skive');
      put(new THREE.Mesh(cyl(nutR, nutH, 6), mat), zTop + washT + nutH / 2, 'mutter');
      // Ved avstandsmontasje står plata på justeringsmuttere.
      if (mnt.kind === 'standoff' && mnt.offset > nutH) {
        put(new THREE.Mesh(cyl(nutR, nutH, 6), mat), mnt.offset - nutH / 2, 'justermutter');
        put(new THREE.Mesh(cyl(washR, washT), mat),
          mnt.offset - nutH - washT / 2, 'justerskive');
      }
    }

    if (show.labels) {
      hud.push({ kind: 'value', p: toW(an.x, an.y, zTop + Math.max(70, p.bx * 0.30)),
        quat: planeQuat(new THREE.Vector3(1, 0, 0), UP),
        text: `${an.N > 1 ? n(an.N / 1000, 1) + ' kN' : '–'} │ ${n(an.V / 1000, 1)} kN`,
        color: byUtil ? '#' + utilColor(u).getHexString() : '#2b2924' });
    }
    root.add(g);
  }

  // ---- felles endeplate -------------------------------------------------
  // Én plate i innstøpingsenden som knytter hele boltegruppa sammen. Den er
  // gruppas del, så den får sin egen farge uavhengig av utnyttelsen i boltene.
  if (foot.kind === 'plate') {
    const pl = foot.plate;
    const ep = new THREE.Mesh(
      new THREE.BoxGeometry(pl.bx, pl.by, foot.t), steelMat);
    ep.position.set((pl.x0 + pl.x1) / 2, (pl.y0 + pl.y1) / 2, -a.hef + foot.t / 2);
    ep.renderOrder = ORDER.steel;
    ep.name = 'endeplate';
    root.add(ep);
  }

  // ---- bruddkjegle i strekk --------------------------------------------
  // Bruddkjegla vises for det regelverket som faktisk regner kjeglebrudd:
  // EN 1992-4 alltid, B19 bare når kjeglemodellen er den styrende.
  const cone = v.checks.find(k => k.id === 'N-cone' || (k.id === 'N-conc' && k.showCone));
  if (show.cone && res.tension.anchors.length && cone && Number.isFinite(cone.NRd)) {
    const ccr = 1.5 * a.hef;
    // Med felles endeplate river hele plata ut ett legeme, så kjegla starter
    // ved platekanten - det samme arealet som A_c,N regnes av.
    const xs = res.tension.anchors.map(t => t.x), ys = res.tension.anchors.map(t => t.y);
    const b = foot.common
      ? { x0: foot.plate.x0, x1: foot.plate.x1,
          y0: foot.plate.y0, y1: foot.plate.y1 }
      : { x0: Math.min(...xs), x1: Math.max(...xs),
          y0: Math.min(...ys), y1: Math.max(...ys) };
    const cm = coneMesh(m, b, ccr, a.hef);
    if (cm) {
      cm.renderOrder = 3;
      root.add(cm, outline(cm, 0xffa53d));
    }
  }

  // ---- kantbrudd-kile ---------------------------------------------------
  // Kantbrudd-kila: EN 1992-4 sin V-edge, eller B19 sin V-conc mot en kant.
  const edge = v.checks.find(k => k.edgeDir);
  if (show.wedge && edge && Number.isFinite(edge.NRd) && edge.util > 0) {
    for (const w of edgeWedges(m, res, edge.edgeDir)) {
      const wm = polyMesh(w.V, w.F, MAT.wedge(), 'kantbrudd');
      wm.renderOrder = 3;
      root.add(wm, outline(wm, 0xff5f56));
    }
  }

  // ---- forankringsarmering ---------------------------------------------
  if (show.rebar && m.code.supplementaryReinf && m.reinf) {
    const r = m.reinf, rm = MAT.rebar();
    const pts = anchorPositions(m);
    const per = Math.max(1, Math.round(r.n / pts.length));
    for (const pt of pts) {
      for (let i = 0; i < per; i++) {
        const ang = (i / per) * Math.PI * 2;
        const off = a.d / 2 + r.ds / 2 + 6;
        const bar = new THREE.Mesh(
          new THREE.CylinderGeometry(r.ds / 2, r.ds / 2, r.l1, 12), rm);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(pt.x + Math.cos(ang) * off, pt.y + Math.sin(ang) * off,
          -a.hef + r.l1 / 2);
        bar.name = 'armering';
        bar.renderOrder = ORDER.steel;
        root.add(bar);
      }
    }
  }

  // ---- laster -----------------------------------------------------------
  if (show.loads) root.add(loadTriad(m, zTop, hud));

  // ---- formene i betongen, med uttrekkspiler ----------------------------
  root.add(buildFeatures(m, dz, hud, show));

  // ---- målsetting -------------------------------------------------------
  if (show.dims) root.add(buildDimensions(m, mnt, zTop, hud, dz));

  // 1 CSS-piksel = 1 mm i modellen ved skala 1. Skalaen settes slik at
  // teksten holder samme andel av modellen uansett hvor stor den er.
  const hudScale = HUD_SCALE(m);
  return { root, hud, hudScale };
}

// ---------------------------------------------------------------------------
//  Bruddkjegla, klippet mot betongen slik den staar.
//
//  Kjegla er en pyramidestubb: bunnflata er forankringas rektangel b i dybden
//  h_ef, og den sprer seg 1,5*h_ef ut til overflata. Den bygges som et
//  hoeydefelt over det samme rutenettet arealet regnes av, saa kjegla i bildet
//  har noeyaktig den grunnflata A_c,N er regnet av: der betongen mangler,
//  stopper kjegla i en loddrett flate i stedet for aa henge i lufta.
//
//  Underflata i et punkt ligger like hoeyt som avstanden ut fra b tilsier:
//  rett over b er den i -h_ef, og 1,5*h_ef lengre ut har den naadd overflata.
// ---------------------------------------------------------------------------
function coneMesh(m, b, ccr, hef) {
  const [z0, z1] = anchorDepth(m);
  const mask = planMask(m, z0, z1);
  const t = { x0: b.x0 - ccr, x1: b.x1 + ccr, y0: b.y0 - ccr, y1: b.y1 + ccr };
  const cuts = (base, extra, lo, hi) =>
    [...new Set([...base, ...extra, lo, hi])]
      .filter(v => v > lo - 1e-9 && v < hi + 1e-9).sort((u, w) => u - w);
  const xs = cuts(mask.xs, [b.x0, b.x1], t.x0, t.x1);
  const ys = cuts(mask.ys, [b.y0, b.y1], t.y0, t.y1);
  if (xs.length < 2 || ys.length < 2) return null;

  const low = (x, y) => {
    const dx = Math.max(b.x0 - x, x - b.x1, 0);
    const dy = Math.max(b.y0 - y, y - b.y1, 0);
    return -hef * (1 - Math.min(Math.max(dx, dy), ccr) / ccr);
  };
  const nx = xs.length - 1, ny = ys.length - 1;
  const keep = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      keep[j * nx + i] = mask.has((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2) ? 1 : 0;
  if (!keep.some(Boolean)) return null;

  const P = [];
  const tri = (a1, a2, a3) => P.push(...a1, ...a2, ...a3);
  const quad = (a1, a2, a3, a4) => { tri(a1, a2, a3); tri(a1, a3, a4); };
  const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && keep[j * nx + i];

  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!keep[j * nx + i]) continue;
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
      const L = (x, y) => [x, y, low(x, y)];
      // underflata (den skraa kjegleflata) og overflata i betongoverflata
      quad(L(x0, y0), L(x1, y0), L(x1, y1), L(x0, y1));
      quad([x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]);
      // loddrette flater der kjegla moeter en kant, et hull eller sin egen ytterkant
      if (!on(i - 1, j)) quad(L(x0, y0), L(x0, y1), [x0, y1, 0], [x0, y0, 0]);
      if (!on(i + 1, j)) quad(L(x1, y1), L(x1, y0), [x1, y0, 0], [x1, y1, 0]);
      if (!on(i, j - 1)) quad(L(x1, y0), L(x0, y0), [x0, y0, 0], [x1, y0, 0]);
      if (!on(i, j + 1)) quad(L(x0, y1), L(x1, y1), [x1, y1, 0], [x0, y1, 0]);
    }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, MAT.cone());
  mesh.name = 'bruddkjegle';
  return mesh;
}

// Kantbruddlegemet: kile fra forreste boltrad ut til kantflata.
//
// Kanten er den betongen faktisk har - er den flyttet av en utsparing eller en
// konsoll, foelger kila med. Klipper en utsparing bruddflata i to, tegnes den
// som to kiler, slik arealet ogsaa regnes.
function edgeWedges(m, res, dir) {
  if (!dir) return [];
  const all = anchorPositions(m);
  const ds = all.map(p => edgeDistances(m, p.x, p.y)[dir]);
  const c1 = Math.min(...ds);
  if (!Number.isFinite(c1)) return [];
  const front = all.filter((p, i) => Math.abs(ds[i] - c1) < 1e-6);
  const hv = -Math.min(1.5 * c1, memberThickness(m, front));
  const axisX = dir.startsWith('x');
  const t = p => (axisX ? p.y : p.x);
  const ax = axisX ? front[0].x : front[0].y;    // boltradens posisjon i lastretning
  const face = dir.endsWith('Pos') ? ax + c1 : ax - c1;
  const al = Math.min(...front.map(t)), ah = Math.max(...front.map(t));

  const [z0, z1] = anchorDepth(m);
  const spans = intersectSpans(
    front.map(p => [t(p) - 1.5 * c1, t(p) + 1.5 * c1]),
    spansAlong(planMask(m, z0, z1), axisX ? 'y' : 'x', ax));
  if (!spans.length) return [];

  const P = (u, w, z) => axisX ? [u, w, z] : [w, u, z];
  const F = [[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5],
             [4,5,6],[4,6,7],[0,3,2],[0,2,1]];
  return spans.map(([tl, th]) => ({ F, V: [
    P(face, tl, 0), P(face, th, 0), P(face, th, hv), P(face, tl, hv),   // kantflata
    P(ax, Math.max(al, tl), 0), P(ax, Math.min(ah, th), 0),
    P(ax, Math.min(ah, th), hv), P(ax, Math.max(al, tl), hv),           // boltlinja
  ] }));
}

// ---------------------------------------------------------------------------
//  Betongdelen slik den faktisk staar: grunnformen med alle snittene dratt ut
//  eller inn. Legemet kommer fra solid.js som noen faa akseparallelle kasser,
//  og konturen som bare de ekte kantene - ingen soemmer mellom kassene.
// ---------------------------------------------------------------------------
function concreteBody(m, dz) {
  const c = m.concrete;
  const g = new THREE.Group();
  g.name = 'betong';
  const mat = MAT.concrete(c.Lx, c.Ly);
  for (const b of solidBoxes(m)) {
    const mesh = boxMesh(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, mat, 'betong');
    mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2 + dz);
    g.add(mesh);
  }
  const pts = [];
  for (const [p, q] of boundaryEdges(m)) {
    pts.push(new THREE.Vector3(p[0], p[1], p[2] + dz),
             new THREE.Vector3(q[0], q[1], q[2] + dz));
  }
  const eg = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x8a857a, transparent: true, opacity: 0.55 }));
  eg.userData.noExport = true;
  g.add(eg);
  return g;
}

// ---------------------------------------------------------------------------
//  Snittene med uttrekkspilene.
//
//  Hver form vises som rektangelet den er tegnet av, i flata den hoerer til,
//  og en pil ut fra den flyttede flata. Pila er et drahaandtak: den er merket
//  med hvilken verdi i modellen den styrer, saa 3D-visninga kan dra den og
//  skrive rett i modellen - samme prinsipp som maalene, bare kontinuerlig.
// ---------------------------------------------------------------------------
const FEATURE_ADD = 0x2f6fb5;      // blaa: legger betong til
const FEATURE_CUT = 0xc0524a;      // roed: tar betong bort

function featurePoint(m, ft, u, v, off) {
  const c = m.concrete, inf = FACE_INFO[ft.face];
  const plane = facePlane(m, ft.face) + inf.sign * off;
  if (inf.axis === 'x') return new THREE.Vector3(plane, u - c.ey, v);
  if (inf.axis === 'y') return new THREE.Vector3(u - c.ex, plane, v);
  return new THREE.Vector3(u - c.ex, v - c.ey, plane);
}

function buildFeatures(m, dz, hud, show) {
  const g = new THREE.Group();
  g.name = 'former';
  const c = m.concrete;
  const list = c.features || [];
  if (!list.length) return g;
  const S = Math.max(c.Lx, c.Ly, 400);
  const shift = new THREE.Vector3(0, 0, dz);

  list.forEach((ft, i) => {
    const inf = FACE_INFO[ft.face];
    if (!inf) return;
    const rect = faceRect(m, ft.face);
    const u0 = Math.max(rect.u0, ft.u - ft.bu / 2), u1 = Math.min(rect.u1, ft.u + ft.bu / 2);
    const v0 = Math.max(rect.v0, ft.v - ft.bv / 2), v1 = Math.min(rect.v1, ft.v + ft.bv / 2);
    if (!(u1 > u0) || !(v1 > v0)) return;
    const d = +ft.depth || 0;
    const col = d < 0 ? FEATURE_CUT : FEATURE_ADD;
    const P = (u, v, off) => featurePoint(m, ft, u, v, off).add(shift);

    // Snittet i flata, og det samme rektangelet der uttrekket har flyttet det.
    const loop = off => [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]]
      .map(([u, v]) => P(u, v, off));
    const pts = [];
    const push = arr => { for (let k = 0; k < arr.length - 1; k++) pts.push(arr[k], arr[k + 1]); };
    push(loop(0));
    if (Math.abs(d) > 1e-6) {
      push(loop(d));
      for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
        pts.push(P(u, v, 0), P(u, v, d));
    }
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9,
                                    depthTest: false }));
    line.name = `snitt_${ft.id || i + 1}`;
    line.renderOrder = ORDER.outline;
    line.userData.noExport = true;
    g.add(line);

    // Uttrekkspila: staar paa den flyttede flata og peker utover. Dra den ut
    // for mer betong, inn - forbi null - for en utsparing.
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    const nrm = new THREE.Vector3(...inf.n);
    const len = Math.max(40, Math.min(S * 0.13, Math.max(u1 - u0, v1 - v0) * 0.9));
    const arrow = forceArrow(P(uc, vc, d), nrm, len, col);
    arrow.name = `uttrekk_${ft.id || i + 1}`;
    const handle = { path: `concrete.features.${i}.depth`, id: ft.id, value: d,
                     dir: [nrm.x, nrm.y, nrm.z], step: 5,
                     label: `${FACE_LABEL[ft.face]} · uttrekk` };
    // Pila er et betjeningselement, ikke geometri: den tegnes flatt og over
    // alt annet. En utsparing flytter flata inn i betongen, og da ville pila
    // ellers ligge begravd akkurat naar du trenger aa ta tak i den.
    const amat = new THREE.MeshBasicMaterial({ color: col, depthTest: false,
      transparent: true, opacity: 0.95 });
    arrow.traverse(o => {
      o.userData.handle = handle;
      o.userData.noExport = true;
      if (o.isMesh) { o.material = amat; o.renderOrder = ORDER.tag - 1; }
    });
    g.add(arrow);

    // Uttrekksdybden maales langs pila, og kan skrives i som alle andre maal.
    if (show.dims && Math.abs(d) > 1e-6) {
      const off = new THREE.Vector3(...inf.n).cross(new THREE.Vector3(0, 0, 1));
      if (off.lengthSq() < 1e-9) off.set(1, 0, 0);
      off.normalize().multiplyScalar(Math.max(u1 - u0, v1 - v0) * 0.62 + S * 0.02);
      dimension(g, hud, P(u1, v1, 0), P(u1, v1, d), off,
        `concrete.features.${i}.depth`, d,
        { arrow: S * 0.011, textOff: TEXT_H(m) * 0.88, step: 5, min: -1e6 });
    }
  });
  return g;
}

// Utnyttelse pr. bolt (staal + uttrekk, det verste)
function anchorUtil(v) {
  const map = new Map();
  const perAnchor = v.checks.filter(c => c.scope === 'bolt' && Number.isFinite(c.NRd));
  const grp = v.checks.filter(c => c.scope === 'gruppe' && Number.isFinite(c.util));
  const gmax = grp.length ? Math.max(...grp.map(c => c.util)) : 0;
  for (const a of v.res.anchors) {
    let u = gmax;
    for (const c of perAnchor) {
      const Ed = c.id.startsWith('N') ? a.N : a.V;
      u = Math.max(u, Ed / c.NRd);
    }
    map.set(a.id, u);
  }
  return map;
}
