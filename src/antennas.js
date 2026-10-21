import * as THREE from 'three/webgpu';

/**
 * De konijnenoren op de tv van de jaren '70: twee chromen sprieten die je kunt vastpakken en draaien.
 * Elke zender komt binnen uit een andere hoek: staan de sprieten er niet goed voor, dan sneeuwt
 * het beeld, komt er een spookbeeld naast, verdwijnt de kleur en ruist het geluid (glitch.wgsl, tvAudio.js).
 * Zoals vroeger: als je een spriet vasthoudt, is de ontvangst net iets beter (je lichaam is ook een antenne).
 *
 * In het model zitten de sprieten in het chroom van de tv-kast. Hier worden ze eruit geknipt: elk stuk
 * chroom dat hoog boven de kast uitsteekt, wordt een eigen mesh die rond zijn voet draait.
 *
 *  - tv: de tv-groep (d70_tv); de sprieten worden er kinderen van, dus ze vallen mee binnen (drop.js)
 *  - channels: aantal zenders, testbeeld meegeteld
 */
const GOOD = Math.cos(THREE.MathUtils.degToRad(7));    // zo dicht bij de goede hoek: helder beeld
const BAD = Math.cos(THREE.MathUtils.degToRad(30));    // zo ver ervan: enkel nog sneeuw (van deze spriet)
const TOUCH = 0.8; // vastgehouden: zoveel van de ruis blijft over
const PHI_MIN = THREE.MathUtils.degToRad(6);   // zo plat kan een spriet liggen (lager raakt hij de kast)
const PHI_MAX = THREE.MathUtils.degToRad(165); // en zo ver naar binnen kan hij leunen

// Elke spriet kantelt enkel omhoog en omlaag, in het verticale vlak van de tv (hoek φ vanaf de buitenkant).
// De beginstand is de goede stand voor alle zenders: pas als je een spriet verzet, krijgt het beeld sneeuw.

// gesplitst in de mesh-onderdelen die samenhangen (gelaste hoekpunten): [driehoek-indices]
function components(geo) {
  const pos = geo.attributes.position, idx = geo.index.array;
  const ids = new Map(), rep = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    if (!ids.has(k)) ids.set(k, i);
    rep[i] = ids.get(k);
  }
  const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(rep[idx[t]]);
    parent[find(rep[idx[t + 1]])] = a;
    parent[find(rep[idx[t + 2]])] = a;
  }
  const out = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(rep[idx[t]]);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(t);
  }
  return [...out.values()];
}

// een nieuwe geometrie met enkel deze driehoeken (alle attributen mee)
function extract(geo, tris) {
  const map = new Map(), index = [];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = geo.index.array[t + k];
    if (!map.has(v)) map.set(v, map.size);
    index.push(map.get(v));
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = new THREE.BufferAttribute(new attr.array.constructor(map.size * attr.itemSize), attr.itemSize, attr.normalized);
    for (const [from, to] of map) for (let c = 0; c < attr.itemSize; c++) a.setComponent(to, c, attr.getComponent(from, c));
    out.setAttribute(name, a);
  }
  out.setIndex(index);
  return out;
}

