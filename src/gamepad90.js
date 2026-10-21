/**
 * De controller van de PlayStation in de jaren '90, zoals de afstandsbediening in de jaren '70 (interactions.js):
 *  - een physics-object (Rapier, eigen wereld voor deze kamer): sleep hem en hij hangt scheef onder je muis,
 *    laat los en hij valt, stuit en tolt verder. Nooit verder dan zijn kabel lang is.
 *  - de kabel is een live touw met zwaartekracht (createRope uit interactions.js), van de controller naar zijn
 *    stekker in de PlayStation. Gaat de PlayStation in het kastje, dan gaat de kabel mee.
 *  - van het diorama gegooid: terug op zijn plek.
 *
 * De controller is een groep van drop.js (in rust op 0). Ligt hij los, dan zet de physics die groep; anders volgt
 * het lichaam de groep (binnenvallen, opbergen in het kastje). Alles in de ruimte van de kamer (r).
 */
import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';

import { createRope } from './interactions.js';

const STEP = 1 / 120;
const FALL_LIMIT = -3;   // lager dan dit: van het diorama gevallen -> terug op zijn plek
const DRAG_START = 0.012; // m: zo ver slepen voor het een worp wordt (minder is een klik: opbergen)

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _n = new THREE.Matrix4(), _ray = new THREE.Ray();

/**
 * @param {Object3D} r       - de kamer van de jaren '90
 * @param {Object3D} pad     - de controller (mesh)
 * @param {Object3D} cable   - de kabel uit Blender: wordt een live touw
 * @param {Object3D} plug    - de stekker in de PlayStation: het vaste uiteinde van de kabel
 * @param {Object3D[]} skip  - wat niet vast staat (deurtjes, PlayStation, cd's...): geen botsvorm
 * @param {object}   names   - de vloer, de muur, het paneel en het tapijt van deze kamer
 * @param {Object3D} [shelf] - de bodem van het tv-meubel: daar ligt de kabel op als hij in het kastje hangt
 */
