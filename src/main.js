import * as THREE from 'three/webgpu';
import { texture, uv, uniform, vec2, vec3 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { createTv } from './tv.js';
import { PROFILE_70 } from './audio/tvAudio.js';
import { createInteractions } from './interactions.js';
import { createCurtains } from './curtains.js';
import { setupRoom80, RADIO_PARTS } from './room80.js';
import { createFrames } from './frames.js';
import { createTvCable80 } from './cable80.js';
import { createRoom90 } from './room90.js';
import { createDrop } from './drop.js';
import { createDropShadows } from './dropShadow.js';
import { createAntennas } from './antennas.js';
import { createSky } from './shaders/sky.js';

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping; // zelfde view transform als in Blender
renderer.setClearColor(0x000000, 0); // doorzichtig: de jaren-70-achtergrond komt uit de css
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();

// ------------------------------------------------------------------ assets
const loadBake = (url) => new THREE.TextureLoader().loadAsync(url).then((t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  return t;
});
// het volledige Cycles-beeld van elk oppervlak (kleur × licht + emissie), gebakken in Blender.
// Het licht van de staande lamp zit in een aparte laag, zodat ze live aan en uit kan;
// de losse objecten (afstandsbediening, stekkers) hebben een eigen lightmap.
// de tv-laag is optioneel: zolang ze niet gebakken is, valt ze terug op zwart
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;
const loadOptionalBake = (url) => loadBake(url).catch(() => {
  console.warn(`${url} ontbreekt — draai blender/build_assets.py opnieuw voor het tv-licht`);
  return BLACK;
});
const [gltf, baked, bakedLamp, bakedTv, bakedLos, bakedLosLamp, bakedLosTv] = await Promise.all([
  new GLTFLoader().loadAsync('models/kamer70.glb'),
  loadBake('textures/baked.webp'),
  loadBake('textures/baked_lamp.webp'),
  loadOptionalBake('textures/baked_tv.webp'),
  loadBake('textures/baked_los.webp'),
  loadBake('textures/baked_los_lamp.webp'),
  loadOptionalBake('textures/baked_los_tv.webp'),
]);

const root = gltf.scene;
scene.add(root);
root.updateMatrixWorld(true);
// de stekker van de tv, als voorbeeld voor de tv-kabel van de jaren '80 (cable80.js): gekopieerd voor de
// materialen hieronder vervangen worden en voor de physics hem verplaatst
const plug70 = root.getObjectByName('d70_tv_stekker').clone();
const plug70b = plug70.clone(); // nog een, voor de staande lamp van de jaren '90
const plug70At = root.getObjectByName('d70_tv_stekker').matrixWorld.clone();
const socket70At = root.getObjectByName('d70_stopcontact').matrixWorld.clone();

// ------------------------------------------------------------------ tv: Glitchy Glitch op het scherm
const screen = root.getObjectByName('d70_tv_scherm');

const card = await new THREE.TextureLoader().loadAsync('textures/testbeeld.png');
card.colorSpace = THREE.SRGBColorSpace;

const tv70 = createTv({
  card, profile: PROFILE_70,
  broadcasts: [
    { src: 'video/apollo13.mp4', title: 'APOLLO 13', sub: 'LANDING IN DE STILLE OCEAAN · 1970' },
    { src: 'video/waterloo.mp4', title: 'ABBA · WATERLOO', sub: 'EUROVISIESONGFESTIVAL · 1974' },
    { src: 'video/queen.mp4', title: 'QUEEN', sub: 'BOHEMIAN RHAPSODY · 1975' },
    { src: 'video/brugge-liverpool.mp4', title: 'CLUB BRUGGE – LIVERPOOL', sub: 'FINALE UEFA-BEKER · 1976' },
  ],
});
const glitch = tv70.glitch;
function switchChannel() {
  tv70.switchChannel();
  channelKnob.set(-(tv70.current + 1) * 0.55); // kanaalknop draait een stand verder
}
screen.material = tv70.material;
// de konijnenoren: draai ze tot de zender helder binnenkomt (antennas.js)
const antennas = createAntennas({ tv: root.getObjectByName('d70_tv') });

// ------------------------------------------------------------------ materialen: het gebakken beeld + live glans
// Diffuus licht, kleur en emissie zitten in de bake; enkel de kijkhoek-afhankelijke glans wordt live berekend.
const BAKE_SCALE = 2; // de bake is × 0.5 opgeslagen zodat waarden tot 2.0 in 8 bit passen
const roomLevel = uniform(1);
const lampLevel = uniform(1);
const ROOM_OFF = 0.1; // kamerlicht uit: niet pikdonker, er komt nog wat licht van buiten
// tv-licht: de bake is het licht van een wit scherm; live gekleurd met het gemiddelde van het beeld,
// rechtstreeks uit de kleinste mipmap (1×1) van het tv-beeld. Uit = zwart beeld = geen licht.
const TV_LIGHT = 1.4;
const tvColor = texture(tv70.texture, vec2(0.5, 0.5)).level(9).rgb.mul(TV_LIGHT);
const at = (tex, u, level) => (level === undefined ? texture(tex, u) : texture(tex, u).level(level)).rgb;
const bakeAt = (base, lamp, tv) => (u = uv(), level) => at(base, u, level).mul(roomLevel)
  .add(at(lamp, u, level).mul(lampLevel))
  .add(at(tv, u, level).mul(tvColor))
  .mul(BAKE_SCALE);
const bakeRoomAt = bakeAt(baked, bakedLamp, bakedTv);
const bakedRoom = bakeRoomAt();
const bakedLoose = bakeAt(bakedLos, bakedLosLamp, bakedLosTv)();
// de schaduw van de meubels op de vloer valt mee met de meubels (dropShadow.js)
const FLOORS70 = new Set(['d70_vloer', 'd70_tapijt']);
const shadows70 = createDropShadows({
  floors: [...FLOORS70].map((n) => root.getObjectByName(n)),
  images: [baked.image, bakedLamp.image],
  level: 3, // 4096 px: wazig genoeg voor de nerf en het tapijt, scherp genoeg voor de schaduw
});
const shadow70 = {
  zetel: shadows70.add(['d70_zetel', 'd70_zetel_kussens'].map((n) => root.getObjectByName(n))),
  tv: shadows70.add([root.getObjectByName('d70_tv')]),
  lamp: shadows70.add([root.getObjectByName('d70_staanlamp')]),
};
const LOOSE = new Set(['d70_afstandsbediening', 'd70_lamp_stekker', 'd70_tv_stekker']);
const isLoose = (o) => { for (let p = o; p; p = p.parent) if (LOOSE.has(p.name)) return true; return false; };
const mats = new Map();
// de antennes zijn zilver, niet het chroom van de kast: helder metaal dat het kamerlicht mee spiegelt
const silver = new THREE.MeshStandardNodeMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.2 });
silver.emissiveNode = vec3(0.17, 0.175, 0.18).mul(roomLevel.max(lampLevel.mul(0.6)));
root.traverse((o) => {
  if (!o.isMesh || o === screen) return;
  if (antennas.owns(o)) { o.material = silver; return; }
  const src = o.material, loose = isLoose(o), floor = FLOORS70.has(o.name) || FLOORS70.has(o.parent?.name);
  const key = src.uuid + (loose ? ':los' : '') + (floor ? `:${o.name}` : '');
  if (!mats.has(key)) {
    const metal = src.metalness > 0.5;
    const m = new THREE.MeshStandardNodeMaterial({
      color: metal ? src.color : 0x000000,
      roughness: Math.max(src.roughness, 0.3),
      metalness: src.metalness,
      side: src.side,
    });
    m.emissiveNode = loose ? bakedLoose : floor ? shadows70.apply(bakedRoom, o, bakeRoomAt, uv()) : bakedRoom;
    mats.set(key, m);
  }
  o.material = mats.get(key);
});