// een uitschuifbare spriet: drie stukken die naar de top toe dunner worden, met een kogelscharnier onderaan
// en een knopje op de top. De uv's gaan allemaal naar het middelpunt van de oude cilinder (zelfde bake).
const SECTIONS = [[0.5, 0.0085], [0.8, 0.0065], [1, 0.0046]]; // [tot welk deel van de lengte, straal]
function telescope(old, axis, length, scale = 1) {
  const uv = old?.attributes.uv, mid = new THREE.Vector2();
  if (uv) {
    for (let i = 0; i < uv.count; i++) mid.add(new THREE.Vector2().fromBufferAttribute(uv, i));
    mid.divideScalar(uv.count);
  }
  const pts = [], R = 0.0165 * scale, K = 0.0105 * scale, e = 1e-4;
  const arc = (c, r, from, to, n) => { for (let i = 0; i <= n; i++) { const a = from + (to - from) * i / n; pts.push(new THREE.Vector2(Math.max(r * Math.sin(a), 1e-5), c + r * Math.cos(a))); } };
  arc(0, R, Math.PI, Math.PI / 2 + 0.55, 6);   // kogel onderaan, tot waar het eerste stuk eruit komt
  let t = 0;
  for (const [end, radius] of SECTIONS) {
    const r = radius * scale, to = end * length - (end < 1 ? 0 : K * 0.8);
    pts.push(new THREE.Vector2(r, Math.max(t, R * 0.45)), new THREE.Vector2(r, to - 0.012 * scale));
    if (end < 1) { // een ring waar het volgende stuk uitschuift
      const w = 0.0035 * scale, h = 0.004 * scale;
      pts.push(new THREE.Vector2(r + w, to - 0.012 * scale + e), new THREE.Vector2(r + w, to + h), new THREE.Vector2(r, to + h + e));
    }
    t = to;
  }
  arc(length - K * 0.8 + K * 0.2, K, Math.PI / 2 + 0.1, 0, 8); // knopje op de top
  const g = new THREE.LatheGeometry(pts, 20);
  for (let i = 0; i < g.attributes.uv.count; i++) g.attributes.uv.setXY(i, mid.x, mid.y);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis));
  return g;
}

const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();

/**
 * @param {Object3D} tv      - de tv-groep; de sprieten worden er kinderen van
 * @param {Box3}     [box]   - zonder model-sprieten (de jaren '80): de doos van de kast in de assen van `tv`;
 *                             er komen twee sprieten bovenop, in verhouding met de breedte
 * @param {Material} [material] - materiaal voor de sprieten (standaard dat van het chroom in het model)
 */
