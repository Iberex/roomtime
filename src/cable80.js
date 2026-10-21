/**
 * De tv-kabel van de jaren '80, zoals die van de tv in de jaren '70 (interactions.js):
 *  - de stekker zit in het stopcontact naast de tv; de kabel loopt naar de achterkant van de tv.
 *  - de stekker uit het stopcontact trekken = de tv valt uit. Hij is dan een physics-object (Rapier, eigen
 *    wereld): hij hangt scheef onder je muis en tolt verder als je hem gooit, maar nooit verder dan de kabel lang is.
 *  - breng hem terug bij het stopcontact en een magneet trekt hem erin; van het diorama gegooid komt hij terug.
 *  - de kabel is een live touw met zwaartekracht (createRope uit interactions.js).
 *
 * De stekker is een kopie van die van de tv in de jaren '70, belicht met het licht van deze kamer.
 * Alles hier staat in de ruimte van de kamer (r), los van het draaitoneel: y omhoog, +z de kamer in.
 */
import * as THREE from 'three/webgpu';
import { texture, uv, vec3 } from 'three/tsl';
import RAPIER from '@dimforge/rapier3d-compat';

import { createRope } from './interactions.js';

const STEP = 1 / 120;
const PLUG_PULL = 0.04;      // zo ver (m) trekken voor de stekker loskomt
const PLUG_MAGNET = 0.15;    // binnen deze afstand trekt het stopcontact de stekker aan als een magneet
const PLUG_SNAP_TIME = 0.22; // s: zo lang glijdt de stekker erin
const FALL_LIMIT = -3;       // lager dan dit: van het diorama gevallen -> terug in het stopcontact

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _ray = new THREE.Ray();

/**
 * @param {Object3D} r        - de kamer van de jaren '80
 * @param {Object3D} plug70   - kopie van de stekker van de jaren '70, met zijn oorspronkelijke materialen
 * @param {Matrix4}  plug70At - waar die stekker in de jaren '70 zit (wereld = ruimte van die kamer)
 * @param {Matrix4}  socket70At - en zijn stopcontact
 * @param {Object3D} socket   - het stopcontact in deze kamer waar de stekker in moet
 * @param {Object3D} tv       - de tv: de kabel hangt aan zijn achterkant
 * @param {Node}     level    - het licht van deze kamer (0..1)
 * @param {Function} onPower  - (aan) de stekker gaat erin of eruit
 * @param {object}   names    - de vloer, de muur en het paneel van deze kamer, en hoe de stekker heet
 *                              (zo werkt dezelfde kabel ook in de jaren '90, voor de staande lamp)
 */