// reflecties: probe van de kamer zelf, zodat hout en messing warm spiegelen
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  screen.visible = false;
  scene.environment = pmrem.fromScene(scene, 0.03, 0.05, 30, { position: new THREE.Vector3(8, 1.1, 0.6) }).texture;
  screen.visible = true;
  scene.environmentIntensity = 0.5;
}

// ------------------------------------------------------------------ camera: exact de Blender-camera
const camNode = root.getObjectByProperty('isCamera', true);
const camera = new THREE.PerspectiveCamera(camNode.fov, innerWidth / innerHeight, 0.1, 100);
camNode.getWorldPosition(camera.position);
camNode.getWorldQuaternion(camera.quaternion);

// levendige camera: draait licht rond het midden van het diorama, volgt de muis en ademt traag.
// De hoeken blijven klein, zodat het kader van de Blender-camera intact blijft.
const pivot = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
const camOffset = camera.position.clone().sub(pivot);
const camUp = new THREE.Vector3(0, 1, 0);
const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
const lookOffset = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  .multiplyScalar(camOffset.length()).add(camera.position).sub(pivot); // waar de camera naar kijkt
const sway = { x: 0, y: 0, tx: 0, ty: 0 };
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
// inzoomen op de tv: recht voor het scherm, dat ruim driekwart van de beeldhoogte vult
const scrBox = new THREE.Box3().setFromObject(screen);
const scrCenter = scrBox.getCenter(new THREE.Vector3());
const scrSize = scrBox.getSize(new THREE.Vector3());
const scrNormal = (() => {
  const n = new THREE.Vector3(), nrm = screen.geometry.attributes.normal;
  for (let i = 0; i < nrm.count; i++) n.x += nrm.getX(i), n.y += nrm.getY(i), n.z += nrm.getZ(i);
  n.transformDirection(screen.matrixWorld);
  if (n.dot(_v.copy(camera.position).sub(scrCenter)) < 0) n.negate(); // naar de kijker toe
  return n;
})();
// andere inzoomplekken: de zetel (met de afstandsbediening) en het stopcontact van de tv.
// De kijkrichting van het stopcontact staat loodrecht op de muur: de dunste as van zijn doos.
const boxOf = (...names) => names.reduce((b, n) => b.expandByObject(root.getObjectByName(n)), new THREE.Box3());
const wallNormal = (box) => {
  const sz = box.getSize(new THREE.Vector3());
  const axis = sz.x < sz.y && sz.x < sz.z ? 'x' : sz.y < sz.z ? 'y' : 'z';
  const n = new THREE.Vector3(); n[axis] = 1;
  if (n.dot(_v.copy(camera.position).sub(box.getCenter(new THREE.Vector3()))) < 0) n.negate();
  return n;
};
const towardCamera = (box, lift) => _v.copy(camera.position).sub(box.getCenter(new THREE.Vector3())).setY(0).normalize()
  .add(new THREE.Vector3(0, lift, 0)).normalize().clone();
// fill: hoeveel van het beeld het object vult
const focusSpot = (box, normal, fill) => ({ box, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()), normal, fill });
const chairBox = boxOf('d70_zetel', 'd70_zetel_kussens');
const socketBox = boxOf('d70_stopcontact');
// inzoomen op de tv: het scherm én de antennes erboven (in hun rustpositie), zodat je ze kunt vastpakken
const tvFocusBox = antennas.rods.reduce((b, r) => b.expandByObject(r), scrBox.clone()).expandByScalar(0.03);
const FOCUS = {
  tv: focusSpot(tvFocusBox, scrNormal, 0.82),
  zetel: focusSpot(chairBox, towardCamera(chairBox, 0.75), 0.8),
  stopcontact: focusSpot(socketBox, wallNormal(socketBox), 0.13), // ruimer: de stekker moet op de vloer in beeld blijven
};
const zoom = { target: null, last: null, k: 0, snap: true };
const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _closePos = new THREE.Vector3();
const _fPos = new THREE.Vector3(), _fLook = new THREE.Vector3(), _tPos = new THREE.Vector3();