export function createAntennas({ tv, box, material }) {
  tv.updateMatrixWorld(true);
  const height = box ? 0 : new THREE.Box3().setFromObject(tv).max.y - tv.getWorldPosition(_v).y;
  const rods = [];
  if (box) {
    const w = box.max.x - box.min.x, scale = w / 0.82; // de tv van de jaren '70 is 0,82 m breed
    for (const side of [-1, 1]) {
      const phi = THREE.MathUtils.degToRad(58), axis = new THREE.Vector3(side * Math.cos(phi), Math.sin(phi), 0);
      const rod = new THREE.Mesh(telescope(null, axis, 0.6 * scale, scale), material);
      rod.name = `${tv.name || 'tv'}_antenne_${rods.length + 1}`;
      rod.position.set((box.min.x + box.max.x) / 2 + side * 0.04 * w, box.max.y, (box.min.z + box.max.z) / 2);
      rod.userData.noCollide = true;
      tv.add(rod);
      rods.push({ mesh: rod, rest: axis, dir: axis.clone(), target: axis.clone() });
    }
  }
  for (const mesh of box ? [] : [...tv.children]) {
    if (!mesh.isMesh || !mesh.geometry.index) continue;
    const parts = components(mesh.geometry);
    const keep = [];
    for (const tris of parts) {
      const g = extract(mesh.geometry, tris);
      g.computeBoundingBox();
      const b = g.boundingBox;
      // een spriet: steekt ver boven de kast uit (de kast zelf begint lager dan de helft van de hoogte)
      if (b.min.y < height * 0.5 || b.max.y - b.min.y < 0.2) { keep.push(...tris); continue; }
      // de voet: het midden van de laagste punten; de top: het punt het verst daarvandaan
      const pos = g.attributes.position, foot = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < b.min.y + 0.01) { foot.add(_v.fromBufferAttribute(pos, i)); n++; }
      foot.divideScalar(n);
      let length = 0;
      const tip = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const d = _v.fromBufferAttribute(pos, i).distanceTo(foot);
        if (d > length) { length = d; tip.copy(_v); }
      }
      g.translate(-foot.x, -foot.y, -foot.z);
      const axis = tip.clone().sub(foot).normalize();
      // de losse cilinder uit het model vervangen door een mooiere spriet (zelfde materiaal en uv)
      const rod = new THREE.Mesh(telescope(g, axis, length), material ?? mesh.material);
      rod.name = `${tv.name}_antenne_${rods.length + 1}`;
      rod.position.copy(foot); // in de assen van de tv
      rod.userData.noCollide = true; // beweegt: geen vaste botsvorm in de physics
      tv.add(rod);
      rods.push({ mesh: rod, rest: axis, dir: axis.clone(), target: axis.clone() });
    }
    if (keep.length === parts.reduce((s, p) => s + p.length, 0)) continue; // niets uitgeknipt
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.setIndex(keep.flatMap((t) => [0, 1, 2].map((k) => mesh.geometry.index.array[t + k])));
  }
  // links/rechts sorteren, zodat de zenders altijd dezelfde spriet bedoelen
  rods.sort((a, b) => a.mesh.position.x - b.mesh.position.x);
  // elke spriet beweegt in het vlak van de tv: richting = (± cos φ, sin φ, 0), ± naar de kant waar hij al staat
  for (const rod of rods) {
    rod.side = Math.sign(rod.rest.x) || 1;
    rod.phi = Math.atan2(rod.rest.y, Math.abs(rod.rest.x));
  }
  const dirAt = (rod, phi) => new THREE.Vector3(rod.side * Math.cos(phi), Math.sin(phi), 0);
  const clampPhi = (phi) => THREE.MathUtils.clamp(phi, PHI_MIN, PHI_MAX);
  const goal = rods.map((rod) => dirAt(rod, clampPhi(rod.phi))); // de stand waarmee ze geladen worden

  const grab = { rod: null };
  let noise = 0, flutter = 0;
  const plane = new THREE.Plane(), normal = new THREE.Vector3();

  return {
    rods: rods.map((r) => r.mesh),
    /** hoort dit object bij een spriet? */
    owns(o) { return rods.some((r) => r.mesh === o); },
    get grabbing() { return !!grab.rod; },
    start(o) { grab.rod = rods.find((r) => r.mesh === o) ?? null; },
    /** de spriet volgt de muis, omhoog en omlaag, in het verticale vlak van de tv */
    move(raycaster) {
      const rod = grab.rod;
      if (!rod) return;
      tv.updateWorldMatrix(true, false);
      normal.set(0, 0, 1).transformDirection(tv.matrixWorld);
      rod.mesh.getWorldPosition(_c);
      plane.setFromNormalAndCoplanarPoint(normal, _c);
      if (!raycaster.ray.intersectPlane(plane, _v)) return;
      tv.worldToLocal(_v).sub(rod.mesh.position);
      rod.target.copy(dirAt(rod, clampPhi(Math.atan2(_v.y, rod.side * _v.x))));
    },
    end() { grab.rod = null; },
    /** 0 = helder beeld … 1 = enkel sneeuw, voor zender `channel` (0 = testbeeld) */
    get noise() { return noise; },
    update(dt, t, channel) {
      for (const rod of rods) {
        rod.dir.lerp(rod.target, 1 - Math.exp(-dt * 22)).normalize();
        rod.mesh.quaternion.setFromUnitVectors(rod.rest, rod.dir);
      }
      let signal = 0;
      rods.forEach((rod, i) => {
        const k = THREE.MathUtils.clamp((rod.dir.dot(goal[i]) - BAD) / (GOOD - BAD), 0, 1);
        signal += k * k * (3 - 2 * k) / rods.length;
      });
      // het signaal schommelt wat, des te meer naarmate het zwakker is
      flutter = 0.5 * Math.sin(t * 2.3) + 0.3 * Math.sin(t * 5.7 + 1) + 0.2 * Math.sin(t * 13.1 + 2);
      const target = THREE.MathUtils.clamp((1 - signal) * (1 + 0.12 * flutter) * (grab.rod ? TOUCH : 1), 0, 1);
      noise += (target - noise) * (1 - Math.exp(-dt * 10));
    },
  };
}
