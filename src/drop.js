import * as THREE from 'three/webgpu';

/**
 * Meubels die binnenvallen: bij het laden valt elk meubel van boven op zijn plek, één voor één.
 * Echte zwaartekracht (steeds sneller), een beetje scheef in de lucht zodat één rand eerst de grond raakt,
 * dan klapt de andere kant neer en wiegt het nog even na. Bij de klap zakt het meubel heel even in
 * (squash) en stuit het een paar keer kort, zoals iets zwaars dat neergeploft wordt.
 *
 * parts: [{ objs, extra?, follow? }] in de volgorde waarin ze vallen
 *  - objs: objecten die zelf vallen (hun matrix wordt tijdens de val hier gezet, niemand anders mag ze bewegen)
 *  - extra: objecten die enkel mee verschijnen (hun positie wordt elders gezet, bv. door de physics)
 *  - follow(offset): voor wat mee moet zakken maar elke frame elders gezet wordt (afstandsbediening, kabels)
 *  - shadow(k): zijn schaduw op de vloer (dropShadow.js): 0 = nog niet te zien of hoog, 1 = geland
 * Iets dat op een ander meubel staat, komt er best na in de lijst: het valt later, dus nooit erdoor.
 */
const HEIGHT = 1.1;   // m: zo hoog boven zijn plek begint elk meubel
const G = 9.81;       // m/s²
const FALL = Math.sqrt(2 * HEIGHT / G); // s: duur van de val (≈ 0,47 s)
const BOUNCE = 0.22;  // hoeveel snelheid er na een klap overblijft (zware meubels stuiten nauwelijks)
const BOUNCES = 2;
const GAP = 0.2;      // s: tussen twee meubels
const TILT = THREE.MathUtils.degToRad(6); // zo scheef hangt een meubel in de lucht…
const TILT_LIFT = 0.07; // m: …maar de hoge rand komt nooit meer dan dit boven de lage uit
const ROCK = 18;      // rad/s: hoe snel de andere kant neerklapt en het meubel nawiegt
const ROCK_DAMP = 6.5;
const SQUASH = 0.035; // hoeveel een meubel inzakt bij de klap
const STRETCH = 0.015; // en hoeveel langer het wordt terwijl het valt

// de stuiten na de eerste klap: [begin, duur, beginsnelheid]
const HOPS = [];
let SETTLE = FALL;
for (let i = 0, v = BOUNCE * G * FALL; i < BOUNCES; i++, v *= BOUNCE) {
  HOPS.push([SETTLE, 2 * v / G, v]);
  SETTLE += 2 * v / G;
}
SETTLE = Math.max(SETTLE, FALL + 0.9); // wiegen en squash moeten ook uitgedempt zijn

/** hoogte boven de plek, s seconden na de start van dit meubel */
function offset(s) {
  if (s < 0) return HEIGHT;
  if (s < FALL) return HEIGHT - 0.5 * G * s * s;
  for (const [start, dur, v] of HOPS) {
    const u = s - start;
    if (u >= 0 && u < dur) return v * u - 0.5 * G * u * u;
  }
  return 0;
}

/** de klappen: [tijdstip, kracht 0..1] */
const IMPACTS = [[FALL, 1], ...HOPS.map(([start, dur, v]) => [start + dur, v / (G * FALL)])];

// een vast, maar per meubel verschillend getal tussen 0 en 1 (zodat elke keer hetzelfde gebeurt)
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Matrix4(), _t = new THREE.Matrix4();
const _axis = new THREE.Vector3();

