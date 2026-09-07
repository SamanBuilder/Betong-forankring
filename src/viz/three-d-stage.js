// ---------------------------------------------------------------------------
//  <three-d-stage> - web component for 3D-visning.
//  Three.js r0.184 (importmap), OrbitControls, eksport til OBJ/MTL og GLB.
//
//  API:
//    stage.setContent(object3d)      bytt ut modellen
//    stage.frameAll()                zoom til modellen
//    stage.pickMode = 'face'         neste klikk plukker en flate i stedet
//                                    for aa rotere; gir 'face-pick'
//
//  Hendelser:
//    'handle'      { path, value, id }   drahaandtak flyttet (kontinuerlig)
//    'handle-end'  { path, value, id }   dratt ferdig
//    'face-pick'   { point, normal }     flate valgt, i modellens koordinater
//    stage.setView('iso'|'top'|'front'|'side')
//    stage.exportOBJ(basename)       laster ned .obj + .mtl
//    stage.exportGLB(basename)       laster ned .glb
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { saveFile, saveMessage, saveError, hostSaves } from '../core/download.js';

// Slår om når verdien er tydelig negativ, tilbake når den er tydelig positiv,
// og lar tilstanden stå i dødsonen imellom.
function hyst(on, value, band) {
  if (on) return value < band;
  return value < -band;
}

const FLIP_Y = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const FLIP_Z = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

const CSS = `
  :host { display:block; position:relative; width:100%; height:100%; }
  canvas { display:block; width:100%; height:100%; outline:none; }
  .bar { position:absolute; top:8px; right:8px; display:flex; gap:4px; flex-wrap:wrap;
         justify-content:flex-end; max-width:calc(100% - 16px); z-index:2; }
  .bar button {
    font: 500 11px/1 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
    padding:7px 10px; border-radius:6px; cursor:pointer;
    border:1px solid #e3dfd6; background:rgba(255,255,255,.86);
    color:#6b665c; backdrop-filter:blur(8px);
    box-shadow:0 1px 3px rgba(43,41,36,.06);
    transition:color .12s ease, border-color .12s ease;
  }
  .bar button:hover { color:#8a7448; border-color:#8a7448; }
  .bar button:focus-visible { outline:2px solid #8a7448; outline-offset:2px; }
  .msg { position:absolute; left:50%; transform:translateX(-50%); bottom:12px; z-index:2;
         font:11px "IBM Plex Mono", ui-monospace, monospace; color:#6b665c;
         background:rgba(255,255,255,.9); border:1px solid #e3dfd6;
         border-radius:6px; padding:6px 11px; }
  .msg:empty { display:none; }
`;

