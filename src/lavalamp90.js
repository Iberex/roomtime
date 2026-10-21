/**
 * De lavalamp in de jaren '90: echte bewegende was in plaats van de vaste klodders uit Blender.
 *  - de was is een veld van metaballen (MarchingCubes van three): klodders die samensmelten en weer loslaten.
 *  - zoals een echte lavalamp: het lampje in de voet verwarmt de was onderaan, warme was stijgt, koelt boven af
 *    en zakt terug. Elke klodder heeft een eigen temperatuur, dus ze gaan elk op hun eigen moment.
 *  - klik op de lamp: aan of uit. Aan warmt ze langzaam op voor er iets loskomt; uit zakt alles terug in de
 *    plas op de bodem en dooft de gloed.
 *
 * De lamp staat als een groep in de kamer (r); de was komt erbij als 'd90_lavalamp_lava', zodat ze mee
 * binnenvalt (drop.js).
 */
import * as THREE from 'three/webgpu';
import { normalView, uniform, vec3 } from 'three/tsl';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

const RES = 40;          // cellen per as
const BLOBS = 7;
const WAX = new THREE.Color(0xff3a14);    // de kleur van de was in Blender
const LIQUID = new THREE.Color(0xffc56a); // de vloeistof eromheen, warm geel als de lamp brandt
const WARM_UP = 4;       // s: zo lang duurt het opwarmen (een echte doet er een half uur over)

/**
 * @param {Object3D} r     - de kamer
 * @param {Object3D} glass - het glas van de lamp (de vorm: hoe breed de fles op elke hoogte is)
 * @param {Object3D} wax   - de vaste was uit Blender: verdwijnt, haar hoogte is die van de vloeistof
 * @param {Node}     level - het licht van de kamer (0..1)
 */
