/**
 * Alles in de kamer waar je aan kunt zitten:
 *  - de afstandsbediening en de twee stekkers zijn physics-objecten (Rapier): vastpakken, slepen, gooien,
 *    ook van het diorama af (dan komen ze na een tijdje terug op hun plek)
 *  - een stekker uit het stopcontact trekken = stroom weg (lamp of tv). Leg hem terug tegen het
 *    stopcontact en hij klikt er weer in. De kabels zijn live touwen (verlet) met zwaartekracht.
 *  - de lichtschakelaar aan de muur schakelt het kamerlicht, het knopje op de lamp de staande lamp
 *    (die brandt als haar stekker erin zit en het knopje aan staat)
 */
import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';

const STEP = 1 / 120; // fijne stappen: snelle worpen schieten niet door dunne vlakken
const PLUG_PULL = 0.04;   // zo ver (m) trekken voor de stekker loskomt
const PLUG_MAGNET = 0.15; // binnen deze afstand trekt het stopcontact de stekker aan als een magneet
const PLUG_SNAP_TIME = 0.22; // s: zo lang glijdt de stekker erin
const FALL_LIMIT = -3;    // lager dan dit: van de map gevallen -> terug op zijn plek

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

export async function createInteractions({ root, scene, onRoom, onLamp, onTv }) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  root.updateMatrixWorld(true);
  const get = (name) => root.getObjectByName(name);

  const remote = get('d70_afstandsbediening');
  const plugs = {
    lamp: { obj: get('d70_lamp_stekker'), cable: get('d70_lamp_kabel') },
    tv: { obj: get('d70_tv_stekker'), cable: get('d70_tv_kabel') },
  };
  const dynamicRoots = new Set([remote, plugs.lamp.obj, plugs.tv.obj]);
  const cables = new Set([plugs.lamp.cable, plugs.tv.cable]);
  const inside = (o, set) => { for (let p = o; p; p = p.parent) if (set.has(p)) return true; return false; };

  // ---------------------------------------------------------------- vaste kamer
  // vloer en muur als massieve blokken (een trimesh is een dun vel waar een worp door kan schieten),
  // de rest als trimesh
  const solid = new Set(['d70_vloer', 'd70_muur'].map(get));
  for (const o of solid) {
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    world.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(c.x, c.y, c.z).setFriction(0.8));
  }
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noCollide || inside(o, dynamicRoots) || inside(o, cables) || inside(o, solid)) return;
    const pos = o.geometry.attributes.position;
    const verts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).toArray(verts, i * 3);
    }
    const idx = o.geometry.index ? new Uint32Array(o.geometry.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8));
  });
  for (const c of cables) { c.visible = false; c.traverse((m) => { m.raycast = () => {}; }); } // worden live touwen

  const boxOf = (name) => new THREE.Box3().setFromObject(get(name));
  const floorTop = boxOf('d70_vloer').max.y;
  const carpet = boxOf('d70_tapijt');
  const wallFront = boxOf('d70_paneel').max.z;
  const floorBox = boxOf('d70_vloer');
  const groundAt = (x, z) => {
    if (x < floorBox.min.x || x > floorBox.max.x || z < floorBox.min.z || z > floorBox.max.z) return -Infinity;
    return x > carpet.min.x && x < carpet.max.x && z > carpet.min.z && z < carpet.max.z ? carpet.max.y : floorTop;
  };

  // ---------------------------------------------------------------- losse objecten: convex hull
  function makeItem(obj, { kinematic = false } = {}) {
    scene.attach(obj); // wereldtransform behouden, los van de ouder (zetel / diorama)
    obj.updateMatrixWorld(true);
    obj.matrixWorld.decompose(_v, _q, _s);
    const home = { p: _v.clone(), q: _q.clone() };
    const inv = obj.matrixWorld.clone().invert();
    const pts = [];
    obj.traverse((m) => {
      if (!m.isMesh) return;
      _m.multiplyMatrices(inv, m.matrixWorld);
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        _w.fromBufferAttribute(pos, i).applyMatrix4(_m).multiply(_s);
        pts.push(_w.x, _w.y, _w.z);
      }
    });
    const desc = (kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(home.p.x, home.p.y, home.p.z)
      .setRotation(home.q)
      .setCcdEnabled(true)
      .setLinearDamping(0.08)
      .setAngularDamping(0.4);
    const body = world.createRigidBody(desc);
    world.createCollider(
      RAPIER.ColliderDesc.convexHull(new Float32Array(pts)).setDensity(900).setFriction(0.7).setRestitution(0.3),
      body,
    );
    return { obj, body, home, fallTime: 0 };
  }

  const items = new Map(); // object -> item
  const remoteItem = makeItem(remote);
  items.set(remote, remoteItem);

  // ---------------------------------------------------------------- stekkers + kabels
  // de kabel komt langs achter uit de stekker: midden van de kant die het verst van de muur ligt
  function plugRear(obj) {
    const box = new THREE.Box3();
    obj.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); } });
    const c = box.getCenter(new THREE.Vector3());
    const out = obj.worldToLocal(obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 1))).normalize(); // muurnormaal (+z) in lokale assen
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const depth = Math.max(...corners.map((p) => p.clone().sub(c).dot(out)));
    return c.addScaledVector(out, depth);
  }

  for (const [key, plug] of Object.entries(plugs)) {
    // kabeluiteinden uit de Blender-kabel: het punt het dichtst bij de stekker hangt eraan vast,
    // het verste punt zit vast aan de lamp / de tv
    plug.obj.updateMatrixWorld(true);
    const plugPos = plug.obj.getWorldPosition(new THREE.Vector3());
    let near = null, far = null, dn = Infinity, df = -Infinity;
    plug.cable.updateMatrixWorld(true);
    plug.cable.traverse((m) => {
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const d = _v.distanceToSquared(plugPos);
        if (d < dn) { dn = d; near = _v.clone(); }
        if (d > df) { df = d; far = _v.clone(); }
      }
    });
    const item = Object.assign(makeItem(plug.obj, { kinematic: true }), plug, {
      key, plugged: true, armed: false, snap: null,
      attachLocal: plugRear(plug.obj),
      anchor: far,
    });
    near = plug.obj.localToWorld(item.attachLocal.clone());
    item.rope = createRope(scene, far, plug.obj.localToWorld(item.attachLocal.clone()),
      far.distanceTo(near) * 1.6 + 0.15, groundAt, wallFront);
    plugs[key] = item;
    items.set(plug.obj, item);
  }

  function setPlugged(item, on) {
    item.plugged = on;
    item.armed = false;
    if (on) {
      item.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      item.body.setTranslation(item.home.p, true);
      item.body.setRotation(item.home.q, true);
      item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      item.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    updatePower();
  }

  // ---------------------------------------------------------------- schakelaars
  const state = { wall: true, knob: true, lampOn: true, tvOn: true };
  function updatePower() {
    const lampOn = plugs.lamp.plugged && state.knob;
    const tvOn = plugs.tv.plugged;
    if (lampOn !== state.lampOn) { state.lampOn = lampOn; onLamp(lampOn); }
    if (tvOn !== state.tvOn) { state.tvOn = tvOn; onTv(tvOn); }
  }

  // knopjes draaien/kantelen rond een as door hun eigen midden
  function makeToggle(knob, axisWorld, angle) {
    const q0 = knob.quaternion.clone();
    const axis = axisWorld.clone().normalize().applyQuaternion(knob.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    return { knob, q0, axis, angle, target: angle };
  }
  const wallKnob = get('d70_schakelaar_knop');
  const lampKnob = get('d70_staanlamp_knop');
  const lampSwitch = get('d70_staanlamp_schakelaar');
  const knobAxis = lampKnob.getWorldPosition(new THREE.Vector3()).sub(lampSwitch.getWorldPosition(new THREE.Vector3()));
  knobAxis.y = 0;
  const toggles = [
    makeToggle(wallKnob, new THREE.Vector3(1, 0, 0), 0.15),
    makeToggle(lampKnob, knobAxis, 0),
  ];
  const buttons = new Map([
    [get('d70_schakelaar'), () => { state.wall = !state.wall; toggles[0].target = state.wall ? 0.15 : -0.15; onRoom(state.wall); }],
    [lampSwitch, () => { state.knob = !state.knob; toggles[1].target = state.knob ? 0 : Math.PI / 2; updatePower(); }],
  ]);

  /** extra klikbaar object; `rotor` draait het rond `axisWorld` door zijn eigen midden: rotor.set(hoek) */
  function addButton(obj, press, axisWorld) {
    buttons.set(obj, press);
    if (!axisWorld) return null;
    const t = makeToggle(obj, axisWorld, 0);
    toggles.push(t);
    return { set(angle) { t.target = angle; } };
  }

  // ---------------------------------------------------------------- aanwijzen, vastpakken, gooien
  // enkel wat je ziet: de Raycaster raakt ook verborgen objecten, en de jaren '90 staan (verborgen) op exact
  // dezelfde plek als deze kamer; anders lagen die voor de stekkers en de afstandsbediening
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function hitTest(raycaster) {
    const hit = raycaster.intersectObjects(scene.children, true).find((h) => shown(h.object));
    if (!hit) return null;
    for (let o = hit.object; o; o = o.parent) {
      if (items.has(o)) return { kind: 'item', item: items.get(o), hit };
      if (buttons.has(o)) return { kind: 'button', press: buttons.get(o), hit };
    }
    return { kind: 'other', object: hit.object, hit };
  }

  const grab = { item: null, local: new THREE.Vector3(), plane: new THREE.Plane(), target: new THREE.Vector3(), ray: new THREE.Ray() };
  function startGrab(h, raycaster) {
    const { item, hit } = h;
    if (item.snap) return;
    grab.item = item;
    grab.local.copy(hit.point).applyMatrix4(item.obj.matrixWorld.clone().invert());
    grab.plane.setFromNormalAndCoplanarPoint(raycaster.ray.direction.clone().negate(), hit.point);
    grab.target.copy(hit.point);
    grab.ray.copy(raycaster.ray);
    item.body.setAngularDamping(2.5); // vastgehouden: slingert uit in plaats van eindeloos te pendelen
    item.body.wakeUp();
  }
  function moveGrab(raycaster) {
    if (!grab.item) return;
    raycaster.ray.intersectPlane(grab.plane, grab.target);
    grab.ray.copy(raycaster.ray);
  }
  function endGrab() {
    grab.item?.body.setAngularDamping(0.4); // losgelaten: tolt vrij verder
    grab.item = null;
  }

  // ---------------------------------------------------------------- simulatie
  let acc = 0;
  function beforeStep() {
    const item = grab.item;
    if (!item) return;
    // een stekker kun je niet verder trekken dan zijn kabel lang is
    if (item.rope) {
      const max = item.rope.length * 0.97;
      _v.copy(grab.target).sub(item.anchor);
      if (_v.length() > max) grab.target.copy(item.anchor).addScaledVector(_v.normalize(), max);
    }
    if (item.plugged) {
      if (grab.target.distanceTo(item.home.p) < PLUG_PULL) return; // zit nog vast
      setPlugged(item, false);
      item.body.applyImpulse({ x: 0, y: 0, z: 0.002 }, true); // 'plop'
    }
    // het vastgepakte punt (niet het midden) naar de muis trekken met een gedempte veer: zo hangt
    // het object scheef onder je muis, draait het mee en tolt het verder als je het gooit
    const t = item.body.translation(), r = item.body.rotation(), lv = item.body.linvel(), av = item.body.angvel();
    const com = item.body.worldCom();
    const p = _w.copy(grab.local).multiply(item.obj.scale).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v.set(t.x, t.y, t.z));
    const rx = p.x - com.x, ry = p.y - com.y, rz = p.z - com.z;
    const pvx = lv.x + av.y * rz - av.z * ry, pvy = lv.y + av.z * rx - av.x * rz, pvz = lv.z + av.x * ry - av.y * rx;
    _v.copy(grab.target).sub(p).multiplyScalar(16);
    if (_v.length() > 7) _v.setLength(7);
    const k = item.body.mass() * 0.35;
    item.body.applyImpulseAtPoint({ x: (_v.x - pvx) * k, y: (_v.y - pvy) * k, z: (_v.z - pvz) * k }, p, true);
  }

  function afterStep(item) {
    if (!item.rope || item.plugged || item.snap) return;
    const t = item.body.translation();
    _v.set(t.x, t.y, t.z);
    item.obj.position.copy(_v);
    const r = item.body.rotation();
    item.obj.quaternion.set(r.x, r.y, r.z, r.w);
    item.obj.updateMatrixWorld(true);
    const end = item.obj.localToWorld(_w.copy(item.attachLocal));
    const d = end.distanceTo(item.anchor), max = item.rope.length;
    if (d > max) {
      const dir = end.clone().sub(item.anchor).normalize();
      const corr = dir.clone().multiplyScalar(-(d - max));
      item.body.setTranslation({ x: t.x + corr.x, y: t.y + corr.y, z: t.z + corr.z }, true);
      const lv = item.body.linvel();
      const out = lv.x * dir.x + lv.y * dir.y + lv.z * dir.z;
      if (out > 0) item.body.setLinvel({ x: lv.x - dir.x * out, y: lv.y - dir.y * out, z: lv.z - dir.z * out }, true);
    }
    // dicht bij het stopcontact: magneet, de stekker glijdt er vanzelf in
    const dHome = _v.copy(item.body.translation()).distanceTo(item.home.p);
    // eerst ver genoeg weg geweest (anders klikt hij meteen terug), dan trekt de magneet; enkel terwijl
    // je de stekker vasthoudt, zodat een losgelaten stekker gewoon langs de muur op de grond valt.
    // Wat telt is waar je muis wijst: je sleept in een vlak naar de camera toe, dus de stekker zelf
    // komt niet altijd op de diepte van de muur.
    if (dHome > PLUG_MAGNET) item.armed = true;
    if (item.armed && grab.item === item && grab.ray.distanceToPoint(item.home.p) < PLUG_MAGNET * 0.8) {
      endGrab();
      const tr = item.body.translation(), ro = item.body.rotation();
      item.snap = { t: 0, p: new THREE.Vector3(tr.x, tr.y, tr.z), q: new THREE.Quaternion(ro.x, ro.y, ro.z, ro.w) };
      item.armed = false;
      item.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
  }

  function update(dt) {
    acc = Math.min(acc + dt, STEP * 8);
    while (acc >= STEP) {
      beforeStep();
      world.step();
      for (const item of items.values()) afterStep(item);
      acc -= STEP;
    }
    for (const item of items.values()) {
      if (item.snap) {
        const sn = item.snap;
        sn.t = Math.min(1, sn.t + dt / PLUG_SNAP_TIME);
        const e = sn.t * sn.t * (3 - 2 * sn.t);
        item.body.setNextKinematicTranslation(_v.copy(sn.p).lerp(item.home.p, e));
        item.body.setNextKinematicRotation(_q.copy(sn.q).slerp(item.home.q, e));
        if (sn.t >= 1) { item.snap = null; setPlugged(item, true); }
      }
      const t = item.body.translation(), r = item.body.rotation();
      item.obj.position.set(t.x, t.y, t.z);
      item.obj.quaternion.set(r.x, r.y, r.z, r.w);
      // van het diorama gegooid: even laten vallen, dan terug op zijn plek
      if (t.y < FALL_LIMIT && grab.item !== item) {
        item.body.setTranslation(item.home.p, true);
        item.body.setRotation(item.home.q, true);
        item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (item.rope) setPlugged(item, true);
      }
      if (item.rope) {
        item.obj.updateMatrixWorld(true);
        item.rope.update(dt, item.obj.localToWorld(_w.copy(item.attachLocal)));
      }
    }
    for (const t of toggles) {
      t.angle += (t.target - t.angle) * (1 - Math.exp(-dt * 18));
      t.knob.quaternion.setFromAxisAngle(t.axis, t.angle).multiply(t.q0);
    }
  }

  // kabels: het vaste uiteinde (aan de lamp / de tv) mag mee bewegen, bv. als de meubels binnenvallen
  const cablesOut = Object.fromEntries(Object.values(plugs).map((p) => [p.key, { anchor: p.anchor, mesh: p.rope.mesh }]));

  return { hitTest, startGrab, moveGrab, endGrab, addButton, update, state, cables: cablesOut, get grabbing() { return !!grab.item; } };
}

// ---------------------------------------------------------------- kabel: verlet-touw met zwaartekracht
export function createRope(scene, anchor, end, length, groundAt, wallFront, n = 32, radius = 0.0032) {
  const pts = Array.from({ length: n }, (_, i) => anchor.clone().lerp(end, i / (n - 1)));
  const prev = pts.map((p) => p.clone());
  let rest = length / (n - 1);
  const mat = new THREE.MeshStandardNodeMaterial({ color: 0x0b0b0b, roughness: 0.45 });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  scene.add(mesh);
  const g = new THREE.Vector3(0, -9.81, 0);

  function simulate(dt, endPos) {
    for (let i = 1; i < n - 1; i++) {
      const p = pts[i], q = prev[i];
      const vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985;
      q.copy(p);
      p.x += vx; p.y += vy + g.y * dt * dt; p.z += vz;
    }
    pts[0].copy(anchor); pts[n - 1].copy(endPos);
    for (let k = 0; k < 30; k++) {
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        _v.subVectors(b, a);
        const d = _v.length() || 1e-6;
        const diff = (d - rest) / d;
        const wa = i === 0 ? 0 : 0.5, wb = i + 1 === n - 1 ? 0 : 0.5;
        const s = wa + wb;
        if (!s) continue;
        a.addScaledVector(_v, diff * (wa / s));
        b.addScaledVector(_v, -diff * (wb / s));
      }
      for (let i = 1; i < n - 1; i++) {
        const p = pts[i];
        const ground = groundAt(p.x, p.z) + radius;
        if (p.y < ground) { p.y = ground; prev[i].x += (p.x - prev[i].x) * 0.3; prev[i].z += (p.z - prev[i].z) * 0.3; } // wrijving
        if (p.z < wallFront + radius && p.y < 2.4) p.z = wallFront + radius;
      }
    }
  }
  function rebuild() {
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, radius, 6, false);
  }
  // even laten uitzakken voor het eerste beeld
  for (let i = 0; i < 480; i++) simulate(STEP, end);
  rebuild();

  return {
    length, mesh,
    /** hoe lang het touw nu hangt (bv. opgerold in een kast); `length` blijft de volle lengte */
    fit(len) { rest = Math.min(len, length) / (n - 1); },
    update(dt, endPos) {
      simulate(Math.min(dt, 1 / 30), endPos);
      rebuild();
    },
  };
}