function moveCamera(t, dt) {
  // muis: max ±4° opzij, ±2° op/neer; daarbovenop een trage ademhaling. Ingezoomd veel minder.
  const calm = 1 - zoom.k * 0.8;
  const tx = (sway.tx * 0.07 + Math.sin(t * 0.17) * 0.012) * calm;
  const ty = (sway.ty * 0.035 + Math.sin(t * 0.23 + 1) * 0.006) * calm;
  const k = 1 - Math.exp(-dt * 2.5);
  sway.x += (tx - sway.x) * k;
  sway.y += (ty - sway.y) * k;
  _q.setFromAxisAngle(camUp, -sway.x).multiply(new THREE.Quaternion().setFromAxisAngle(camRight, sway.y));
  _pos.copy(camOffset).applyQuaternion(_q).add(pivot);
  _look.copy(lookOffset).applyQuaternion(_q).add(pivot);

  zoom.k += ((zoom.target ? 1 : 0) - zoom.k) * (1 - Math.exp(-dt * 2.2));
  const e = zoom.k * zoom.k * (3 - 2 * zoom.k);
  const f = FOCUS[zoom.target ?? zoom.last];
  if (f && e > 0.0001) {
    const vfov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hfov = Math.atan(Math.tan(vfov) * camera.aspect);
    const d = Math.max(f.size.y / 2 / Math.tan(vfov), Math.hypot(f.size.x, f.size.z) / 2 / Math.tan(hfov)) / f.fill;
    _tPos.copy(f.normal).multiplyScalar(d).add(f.center);
    // van de ene plek naar de andere: de close-up glijdt mee in plaats van te springen
    if (zoom.snap) { _fPos.copy(_tPos); _fLook.copy(f.center); zoom.snap = false; }
    const kf = 1 - Math.exp(-dt * 2.2);
    _fPos.lerp(_tPos, kf);
    _fLook.lerp(f.center, kf);
    _closePos.copy(_fPos);
    _closePos.x += sway.x * d * 0.15; _closePos.y += sway.y * d * 0.15; // beetje leven, ook ingezoomd
    _pos.lerp(_closePos, e);
    _look.lerp(_fLook, e);
  } else {
    zoom.snap = true;
  }
  // draaitoneel: de kamer draait rond de as midden achter de muur. De camera draait de andere kant op
  // rond die as, wat er precies hetzelfde uitziet; zo blijft de physics van de kamer gewoon staan.
  camera.up.copy(camUp);
  if (turn.angle !== 0) {
    _q.setFromAxisAngle(camUp, turn.angle);
    _pos.sub(turnAxis).applyQuaternion(_q).add(turnAxis);
    _look.sub(turnAxis).applyQuaternion(_q).add(turnAxis);
    camera.up.applyQuaternion(_q);
  }
  camera.position.copy(_pos);
  camera.lookAt(_look);
}

// oog-knoppen: in elke kamer bij de plekken waar je op kunt inzoomen (jaren '70: tv, zetel, stopcontact;
// jaren '80: tv, zetel, radio, raam). Ingezoomd schuift het actieve oog naar de hoek van het venster en
// verdwijnen de andere. Elk oog hoort bij één decennium en is enkel zichtbaar als die kamer vooraan staat.
const tvEye = document.getElementById('tv-zoom');
const EYES = {};
function addEye(name, label, decade, worldBox) {
  const el = name === 'tv' ? tvEye : tvEye.cloneNode(true);
  if (el !== tvEye) { el.id = `${name}-zoom`; tvEye.parentNode.insertBefore(el, tvEye.nextSibling); }
  el.setAttribute('aria-label', label);
  el.addEventListener('click', () => toggleZoom(name));
  el.addEventListener('pointerdown', (e) => e.stopPropagation()); // geen klik op de kamer erdoorheen
  EYES[name] = { el, label, decade, worldBox };
}
addEye('tv', 'Inzoomen op de tv', 0);
addEye('zetel', 'Inzoomen op de zetel', 0, chairBox);
addEye('stopcontact', 'Inzoomen op het stopcontact', 0, socketBox);
function toggleZoom(target = null) {
  if (target === zoom.target) target = null;
  zoom.target = target;
  if (target) zoom.last = target;
  for (const [name, { el, label }] of Object.entries(EYES)) {
    const on = name === target;
    el.classList.toggle('zoomed', on);
    el.classList.toggle('hidden', !!target && !on);
    el.setAttribute('aria-pressed', String(on));
    el.setAttribute('aria-label', on ? 'Uitzoomen' : label);
  }
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && zoom.target) toggleZoom(null); });