export async function createTvCable80({ r, plug70, plug70At, socket70At, socket, tv, level, onPower,
  names = { floor: 'd70_vloer001', wall: 'd70_muur001', panel: 'd70_paneel001', plug: 'd80_tv_stekker' } }) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  r.updateMatrixWorld(true);
  const toR = new THREE.Matrix4();
  const local = (o, out = new THREE.Matrix4()) => out.multiplyMatrices(toR.copy(r.matrixWorld).invert(), o.matrixWorld);
  const get = (n) => r.getObjectByName(n);
  const boxOf = (o) => {
    const b = new THREE.Box3();
    o.updateMatrixWorld(true);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      b.union(m.geometry.boundingBox.clone().applyMatrix4(local(m)));
    });
    return b;
  };

  // ---------------------------------------------------------------- de kamer: vloer en muur als blokken
  const floor = boxOf(get(names.floor)), wall = boxOf(get(names.wall));
  for (const b of [floor, wall]) {
    const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    world.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(c.x, c.y, c.z).setFriction(0.8));
  }
  const wallFront = boxOf(get(names.panel) ?? get(names.wall)).max.z;
  const groundAt = (x, z) => (x < floor.min.x || x > floor.max.x || z < floor.min.z || z > floor.max.z ? -Infinity : floor.max.y);

  // ---------------------------------------------------------------- de stekker: zelfde plek t.o.v. het stopcontact
  const obj = plug70;
  obj.name = names.plug;
  obj.matrixAutoUpdate = true;
  local(socket).multiply(socket70At.clone().invert()).multiply(plug70At).decompose(obj.position, obj.quaternion, obj.scale);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const albedo = m.map ? texture(m.map, uv()).rgb.mul(vec3(m.color.r, m.color.g, m.color.b)) : vec3(m.color.r, m.color.g, m.color.b);
    o.material = new THREE.MeshBasicNodeMaterial({ colorNode: albedo.mul(level).mul(0.85) });
  });
  r.add(obj);
  obj.updateMatrixWorld(true);
  const home = { p: obj.position.clone(), q: obj.quaternion.clone() };

  // convex hull in de assen van de stekker (met zijn schaal), zoals in interactions.js
  const pts = [], inv = new THREE.Matrix4().compose(obj.position, obj.quaternion, new THREE.Vector3(1, 1, 1)).invert();
  obj.traverse((m) => {
    if (!m.isMesh) return;
    _m.multiplyMatrices(inv, local(m));
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { _w.fromBufferAttribute(pos, i).applyMatrix4(_m); pts.push(_w.x, _w.y, _w.z); }
  });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(home.p.x, home.p.y, home.p.z).setRotation(home.q)
    .setCcdEnabled(true).setLinearDamping(0.08).setAngularDamping(0.4));
  world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts)).setDensity(900).setFriction(0.7).setRestitution(0.3), body);

  // de kabel komt langs achter uit de stekker: het midden van de kant die het verst van de muur ligt
  const pbox = new THREE.Box3();
  obj.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); pbox.union(m.geometry.boundingBox.clone().applyMatrix4(_m.multiplyMatrices(inv, local(m)))); } });
  const out = new THREE.Vector3(0, 0, 1).applyQuaternion(home.q.clone().invert()); // muurnormaal in de assen van de stekker
  const attachLocal = pbox.getCenter(new THREE.Vector3());
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? pbox.max.x : pbox.min.x, i & 2 ? pbox.max.y : pbox.min.y, i & 4 ? pbox.max.z : pbox.min.z));
  attachLocal.addScaledVector(out, Math.max(...corners.map((p) => p.clone().sub(attachLocal).dot(out))));
  const plugEnd = () => _w.copy(attachLocal).applyQuaternion(obj.quaternion).add(obj.position);

  // het andere uiteinde: onderaan de achterkant van de tv, in de assen van de tv (valt mee als de tv binnenvalt)
  const tvBox = boxOf(tv);
  const tvAt = local(tv).invert();
  const anchorTv = new THREE.Vector3((tvBox.min.x + tvBox.max.x) / 2, tvBox.min.y + 0.04, tvBox.min.z + 0.02).applyMatrix4(tvAt);
  const anchor = new THREE.Vector3();
  const updateAnchor = () => anchor.copy(anchorTv).applyMatrix4(local(tv, _m));
  updateAnchor();
  const start = plugEnd().clone();
  const rope = createRope(r, anchor, start, anchor.distanceTo(start) * 1.15 + 0.3, groundAt, wallFront);

  // ---------------------------------------------------------------- vastpakken en simuleren
  let plugged = true, armed = false, snap = null, acc = 0;
  const grab = { on: false, local: new THREE.Vector3(), plane: new THREE.Plane(), target: new THREE.Vector3(), ray: new THREE.Ray() };
  const rayIn = (raycaster) => _ray.copy(raycaster.ray).applyMatrix4(toR.copy(r.matrixWorld).invert());

  function setPlugged(on) {
    plugged = on;
    armed = false;
    if (on) {
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      body.setTranslation(home.p, true);
      body.setRotation(home.q, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    onPower?.(on);
  }

  function beforeStep() {
    if (!grab.on) return;
    // niet verder dan de kabel lang is
    const max = rope.length * 0.97;
    _v.copy(grab.target).sub(anchor);
    if (_v.length() > max) grab.target.copy(anchor).addScaledVector(_v.normalize(), max);
    if (plugged) {
      if (grab.target.distanceTo(home.p) < PLUG_PULL) return; // zit nog vast
      setPlugged(false);
      body.applyImpulse({ x: 0, y: 0, z: 0.002 }, true); // 'plop'
    }
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
    if (plugged || snap) return;
    const t = body.translation(), q = body.rotation();
    obj.position.set(t.x, t.y, t.z);
    obj.quaternion.set(q.x, q.y, q.z, q.w);
    const end = plugEnd(), d = end.distanceTo(anchor), max = rope.length;
    if (d > max) {
      const dir = end.clone().sub(anchor).normalize();
      body.setTranslation({ x: t.x - dir.x * (d - max), y: t.y - dir.y * (d - max), z: t.z - dir.z * (d - max) }, true);
      const lv = body.linvel(), o = lv.x * dir.x + lv.y * dir.y + lv.z * dir.z;
      if (o > 0) body.setLinvel({ x: lv.x - dir.x * o, y: lv.y - dir.y * o, z: lv.z - dir.z * o }, true);
    }
    // eerst ver genoeg weg geweest, dan trekt de magneet zolang je hem vasthoudt en ernaar wijst
    if (_v.set(t.x, t.y, t.z).distanceTo(home.p) > PLUG_MAGNET) armed = true;
    if (armed && grab.on && grab.ray.distanceToPoint(home.p) < PLUG_MAGNET * 0.8) {
      grab.on = false;
      body.setAngularDamping(0.4);
      snap = { t: 0, p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(q.x, q.y, q.z, q.w) };
      armed = false;
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
  }

  const meshes = [];
  obj.traverse((m) => { if (m.isMesh) meshes.push(m); });
  return {
    objects: [obj],
    owns: (o) => { for (; o; o = o.parent) if (o === obj) return true; return false; },
    get grabbing() { return grab.on; },
    get plugged() { return plugged; },
    start(hit, raycaster) {
      if (snap) return;
      grab.on = true;
      _v.copy(hit.point).applyMatrix4(toR.copy(r.matrixWorld).invert());               // in de ruimte van de kamer
      grab.local.copy(_v).sub(obj.position).applyQuaternion(obj.quaternion.clone().invert()); // in de assen van de stekker
      const ray = rayIn(raycaster);
      grab.plane.setFromNormalAndCoplanarPoint(ray.direction.clone().negate(), _v);
      grab.target.copy(_v);
      grab.ray.copy(ray);
      body.setAngularDamping(2.5);
      body.wakeUp();
    },
    move(raycaster) {
      if (!grab.on) return;
      const ray = rayIn(raycaster);
      ray.intersectPlane(grab.plane, grab.target);
      grab.ray.copy(ray);
    },
    end() {
      if (!grab.on) return;
      grab.on = false;
      body.setAngularDamping(0.4);
    },
    update(dt) {
      updateAnchor();
      acc = Math.min(acc + dt, STEP * 8);
      while (acc >= STEP) {
        beforeStep();
        world.step();
        afterStep();
        acc -= STEP;
      }
      if (snap) {
        snap.t = Math.min(1, snap.t + dt / PLUG_SNAP_TIME);
        const e = snap.t * snap.t * (3 - 2 * snap.t);
        body.setNextKinematicTranslation(_v.copy(snap.p).lerp(home.p, e));
        body.setNextKinematicRotation(_q.copy(snap.q).slerp(home.q, e));
        if (snap.t >= 1) { snap = null; setPlugged(true); }
      }
      const t = body.translation(), q = body.rotation();
      obj.position.set(t.x, t.y, t.z);
      obj.quaternion.set(q.x, q.y, q.z, q.w);
      if (t.y < FALL_LIMIT && !grab.on) setPlugged(true); // van het diorama gegooid: terug in het stopcontact
      rope.update(dt, plugEnd().clone());
    },
  };
}