export class ThreeDStage extends HTMLElement {
  connectedCallback() {
    if (this._init) return;
    this._init = true;

    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="bar">
        <button data-v="iso">ISO</button><button data-v="top">Plan</button>
        <button data-v="front">Front</button><button data-v="side">Side</button>
        <button data-a="fit">Tilpass</button>
        <button data-a="obj">OBJ</button><button data-a="glb">GLB</button>
      </div>
      <div class="msg"></div>`;
    this._msg = root.querySelector('.msg');
    // Verten kan levere sine egne, dokkede kontroller i stedet for den
    // flytende lista - da skal ingenting ligge oppå selve visninga.
    if (this.getAttribute('controls') === 'none')
      root.querySelector('.bar').remove();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // Nøytral tonemapping holder de lyse gråtonene der de skal være;
    // ACES trekker et lyst motiv mot grått.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    // Ingen skyggelegging: modellen leses tydeligere uten, og skyggen av en
    // flat betongkloss ga lite igjen for kostnaden.
    this.renderer.shadowMap.enabled = false;
    root.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.getAttribute('background') || '#efede8');

    // Miljøkart - uten dette blir metalliske materialer nesten svarte.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    // To kameraer som deler posisjon og retning. Perspektiv gir dybdefølelse;
    // parallellprojeksjon gjør at like store ting tegnes like store uansett
    // avstand, slik at mål kan sammenliknes direkte i bildet.
    this.perspCam = new THREE.PerspectiveCamera(38, 1, 1, 100000);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.camera = this.perspCam;
    this.camera.position.set(1200, 900, 1200);
    this._orthoSize = 1000;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // Lys: ett mykt hovedlys som gir kontaktskyggen, pluss himmellys og et
    // svakt motlys så baksidene ikke går i svart.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcabe, 0.95));

    this.key = new THREE.DirectionalLight(0xfff8ec, 1.55);
    this.key.position.set(-1500, 2400, 1700);
    this.scene.add(this.key, this.key.target);

    const fill = new THREE.DirectionalLight(0xe8eef7, 0.3);
    fill.position.set(1600, 900, -1400);
    this.scene.add(fill);


    this.content = new THREE.Group();
    this.scene.add(this.content);

    // Påskriftene er ekte DOM-elementer plassert med 3D-transformasjoner, så de
    // ligger i modellens plan og følger den i både rotasjon og størrelse - og
    // er likevel redigerbare felt. Laget legges i lys DOM av verten
    // (attachLabelLayer), ellers når ikke sidas CSS inn til dem.
    this.css = new CSS3DRenderer();
    Object.assign(this.css.domElement.style,
      { position: 'absolute', inset: '0', pointerEvents: 'none' });
    this.cssScene = new THREE.Scene();
    this._labels = [];

    root.querySelectorAll('[data-v]').forEach(b =>
      b.onclick = () => this.setView(b.dataset.v));
    root.querySelector('[data-a="fit"]')?.addEventListener('click', () => this.frameAll());
    root.querySelector('[data-a="obj"]')?.addEventListener('click', () => this.exportOBJ());
    root.querySelector('[data-a="glb"]')?.addEventListener('click', () => this.exportGLB());

    this._initPointer();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this);
    this._resize();

    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._faceLabels();
      this.css.render(this.cssScene, this.camera);
    };
    tick();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    this.setLabels([]);
    this._ro?.disconnect();
  }

  _resize() {
    const w = this.clientWidth || 800, h = this.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.css?.setSize(w, h);

    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();

    const a = w / h, s = this._orthoSize;
    Object.assign(this.orthoCam, { left: -s * a, right: s * a, top: s, bottom: -s });
    this.orthoCam.updateProjectionMatrix();
  }

  get isOrtho() { return this.camera === this.orthoCam; }

  // Bytter projeksjon uten at bildet hopper. Det nye kameraet arver posisjon og
  // retning, og utsnittet regnes om slik at modellen har samme synlige
  // størrelse ved målpunktet - i stedet for å ramme inn på nytt og kaste bort
  // zoomen brukeren har stilt inn.
  setProjection(kind) {
    const want = kind === 'ortho';
    if (want === this.isOrtho) return;
    const from = this.camera, to = want ? this.orthoCam : this.perspCam;
    const half = Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov) / 2);
    const dist = from.position.distanceTo(this.controls.target);

    to.quaternion.copy(from.quaternion);
    to.up.copy(from.up);

    if (want) {
      to.position.copy(from.position);
      this._orthoSize = dist * half;      // halve bildehøyden ved målpunktet
      to.zoom = 1;
    } else {
      const d = (this._orthoSize / (from.zoom || 1)) / half;
      const dir = new THREE.Vector3()
        .subVectors(from.position, this.controls.target).normalize();
      to.position.copy(this.controls.target).addScaledVector(dir, d);
      to.near = Math.max(1, d / 500);
      to.far = d * 20;
    }

    this.camera = to;
    this.controls.object = to;
    this._resize();
    this.dispatchEvent(new CustomEvent('projection', { detail: { ortho: want } }));
  }

  // Laget for påskrifter må ligge i vertens DOM for at CSS-en skal treffe.
  attachLabelLayer(host) {
    host.appendChild(this.css.domElement);
    this._resize();
  }

  // items: [{ el, pos: Vector3, quat: Quaternion, scale: number }]
  setLabels(items) {
    for (const o of this._labels) {
      this.cssScene.remove(o);
      o.element.remove();
    }
    this._labels = [];
    for (const it of items) {
      it.el.style.pointerEvents = 'auto';
      const o = new CSS3DObject(it.el);
      o.position.copy(it.pos);
      o.quaternion.copy(it.quat);
      o.scale.setScalar(it.scale);
      o.userData.front = it.quat.clone();
      this.cssScene.add(o);
      this._labels.push(o);
    }
  }

  // Tekst som ligger i et plan kan bli ulesbar på to ulike måter, og de krever
  // hver sin korreksjon:
  //
  //   speilvendt   kamera ser baksida av planet   -> snu 180° om lokal Y
  //   opp ned      lesretninga peker mot venstre  -> snu 180° om lokal Z
  //
  // Begge testene bygger på et fortegn som går gjennom null når planet eller
  // lesretninga står på kant mot kamera. Uten dødsone vipper påskrifta fram og
  // tilbake for de minste kamerabevegelsene akkurat der. Derfor er hver test
  // hysteresebasert: den slår om ved ±BAND og husker tilstanden imellom.
  _faceLabels() {
    if (!this._labels.length) return;
    const q = this._q || (this._q = new THREE.Quaternion());
    const n = this._n || (this._n = new THREE.Vector3());
    const d = this._d || (this._d = new THREE.Vector3());
    const x = this._x || (this._x = new THREE.Vector3());
    const inv = this._iq || (this._iq = new THREE.Quaternion());
    inv.copy(this.camera.quaternion).invert();

    for (const o of this._labels) {
      const u = o.userData;
      q.copy(u.front);

      n.set(0, 0, 1).applyQuaternion(q);
      // I parallellprojeksjon går alle strålene samme vei, så retningen mot
      // betrakteren er kameraets egen +z - ikke veien fra påskrifta til det.
      if (this.isOrtho) d.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
      else d.subVectors(this.camera.position, o.position).normalize();
      u.mirror = hyst(u.mirror, n.dot(d), 0.05);
      if (u.mirror) q.multiply(FLIP_Y);

      x.set(1, 0, 0).applyQuaternion(q).applyQuaternion(inv);
      u.upside = hyst(u.upside, x.x, 0.12);
      if (u.upside) q.multiply(FLIP_Z);

      o.quaternion.copy(q);
    }
  }

  // -----------------------------------------------------------------------
  //  Drahaandtak og flatevalg.
  //
  //  Et haandtak er hvilken som helst gruppe i modellen med userData.handle:
  //    { path, value, dir, step, min, max }
  //  Pila peker langs sin egen lokale +y, saa dragaksen leses rett ut av
  //  verdensmatrisa - da trenger ikke visninga vite noe om ingenioerakser.
  //
  //  Under draget regnes verdien ut av hvor langt PEKEREN har flyttet seg
  //  langs aksen, ikke av hvor pila staar. Da kan modellen bygges om for hver
  //  eneste ramme uten at draget mister taket: haandtaket er tall, ikke mesh.
  // -----------------------------------------------------------------------
  _initPointer() {
    this._ray = new THREE.Raycaster();
    this._ray.params.Line.threshold = 0;
    this._handleObjs = [];
    // Lyttes av i fangstfasen paa verten, ikke paa lerretet: da kommer vi til
    // foer OrbitControls og kan stanse rotasjonen naar draget er vaart.
    const opt = { capture: true };
    this.addEventListener('pointerdown', e => this._onPointerDown(e), opt);
    this.addEventListener('pointermove', e => this._onPointerMove(e), opt);
    this.addEventListener('pointerup', e => this._onPointerUp(e), opt);
    this.addEventListener('pointercancel', e => this._onPointerUp(e), opt);
  }

  _ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1,
             y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }

  _hits(e, objs) {
    this._ray.setFromCamera(this._ndc(e), this.camera);
    return this._ray.intersectObjects(objs || this.content.children, true)
      .filter(h => h.object.visible && h.object.type !== 'LineSegments');
  }

  // Bare haandtakene testes, ikke hele modellen: gjengespiraler og kammer er
  // tunge aa stryke en straale gjennom for hver musebevegelse.
  _handleAt(e) {
    if (!this._handleObjs.length) return null;
    for (const hit of this._hits(e, this._handleObjs)) {
      let o = hit.object;
      while (o && !o.userData.handle) o = o.parent;
      if (o) return { obj: o, handle: o.userData.handle };
    }
    return null;
  }

  // Naermeste punkt paa dragaksen til pekerstraalen, som parameter langs aksen.
  _axisParam(e, origin, axis) {
    this._ray.setFromCamera(this._ndc(e), this.camera);
    const ro = this._ray.ray.origin, rd = this._ray.ray.direction;
    const w = new THREE.Vector3().subVectors(origin, ro);
    const b = axis.dot(rd), d = axis.dot(w), f = rd.dot(w);
    const den = 1 - b * b;
    if (Math.abs(den) < 1e-6) return null;      // ser rett langs aksen
    return (b * f - d) / den;
  }

  _onPointerDown(e) {
    if (e.button !== 0) return;
    if (this.pickMode === 'face') {
      const hit = this._hits(e).find(h => h.face && h.object.name.startsWith('betong'));
      if (!hit) return;
      const inv = new THREE.Matrix4().copy(this.content.children[0].matrixWorld).invert();
      const point = hit.point.clone().applyMatrix4(inv);
      const normal = hit.face.normal.clone()
        .transformDirection(hit.object.matrixWorld).transformDirection(inv).normalize();
      e.preventDefault(); e.stopPropagation();
      this.dispatchEvent(new CustomEvent('face-pick', {
        detail: { point: { x: point.x, y: point.y, z: point.z },
                  normal: { x: normal.x, y: normal.y, z: normal.z } } }));
      return;
    }
    const h = this._handleAt(e);
    if (!h) return;
    const origin = new THREE.Vector3().setFromMatrixPosition(h.obj.matrixWorld);
    const axis = new THREE.Vector3(0, 1, 0)
      .transformDirection(h.obj.matrixWorld).normalize();
    const p0 = this._axisParam(e, origin, axis);
    if (p0 == null) return;
    e.preventDefault(); e.stopPropagation();
    this.controls.enabled = false;
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* uten peker */ }
    this._drag = { h: h.handle, origin, axis, p0, v0: +h.handle.value || 0,
                   id: e.pointerId, moved: false };
  }

  _onPointerMove(e) {
    if (!this._drag) {
      if (!this.pickMode) {
        const over = !!this._handleAt(e);
        if (over !== this._overHandle) {
          this._overHandle = over;
          this.renderer.domElement.style.cursor = over ? 'grab' : '';
        }
      } else this.renderer.domElement.style.cursor = 'crosshair';
      return;
    }
    const d = this._drag;
    e.preventDefault(); e.stopPropagation();
    const p = this._axisParam(e, d.origin, d.axis);
    if (p == null) return;
    const step = d.h.step || 1;
    let v = d.v0 + (p - d.p0);
    v = Math.round(v / step) * step;
    if (d.h.min != null) v = Math.max(d.h.min, v);
    if (d.h.max != null) v = Math.min(d.h.max, v);
    if (v === d.last) return;
    d.last = v; d.moved = true;
    this.renderer.domElement.style.cursor = 'grabbing';
    this.dispatchEvent(new CustomEvent('handle', {
      detail: { path: d.h.path, id: d.h.id, value: v } }));
  }

  _onPointerUp(e) {
    if (!this._drag) return;
    const d = this._drag;
    this._drag = null;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = '';
    try { this.renderer.domElement.releasePointerCapture(d.id); } catch { /* sluppet */ }
    if (d.moved)
      this.dispatchEvent(new CustomEvent('handle-end', {
        detail: { path: d.h.path, id: d.h.id, value: d.last } }));
  }

  setContent(obj) {
    this.content.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(mm => mm.dispose());
    });
    this.content.clear();
    this.content.add(obj);
    // Bare det oeverste leddet i hvert haandtak samles - resten av pila henger
    // under det og treffes likevel av straalen.
    this._handleObjs = [];
    obj.traverse(o => {
      if (!o.userData.handle) return;
      for (let q = o.parent; q; q = q.parent) if (q.userData.handle) return;
      this._handleObjs.push(o);
    });
    if (!this._framed) { this.frameAll(); this._framed = true; }
  }

  _bounds() {
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) box.set(new THREE.Vector3(-500, -500, -500), new THREE.Vector3(500, 500, 500));
    return box;
  }

  frameAll(factor = 1.5) {
    const box = this._bounds();
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(this.perspCam.fov) / 2)) * factor * 0.6;
    const dir = this._framed
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : new THREE.Vector3(1, 0.8, 1).normalize();   // fast startretning
    if (!dir.lengthSq()) dir.set(1, 0.8, 1).normalize();
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.perspCam.near = Math.max(1, dist / 500);
    this.perspCam.far = dist * 20;
    this.perspCam.updateProjectionMatrix();

    // Parallellkameraet har ingen avstandsavhengighet, så «zoom» er høyden på
    // bildeutsnittet. Den settes av modellens størrelse, ikke av avstanden.
    this._orthoSize = r * factor * 0.62;
    this.orthoCam.zoom = 1;
    this._resize();

    // Hovedlyset holdes i fast retning i forhold til modellen, så belysninga
    // ikke endrer seg når du zoomer.
    this.key.target.position.copy(c);
    this.key.position.copy(c).add(new THREE.Vector3(-r * 1.8, r * 2.0, r * 1.4));
  }

  setView(v) {
    const box = this._bounds();
    const c = box.getCenter(new THREE.Vector3());
    const dirs = {
      iso: [1, 0.75, 1], top: [0.001, 1, 0.001], front: [0, 0.05, 1], side: [1, 0.05, 0],
    };
    const d = new THREE.Vector3(...(dirs[v] || dirs.iso)).normalize();
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(d, dist);
    this.frameAll();
  }

  // ---- Eksport ----------------------------------------------------------
  //  Binær GLB kommer ikke gjennom vertens nedlasting, så der eksporteres
  //  glTF (JSON) i stedet. Samme modell, samme materialer.
  async exportGLB(name = 'forankring') {
    const binary = !(await hostSaves());
    this._note(binary ? 'Bygger GLB…' : 'Bygger glTF…');
    try {
      const data = await new Promise((ok, bad) =>
        new GLTFExporter().parse(this.content, ok, bad, { binary }));
      const file = binary
        ? [new Blob([data], { type: 'model/gltf-binary' }), `${name}.glb`]
        : [JSON.stringify(data), `${name}.gltf`];
      this._note(saveMessage(await saveFile(file[0], file[1])));
    } catch (e) { this._note(saveError(e)); }
  }

  async exportOBJ(name = 'forankring') {
    const { obj, mtl } = objMtl(this.content, name);
    try {
      // Én forespørsel om gangen - MTL-fila må vente på svar på OBJ-fila.
      const a = await saveFile(obj, `${name}.obj`);
      const b = await saveFile(mtl, `${name}.mtl`);
      this._note(a.renamed
        ? `Lagret ${a.filename} + ${b.filename} – gi dem endelsene .obj og .mtl`
        : `Lagret ${a.filename} + ${b.filename}`);
    } catch (e) { this._note(saveError(e)); }
  }

  _note(t) {
    this._msg.textContent = t;
    clearTimeout(this._noteT);
    this._noteT = setTimeout(() => (this._msg.textContent = ''), 7000);
  }
}

// ---------------------------------------------------------------------------
//  OBJ + MTL.  Egen skriver (ikke OBJExporter) fordi vi vil ha ekte
//  usemtl-grupper og en MTL-fil med farger/gjennomsiktighet.
// ---------------------------------------------------------------------------
export function objMtl(root, name = 'model') {
  const O = [`# ${name} - eksportert fra Betong forankring`, `mtllib ${name}.mtl`];
  const mats = new Map();
  let vOff = 1, nOff = 1;

  root.updateWorldMatrix(true, true);
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();

  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.userData.noExport) return;
    const g = o.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const idx = g.index ? g.index.array
      : Uint32Array.from({ length: pos.count }, (_, i) => i);