export function createDrop(parts) {
  const items = parts.map((p, i) => {
    const a = hash(i) * Math.PI * 2;
    return {
      objs: p.objs.filter(Boolean),
      extra: (p.extra ?? []).filter(Boolean),
      follow: p.follow,
      shadow: p.shadow,
      delay: i * GAP,
      axis: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), // rond deze horizontale as hangt het scheef
      sign: hash(i + 17) < 0.5 ? -1 : 1,
    };
  });
  const end = (items.length - 1) * GAP + SETTLE;
  let t = null;     // s sinds de start; null: nog niet gestart
  let t0 = 0;       // klok bij de start: op de klok, niet per frame, zodat het ook bij haperende frames vlot valt

  // waar en hoe groot elk meubel in rust is: daaromheen kantelt en zakt het
  function measure(item) {
    const box = new THREE.Box3();
    for (const o of item.objs) { o.updateWorldMatrix(true, true); box.expandByObject(o); }
    if (box.isEmpty()) { item.objs = []; return; }
    const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    item.base = new THREE.Vector3(c.x, box.min.y, c.z);
    // de richting die omhoog gaat als het meubel rond zijn as kantelt, en hoe ver de rand in die richting ligt
    item.dir = new THREE.Vector3(item.axis.z, 0, -item.axis.x);
    item.reach = Math.abs(item.dir.x) * h.x + Math.abs(item.dir.z) * h.z;
    item.tilt = item.sign * Math.min(TILT, Math.atan(TILT_LIFT / Math.max(2 * item.reach, 1e-3)));
    item.weight = Math.min(1, Math.cbrt(8 * h.x * h.y * h.z) / 1.2); // een zetel bonkt harder dan een cassette
    item.rest = item.objs.map((o) => ({
      world: o.matrixWorld.clone(),
      parentInv: o.parent ? o.parent.matrixWorld.clone().invert() : new THREE.Matrix4(),
    }));
  }

  const show = (item, on) => { for (const o of [...item.objs, ...item.extra]) o.visible = on; };

  // de wereldmatrix van het meubel: omhoog met off, gekanteld rond de lage rand, ingezakt rond de voet
  function place(item, off, angle, sy) {
    const p = item.base;
    // kantelen rond de rand die het laagst hangt (wisselt van kant als het nawiegt)
    const edge = _axis.copy(item.dir).multiplyScalar(-Math.sign(angle) * item.reach).add(p);
    _r.makeTranslation(edge.x, edge.y, edge.z)
      .multiply(_m.makeRotationAxis(item.axis, angle))
      .multiply(_t.makeTranslation(-edge.x, -edge.y, -edge.z));
    const sxz = 1 / Math.sqrt(sy); // het volume blijft gelijk: wat inzakt, wordt breder
    _s.makeTranslation(p.x, p.y, p.z)
      .multiply(_m.makeScale(sxz, sy, sxz))
      .multiply(_t.makeTranslation(-p.x, -p.y, -p.z));
    _r.premultiply(_t.makeTranslation(0, off, 0)).multiply(_s);
    item.objs.forEach((o, j) => {
      const { world, parentInv } = item.rest[j];
      o.matrix.copy(parentInv).multiply(_r).multiply(world);
      o.matrixWorldNeedsUpdate = true;
    });
  }

  function pose(item) {
    const s = t - item.delay;
    show(item, s >= 0);
    const off = offset(s);
    item.follow?.(off);
    item.shadow?.(s < 0 ? 0 : 1 - Math.min(1, off / HEIGHT)); // hoe dichter bij de grond, hoe donkerder de schaduw
    if (!item.objs.length) return;
    if (s >= SETTLE) { // in rust: terug naar de gewone positie
      if (!item.done) for (const o of item.objs) { o.matrixAutoUpdate = true; o.updateMatrix(); o.matrixWorldNeedsUpdate = true; }
      item.done = true;
      return;
    }
    item.done = false;
    for (const o of item.objs) o.matrixAutoUpdate = false;
    let angle, sy;
    if (s < FALL) {
      const u = Math.max(0, s) / FALL;
      angle = item.tilt * (0.7 + 0.3 * u); // kantelt een beetje verder terwijl het valt
      sy = 1 + STRETCH * u;
    } else {
      const u = s - FALL; // na de eerste klap: de hoge kant klapt neer, wiegt over naar de andere kant en komt tot rust
      angle = item.tilt * Math.exp(-ROCK_DAMP * u) * Math.cos(ROCK * u);
      sy = 1;
      for (const [at, k] of IMPACTS) { // elke klap duwt het meubel even in, en het veert terug
        const v = s - at;
        if (v >= 0) sy -= SQUASH * k * Math.exp(-14 * v) * Math.cos(32 * v);
      }
    }
    place(item, off, angle, sy);
  }

  return {
    /** begint na `wait` seconden; tot dan is alles weg */
    start(wait = 0) {
      for (const item of items) measure(item);
      t = -wait;
      t0 = performance.now() / 1000 + wait;
      for (const item of items) pose(item);
    },
    /** bezig met vallen (gestart en nog niet alles geland) */
    get busy() { return t !== null && t < end; },
    /** hoe hard het nu nadreunt van wat net neerkwam (0..±1): voor een klein schokje van de camera */
    get thud() {
      if (t === null || t >= end) return 0;
      let sum = 0;
      for (const item of items) {
        if (!item.weight) continue;
        for (const [at, k] of IMPACTS) {
          const v = t - item.delay - at;
          if (v >= 0 && v < 0.4) sum += item.weight * k * Math.exp(-11 * v) * Math.sin(55 * v + 1.2);
        }
      }
      return sum;
    },
    update() {
      if (t === null || t >= end) return;
      t = Math.min(end, performance.now() / 1000 - t0);
      for (const item of items) pose(item);
    },
  };
}