export async function createGamepad90({ r, pad, cable, plug, skip = [], names, shelf }) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  r.updateMatrixWorld(true);
  const toR = new THREE.Matrix4();
  const local = (o, out = new THREE.Matrix4()) => { o.updateWorldMatrix(true, false); return out.multiplyMatrices(toR.copy(r.matrixWorld).invert(), o.matrixWorld); };
  const get = (n) => r.getObjectByName(n);
  const inside = (o, list) => { for (; o; o = o.parent) if (list.includes(o)) return true; return false; };
  const boxOf = (o) => {
    const b = new THREE.Box3();
    o.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox.clone().applyMatrix4(local(m))); } });
    return b;
  };

  // ---------------------------------------------------------------- de kamer
  // vloer, muur en tapijt als massieve blokken (een worp schiet niet door een dun vel), de meubels als trimesh
  const floor = boxOf(get(names.floor)), wall = boxOf(get(names.wall)), rug = get(names.carpet) && boxOf(get(names.carpet));
  for (const b of [floor, wall, rug].filter(Boolean)) {
    const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(_v.setScalar(0.002));
    world.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(c.x, c.y, c.z).setFriction(0.8));
  }
  const loose = [pad, cable, plug, ...skip, ...[names.floor, names.wall, names.carpet].map(get)].filter(Boolean);
  // waar je de controller naartoe sleept: wat vast staat, plus de vloer, de muur en het tapijt
  const surfaces = [names.floor, names.wall, names.carpet].map(get).filter(Boolean);
  r.traverse((o) => {
    if (!o.isMesh || !o.visible || inside(o, loose)) return;
    surfaces.push(o);
    const pos = o.geometry.attributes.position, at = local(o);
    const verts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) _v.fromBufferAttribute(pos, i).applyMatrix4(at).toArray(verts, i * 3);
    const idx = o.geometry.index ? new Uint32Array(o.geometry.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8));
  });
  const wallFront = boxOf(get(names.panel) ?? get(names.wall)).max.z;
  // de grond onder de kabel: het tapijt, de vloer, of de bodem van het kastje als hij daarin hangt
  const shelfBox = shelf && (shelf.geometry.computeBoundingBox(), shelf.geometry.boundingBox);
  const shelfInv = shelf && local(shelf).invert(), shelfTop = shelf && boxOf(shelf).max.y;
  const overShelf = (x, z) => { _w.set(x, shelfTop, z).applyMatrix4(shelfInv); return _w.x > shelfBox.min.x && _w.x < shelfBox.max.x && _w.z > shelfBox.min.z && _w.z < shelfBox.max.z; };
  const shelfAt = shelf && ((x, z) => (overShelf(x, z) ? shelfTop : -Infinity));
  const groundAt = (x, z) => {
    if (x < floor.min.x || x > floor.max.x || z < floor.min.z || z > floor.max.z) return -Infinity;
    const g = rug && x > rug.min.x && x < rug.max.x && z > rug.min.z && z < rug.max.z ? rug.max.y : floor.max.y;
    return Math.max(g, shelfAt?.(x, z) ?? -Infinity);
  };

  // ---------------------------------------------------------------- de controller: convex hull
  // het lichaam staat waar de controller in rust ligt (B0); de groep is dan B · B0⁻¹
  const B0 = new THREE.Matrix4(), home = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  local(pad).decompose(home.p, home.q, _s);
  B0.compose(home.p, home.q, _v.set(1, 1, 1));
  const B0inv = B0.clone().invert();
  const pts = [];
  pad.traverse((m) => {
    if (!m.isMesh) return;
    _m.multiplyMatrices(B0inv, local(m));
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { _w.fromBufferAttribute(pos, i).applyMatrix4(_m); pts.push(_w.x, _w.y, _w.z); }
  });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(home.p.x, home.p.y, home.p.z).setRotation(home.q)
    .setCcdEnabled(true).setLinearDamping(0.1).setAngularDamping(0.5));
  world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts)).setDensity(700).setFriction(0.7).setRestitution(0.3), body);

  // ---------------------------------------------------------------- de kabel
  // zijn uiteinden uit de Blender-kabel: het punt het dichtst bij de controller hangt aan de controller, het
  // punt het dichtst bij de stekker zit vast in de PlayStation (in hun eigen assen: ze bewegen allebei)
  const padC = boxOf(pad).getCenter(new THREE.Vector3()), plugC = boxOf(plug).getCenter(new THREE.Vector3());
  let near = null, far = null, dn = Infinity, df = Infinity;
  cable.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position, at = local(m);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(at);
      const a = _v.distanceToSquared(padC), b = _v.distanceToSquared(plugC);
      if (a < dn) { dn = a; near = _v.clone(); }
      if (b < df) { df = b; far = _v.clone(); }
    }
  });
  near ??= padC; far ??= plugC;
  const attachLocal = near.clone().applyMatrix4(local(pad).invert());
  const anchorLocal = far.clone().applyMatrix4(local(plug).invert());
  cable.visible = false;
  cable.traverse((m) => { m.raycast = () => {}; });
  const padEnd = () => _w.copy(attachLocal).applyMatrix4(local(pad, _m));
  const anchor = new THREE.Vector3();
  const updateAnchor = () => anchor.copy(anchorLocal).applyMatrix4(local(plug, _n));
  updateAnchor();
  const rope = createRope(r, anchor, padEnd().clone(), near.distanceTo(far) * 1.25 + 0.25, groundAt, wallFront, 32, 0.0022);

  // ---------------------------------------------------------------- vastpakken en simuleren
  let free = false, acc = 0, group = null, tidy = false, hang = rope.length;
  const grab = { on: false, pending: false, start: new THREE.Vector3(), local: new THREE.Vector3(), plane: new THREE.Plane(), target: new THREE.Vector3() };
  const rayIn = (raycaster) => _ray.copy(raycaster.ray).applyMatrix4(toR.copy(r.matrixWorld).invert());
  const groupOf = () => {
    for (let o = pad.parent; o && o !== r; o = o.parent) if (o.parent === r) return o;
    return null;
  };

  // het lichaam naar waar de groep nu staat (die beweegt door drop.js of het opbergen)
  function follow() {
    if (!group) return; // (nog) geen groep: de controller ligt op zijn plek
    local(group, _m).multiply(B0).decompose(_v, _q, _s);
    body.setTranslation(_v, true);
    body.setRotation(_q, true);
  }
  // de groep naar het lichaam: G = B · B0⁻¹ (de groep hangt rechtstreeks in de kamer)
  function place() {
    const t = body.translation(), q = body.rotation();
    _m.compose(_v.set(t.x, t.y, t.z), _q.set(q.x, q.y, q.z, q.w), _s.set(1, 1, 1)).multiply(B0inv);
    _m.decompose(group.position, group.quaternion, _s);
    group.updateMatrixWorld(true);
  }
  function setFree(on) {
    free = on;
    if (on) {
      follow();
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  function beforeStep() {
    if (!grab.on) return;
    const max = rope.length * 0.97; // niet verder dan de kabel lang is
    _v.copy(grab.target).sub(anchor);
    if (_v.length() > max) grab.target.copy(anchor).addScaledVector(_v.normalize(), max);
    // het vastgepakte punt naar de muis trekken met een gedempte veer
    const t = body.translation(), q = body.rotation(), lv = body.linvel(), av = body.angvel(), com = body.worldCom();
    const p = _w.copy(grab.local).applyQuaternion(_q.set(q.x, q.y, q.z, q.w)).add(_v.set(t.x, t.y, t.z));
    const rx = p.x - com.x, ry = p.y - com.y, rz = p.z - com.z;
    const pvx = lv.x + av.y * rz - av.z * ry, pvy = lv.y + av.z * rx - av.x * rz, pvz = lv.z + av.x * ry - av.y * rx;
    _v.copy(grab.target).sub(p).multiplyScalar(16);
    if (_v.length() > 7) _v.setLength(7);
    const k = body.mass() * 0.35;
    body.applyImpulseAtPoint({ x: (_v.x - pvx) * k, y: (_v.y - pvy) * k, z: (_v.z - pvz) * k }, p, true);
  }
  function afterStep() {
    // de kabel houdt hem tegen: verder dan zijn lengte trekt hij de controller terug
    place();
    const t = body.translation(), end = padEnd(), d = end.distanceTo(anchor), max = rope.length;
    if (d <= max) return;
    const dir = end.sub(anchor).normalize();
    body.setTranslation({ x: t.x - dir.x * (d - max), y: t.y - dir.y * (d - max), z: t.z - dir.z * (d - max) }, true);
    const lv = body.linvel(), o = lv.x * dir.x + lv.y * dir.y + lv.z * dir.z;
    if (o > 0) body.setLinvel({ x: lv.x - dir.x * o, y: lv.y - dir.y * o, z: lv.z - dir.z * o }, true);
  }

  return {
    /** hij ligt los (de physics zet zijn groep) */
    get free() { return free; },
    get grabbing() { return grab.on || grab.pending; },
    /** muis neer op de controller: nog geen worp, eerst kijken of je sleept */
    press(hit, raycaster) {
      group = groupOf();
      if (!group) return;
      grab.pending = true;
      _v.copy(hit.point).applyMatrix4(toR.copy(r.matrixWorld).invert());
      grab.start.copy(_v);
      grab.target.copy(_v);
      grab.plane.setFromNormalAndCoplanarPoint(rayIn(raycaster).direction.clone().negate(), _v);
    },
    /**
     * slepen; geeft true de eerste keer dat het een worp wordt (de controller komt dan los).
     * Hij gaat naar het oppervlak waar je muis naar wijst (vloer, plank in het kastje, stapel banden), een paar cm
     * erboven: zo kun je hem het kastje in slepen en trek je hem nooit de grond in. Wijs je naar niets, dan blijft
     * hij in een vlak naar de camera, maar nooit onder de vloer.
     */
    move(raycaster) {
      if (!grab.pending && !grab.on) return false;
      const ray = rayIn(raycaster);
      const h = raycaster.intersectObjects(surfaces, false)[0];
      if (h) grab.target.copy(h.point).applyMatrix4(toR.copy(r.matrixWorld).invert()).addScaledVector(ray.direction, -0.05).add(_v.set(0, 0.025, 0));
      else if (ray.intersectPlane(grab.plane, grab.target)) grab.target.y = Math.max(grab.target.y, floor.max.y + 0.03);
      if (grab.on || grab.target.distanceTo(grab.start) < DRAG_START) return false;
      grab.pending = false;
      grab.on = true;
      if (!free) setFree(true);
      const t = body.translation(), q = body.rotation();
      grab.local.copy(grab.start).sub(_v.set(t.x, t.y, t.z)).applyQuaternion(_q.set(q.x, q.y, q.z, q.w).invert()); // in de assen van het lichaam
      body.setAngularDamping(2.5); // vastgehouden: slingert uit in plaats van eindeloos te pendelen
      body.wakeUp();
      return true;
    },
    /** ligt hij (los) in het kastje: boven de bodem van het meubel, niet hoger dan een vak */
    get inCabinet() {
      if (!free || !shelf) return false;
      const t = body.translation();
      return overShelf(t.x, t.z) && t.y > shelfTop - 0.02 && t.y < shelfTop + 0.4;
    },
    /** muis los; geeft true als het een klik was (niet gesleept) */
    release() {
      const click = grab.pending;
      grab.pending = false;
      if (grab.on) { grab.on = false; body.setAngularDamping(0.5); }
      return click;
    },
    /**
     * opgeborgen: de kabel ligt opgerold in het kastje in plaats van met al zijn lengte naar buiten te hangen.
     * Hij wordt geleidelijk korter (net iets langer dan de afstand tot de PlayStation) en weer langer als hij eruit gaat.
     */
    set tidy(on) { tidy = on; },
    /** de groep neemt het weer over (opbergen): het lichaam volgt haar vanaf waar ze nu ligt */
    settle() { grab.on = grab.pending = false; if (free) setFree(false); },
    update(dt) {
      group ??= groupOf();
      updateAnchor();
      if (free && group) {
        acc = Math.min(acc + dt, STEP * 8);
        while (acc >= STEP) {
          beforeStep();
          world.step();
          afterStep();
          acc -= STEP;
        }
        place();
        if (body.translation().y < FALL_LIMIT && !grab.on) { // van het diorama gegooid: terug op zijn plek
          setFree(false);
          group.position.set(0, 0, 0);
          group.quaternion.identity();
          group.updateMatrixWorld(true);
        }
      }
      if (!free) follow();
      // de kabel enkel als de controller en de PlayStation er allebei zijn (bij het binnenvallen nog niet)
      let shown = true;
      for (const o of [pad, plug]) for (let p = o; p; p = p.parent) if (!p.visible) shown = false;
      rope.mesh.visible = shown;
      const end = padEnd().clone();
      const want = tidy ? Math.min(rope.length, anchor.distanceTo(end) * 1.08 + 0.05) : rope.length;
      hang += (want - hang) * (1 - Math.exp(-dt * 4));
      rope.fit(hang);
      rope.update(dt, end);
    },
  };
}