const _c = new THREE.Vector3();
const toScreen = (v) => (v.project(camera), [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]);
// doos van de tv in haar eigen assen (de kast is een groep van meshes, één per materiaal)
const tvObj = root.getObjectByName('d70_tv');
const tvLocal = new THREE.Box3();
const toTv = tvObj.matrixWorld.clone().invert();
tvObj.traverse((o) => {
  if (!o.isMesh) return;
  o.geometry.computeBoundingBox();
  tvLocal.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toTv, o.matrixWorld)));
});
const tvCorners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(
  i & 1 ? tvLocal.max.x : tvLocal.min.x, i & 2 ? tvLocal.max.y : tvLocal.min.y, i & 4 ? tvLocal.max.z : tvLocal.min.z,
).applyMatrix4(tvObj.matrixWorld));
function placeEye() {
  // rechterbovenhoek van de kast: meest rechtse punt van de voorkant (de 4 hoeken het dichtst bij de camera),
  // hoogte net boven het scherm (niet de antennes)
  const front = [...tvCorners].sort((a, b) => a.distanceToSquared(camera.position) - b.distanceToSquared(camera.position)).slice(0, 4);
  let x = -Infinity, y = Infinity;
  for (const p of front) x = Math.max(x, toScreen(_c.copy(p))[0]);
  const capY = scrBox.max.y + scrSize.y * 0.25;
  for (let i = 0; i < 4; i++) {
    const [, sy] = toScreen(_c.set(i & 1 ? scrBox.max.x : scrBox.min.x, capY, i & 2 ? scrBox.max.z : scrBox.min.z));
    y = Math.min(y, sy);
  }
  placeAt(EYES.tv.el, x, y, 'tv');
  // de andere plekken: het oog zweeft net boven het midden van de bovenkant (in de echte wereld,
  // ook voor de kamers die op het draaitoneel achter de muur staan)
  for (const [name, { el, worldBox: b }] of Object.entries(EYES)) {
    if (!b) continue;
    const [sx, sy] = toScreen(_c.set((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2));
    placeAt(el, sx, sy - 26, name);
  }
}
function placeAt(el, x, y, name) {
  const e = zoom.target === name || (!zoom.target && zoom.last === name) ? zoom.k * zoom.k * (3 - 2 * zoom.k) : 0;
  x += (innerWidth - 36 - x) * e;
  y += (36 - y) * e;
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}
const BASE_ASPECT = camNode.aspect || 16 / 9;
const BASE_VFOV = THREE.MathUtils.degToRad(camNode.fov);
const BASE_HFOV = 2 * Math.atan(Math.tan(BASE_VFOV / 2) * BASE_ASPECT);

function resize() {
  const a = innerWidth / innerHeight;
  // breder dan 16:9: hoogte vasthouden; smaller: breedte vasthouden, zodat het kader nooit afgesneden wordt
  const v = a >= BASE_ASPECT ? BASE_VFOV : 2 * Math.atan(Math.tan(BASE_HFOV / 2) / a);
  camera.aspect = a;
  camera.fov = THREE.MathUtils.radToDeg(v);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

resize();

// ------------------------------------------------------------------ draaitoneel: van decennium wisselen
// De jaren '80 staan rug aan rug achter de muur van de jaren '70: wisselen draait het hele diorama rond een
// verticale as midden tussen de twee muren, zoals een draaideur. Naar de jaren '90 draait de deur nog een halve
// slag verder: dan staan op de voorkant de jaren '90, op de plek van de jaren '70 (die zijn dan toch uit beeld).
const wallBox = new THREE.Box3().setFromObject(root.getObjectByName('d70_muur'));
const CORE = 0.03; // spleet tussen de twee muren: rug aan rug, de lucht achter het raam zit erin
const turnAxis = new THREE.Vector3(wallBox.getCenter(new THREE.Vector3()).x, 0, wallBox.min.z - CORE / 2);
// yaw: draai rond de verticale as (zie moveCamera)
const DECADES = [
  { name: "Jaren '70", yaw: 0 },
  { name: "Jaren '80", yaw: Math.PI, model: 'models/kamer80.glb', bake: 'textures/baked80.webp', dayBake: 'textures/baked80_dag.webp', emitBake: 'textures/baked80_emit.webp' },
  { name: "Jaren '90", yaw: 2 * Math.PI },
];

// de andere kamers: gebakken zoals de jaren '70, 180° gedraaid achter de muur gezet.
// Het daglicht door het raam is een aparte bake: het valt weg als je de gordijnen dichtdoet.
const dayLevel = uniform(1);
const room80Level = uniform(1);
const power80 = { room: true, smooth: 1 };
const DAY_OFF = 0.25;
let curtains = null;
let room80 = null;
let sky = null;
async function loadDecadeRoom({ model, bake, dayBake, emitBake }, angle, decade) {
  const [g, tex, dayTex, emitTex] = await Promise.all([new GLTFLoader().loadAsync(model), loadBake(bake), loadBake(dayBake), loadBake(emitBake)]);
  const r = g.scene;
  // kleur en licht apart: elk materiaal heeft een eigen scherpe kleurtexture (UV 0), het licht komt uit
  // de gedeelde lightmap (UV 1). Zo blijft de stof van de zetel scherp als je inzoomt.
  const lightAt = (u, level) => at(tex, u, level).mul(room80Level).add(at(dayTex, u, level).mul(dayLevel)).mul(BAKE_SCALE);
  const light = lightAt(uv(1));
  const emit = texture(emitTex, uv(1)).rgb.mul(BAKE_SCALE);
  const glass = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.12, depthWrite: false });
  const mats = new Map();
  const albedoOf = (m) => {
    if (m.map) m.map.anisotropy = renderer.getMaxAnisotropy?.() ?? 8;
    return m.map ? texture(m.map, uv()).rgb.mul(m.color) : vec3(m.color.r, m.color.g, m.color.b);
  };
  const bakedMat = (m) => {
    if (!mats.has(m)) mats.set(m, new THREE.MeshBasicNodeMaterial({ colorNode: albedoOf(m).mul(light).add(emit) }));
    return mats.get(m);
  };
  // doorzichtig: het raam, en het glas van materialen die zo heten (het venstertje van het cassettevak,
  // de doosjes van de cassettes), zodat je de cassette in de radio ziet zitten
  const glassy = new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0.18, depthWrite: false });
  const floor = r.getObjectByName('d70_vloer001'); // krijgt verderop een eigen materiaal: de schaduw valt mee
  r.traverse((o) => {
    if (!o.isMesh || o === floor || o.parent === floor) return;
    o.material = /glas/.test(o.name) ? glass : /^Glass/.test(o.material.name) ? glassy : bakedMat(o.material);
  });
  // de lucht achter het raam: een Shadertoy-daglucht met drijvende wolken (shaders/sky.js). Ze heeft geen
  // licht nodig, haar kleur is haar eigen licht. In Blender staat ze een halve meter achter de muur; hier
  // vlak erachter, zodat de muur tussen de kamers dun kan blijven.
  const skyMesh = r.getObjectByName('d80_buiten_lucht'), wall = r.getObjectByName('d70_muur001');
  if (skyMesh) {
    skyMesh.geometry.computeBoundingBox();
    sky = createSky(skyMesh.geometry.boundingBox);
    skyMesh.material = new THREE.MeshBasicNodeMaterial({ colorNode: sky.node, side: THREE.DoubleSide });
  }
  if (skyMesh && wall) {
    const wallBack = new THREE.Box3().setFromObject(wall).min.z;
    skyMesh.position.z += wallBack - CORE * 0.5 - new THREE.Box3().setFromObject(skyMesh).max.z;
  }
  // het midden van de kamer op het midden van de jaren '70 leggen, dan rond de as draaien
  const holder = new THREE.Group();
  holder.position.copy(turnAxis);
  holder.rotation.y = angle;
  r.position.set(-new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).x, 0, -turnAxis.z);
  holder.add(r);
  DECADES[decade].holder = holder;
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const left = r.getObjectByName('d80_raam_gordijn_links'), right = r.getObjectByName('d80_raam_gordijn_rechts');
  const glassMesh = r.getObjectByName('d80_raam_glas');
  if (left && right && glassMesh) {
    glassMesh.geometry.computeBoundingBox();
    const center = glassMesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x;
    curtains = createCurtains({ left, right, center });
  }
  // de meubels vallen binnen als je hier de eerste keer naartoe draait (drop.js). Het model is plat,
  // dus eerst de onderdelen van elk meubel samen in een groep (die staat in rust op 0: niets verschuift)
  const piece = (...names) => {
    const grp = new THREE.Group();
    r.add(grp);
    for (const n of names) { const o = r.getObjectByName(n); if (o) grp.add(o); }
    return grp;
  };
  // de schaduw van wat op de vloer staat valt mee (dropShadow.js); de kamer staat nu op haar plek
  const shadows = createDropShadows({ floors: [floor], images: [tex.image, dayTex.image], uvSet: 'uv1', level: 2, flat: true });
  const onFloor = (grp) => ({ objs: [grp], shadow: shadows.add([grp]) });
  const sofa = onFloor(piece('sofa_03'));
  const stand = onFloor(piece('Wood_Tall_Tv_Stand', 'Basebot', 'BaseCenter', 'BaseTop', 'Drawer', 'DrawerHandle', 'Roller', 'Support', 'Supportop'));
  const table = onFloor(piece('Cube002', 'Cube003')); // salontafel
  floor?.traverse((o) => {
    if (o.isMesh) o.material = new THREE.MeshBasicNodeMaterial({ colorNode: albedoOf(o.material).mul(shadows.apply(light, o, lightAt, uv(1))).add(emit) });
  });
  // de kaders aan de muur: van de muur halen, gooien, terug ophangen (frames.js). Eigen physics, opgebouwd
  // voor de meubels binnenvallen, zodat alles op zijn plek staat; wat beweegt (cassettes, gordijnen) botst niet.
  const frames = await createFrames({ r, level: room80Level, skip: (o) => /^d80_(cassette|raam_gordijn|buiten_lucht)/.test(o.name) });
  const d = DECADES[decade];
  d.drop = createDrop([
    sofa,
    stand,
    table,
    { objs: [piece('television_02')] },      // na het tv-meubel: landt erop
    { objs: [piece(...RADIO_PARTS)] },       // na de tafel
    ...[1, 2, 3].map((i) => ({ objs: [piece(`d80_cassette_${i}`)] })),
  ]);
  if (d.dropped) d.drop.start(turning() ? (1 - turn.t) * TURN_TIME : 0.2); // al naartoe gedraaid terwijl ze nog laadde
  // zilveren antennes, zoals in de jaren '70, maar met het licht van deze kamer
  const antennaMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.2 });
  antennaMaterial.emissiveNode = vec3(0.17, 0.175, 0.18).mul(room80Level);
  // het stopcontact links (achter de zetel) is weg; de tv hangt met een kabel aan dat rechts ernaast, zoals in
  // de jaren '70 (de kamer staat 180° gedraaid: in Blender is links rechts)
  const socketLeft = r.getObjectByName('d70_stopcontact_lamp001');
  if (socketLeft) socketLeft.visible = false;
  const cable = await createTvCable80({
    r, plug70, plug70At, socket70At, level: room80Level,
    socket: r.getObjectByName('d70_stopcontact001'), tv: r.getObjectByName('television_02'),
    onPower(on) { room80?.tv.setPower(on); },
  });
  room80 = setupRoom80({ r, card, antennaMaterial, frames, cable, onRoom(on) { power80.room = on; } });
  room80.setActive(turn.index === 1 && !turning());
  room80.startAudio(); // meteen, zoals de andere tv's (zie 'geluid')
  // zoomen gebeurt in de ruimte van de jaren '70 (de camera draait daarna mee rond de as):
  // de echte doos en richting dus terugdraaien over de hoek van deze kamer
  const back = new THREE.Matrix4().makeTranslation(turnAxis.x, 0, turnAxis.z)
    .multiply(new THREE.Matrix4().makeRotationY(-angle)).multiply(new THREE.Matrix4().makeTranslation(-turnAxis.x, 0, -turnAxis.z));
  const spot = (name, label, objects, normal, fill) => {
    const world = objects.reduce((b, o) => b.expandByObject(o), new THREE.Box3());
    const box = world.clone().applyMatrix4(back);
    FOCUS[name] = focusSpot(box, typeof normal === 'function' ? normal(box) : normal.clone().transformDirection(r.matrixWorld).transformDirection(back), fill);
    addEye(name, label, decade, world);
  };
  const tvSpot = room80.spots.tv;
  spot('tv80', 'Inzoomen op de tv', [room80.screen, ...room80.antennas.rods], tvSpot.normal, 0.8); // met de antennes erbij
  spot('zetel80', 'Inzoomen op de zetel', [r.getObjectByName('sofa_03')], (b) => towardCamera(b, 0.55), 0.85);
  spot('radio', 'Inzoomen op de radio en de cassettes', room80.spots.radio.objects, room80.spots.radio.normal, 0.8);
  // het stopcontact van de tv, zoals in de jaren '70: recht ervoor (tussen de planken van het tv-meubel door)
  // en ruim, zodat de stekker op de vloer in beeld blijft
  spot('stopcontact80', 'Inzoomen op het stopcontact', [r.getObjectByName('d70_stopcontact001')], (b) => wallNormal(b), 0.1);
  spot('raam', 'Inzoomen op het raam', [left, right, r.getObjectByName('d80_raam_volant')].filter(Boolean), (b) => wallNormal(b), 0.8);
  toggleZoom(zoom.target);
}
for (const [i, d] of DECADES.entries()) {
  if (!d.model) continue;
  d.ready = loadDecadeRoom(d, d.yaw, i).then(() => true, (err) => {
    console.warn(`${d.name}: ${d.model} kon niet laden — draai blender/build_room80.py`, err);
    return false;
  });
}
// de jaren '90 (room90.js): op de plek van de jaren '70, op de voorkant van de draaideur
let room90 = null;
{
  const d = DECADES[2];
  d.holder = new THREE.Group();
  scene.add(d.holder);
  d.ready = createRoom90({ card, plug: { plug70: plug70b, plug70At, socket70At } }).then((r90) => {
    d.holder.add(r90.group);
    room90 = r90;
    // oogjes bij wat je hier kunt doen. De jaren '90 staan op de plek van de jaren '70 (de draai is een volle
    // slag): de dozen en richtingen gelden zoals ze zijn, gericht naar het standpunt van de camera daar.
    d.holder.updateMatrixWorld(true);
    const home = camNode.getWorldPosition(new THREE.Vector3());
    const toward = (lift) => (box) => home.clone().sub(box.getCenter(new THREE.Vector3())).setY(0).normalize().add(new THREE.Vector3(0, lift, 0)).normalize();
    const spot90 = (name, label, objects, normal, fill) => {
      if (!objects.length) return;
      const box = objects.reduce((b, o) => b.expandByObject(o), new THREE.Box3());
      FOCUS[name] = focusSpot(box, normal(box), fill);
      addEye(name, label, 2, box);
    };
    spot90('tv90', 'Inzoomen op de tv', r90.spots.tv, toward(0.15), 0.75);
    spot90('poster90', 'Inzoomen op de poster', r90.spots.poster, () => new THREE.Vector3(0, 0, 1), 0.75);
    spot90('lamp90', 'Inzoomen op de staande lamp', r90.spots.lamp, toward(0.25), 0.85);
    spot90('tapijt90', 'Inzoomen op het tapijt', r90.spots.carpet, toward(1.4), 0.8);
    // het stopcontact van de staande lamp: schuin van linksvoor (van voren staat de cd-toren ervoor, van rechts de bank)
    spot90('cds90', 'Inzoomen op de cd-toren', r90.spots.cds, toward(0.3), 0.6);
    spot90('stopcontact90', 'Inzoomen op het stopcontact', r90.spots.socket, () => new THREE.Vector3(-0.8, 0.3, 0.55).normalize(), 0.1);
    // de meubels vallen binnen als je hier de eerste keer naartoe draait, zoals in de andere kamers (drop.js)
    d.drop = createDrop(r90.dropParts());
    if (d.dropped) d.drop.start(turning() ? (1 - turn.t) * TURN_TIME : 0.2); // al naartoe gedraaid terwijl ze nog laadde
    r90.startAudio(); // meteen, zoals de andere tv's (zie 'geluid')
    return true;
  }, (err) => {
    console.warn(`${d.name}: models/kamer90.glb kon niet laden — draai blender/build_room90.py`, err);
    return false;
  });
}
// de zijkanten van de ruimte tussen de muren dichtmaken, anders kijk je er tijdens het draaien in
{
  const capMat = new THREE.MeshBasicMaterial({ color: 0x2a1a10, side: THREE.DoubleSide });
  const h = wallBox.max.y + 0.12, depth = CORE;
  for (const x of [wallBox.min.x, wallBox.max.x]) {
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(depth, h), capMat);
    cap.rotation.y = Math.PI / 2;
    cap.position.set(x, h / 2 - 0.12, turnAxis.z);
    cap.userData.always = true;
    scene.add(cap);
  }
}

