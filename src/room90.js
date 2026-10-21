/**
 * De kamer van de jaren '90, uit Blender (blender/build_room90.py): het diorama d90_diorama met de Sony
 * Trinitron op het tv-meubel, de bank, de cd-toren, de halogeen-uplighter, de ficus en de Memphis-poster.
 * Zoals de jaren '80: elk materiaal heeft een eigen scherpe kleurtexture (UV 0), het licht komt uit één
 * gedeelde lightmap (UV 1), plus wat zelf licht geeft (de halogeenkom, de leds).
 *
 *  - geen lichtschakelaar: het grote licht (het vullicht) is altijd uit, enkel de lampen branden; de schakelaar
 *    uit Blender is weg.
 *  - de stekker van de staande lamp: zoals in de jaren '70 en '80 (cable80.js); eruit = de lamp uit.
 *  - de knop op de halogeen-uplighter (het dimmerschuifje op de stang): de lamp aan en uit, met haar kaatsing op het
 *    plafond en haar gloeiende kom. Het licht van de lamp is een aparte bake (baked90_lamp.webp).
 *  - de klok: de wijzers lopen op de echte tijd.
 *  - het tv-meubel: klik op een glazen deurtje (of zijn knopje) en het zwaait open. Klik op de PlayStation of de
 *    controller en ze gaan in het kastje (de deurtjes gaan vanzelf open); nog een klik zet ze terug.
 *  - de controller: sleep hem en hij is een physics-object aan een live kabel naar de PlayStation (gamepad90.js).
 *  - de cd-toren: klik op een losse cd op de vloer en hij schuift in een vrij vakje; nog een klik legt hem terug.
 *  - de lavalamp: bewegende was die opwarmt, stijgt en zakt (lavalamp90.js). Klik erop: aan of uit.
 *  - de tv: dezelfde Glitchy Glitch als in de andere kamers. Klik op het scherm om te zappen: testbeeld, dan de
 *    uitzendingen in chronologische volgorde. Houd de muis erop voor het magneeteffect.
 *  - de poster: "Genuary #15: Design a rug" door Flopine (shaders/rug.js), tegels in jaren-90-kleuren die traag
 *    naar boven schuiven, belicht door de kamer. Met de muis erover draaien de tegels rond de cursor weg; klik
 *    voor een nieuw patroon. De Memphis-vormen uit Blender hangen er niet meer op.
 *  - het tapijt: "Wigglestrips" door cacheflowe (shaders/wiggle.js), golvende strepen in de kleuren uit Blender,
 *    met de schaduwen van de bake erop. Met de muis erover rimpelen de strepen; klik en ze verschuiven met een golfstoot.
 *    Klik op het scherm voor een glitch, houd de muis erop voor het magneeteffect.
 *
 * In Blender staat de kamer naast de andere (x 18,2..22,2); hier schuift ze naar dezelfde plek als de jaren
 * '70 (x 6..10, muur bij z = -1,14): op de voorkant van de draaideur, rug aan rug met de jaren '80 (main.js).
 */
import * as THREE from 'three/webgpu';
import { texture, uv, uniform, vec2, vec3, mix, smoothstep } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { createTv } from './tv.js';
import { createDropShadows } from './dropShadow.js';
import { createTvCable80 } from './cable80.js';
import { createGamepad90 } from './gamepad90.js';
import { createLavaLamp } from './lavalamp90.js';
import { createRug } from './shaders/rug.js';
import { createWiggle } from './shaders/wiggle.js';
import { PROFILE_90 } from './audio/tvAudio.js';

const BAKE_SCALE = 2; // × 0.5 opgeslagen, zoals de andere bakes
const ROOM_OFF = 0.1; // het grote licht is uit: niet pikdonker
const CENTER_X = 8;   // het midden van de jaren '70
const SCREEN_MAT = 'Mat_d90_tv_scherm_uit';

// de zenders van de jaren '90, in chronologische volgorde (fragmenten van ± 5 minuten)
const BROADCASTS = [
  { src: 'video/kampioenen.mp4', title: 'FC DE KAMPIOENEN', sub: 'CRISIS · BRT · 1990' },
  { src: 'video/la-vache.mp4', title: 'MILK INC. · LA VACHE', sub: 'VIDEOCLIP · 1997' },
  { src: 'video/diana.mp4', title: 'PRINSES DIANA', sub: 'DE BEGRAFENIS, LONDEN · 1997' },
  { src: 'video/millennium.mp4', title: 'HET JOURNAAL', sub: 'VRT · 1 JANUARI 2000' },
];

const loadBake = (url) => new THREE.TextureLoader().loadAsync(url).then((t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 8;
  return t;
});
// zolang de laag van de lamp niet gebakken is: zwart (de lamp geeft dan geen licht)
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