    const mat = [].concat(o.material)[0];
    const key = mat.name || `mat_${mat.uuid.slice(0, 8)}`;
    if (!mats.has(key)) mats.set(key, mat);

    O.push(`o ${(o.name || 'part').replace(/\s+/g, '_')}`);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      O.push(`v ${f(v.x)} ${f(v.y)} ${f(v.z)}`);
    }
    if (nor) {
      nm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < nor.count; i++) {
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        O.push(`vn ${f(v.x)} ${f(v.y)} ${f(v.z)}`);
      }
    }
    O.push(`usemtl ${key}`);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] + vOff, b = idx[i + 1] + vOff, c = idx[i + 2] + vOff;
      O.push(nor
        ? `f ${a}//${idx[i] + nOff} ${b}//${idx[i + 1] + nOff} ${c}//${idx[i + 2] + nOff}`
        : `f ${a} ${b} ${c}`);
    }
    vOff += pos.count;
    if (nor) nOff += nor.count;
  });

  const M = [`# ${name} materialer`];
  for (const [key, mat] of mats) {
    const c = mat.color || new THREE.Color(0xcccccc);
    M.push(`newmtl ${key}`,
      `Kd ${f(c.r)} ${f(c.g)} ${f(c.b)}`,
      `Ka ${f(c.r * 0.2)} ${f(c.g * 0.2)} ${f(c.b * 0.2)}`,
      `Ks 0.20 0.20 0.20`,
      `Ns ${f(200 * (1 - (mat.roughness ?? 0.7)))}`,
      `d ${f(mat.transparent ? (mat.opacity ?? 1) : 1)}`,
      `illum 2`, '');
  }
  return { obj: O.join('\n'), mtl: M.join('\n') };
}

const f = n => (Math.round(n * 1e4) / 1e4).toString();

if (!customElements.get('three-d-stage')) customElements.define('three-d-stage', ThreeDStage);