const turn = { index: 0, prev: 0, from: 0, to: 0, angle: 0, t: 1, start: 0, muted: false, front: 0 };
const TURN_TIME = 1.8; // s
const turning = () => turn.t < 1;
const arrows = { prev: document.getElementById('decade-prev'), next: document.getElementById('decade-next') };
// de pijlen tonen naar welk decennium ze draaien (links het vorige, rechts het volgende; aan het begin en
// het einde van de rij is er geen); een kamer die niet laadt, kun je niet kiezen
function updateArrows() {
  for (const [dir, el] of Object.entries(arrows)) {
    const d = DECADES[turn.index + (dir === 'next' ? 1 : -1)];
    el.classList.toggle('none', !d);
    if (!d) continue;
    el.querySelector('span').textContent = d.name;
    el.setAttribute('aria-label', `Draai naar de ${d.name.toLowerCase()}`);
    el.disabled = d.ok === false;
  }
}
function setDecade(i) {
  if (i < 0 || i >= DECADES.length || i === turn.index || turning() || DECADES[i].ok === false) return;
  toggleZoom(null);
  turn.from = turn.angle;
  turn.to = DECADES[i].yaw;
  turn.t = 0;
  turn.start = performance.now();
  turn.prev = turn.index;
  turn.index = i;
  // de eerste keer hier: de meubels vallen binnen terwijl de kamer naar voren draait
  if (!DECADES[i].dropped) { DECADES[i].dropped = true; DECADES[i].drop?.start(TURN_TIME * 0.6); }
  renderer.domElement.style.cursor = '';
  updateArrows();
  document.body.dataset.decade = i;
}
function updateTurn(dt) {
  if (turn.t < 1) {
    // op de klok, niet per frame: ook bij haperende frames is de draai na TURN_TIME klaar
    turn.t = Math.min(1, (performance.now() - turn.start) / 1000 / TURN_TIME);
    const e = turn.t < 0.5 ? 4 * turn.t ** 3 : 1 - (-2 * turn.t + 2) ** 3 / 2; // ease in-out
    turn.angle = turn.from + (turn.to - turn.from) * e;
  }
  // enkel de kamer waar je bent, en tijdens het draaien ook die waar je vandaan komt: de andere staan rug aan
  // rug achter de muur en steken er anders aan de zijkant uit (de ficus van de jaren '90 bij de jaren '80).
  // De jaren '90 staan op de plek van de jaren '70, op de voorkant van de draaideur: die zijn er nooit samen.
  const shown = (i) => turn.index === i || (turning() && turn.prev === i);
  for (const c of scene.children) {
    if (c === DECADES[2].holder) c.visible = shown(2);
    else if (c === DECADES[1].holder) c.visible = shown(1);
    else if (!c.userData.always) c.visible = shown(0); // de jaren '70, met hun kabels
  }
  // de oogjes horen bij hun eigen kamer; geluid enkel van de kamer die vooraan staat
  // (en pas als de meubels van die kamer geland zijn)
  for (const { el, decade } of Object.values(EYES)) el.classList.toggle('away', turning() || decade !== turn.index || !!DECADES[decade].drop?.busy);
  // (de jaren '80 pas als de draai klaar is, de jaren '70 valt meteen stil)
  const front = turning() ? -1 : turn.index;
  if (front !== turn.front) {
    turn.front = front;
    turn.muted = turn.index !== 0;
    tv70.audio.setVolume(turn.muted ? 0 : volume);
    room80?.setActive(front === 1);
    room90?.setActive(front === 2);
  }
}
arrows.prev.addEventListener('click', () => setDecade(turn.index - 1));
arrows.next.addEventListener('click', () => setDecade(turn.index + 1));
for (const el of Object.values(arrows)) el.addEventListener('pointerdown', (e) => e.stopPropagation());
for (const d of DECADES) d.ready?.then((ok) => { d.ok = ok; updateArrows(); });
updateArrows();
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') setDecade(turn.index + 1);
  if (e.key === 'ArrowLeft') setDecade(turn.index - 1);
});