export async function createRoom90({ card, plug }) {
  const [g, tex, lampTex, emitTex] = await Promise.all([
    new GLTFLoader().loadAsync('models/kamer90.glb'),
    loadBake('textures/baked90.webp'),
    loadBake('textures/baked90_lamp.webp').catch(() => BLACK),
    loadBake('textures/baked90_emit.webp'),
  ]);
  const r = g.scene;
  r.name = 'kamer90';
  const get = (n) => r.getObjectByName(n);

  // ---------------------------------------------------------------- materialen: kleur × licht + emissie
  const level = uniform(ROOM_OFF); // het grote licht: altijd uit (niet pikdonker)
  const lampLevel = uniform(1); // de halogeen-uplighter (knop op de lamp)
  const light = texture(tex, uv(1)).rgb.mul(level).add(texture(lampTex, uv(1)).rgb.mul(lampLevel)).mul(BAKE_SCALE);
  const emit = texture(emitTex, uv(1)).rgb.mul(BAKE_SCALE);
  // het glas (deurtjes van het tv-meubel, de salontafel, de poster) dimt mee met het kamerlicht
  const glass = new THREE.MeshBasicNodeMaterial({ colorNode: vec3(0.85, 0.91, 0.88).mul(level), transparent: true, opacity: 0.18, depthWrite: false });
  // het glas voor de poster: amper zichtbaar, anders legt het een witte waas over de kleuren van de shader
  const posterGlass = new THREE.MeshBasicNodeMaterial({ colorNode: vec3(0.85, 0.91, 0.88).mul(level), transparent: true, opacity: 0.05, depthWrite: false });
  const mats = new Map();
  const baked = (m) => {
    if (!mats.has(m)) {
      if (m.map) m.map.anisotropy = 8;
      const albedo = m.map ? texture(m.map, uv()).rgb.mul(m.color) : vec3(m.color.r, m.color.g, m.color.b);
      mats.set(m, new THREE.MeshBasicNodeMaterial({ colorNode: albedo.mul(light).add(emit) }));
    }
    return mats.get(m);
  };
  const screens = [];
  r.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material.name.startsWith(SCREEN_MAT)) screens.push(o); // het bakscript kan er '.001' achter zetten
    else if (/^d90_poster_glas/.test(o.name)) o.material = posterGlass;
    else if (/^wall_clock_glass/.test(o.material.name)) o.material = posterGlass; // het glas van de klok: anders zie je de wijzers niet
    else if (/^d90_uplighter_gloed/.test(o.name)) { // de kom van de lamp gloeit enkel als ze aan is
      const m = o.material;
      const albedo = m.map ? texture(m.map, uv()).rgb.mul(m.color) : vec3(m.color.r, m.color.g, m.color.b);
      o.material = new THREE.MeshBasicNodeMaterial({ colorNode: albedo.mul(light).add(emit.mul(lampLevel)) });
    }
    else {
      o.userData.bakedFrom = o.material; // het glTF-materiaal (kleurtexture), voor de vloeren met meevallende schaduw
      o.material = /_glas$/.test(o.name) || o.material.name === 'glas' ? glass : baked(o.material);
    }
  });

  // naar de plek van de jaren '70
  const floorBox = new THREE.Box3().setFromObject(get('d90_vloer'));
  r.position.x = CENTER_X - (floorBox.min.x + floorBox.max.x) / 2;
  r.updateMatrixWorld(true);

  // ---------------------------------------------------------------- tv
  // het testbeeld en de zenders. Het scherm van de Trinitron krijgt een uv recht op het glas
  // (v van boven naar onder, zoals op de andere schermen): de uitvouw uit de bake is daar niet voor gemaakt.
  // een Trinitron: scherper en rustiger beeld dan de toestellen van de jaren '70 en '80
  const tv = createTv({ broadcasts: BROADCASTS, card, profile: PROFILE_90, clean: 1, size: [960, 720] });
  for (const s of screens) {
    const geo = s.geometry;
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox, size = max.clone().sub(min);
    const thin = size.x < size.z ? 'x' : 'z';    // de as loodrecht op het glas (y is omhoog)
    const across = thin === 'x' ? 'z' : 'x';
    let n = 0;
    const normals = geo.attributes.normal;
    if (normals) for (let i = 0; i < normals.count; i++) n += normals.getComponent(i, thin === 'x' ? 0 : 2);
    // kijk je van +z (of -x) naar het glas, dan loopt u in de richting van de as; anders omgekeerd
    const flip = thin === 'z' ? n < 0 : n > 0;
    const pos = geo.attributes.position, uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const a = across === 'x' ? pos.getX(i) : pos.getZ(i);
      const u = (a - min[across]) / size[across];
      uvs[i * 2] = flip ? 1 - u : u;
      uvs[i * 2 + 1] = (max.y - pos.getY(i)) / size.y;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    s.material = tv.material;
  }

  // ---------------------------------------------------------------- poster
  // het licht op de poster: het gemiddelde van haar stuk lightmap, niet pixel per pixel. Zo blijven er geen
  // schaduwen van wat er ooit op hing (de Memphis-vormen) op de shader staan; de poster is even licht als de muur.
  function averageLight(geo, front) {
    const uv1 = geo.attributes.uv1;
    if (!uv1 || !tex.image) return light;
    let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
    const idx = geo.index ? geo.index.array : Array.from({ length: uv1.count }, (_, i) => i);
    const onFront = new Set();
    for (let t = 0; t < idx.length; t += 3) if (front(idx[t]) && front(idx[t + 1]) && front(idx[t + 2])) onFront.add(idx[t]).add(idx[t + 1]).add(idx[t + 2]);
    for (const i of onFront) { // enkel de voorkant: de zijkanten liggen elders in de lightmap
      u0 = Math.min(u0, uv1.getX(i)); u1 = Math.max(u1, uv1.getX(i));
      v0 = Math.min(v0, uv1.getY(i)); v1 = Math.max(v1, uv1.getY(i));
    }
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); // de bake is sRGB, three rekent lineair
    const average = (img) => {
      if (!img?.width || img.width < 2) return vec3(0, 0, 0); // (nog) geen bake
      const w = img.width, h = img.height;
      const x = Math.floor(u0 * w), y = Math.floor(v0 * h), cw = Math.max(1, Math.ceil((u1 - u0) * w)), ch = Math.max(1, Math.ceil((v1 - v0) * h));
      const canvas = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, x, y, cw, ch, 0, 0, cw, ch);
      const px = ctx.getImageData(0, 0, cw, ch).data, sum = [0, 0, 0];
      for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += lin(px[i + k] / 255);
      const n = px.length / 4;
      return vec3(sum[0] / n, sum[1] / n, sum[2] / n);
    };
    return average(tex.image).mul(level).add(average(lampTex.image).mul(lampLevel)).mul(BAKE_SCALE);
  }
  // de Memphis-vormen uit Blender weg; op het papier de shader van Flopine, met het licht van de kamer erop.
  // Het papier krijgt een uv recht op de voorkant: x van 0 tot breedte / hoogte, y van 0 (onder) tot 1 (boven).
  r.traverse((o) => { if (/^d90_memphis/.test(o.name)) o.visible = false; });
  const paper = get('d90_poster_papier');
  let rug = null;
  const posterMeshes = [];
  paper?.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox, size = max.clone().sub(min);
    const thin = size.x < size.z ? 'x' : 'z', across = thin === 'x' ? 'z' : 'x';
    let n = 0;
    const normals = geo.attributes.normal;
    if (normals) for (let i = 0; i < normals.count; i++) n += normals.getComponent(i, thin === 'x' ? 0 : 2);
    const flip = thin === 'z' ? n < 0 : n > 0; // van voren gezien loopt x van links naar rechts
    const aspect = size[across] / size.y;
    const pos = geo.attributes.position, uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const u = ((across === 'x' ? pos.getX(i) : pos.getZ(i)) - min[across]) / size[across];
      uvs[i * 2] = (flip ? 1 - u : u) * aspect;
      uvs[i * 2 + 1] = (pos.getY(i) - min.y) / size.y;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    rug ??= createRug(uv(), aspect);
    posterMeshes.push(o);
    // de voorkant: driehoeken helemaal op het voorste vlak (de muur zit aan de -z-kant, de kamer aan +z)
    const axis = thin === 'x' ? 0 : 2, frontAt = (thin === 'z' ? n >= 0 : n > 0) ? max[thin] : min[thin];
    const front = (i) => Math.abs(pos.getComponent(i, axis) - frontAt) < 1e-4;
    o.material = new THREE.MeshBasicNodeMaterial({ colorNode: rug.node.mul(averageLight(geo, front)).add(emit) });
  });

  // ---------------------------------------------------------------- tapijt
  // Wigglestrips op het tapijt, met de lightmap gewoon pixel per pixel: de schaduw van de bank en de tafel blijft.
  // Het tapijt krijgt een uv op de bovenkant: x van 0 tot breedte / diepte, y van 0 (achteraan) tot 1 (vooraan);
  // de strepen lopen zo van achter naar voor, zoals in Blender.
  const carpetMeshes = [];
  let carpet = null;
  get('d90_tapijt')?.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox, size = max.clone().sub(min);
    const aspect = size.x / size.z;
    const pos = geo.attributes.position, uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = (pos.getX(i) - min.x) / size.z;
      uvs[i * 2 + 1] = (pos.getZ(i) - min.z) / size.z;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    carpet ??= createWiggle(uv(), aspect);
    carpetMeshes.push(o);
    o.material = new THREE.MeshBasicNodeMaterial({ colorNode: carpet.node.mul(light).add(emit) });
  });

  // ---------------------------------------------------------------- geen lichtschakelaar
  // het grote licht blijft uit; de schakelaar en zijn knopje uit Blender verdwijnen (ook uit de physics).
  // Waar het plaatje hing, is de muur in de bake zwart (dat stuk zag nooit licht): daar komt het licht van de muur
  // ernaast, gezocht in de lightmap zelf (uv 1), zodat het patroon van de muur blijft staan.
  const plate = get('d90_schakelaar'), panel = get('d90_paneel');
  if (plate && panel?.isMesh) {
    r.updateMatrixWorld(true);
    const pb = new THREE.Box3().setFromObject(plate).expandByScalar(0.012);
    const ray = new THREE.Raycaster(), back = new THREE.Vector3(0, 0, -1);
    const uvAt = (x, y) => { ray.set(new THREE.Vector3(x, y, pb.max.z + 0.5), back); return ray.intersectObject(panel)[0]?.uv1; };
    const corners = [[pb.min.x, pb.min.y], [pb.max.x, pb.min.y], [pb.min.x, pb.max.y], [pb.max.x, pb.max.y]].map(([x, y]) => uvAt(x, y));
    const beside = uvAt(pb.max.x + 0.12, (pb.min.y + pb.max.y) / 2);
    if (corners.every(Boolean) && beside) {
      const u0 = Math.min(...corners.map((c) => c.x)), u1 = Math.max(...corners.map((c) => c.x));
      const v0 = Math.min(...corners.map((c) => c.y)), v1 = Math.max(...corners.map((c) => c.y));
      const p = uv(1), e = 0.0015; // een zachte rand van een paar texels
      const inside = (a, lo, hi) => smoothstep(lo - e, lo, a).mul(smoothstep(hi, hi + e, a).oneMinus()); // (smoothstep met omgekeerde randen is in WGSL ongedefinieerd)
      const mask = inside(p.x, u0, u1).mul(inside(p.y, v0, v1));
      const at = vec2(beside.x, beside.y);
      const near = texture(tex, at).rgb.mul(level).add(texture(lampTex, at).rgb.mul(lampLevel)).mul(BAKE_SCALE);
      const m = panel.userData.bakedFrom;
      const albedo = m.map ? texture(m.map, uv()).rgb.mul(m.color) : vec3(m.color.r, m.color.g, m.color.b);
      panel.material = new THREE.MeshBasicNodeMaterial({ colorNode: albedo.mul(mix(light, near, mask)).add(emit) });
    }
  }
  for (const o of [plate, get('d90_schakelaar_knop')]) if (o) o.visible = false;

  // ---------------------------------------------------------------- de knop op de lamp
  // het dimmerschuifje op de stang van de uplighter: klikken zet de lamp aan of uit, het schuifje schuift mee
  const dimmer = get('d90_uplighter_dimmer'), slider = get('d90_uplighter_dimmer_schuif');
  const lamp = { on: true, plugged: true, smooth: 1, y0: slider?.position.y ?? 0 };

  // ---------------------------------------------------------------- de stekker van de lamp
  // dezelfde kabel als die van de tv in de jaren '80: in het stopcontact naast de lamp, de kabel naar haar voet
  const cable = plug && await createTvCable80({
    r, ...plug, level,
    socket: get('d90_stopcontact_lamp'), tv: get('d90_uplighter_voet'),
    onPower(on) { lamp.plugged = on; },
    names: { floor: 'd90_vloer', wall: 'd90_muur', panel: 'd90_paneel', plug: 'd90_lamp_stekker' },
  });

  // ---------------------------------------------------------------- de klok
  // de wijzers draaien rond het midden van de klok, recht op de muur (+z); waar ze nu naar wijzen, meten we aan hun
  // verste punt, en vandaar draaien ze naar de echte tijd
  const hands = ['uur', 'minuut', 'seconde'].map((k) => {
    const o = get(`d90_klok_${k}wijzer`);
    if (!o) return null;
    let far = null, best = -1;
    const pos = o.geometry?.attributes.position;
    for (let i = 0; pos && i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyQuaternion(o.quaternion);
      const d = v.x * v.x + v.y * v.y;
      if (d > best) { best = d; far = v; }
    }
    return far && { k, o, q0: o.quaternion.clone(), a0: Math.atan2(far.y, far.x) };
  }).filter(Boolean);
  const Z = new THREE.Vector3(0, 0, 1), _qz = new THREE.Quaternion();

  // ---------------------------------------------------------------- het tv-meubel: deurtjes, PlayStation, controller
  // Het meubel staat schuin: zijn assen komen uit de deurtjes (x langs de deurtjes, z naar voren, y omhoog).
  // De deurtjes draaien rond hun buitenste scharnier naar voren open. De PlayStation gaat in het onderste vak
  // bovenop de rij videobanden, de controller bovenop de stapel banden ernaast (de enige plekken waar ze passen).
  const doorL = get('d90_tvmeubel_glasdeur_L_glas'), doorR = get('d90_tvmeubel_glasdeur_R_glas');
  const cabinetQ = (doorL ?? doorR)?.quaternion.clone() ?? new THREE.Quaternion();
  const cabX = new THREE.Vector3(1, 0, 0).applyQuaternion(cabinetQ), cabZ = new THREE.Vector3(0, 0, 1).applyQuaternion(cabinetQ);
  const localBox = (o) => {
    const b = new THREE.Box3(), toR = r.matrixWorld.clone().invert();
    o.updateMatrixWorld(true);
    o.traverse((m) => { if (m.isMesh && m.visible && !m.userData.isHitbox) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).applyMatrix4(toR)); } });
    return b;
  };
  // de doos van een groep in rust (op 0), ook als ze nu ergens anders staat (in het kastje, of los gegooid)
  // Gemeten in de assen van de groep zelf, dus los van haar matrix: tijdens het binnenvallen zet drop.js die matrix
  // (tot 1,1 m hoog, gekanteld) en dan klopte de doos niet; de PlayStation ging later zo ver onder de vloer.
  const restBox = (g) => {
    if (!g.userData.restBox) {
      const b = new THREE.Box3(), inv = new THREE.Matrix4();
      g.updateMatrixWorld(true);
      inv.copy(g.matrixWorld).invert();
      g.traverse((m) => {
        if (!m.isMesh || !m.visible || m.userData.isHitbox) return;
        m.geometry.computeBoundingBox();
        b.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
      });
      g.userData.restBox = b; // de groep hangt rechtstreeks in de kamer: in rust zijn haar assen die van de kamer
    }
    return g.userData.restBox;
  };
  const bottom = get('d90_tvmeubel_bodem') && localBox(get('d90_tvmeubel_bodem'));
  const cabC = bottom ? bottom.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const inCab = (x, z) => cabC.clone().addScaledVector(cabX, x).addScaledVector(cabZ, z); // een punt in de assen van het meubel
  const doors = [[doorL, get('d90_tvmeubel_knop_L'), -1], [doorR, get('d90_tvmeubel_knop_R'), 1]].filter(([d]) => d).map(([door, knob, side]) => {
    // het scharnier: de buitenste rand van het deurtje (links -x, rechts +x), op de hoogte van het meubel
    const b = localBox(door), c = b.getCenter(new THREE.Vector3());
    const corners = [[b.min.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.min.z], [b.max.x, b.max.z]].map(([x, z]) => new THREE.Vector3(x, c.y, z));
    const hinge = corners.reduce((best, p) => (side * p.clone().sub(c).dot(cabX) > side * best.clone().sub(c).dot(cabX) ? p : best));
    const parts = [door, knob].filter(Boolean).map((o) => ({ o, m0: o.matrix.clone() }));
    return { door, knob, side, hinge, parts, open: 0, target: 0 };
  });
  // naar voren openen: het linkse deurtje draait met de klok mee (van boven gezien), het rechtse ertegenin
  const DOOR_ANGLE = THREE.MathUtils.degToRad(105);
  const _dm = new THREE.Matrix4(), _dt = new THREE.Matrix4(), _dr = new THREE.Matrix4();
  function poseDoor(d) {
    const a = -d.side * DOOR_ANGLE * d.open; // links: negatief rond +y (de vrije rand gaat naar voren)
    _dm.makeTranslation(d.hinge.x, d.hinge.y, d.hinge.z).multiply(_dr.makeRotationY(-a)).multiply(_dt.makeTranslation(-d.hinge.x, -d.hinge.y, -d.hinge.z));
    for (const { o, m0 } of d.parts) {
      o.matrixAutoUpdate = false;
      o.matrix.copy(_dm).multiply(m0); // (het deurtje zit in de groep van het meubel, die in rust op 0 staat)
      o.matrixWorldNeedsUpdate = true;
    }
  }
  const doorOf = (o) => doors.find((d) => owner(o, d.parts.map((p) => p.o)));
  const openDoors = () => { for (const d of doors) d.target = 1; };

  // opbergen: de groep van het meubel (drop.js maakt die) vliegt in een boogje naar haar plek in het kastje
  const yawOf = (q) => new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
  const STORE = [
    { group: 'drop_console', yawFrom: 'd90_console_behuizing', slot: [-0.25, 0.02], onTop: 'd90_vhs_rij_00' },
    { group: 'drop_gamepad', yawFrom: 'd90_gamepad', slot: [0.245, 0.02], onTop: 'd90_vhs_stapel_3' },
  ].map((st) => ({ ...st, inside: false, t: 1, from: null, to: null }));
  function storeTarget(st, g) {
    // de groep staat in rust op 0: haar eigen doos is die in de kamer. Ze draait mee met het meubel en zakt op de plek.
    const home = restBox(g), hc = home.getCenter(new THREE.Vector3());
    const yaw = yawOf(cabinetQ) - yawOf((get(st.yawFrom) ?? g).quaternion);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const top = get(st.onTop) ? localBox(get(st.onTop)).max.y : cabC.y;
    const spot = inCab(st.slot[0], st.slot[1]); spot.y = top + 0.002 + (hc.y - home.min.y);
    // positie van de groep zodat het midden van haar doos (rond dat midden gedraaid) op de plek komt
    const pos = spot.clone().sub(hc.clone().applyQuaternion(q));
    return { pos, q };
  }
  // zoals je het met de hand doet: recht omhoog tillen, horizontaal naar de opening van het kastje dragen (en
  // ondertussen rechtdraaien), recht het vak in schuiven, de laatste centimeters neerzetten. Eruit precies
  // omgekeerd: optillen, eruit schuiven, terugdragen tot boven zijn plek en recht naar beneden neerzetten.
  const LIFT = 0.03, FRONT = 0.38; // m: boven de plank / voor het midden van het meubel
  // `from`: waar de groep nu ligt als dat niet haar plek is (de controller, ergens neergegooid)
  function storePath(st, g, from) {
    const home = { pos: new THREE.Vector3(), q: new THREE.Quaternion() }; // de groep staat in rust op 0
    const slot = storeTarget(st, g);
    const above = { pos: slot.pos.clone().setY(slot.pos.y + LIFT), q: slot.q };
    const front = { pos: above.pos.clone().addScaledVector(cabZ, FRONT), q: slot.q };
    // boven zijn plek op de vloer, op de hoogte waarop hij gedragen wordt: die van de opening, minstens 12 cm hoog
    // (de groep staat in rust op 0, dus haar y is hoe ver ze opgetild is)
    const start = from ?? home;
    // al in het kastje losgelaten: rechtstreeks naar boven zijn plek en neerzetten
    if (from?.inCabinet) return [[start, 0], [above, 0.35], [slot, 0.25]];
    const startUp = { pos: start.pos.clone().setY(Math.max(from ? from.pos.y + 0.08 : 0.12, front.pos.y)), q: start.q };
    // [punt, duur in s]: optillen, ernaartoe dragen, inschuiven, neerzetten
    return [[start, 0], [startUp, 0.35], [front, 0.6], [above, 0.4], [slot, 0.25]];
  }
  function toggleStore(st) {
    const g = r.getObjectByName(st.group);
    if (!g || st.t < 1) return;
    st.g = g;
    st.pivot = restBox(g).getCenter(new THREE.Vector3());
    // ligt de controller los: vanaf daar, en de physics laat hem los
    const from = st.pad?.free ? { pos: g.position.clone(), q: g.quaternion.clone(), inCabinet: st.pad.inCabinet } : null;
    if (from) st.pad.settle();
    st.fromLoose = !!from;
    const path = storePath(st, g, from);
    if (st.inside) { // eruit: dezelfde weg terug
      const back = path.slice().reverse().map(([p], i, arr) => [p, i === 0 ? 0 : path[arr.length - i][1]]);
      st.path = back;
    } else st.path = path;
    st.total = st.path.reduce((s, [, d]) => s + d, 0);
    st.inside = !st.inside;
    st.t = 0;
    openDoors(); // erin of eruit: de deurtjes moeten open
  }
  // waar de groep is op tijdstip u (0..1) van haar pad: elk stuk met een zachte start en landing.
  // Ze draait rond haar eigen midden (st.pivot, in haar assen), niet rond de oorsprong van de kamer: die ligt
  // meters verderop, dan zwaait een kleine draai haar in een grote boog door de lucht.
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), ZERO = new THREE.Vector3();
  function alongPath(st, u) {
    let t = u * st.total;
    const piv = st.pivot ?? ZERO;
    for (let i = 1; i < st.path.length; i++) {
      const [a] = st.path[i - 1], [b, d] = st.path[i];
      if (t <= d || i === st.path.length - 1) {
        const k = THREE.MathUtils.clamp(t / d, 0, 1), e = k * k * (3 - 2 * k);
        st.g.quaternion.slerpQuaternions(a.q, b.q, e);
        _pa.copy(piv).applyQuaternion(a.q).add(a.pos);
        _pb.copy(piv).applyQuaternion(b.q).add(b.pos);
        st.g.position.lerpVectors(_pa, _pb, e).sub(_pa.copy(piv).applyQuaternion(st.g.quaternion));
        return;
      }
      t -= d;
    }
  }
  const shadowOf = new Map(); // groepsnaam -> zijn schaduw op de vloer (dropShadow.js): 1 = er, 0 = weg
  const storeOf = (o) => STORE.find((st) => { const g = r.getObjectByName(st.group); return g && owner(o, [g]); });

  const owner = (o, list) => { for (; o; o = o.parent) if (list.includes(o)) return o; return null; };

  // ---------------------------------------------------------------- de lavalamp
  const lavaParts = ['glas', 'kap', 'voet'].map((k) => get(`d90_lavalamp_${k}`)).filter(Boolean);
  const lava = get('d90_lavalamp_glas') && get('d90_lavalamp_was')
    ? createLavaLamp({ r, glass: get('d90_lavalamp_glas'), wax: get('d90_lavalamp_was'), level }) : null;

  // ---------------------------------------------------------------- de cd-toren
  // De doosjes in de toren liggen plat, om de 15,5 mm (gemeten in het model), met hier en daar een leeg vakje.
  // Klik op een losse cd op de vloer: hij gaat omhoog, draait met zijn rug naar voren en schuift in het hoogste
  // vrije vakje. Nog een klik: dezelfde weg terug naar zijn plek op de vloer.
  const CD_PITCH = 0.0155, CD_IN = 0.2; // m: tussen twee vakjes / zo ver voor de toren begint hij in te schuiven
  const stack = get('d90_cd_doosjes');
  const cdSlots = [];
  if (stack) {
    const ys = [], b = new THREE.Box3(), p = new THREE.Vector3();
    stack.traverse((m) => {
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position, at = m === stack ? new THREE.Matrix4() : m.matrix;
      for (let i = 0; i < pos.count; i++) { p.fromBufferAttribute(pos, i).applyMatrix4(at); ys.push(p.y); b.expandByPoint(p); }
    });
    const c = b.getCenter(new THREE.Vector3()), at = stack.matrix; // de toren hangt (nog) rechtstreeks in de kamer
    const q = stack.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(stack.quaternion); // de open kant (de rug zit aan -z)
    for (let y = b.min.y; y < b.max.y - 0.005; y += CD_PITCH) {
      if (ys.some((v) => Math.abs(v - y) < 0.003)) continue; // bezet
      cdSlots.push({ pos: new THREE.Vector3(c.x, y, c.z).applyMatrix4(at), q, front, cd: null });
    }
    cdSlots.reverse(); // het hoogste vrije vakje eerst
  }
  const CDS = stack ? ['aqua_aquarium', 'metallica_load', 'pearljam_ten', 'spicegirls_spice'].map((k) => get(`d90_cd_${k}`)).filter(Boolean).map((g) => ({
    g, inside: false, t: 1, slot: null,
    home: { pos: g.position.clone(), q: g.quaternion.clone() }, // de cd hangt in de kamer (of in een groep in rust op 0)
  })) : [];
  const cdOf = (o) => CDS.find((cd) => owner(o, [cd.g]));
  function toggleCd(cd) {
    if (cd.t < 1) return;
    if (!cd.inside) {
      cd.slot = cdSlots.find((s) => !s.cd);
      if (!cd.slot) return; // de toren is vol
      cd.slot.cd = cd;
      const slot = { pos: cd.slot.pos, q: cd.slot.q };
      const before = { pos: slot.pos.clone().addScaledVector(cd.slot.front, CD_IN), q: slot.q };
      const up = { pos: cd.home.pos.clone().setY(cd.home.pos.y + 0.12), q: cd.home.q };
      cd.path = [[cd.home, 0], [up, 0.3], [before, 0.55], [slot, 0.35]]; // optillen, voor het vakje, inschuiven
    } else {
      cd.path = cd.path.slice().reverse().map(([pt], i, arr) => [pt, i === 0 ? 0 : cd.path[arr.length - i][1]]);
      cd.slot.cd = null;
      cd.slot = null;
    }
    cd.total = cd.path.reduce((s, [, d]) => s + d, 0);
    cd.inside = !cd.inside;
    cd.t = 0;
  }

  // ---------------------------------------------------------------- de controller: physics en een live kabel
  // wat beweegt (of geen naam heeft: de live kabels) krijgt geen vaste botsvorm
  const MOVING = /^d90_(console|spelconsole|gamepad|tvmeubel_glasdeur|tvmeubel_knop|lavalamp|klok_|uplighter_dimmer_schuif|lamp_stekker|schakelaar_knop|cd_(?!toren|doosjes))|^Plane\d+$|^hlina/;
  const moving = [];
  r.traverse((o) => { if (o.isMesh && (!o.name || MOVING.test(o.name) || o.isMarchingCubes)) moving.push(o); });
  const padStore = STORE.find((st) => st.group === 'drop_gamepad');
  const pad = get('d90_gamepad') && get('d90_gamepad_kabel') && get('d90_gamepad_stekker') ? await createGamepad90({
    r, pad: get('d90_gamepad'), cable: get('d90_gamepad_kabel'), plug: get('d90_gamepad_stekker'), skip: moving,
    names: { floor: 'd90_vloer', wall: 'd90_muur', panel: 'd90_paneel', carpet: 'd90_tapijt' },
    shelf: get('d90_tvmeubel_bodem'),
  }) : null;
  if (padStore) padStore.pad = pad;

  function hit(raycaster) {
    const storeGroups = STORE.map((st) => r.getObjectByName(st.group));
    // een onzichtbaar klikvlak ter grootte van hun doos: de controller is klein en zijn kabel dun, je miste hem
    for (const g of storeGroups) {
      if (!g || g.userData.hitbox) continue;
      const b = restBox(g), size = b.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.06, 0.06, 0.06));
      const box = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }));
      box.position.copy(b.getCenter(new THREE.Vector3())); // in de assen van de groep: haar doos in rust
      box.userData.isHitbox = true;
      g.add(box);
      g.userData.hitbox = box;
    }
    // de cd's ook: plat op de vloer zijn ze amper 1 cm hoog
    for (const cd of CDS) {
      if (cd.g.userData.hitbox) continue;
      const b = new THREE.Box3();
      cd.g.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(m === cd.g ? new THREE.Matrix4() : m.matrix)); } });
      const size = b.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.03, 0.03, 0.03));
      const box = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }));
      box.position.copy(b.getCenter(new THREE.Vector3()));
      box.userData.isHitbox = true;
      cd.g.add(box);
      cd.g.userData.hitbox = box;
    }
    const h = raycaster.intersectObjects([...screens, ...posterMeshes, ...carpetMeshes, dimmer, slider, ...(cable?.objects ?? []),
      ...doors.flatMap((d) => d.parts.map((p) => p.o)), ...storeGroups, ...CDS.map((cd) => cd.g), ...lavaParts].filter(Boolean), true)[0];
    if (!h) return null;
    const cd = cdOf(h.object);
    if (cd) return { kind: 'cd', cd };
    if (lava && owner(h.object, lavaParts)) return { kind: 'lava' };
    const st = storeOf(h.object);
    if (st) return { kind: st === padStore && pad ? 'pad' : 'store', st, h };
    const door = doorOf(h.object);
    if (door) return { kind: 'door', door };
    if (cable?.owns(h.object)) return { kind: 'plug', h };
    if (owner(h.object, screens)) return { kind: 'screen', h };
    if (owner(h.object, posterMeshes)) return { kind: 'poster', h };
    if (owner(h.object, carpetMeshes)) return { kind: 'carpet', h };
    if (owner(h.object, [dimmer, slider])) return { kind: 'lamp' };
    return null;
  }

  let onScreen = false, onPoster = false, onCarpet = false, active = false, vol = null;
  return {
    group: r, tv, screens, level, lampLevel,
    /**
     * de meubels die binnenvallen (drop.js), in de volgorde waarin ze vallen: wat op iets anders staat, komt erna.
     * Elk meubel wordt een groep (in rust op 0: niets verschuift). De echte VHS-cassettes (BlenderKit, zonder
     * herkenbare naam) gaan mee met het meubel waar ze het dichtst bij liggen.
     */
    dropParts() {
      const PIECES = [
        ['bank', /^d90_bank/],
        ['tvmeubel', /^d90_tvmeubel|^d90_vhs_(rij|stapel|echt_\d)|^d90_videorecorder|^d90_vcr/],
        ['tv', /^d90_tv_trinitron/],
        ['lavalamp', /^d90_lavalamp/],
        ['salontafel', /^d90_salontafel|^d90_vhs_echt_tafel/],
        ['cdtoren', /^d90_cd_/],
        ['lamp', /^d90_uplighter|^d90_halogeen/],
        ['ficus', /^Plane\d+$|^hlina|^kvetinac|^d90_ficus/],
        ['console', /^d90_console|^d90_spelconsole|^d90_gamepad_stekker/], // de stekker van de controller zit in de PlayStation
        ['gamepad', /^d90_gamepad/],
      ];
      const groups = new Map(PIECES.map(([k]) => [k, []]));
      const loose = [];
      for (const o of [...r.children]) {
        const hit = PIECES.find(([, re]) => re.test(o.name));
        if (hit) groups.get(hit[0]).push(o);
        else if (/^vhs_/.test(o.name)) loose.push(o);
      }
      const centerOf = (objs) => objs.reduce((b, o) => b.expandByObject(o), new THREE.Box3()).getCenter(new THREE.Vector3());
      const homes = ['tvmeubel', 'salontafel'].map((k) => [k, centerOf(groups.get(k))]);
      for (const o of loose) {
        const c = centerOf([o]);
        homes.sort((a, b) => a[1].distanceTo(c) - b[1].distanceTo(c));
        groups.get(homes[0][0]).push(o);
      }
      const parts = PIECES.map(([k]) => {
        const grp = new THREE.Group();
        grp.name = `drop_${k}`;
        r.add(grp);
        for (const o of groups.get(k)) grp.add(o);
        return { objs: [grp] };
      }).filter((p) => p.objs[0].children.length);

      // de schaduw van wat valt, zoals in de jaren '80 (dropShadow.js): de schaduw zit in de bake, dus ze lag er al
      // terwijl het meubel nog boven zijn plek hing. Zolang het valt, tillen de vloer, het tapijt en zijn rand het
      // licht onder hem op tot dat ernaast; bij de landing komt de schaduw terug. Beide lichtlagen tellen mee.
      r.updateMatrixWorld(true);
      const floors = ['d90_vloer', 'd90_tapijt', 'd90_tapijt_rand'].map(get).filter(Boolean);
      const images = [tex.image, lampTex.image].filter((img) => img?.width > 1);
      const shadows = createDropShadows({ floors, images, uvSet: 'uv1', level: 2, flat: true });
      for (const p of parts) { p.shadow = shadows.add(p.objs); shadowOf.set(p.objs[0].name, p.shadow); }
      for (const cd of CDS) cd.shadow = shadows.add([cd.g], 0.08); // de gebakken schaduw onder elke losse cd
      const lightAt = (u, lod) => texture(tex, u).level(lod).rgb.mul(level)
        .add(texture(lampTex, u).level(lod).rgb.mul(lampLevel)).mul(BAKE_SCALE);
      for (const f of floors) {
        f.traverse((o) => {
          if (!o.isMesh) return;
          const lit = shadows.apply(light, o, lightAt, uv(1));
          if (carpetMeshes.includes(o)) o.material = new THREE.MeshBasicNodeMaterial({ colorNode: carpet.node.mul(lit).add(emit) });
          else {
            const m = o.userData.bakedFrom ?? o.material;
            const albedo = m.map ? texture(m.map, uv()).rgb.mul(m.color) : vec3(m.color.r, m.color.g, m.color.b);
            o.material = new THREE.MeshBasicNodeMaterial({ colorNode: albedo.mul(lit).add(emit) });
          }
        });
      }
      return parts;
    },
    /** de plekken waar iets te doen is (main.js zet er een oogje bij om op in te zoomen) */
    spots: {
      tv: [get('d90_tv_trinitron_mesh'), ...screens].filter(Boolean),
      poster: [get('d90_poster_papier')].filter(Boolean),
      lamp: (() => { const out = []; r.traverse((o) => { if (o.isMesh && /^d90_uplighter/.test(o.name)) out.push(o); }); return out; })(),
      socket: [get('d90_stopcontact_lamp')].filter(Boolean),
      carpet: carpetMeshes,
      // de cd-toren met de losse cd's ervoor: wat je in de toren kunt zetten, staat mee in beeld
      cds: [stack, get('d90_cd_toren'), ...CDS.map((cd) => cd.g)].filter(Boolean),
    },
    hover(raycaster) {
      const h = hit(raycaster);
      onScreen = h?.kind === 'screen';
      if (onScreen && h.h.uv) tv.glitch.uniforms.magnet.value.copy(h.h.uv);
      onPoster = h?.kind === 'poster';
      if (onPoster && h.h.uv) rug.mouse.value.copy(h.h.uv); // de uv van het papier is de positie op de poster
      onCarpet = h?.kind === 'carpet';
      if (onCarpet && h.h.uv) carpet.mouse.value.copy(h.h.uv);
      return h ? (h.kind === 'plug' || h.kind === 'pad' ? 'grab' : 'pointer') : '';
    },
    down(raycaster) {
      const h = hit(raycaster);
      if (!h) return false;
      if (h.kind === 'screen') tv.switchChannel(); // zappen: testbeeld, dan de uitzendingen
      else if (h.kind === 'poster') { rug.seed.value += 1 + Math.floor(Math.random() * 50); rug.pop.value = 1; } // nieuw patroon
      else if (h.kind === 'carpet') { carpet.seed.value += 1 + Math.random(); carpet.pop.value = 1; } // verschuiven, golfstoot
      else if (h.kind === 'lamp') lamp.on = !lamp.on;
      else if (h.kind === 'plug') cable.start(h.h, raycaster);
      else if (h.kind === 'door') h.door.target = h.door.target > 0.5 ? 0 : 1;
      else if (h.kind === 'store') toggleStore(h.st);
      else if (h.kind === 'pad') { if (h.st.t >= 1) pad.press(h.h, raycaster); } // klik: opbergen, slepen: gooien (zie up)
      else if (h.kind === 'cd') toggleCd(h.cd);
      else if (h.kind === 'lava') lava.toggle();
      return true;
    },
    leave() { onScreen = false; onPoster = false; onCarpet = false; },
    get grabbing() { return !!cable?.grabbing || !!pad?.grabbing; },
    move(raycaster) {
      cable?.move(raycaster);
      // de controller komt los: lag hij in het kastje, dan haal je hem eruit
      if (pad?.move(raycaster) && padStore.inside) { padStore.inside = false; openDoors(); }
    },
    up() {
      cable?.end();
      if (pad?.grabbing) {
        const click = pad.release();
        // een klik zet hem in of uit het kastje; losgelaten in het kastje: hij gaat op zijn plek op de stapel banden
        if (click || pad.inCabinet) toggleStore(padStore);
      }
    },
    startAudio() { tv.startAudio(); },
    /** de kamer staat vooraan (true) of is weggedraaid (false): geluid aan of uit */
    setActive(on) { active = on; },
    update(t, dt) {
      tv.update(t, dt, onScreen);
      if (rug) {
        rug.time.value = t;
        rug.hover.value += ((onPoster ? 1 : 0) - rug.hover.value) * (1 - Math.exp(-dt * 6)); // draait zacht mee
        rug.pop.value *= Math.exp(-dt * 7);
      }
      if (carpet) {
        carpet.time.value = t;
        carpet.hover.value += ((onCarpet ? 1 : 0) - carpet.hover.value) * (1 - Math.exp(-dt * 6)); // rimpelt zacht aan en uit
        carpet.pop.value *= Math.exp(-dt * 2.5);
      }
      if (active !== vol) { vol = active; tv.audio.setVolume(active ? 1 : 0); } // luider dan de oudere toestellen (0,6)
      // de halogeen: zacht aan (gloeidraad), snel uit; het schuifje schuift mee (aan = boven)
      cable?.update(dt);
      // deurtjes: een licht onderdempte veer, ze zwaaien een beetje door
      for (const d of doors) {
        d.v = (d.v ?? 0) + (60 * (d.target - d.open) - 9 * (d.v ?? 0)) * dt;
        d.open = THREE.MathUtils.clamp(d.open + d.v * dt, -0.05, 1.08);
        poseDoor(d);
      }
      // opbergen: eerst wachten tot de deurtjes ver genoeg open zijn, dan langs het pad
      for (const st of STORE) {
        if (st.t >= 1 || !st.g) continue;
        if (doors.some((d) => d.open < 0.6)) continue;
        st.t = Math.min(1, st.t + dt / st.total);
        alongPath(st, st.t);
      }
      // de controller: de physics (na het opbergen, zodat de kabel de groep in dezelfde frame volgt)
      if (pad) pad.tidy = padStore.inside; // in het kastje (of op weg ernaartoe): de kabel opgerold
      pad?.update(dt);
      // opgeborgen of los gegooid: zijn schaduw ligt niet meer op de vloer (elke frame, anders zet drop.js ze terug)
      for (const st of STORE) {
        const sh = shadowOf.get(st.group);
        const away = st.inside || !!st.pad?.free;
        if (!sh || (!away && st.t >= 1 && !st.wasAway)) continue;
        const e = st.t * st.t * (3 - 2 * st.t);
        sh(st.t >= 1 ? (away ? 0 : 1) : st.inside ? (st.fromLoose ? 0 : 1 - e) : e);
        st.wasAway = away || st.t < 1;
      }
      // de cd's naar of uit de toren
      for (const cd of CDS) {
        if (cd.t >= 1) continue;
        cd.t = Math.min(1, cd.t + dt / cd.total);
        alongPath(cd, cd.t);
        const e = cd.t * cd.t * (3 - 2 * cd.t);
        cd.shadow?.(cd.inside ? 1 - e : e); // weg van de vloer: zijn schaduw ook
      }
      lava?.update(dt, active);
      const lampOn = lamp.on && lamp.plugged; // de knop aan én de stekker erin
      lamp.smooth += ((lampOn ? 1 : 0) - lamp.smooth) * (1 - Math.exp(-dt * (lampOn ? 6 : 14)));
      lampLevel.value = lamp.smooth;
      if (slider) slider.position.y = lamp.y0 - 0.025 * (1 - lamp.smooth);
      // de klok op de echte tijd: met de klok mee is negatief rond +z (je kijkt van voren)
      const now = new Date();
      const sec = now.getSeconds() + now.getMilliseconds() / 1000, min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
      const turns = { uur: hr / 12, minuut: min / 60, seconde: sec / 60 };
      for (const hd of hands) {
        const target = Math.PI / 2 - 2 * Math.PI * turns[hd.k]; // 12 uur = recht omhoog
        hd.o.quaternion.copy(_qz.setFromAxisAngle(Z, target - hd.a0)).multiply(hd.q0);
      }
    },
    render(renderer, visible) {
      if (visible) tv.render(renderer);
    },
  };
}