export function createLavaLamp({ r, glass, wax, level }) {
  r.updateMatrixWorld(true);
  const toR = r.matrixWorld.clone().invert();
  const at = (o) => new THREE.Matrix4().multiplyMatrices(toR, o.matrixWorld);

  // ---------------------------------------------------------------- de vorm van de fles
  // de straal van het glas op elke hoogte (in vakjes), gemeten aan zijn hoekpunten rond de as
  const gBox = new THREE.Box3().setFromBufferAttribute(glass.geometry.attributes.position).applyMatrix4(at(glass));
  const wBox = new THREE.Box3().setFromBufferAttribute(wax.geometry.attributes.position).applyMatrix4(at(wax));
  const axis = gBox.getCenter(new THREE.Vector3());
  const y0 = wBox.min.y, y1 = wBox.max.y; // de vloeistof
  const BINS = 24, prof = new Float32Array(BINS);
  const gm = at(glass), pos = glass.geometry.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(gm);
    const b = Math.floor(((p.y - y0) / (y1 - y0)) * BINS);
    if (b >= 0 && b < BINS) prof[b] = Math.max(prof[b], Math.hypot(p.x - axis.x, p.z - axis.z));
  }
  for (let i = 0; i < BINS; i++) if (!prof[i]) prof[i] = prof[i - 1] || Math.max(gBox.max.x - axis.x, 0.05); // lege vakjes
  const WALL = 0.88; // de binnenkant van het glas
  const radiusAt = (y) => {
    const f = THREE.MathUtils.clamp(((y - y0) / (y1 - y0)) * BINS - 0.5, 0, BINS - 1), i = Math.floor(f), k = f - i;
    return WALL * (prof[i] * (1 - k) + prof[Math.min(BINS - 1, i + 1)] * k);
  };
  const R = Math.max(...prof) * WALL;

  // ---------------------------------------------------------------- materiaal
  const glow = uniform(1); // 0 = uit en koud, 1 = aan en warm
  // de was geeft zelf licht als de lamp brandt (van onder beschenen), anders enkel wat kamerlicht; de kant naar
  // je toe is lichter, zo zie je de bolling
  const facing = normalView.z.abs().mul(0.55).add(0.45);
  const waxMat = new THREE.MeshBasicNodeMaterial({
    colorNode: vec3(WAX.r, WAX.g, WAX.b).mul(facing).mul(level.mul(0.35).add(glow.mul(1.1)).add(0.04)),
    side: THREE.DoubleSide,
  });
  const liquidMat = new THREE.MeshBasicNodeMaterial({
    colorNode: vec3(LIQUID.r, LIQUID.g, LIQUID.b).mul(level.mul(0.75).add(glow.mul(0.9))),
    transparent: true, opacity: 0.22, depthWrite: false,
  });
  glass.material = liquidMat;

  // ---------------------------------------------------------------- het veld
  // het rooster ligt rond de vloeistof, met twee lege vakjes rand (MarchingCubes sluit de rand niet af)
  const mc = new MarchingCubes(RES, waxMat, false, false, 30000);
  mc.name = 'd90_lavalamp_lava';
  mc.isolation = 1;
  mc.frustumCulled = false;
  mc.raycast = () => {};
  const pad = RES / (RES - 6);
  mc.scale.set(R * pad, ((y1 - y0) / 2) * pad, R * pad);
  mc.position.set(axis.x, (y0 + y1) / 2, axis.z);
  r.add(mc);
  wax.visible = false;
  // de echte positie van elk vakje (in m, ten opzichte van de as)
  const cell = (i, s) => ((i - RES / 2) / (RES / 2)) * s;
  const cx = Float32Array.from({ length: RES }, (_, i) => cell(i, mc.scale.x));
  const cy = Float32Array.from({ length: RES }, (_, i) => cell(i, mc.scale.y) + mc.position.y);
  const cz = Float32Array.from({ length: RES }, (_, i) => cell(i, mc.scale.z));
  const rad = Float32Array.from(cy, (y) => (y < y0 || y > y1 ? 0 : radiusAt(y)));

  // ---------------------------------------------------------------- de klodders
  const H = y1 - y0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const blobs = Array.from({ length: BLOBS }, (_, i) => ({
    r: rnd(0.022, 0.034),
    y: y0 + rnd(0.05, 0.8) * H,
    vy: 0,
    temp: rnd(0.2, 0.9),
    a: (i / BLOBS) * Math.PI * 2, // waar rond de as hij drijft
    spin: rnd(0.05, 0.15) * (Math.random() < 0.5 ? -1 : 1),
    off: rnd(0, 0.55),            // hoe ver van de as (deel van de vrije ruimte)
    ph: rnd(0, 10),
    x: 0, z: 0, s: 1,
  }));
  const POOL = 0.028; // m: zo dik is de plas op de bodem

  let on = true, warm = 1, time = 0;

  function simulate(dt) {
    time += dt;
    warm += ((on ? 1 : 0) - warm) * (1 - Math.exp(-dt / WARM_UP));
    for (const b of blobs) {
      const h = (b.y - y0) / H; // 0 onderaan, 1 bovenaan
      // onderaan verwarmt het lampje, overal koelt hij wat af, bovenaan veel
      b.temp += dt * (warm * 0.45 * Math.max(0, 1 - h / 0.18) - 0.035 - 0.3 * Math.max(0, (h - 0.82) / 0.18));
      b.temp = THREE.MathUtils.clamp(b.temp, 0, 1);
      // warm stijgt, koud zakt; traag, zoals in olie
      const want = (b.temp - 0.45) * 0.13 * (0.3 + 0.7 * warm);
      b.vy += (want - b.vy) * (1 - Math.exp(-dt * 1.5));
      b.y += b.vy * dt;
      const lo = y0 + POOL * 0.4, hi = y1 - b.r * 0.9;
      if (b.y < lo) { b.y = lo; b.vy = Math.max(0, b.vy); }
      if (b.y > hi) { b.y = hi; b.vy = Math.min(0, b.vy); }
      // langzaam rond de as drijven, binnen het glas
      b.a += b.spin * dt * warm;
      const room = Math.max(0, radiusAt(b.y) - b.r);
      const d = room * (b.off + 0.15 * Math.sin(time * 0.3 + b.ph));
      b.x = Math.cos(b.a) * d; b.z = Math.sin(b.a) * d;
      b.s = 1 + Math.min(0.8, Math.abs(b.vy) * 9); // in beweging rekt hij uit
    }
  }

  function fill() {
    const f = mc.field, S = RES, S2 = RES * RES;
    mc.normal_cache.fill(0);
    for (let k = 0; k < S; k++) {
      const z = cz[k];
      for (let j = 0; j < S; j++) {
        const y = cy[j], rmax = rad[j], row = k * S2 + j * S;
        if (!rmax) { f.fill(0, row, row + S); continue; }
        // de plas: dik onderaan, dunner als de was warm is (er is dan meer weggedreven)
        const above = y - y0 + 0.002, pool = (POOL * (1 - 0.35 * warm)) / above;
        const base = pool * pool;
        for (let i = 0; i < S; i++) {
          const x = cx[i];
          if (x * x + z * z > rmax * rmax) { f[row + i] = 0; continue; }
          let v = base;
          for (const b of blobs) {
            const dx = x - b.x, dy = (y - b.y) / b.s, dz = z - b.z;
            v += (b.r * b.r) / (dx * dx + dy * dy + dz * dz + 1e-6);
          }
          f[row + i] = Math.min(v, 8);
        }
      }
    }
    mc.update();
    // MarchingCubes houdt zijn aantal hoekpunten bij in `count`, maar de WebGPU-renderer leest `count` als het
    // aantal instanties: dan tekent hij de was duizenden keren. Het echte aantal staat al in de drawRange.
    mc.count = 1;
  }

  // het eerste beeld: al even aan het borrelen
  for (let i = 0; i < 300; i++) simulate(1 / 30);
  fill();

  return {
    mesh: mc,
    get on() { return on; },
    toggle() { on = !on; },
    /** `visible`: de kamer is te zien (anders enkel verder rekenen, niet opnieuw vormen) */
    update(dt, visible) {
      simulate(Math.min(dt, 1 / 20));
      glow.value = warm;
      if (visible) fill();
    },
  };
}