// ------------------------------------------------------------------ stroom: lamp en tv
// lamp: flikkert even bij het aanslaan, zoals een gloeilamp; tv: beeldbuis klapt dicht tot een lijn
const power = { room: true, roomSmooth: 1, lamp: true, lampSmooth: 1, lampFlicker: 0 };
const room = await createInteractions({
  root, scene,
  onRoom(on) { power.room = on; },
  onLamp(on) { power.lamp = on; power.lampFlicker = on ? 0.3 : 0; },
  onTv(on) { tv70.setPower(on); },
});

// tv-knoppen: kanaal zapt per klik (testbeeld, dan 1–4) en draait mee; volume in vijf standen, ook met scrollen.
// Ze draaien rond de as loodrecht op het front, net als het scherm.
const VOLUMES = [0, 0.25, 0.5, 0.75, 1];
let volume = 0.5;
const setVolume = (v) => {
  volume = THREE.MathUtils.clamp(v, 0, 1);
  if (!turn.muted) tv70.audio.setVolume(volume);
  volumeKnob.set(-(volume - 0.5) * 4); // ongeveer driekwart toer van stil naar luid
};
const volumePress = () => setVolume(VOLUMES[(VOLUMES.findIndex((v) => v >= volume - 0.01) + 1) % VOLUMES.length]);
const channelKnob = room.addButton(root.getObjectByName('d70_tv_knop_kanaal'), () => switchChannel(), scrNormal);
const volumeKnob = room.addButton(root.getObjectByName('d70_tv_knop_volume'), volumePress, scrNormal);
setVolume(volume);

// ------------------------------------------------------------------ geluid
// De tv's van alle kamers starten meteen bij het laden. Browsers houden geluid tegen tot je iets op de pagina
// doet: dan gaat het aan bij de eerste klik, tik of toets, waar dan ook (ook op de pijlen), in alle kamers tegelijk.
// Welke kamer je hoort, regelt het draaitoneel (de rest staat stil).
function startAudio() {
  tv70.startAudio();
  room80?.startAudio();
  room90?.startAudio();
}
startAudio();
for (const type of ['pointerdown', 'keydown', 'touchend']) addEventListener(type, startAudio, { capture: true });

// ------------------------------------------------------------------ interactie
// Houd je muis op het scherm: de beeldbuis buigt en verkleurt rond de cursor, zoals bij een magneet.
// Afstandsbediening en stekkers kun je vastpakken en gooien, schakelaars aanklikken, het scherm zapt.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let onScreen = false;
const canvas = renderer.domElement;
function aim(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}
addEventListener('pointermove', (e) => {
  aim(e);
  if (room.grabbing) { room.moveGrab(raycaster); return; }
  if (antennas.grabbing) { antennas.move(raycaster); return; }
  sway.tx = ndc.x; sway.ty = ndc.y;
  if (curtains?.grabbing) { curtains.moveGrab(raycaster, e); return; }
  if (room80?.grabbing) { room80.move(raycaster); return; }
  if (room90?.grabbing) { room90.move(raycaster); return; }
  if (turn.index !== 0 || turning()) { // de jaren '70 is hier niet interactief; in de jaren '80 tv, radio, cassettes, gordijnen
    onScreen = false;
    const here = !turning();
    if (turn.index === 2) { canvas.style.cursor = here && room90 ? room90.hover(raycaster) : ''; return; } // tv en lichtschakelaar
    room90?.leave();
    canvas.style.cursor = (here && room80?.hover(raycaster)) || (here && curtains?.hitTest(raycaster) ? 'grab' : '');
    return;
  }
  const h = room.hitTest(raycaster);
  onScreen = h?.object === screen;
  if (onScreen) glitch.uniforms.magnet.value.copy(h.hit.uv);
  canvas.style.cursor = h?.kind === 'item' || antennas.owns(h?.object) ? 'grab' : h?.kind === 'button' || (onScreen && tv70.power) ? 'pointer' : '';
});
document.addEventListener('pointerleave', () => { onScreen = false; room90?.leave(); });
canvas.addEventListener('pointerdown', (e) => {
  if (turning() || DECADES[turn.index].drop?.busy) return;
  aim(e);
  if (turn.index === 1) {
    if (room80?.down(raycaster)) {
      if (room80.grabbing) { canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; }
    } else if (curtains?.startGrab(raycaster, e)) {
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    }
    return;
  }
  if (turn.index === 2) {
    if (room90?.down(raycaster) && room90.grabbing) { canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; }
    return;
  }
  if (turn.index !== 0) return;
  const h = room.hitTest(raycaster);
  if (antennas.owns(h?.object)) {
    antennas.start(h.object);
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  } else if (h?.kind === 'item') {
    room.startGrab(h, raycaster);
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  } else if (h?.kind === 'button') {
    h.press();
  } else if (h?.object === screen && tv70.power) {
    switchChannel();
  }
});
const release = () => {
  if (room.grabbing) { room.endGrab(); canvas.style.cursor = 'grab'; }
  if (antennas.grabbing) { antennas.end(); canvas.style.cursor = 'grab'; }
  if (curtains?.grabbing) { curtains.endGrab(); canvas.style.cursor = 'grab'; }
  if (room80?.grabbing) { room80.up(); canvas.style.cursor = 'grab'; }
  if (room90?.grabbing) { room90.up(); canvas.style.cursor = 'grab'; }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('wheel', (e) => {
  if (turn.index !== 0) return;
  aim(e);
  const h = room.hitTest(raycaster);
  if (h?.press !== volumePress) return;
  e.preventDefault();
  setVolume(volume - e.deltaY * 0.0015);
}, { passive: false });
canvas.addEventListener('pointercancel', release);

// ------------------------------------------------------------------ loop
const timer = new THREE.Timer();
await renderer.compileAsync(scene, camera);

// binnenkomen: terwijl de kamer infadet, vallen de meubels van boven op hun plek (drop.js).
// Het tapijt blijft liggen: de vloer eronder is niet gebakken. De afstandsbediening valt mee met de zetel; de kabels hangen aan lamp en tv en zakken mee.
{
  const remote = scene.getObjectByName('d70_afstandsbediening'); // physics zet haar positie elke frame
  const cable = ({ anchor }) => { const y0 = anchor.y; return (off) => { anchor.y = y0 + off; }; };
  DECADES[0].dropped = true;
  DECADES[0].drop = createDrop([
    { objs: [root.getObjectByName('d70_zetel')], extra: [remote], follow: (off) => { remote.position.y += off; }, shadow: shadow70.zetel },
    { objs: [tvObj], extra: [room.cables.tv.mesh], follow: cable(room.cables.tv), shadow: shadow70.tv },
    { objs: [root.getObjectByName('d70_staanlamp')], extra: [room.cables.lamp.mesh], follow: cable(room.cables.lamp), shadow: shadow70.lamp },
  ]);
  DECADES[0].drop.start(0.35);
}
document.body.classList.add('ready');

renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 20);
  const t = timer.getElapsed();
  updateTurn(dt);
  moveCamera(t, dt);
  placeEye();

  antennas.update(dt, t, tv70.current + 1);
  glitch.uniforms.snow.value = antennas.noise; // slecht gerichte antennes: sneeuw op het scherm
  tv70.update(t, dt, onScreen);

  room.update(dt);
  for (const d of DECADES) d.drop?.update(); // na de physics: de afstandsbediening zakt mee
  camera.position.y += 0.006 * (DECADES[turn.index].drop?.thud ?? 0); // de vloer dreunt even na als er iets neerploft
  room80?.update(t, dt, camera, { width: innerWidth, height: innerHeight });
  room90?.update(t, dt);
  if (sky) sky.time.value = t;
  // gordijnen: hoe meer het raam bedekt is, hoe minder daglicht (de stof laat nog wat door)
  if (curtains) {
    curtains.update(dt);
    // licht uit: ook het daglicht in de kamer zakt (avondlicht), zodat het echt donker wordt zoals in de jaren '70
    dayLevel.value = (1 - 0.88 * curtains.coverage) * (DAY_OFF + (1 - DAY_OFF) * power80.smooth);
  }
  // reflecties volgen het licht in de kamer
  power.roomSmooth += ((power.room ? 1 : 0) - power.roomSmooth) * (1 - Math.exp(-dt * 12));
  roomLevel.value = ROOM_OFF + (1 - ROOM_OFF) * power.roomSmooth;
  scene.environmentIntensity = 0.5 * Math.max(roomLevel.value, lampLevel.value * 0.6);
  power.lampSmooth += ((power.lamp ? 1 : 0) - power.lampSmooth) * (1 - Math.exp(-dt * (power.lamp ? 14 : 9)));
  let lamp = power.lampSmooth;
  if (power.lampFlicker > 0) { power.lampFlicker -= dt; if (Math.random() < 0.45) lamp *= 0.3; }
  lampLevel.value = lamp;
  power80.smooth += ((power80.room ? 1 : 0) - power80.smooth) * (1 - Math.exp(-dt * 12));
  room80Level.value = ROOM_OFF + (1 - ROOM_OFF) * power80.smooth;
  if (turn.index === 0 || turning()) tv70.render(renderer);
  room80?.render(renderer, turn.index === 1 || turning());
  room90?.render(renderer, turn.index === 2 || turning());
  renderer.render(scene, camera);
});
