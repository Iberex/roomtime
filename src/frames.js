/**
 * De kaders aan de muur van de jaren '80: van de muur trekken, rondgooien en terug ophangen.
 *  - elk kader hangt aan een spijkertje. Klik erop en het schommelt; trek het verder weg en het komt los.
 *  - los is het een physics-object (Rapier, eigen wereld voor deze kamer): het hangt scheef onder je muis
 *    en tolt verder als je het gooit. Valt het van het diorama, dan hangt het even later terug aan de muur.
 *  - ophangen: kom met een kader in de buurt van een vrij spijkertje (die lichten op zolang je een kader vasthebt)
 *    en een magneet trekt het er met physics naartoe: het richt zich, glijdt tegen de muur en haakt in.
 *    Laat je het los terwijl de magneet al trekt, dan haakt het er toch op. Elk kader past op elke vrije
 *    nagel, zo kun je ze herschikken. Overlapt het een kader dat er al hangt, dan hangt het er net voor.
 *
 * Alles hier staat in de ruimte van de kamer (r), los van het draaitoneel: y omhoog, +z de kamer in.
 */
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import RAPIER from '@dimforge/rapier3d-compat';

const STEP = 1 / 120;
const PULL = 0.1;       // zo ver (m) trekken voor het kader van zijn nagel loskomt; minder: het schommelt mee
const MAGNET = 0.22;    // wijst je muis zo dicht (m) bij waar een kader op een vrije nagel zou hangen, dan begint de magneet te trekken
const ARM = 0.2;        // ... maar pas als je eerst zo ver weg bent geweest van de nagel waar het afkwam
const LATCH = 0.02;     // zo dicht (m) en ...
const LATCH_ANGLE = 0.15; // ... zo recht (rad) bij zijn hangpositie: het haakt in
const PULL_TIMEOUT = 1.5; // s: losgelaten in de magneet maar niet ingehaakt (iets zit in de weg): dan valt het
const HANG_TIME = 0.12; // s: het laatste stukje op zijn nagel
const NAIL_DROP = 0.03; // de nagel zit zo ver (m) onder de bovenrand van het kader, erachter
const FALL_LIMIT = -3;  // lager dan dit: van het diorama gevallen

const Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _ray = new THREE.Ray();

export async function createFrames({ r, level, skip = () => false }) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  r.updateMatrixWorld(true);
  const toR = r.matrixWorld.clone().invert();
  const local = (o) => _m.multiplyMatrices(toR, o.matrixWorld);
  const boxOf = (o) => {
    const b = new THREE.Box3();
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      b.union(m.geometry.boundingBox.clone().applyMatrix4(local(m)));
    });
    return b;
  };

  const frameObjs = r.children.filter((o) => /^d80_kader_[a-z]+$/.test(o.name));
  const isFrame = (o) => { for (; o && o !== r; o = o.parent) if (/^d80_kader/.test(o.name)) return true; return false; };
  const skipped = (o) => { for (; o && o !== r; o = o.parent) if (skip(o)) return true; return false; };

  // ---------------------------------------------------------------- vaste kamer
  // vloer en muur als massieve blokken (een worp schiet niet door een dun vel), de rest als trimesh
  const solid = ['d70_vloer001', 'd70_muur001', 'd70_paneel001'].map((n) => r.getObjectByName(n)).filter(Boolean);
  const wall = new THREE.Box3();
  for (const o of solid) {
    const b = boxOf(o);
    if (o.name !== 'd70_vloer001') { wall.union(b); continue; }
    const c = b.getCenter(new THREE.Vector3()), h = b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    world.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(c.x, c.y, c.z).setFriction(0.8));
  }
  if (!wall.isEmpty()) {
    const c = wall.getCenter(new THREE.Vector3()), h = wall.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    world.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setTranslation(c.x, c.y, c.z).setFriction(0.8));
  }
  const wallFront = wall.isEmpty() ? null : wall.max.z;
  r.traverse((o) => {
    if (!o.isMesh || isFrame(o) || skipped(o) || solid.some((s) => s === o || s === o.parent)) return;
    const pos = o.geometry.attributes.position, mw = local(o);
    const verts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) _v.fromBufferAttribute(pos, i).applyMatrix4(mw).toArray(verts, i * 3);
    const idx = o.geometry.index ? new Uint32Array(o.geometry.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8));
  });

  // ---------------------------------------------------------------- materialen voor wat er in three bijkomt
  // de achterkant van een kader (hardboard) en de spijkertjes; ze volgen het kamerlicht
  const backMat = new THREE.MeshBasicNodeMaterial({ colorNode: vec3(0.2, 0.13, 0.08).mul(level), side: THREE.DoubleSide });
  const nailMat = new THREE.MeshStandardNodeMaterial({ color: 0xd8b273, metalness: 1, roughness: 0.3 });
  nailMat.emissiveNode = vec3(0.3, 0.22, 0.12).mul(level);
  const shadowMat = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });

  // ---------------------------------------------------------------- de kaders
  const frames = frameObjs.map((obj) => {
    const photo = r.getObjectByName(`${obj.name}_foto`);
    if (photo) obj.attach(photo); // de foto beweegt mee
    obj.updateMatrixWorld(true);
    const home = { p: obj.position.clone(), q: obj.quaternion.clone() };
    const inv = home.q.clone().invert();
    const box = boxOf(obj);
    const out = Z.clone().applyQuaternion(inv); // de kamer in, in de assen van het kader

    // de achterkant: de buitenrand van de lijst (de punten die tegen de muur liggen), dichtgemaakt met hardboard
    const pts = [];
    obj.traverse((m) => {
      if (!m.isMesh) return;
      _m.copy(obj.matrixWorld).invert().multiply(m.matrixWorld);
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(_m));
    });
    const back = Math.min(...pts.map((p) => p.dot(out)));
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(inv), w = new THREE.Vector3().crossVectors(out, u);
    const rim = pts.filter((p) => p.dot(out) < back + 1e-4);
    const mid = rim.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(rim.length || 1);
    const ring = rim.map((p) => ({ x: _v.subVectors(p, mid).dot(u), y: _v.dot(w) }))
      .sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))
      .filter((p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-4);
    if (ring.length >= 3) {
      const geo = new THREE.ShapeGeometry(new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, p.y))));
      geo.applyMatrix4(new THREE.Matrix4().makeBasis(u, w, out).setPosition(mid.clone().addScaledVector(out, 0.0005)));
      const board = new THREE.Mesh(geo, backMat);
      board.name = `${obj.name}_achterkant`;
      obj.add(board);
    }

    // de nagel: midden boven, net onder de bovenrand, tegen de muur
    const nail = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - NAIL_DROP, home.p.z);
    const hangLocal = nail.clone().sub(home.p).applyQuaternion(inv);           // waar het kader aan de nagel hangt
    const centerLocal = box.getCenter(new THREE.Vector3()).sub(home.p).applyQuaternion(inv);
    const size = box.getSize(new THREE.Vector3());

    // physics: convex hull van lijst, foto en achterkant
    obj.updateMatrixWorld(true);
    const hull = [];
    obj.traverse((m) => {
      if (!m.isMesh) return;
      _m.copy(obj.matrixWorld).invert().multiply(m.matrixWorld);
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) _v.fromBufferAttribute(pos, i).applyMatrix4(_m).toArray(hull, hull.length);
    });
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(home.p.x, home.p.y, home.p.z).setRotation(home.q)
      .setCcdEnabled(true).setLinearDamping(0.1).setAngularDamping(0.5));
    world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(hull)).setDensity(500).setFriction(0.6).setRestitution(0.25), body);
    return { obj, body, home, hangLocal, centerLocal, size, nail: null, swing: { a: 0, v: 0, target: 0 }, lift: 0, snap: null, armed: false, left: null, pull: null };
  });

  // elke nagel hoort eerst bij zijn eigen kader; daarna maakt het niet uit welk kader eraan hangt.
  // Rond elke nagel een gloeiend ringetje op de muur: zichtbaar zolang je een kader vasthebt, fel bij de
  // nagel waar de magneet aan trekt.
  const nails = frames.map((f) => {
    const at = f.home.p.clone().add(f.hangLocal.clone().applyQuaternion(f.home.q));
    const wallZ = wallFront ?? at.z - 0.005;
    const n = { at, frame: f, mesh: makeNail(at, wallZ, nailMat, shadowMat), glow: 0 };
    // zonder tonemapping: AgX maakt van fel oranje een flets zalmroze op het behang
    n.ringMat = new THREE.MeshBasicNodeMaterial({ color: 0xff6a10, toneMapped: false });
    n.edgeMat = new THREE.MeshBasicNodeMaterial({ color: 0x3a1a06, toneMapped: false });
    n.ring = new THREE.Group();
    n.ring.add(new THREE.Mesh(new THREE.RingGeometry(0.022, 0.036, 48), n.ringMat),
      new THREE.Mesh(new THREE.RingGeometry(0.036, 0.04, 48), n.edgeMat));
    n.ring.position.set(at.x, at.y, wallZ + 0.002);
    n.ring.traverse((m) => { m.raycast = () => {}; });
    n.ring.visible = false;
    r.add(n.mesh, n.ring);
    f.nail = n;
    return n;
  });

  // ---------------------------------------------------------------- hangen
  // pose van kader f aan nagel n, geschommeld over hoek a rond de nagel
  function hangPose(f, n, a, outP, outQ) {
    outQ.setFromAxisAngle(Z, a).multiply(f.home.q);
    outP.copy(f.hangLocal).applyQuaternion(outQ).multiplyScalar(-1).add(n.at);
    outP.z += f.lift;
    return outP;
  }
  // waar het midden van f zou komen als het aan n hangt (daar richt je op met de muis)
  const centerOn = (f, n) => hangPose(f, n, 0, _w, _q2).clone().add(f.centerLocal.clone().applyQuaternion(f.home.q));
  const freeNails = () => nails.filter((n) => !n.frame);

  // overlapt het een kader dat er al hangt, dan komt het er net voor (anders steken ze door elkaar)
  function liftFor(f, n) {
    const c = centerOn(f, n);
    let lift = 0;
    for (const g of frames) {
      if (g === f || !g.nail || g.snap) continue;
      const d = centerOn(g, g.nail);
      if (Math.abs(c.x - d.x) < (f.size.x + g.size.x) / 2 && Math.abs(c.y - d.y) < (f.size.y + g.size.y) / 2) lift = Math.max(lift, g.lift + g.size.z + 0.002);
    }
    return lift;
  }

  function hang(f, n, { animate = true } = {}) {
    if (grab.f === f) grab.f = null;
    n.frame = f;
    f.nail = n;
    f.lift = liftFor(f, n);
    f.armed = false;
    f.pull = null;
    f.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    f.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    f.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    f.swing.a = 0;
    f.swing.v = (Math.random() < 0.5 ? -1 : 1) * 0.5; // het tikt tegen de muur en wiegt heel even na
    if (animate) {
      const t = f.body.translation(), q = f.body.rotation();
      f.snap = { t: 0, p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(q.x, q.y, q.z, q.w) };
    } else {
      f.snap = null;
      hangPose(f, n, 0, _v, _q);
      f.body.setTranslation(_v, true);
      f.body.setRotation(_q, true);
    }
  }
  function unhang(f) {
    if (f.nail) f.nail.frame = null;
    f.left = f.nail;
    f.nail = null;
    f.snap = null;
    f.lift = 0;
    f.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    f.body.applyImpulse({ x: 0, y: 0, z: f.body.mass() * 0.4 }, true); // los van de muur
  }

  // ---------------------------------------------------------------- vastpakken en gooien
  const objs = frames.map((f) => f.obj);
  const owner = (o) => { for (; o; o = o.parent) { const i = objs.indexOf(o); if (i >= 0) return frames[i]; } return null; };
  const toLocalRay = (raycaster) => _ray.copy(raycaster.ray).applyMatrix4(_m.copy(r.matrixWorld).invert());
  const grab = { f: null, local: new THREE.Vector3(), plane: new THREE.Plane(), target: new THREE.Vector3(), start: new THREE.Vector3(), ray: new THREE.Ray() };

  function start(hit, raycaster) {
    const f = owner(hit.object);
    if (!f || f.snap) return false;
    const ray = toLocalRay(raycaster);
    const p = hit.point.clone().applyMatrix4(_m.copy(r.matrixWorld).invert());
    grab.f = f;
    grab.local.copy(p).sub(f.obj.position).applyQuaternion(_q.copy(f.obj.quaternion).invert());
    grab.plane.setFromNormalAndCoplanarPoint(ray.direction.clone().negate(), p);
    grab.target.copy(p);
    grab.start.copy(p);
    grab.ray.copy(ray);
    if (f.nail) f.swing.v += (p.x > centerOn(f, f.nail).x ? -1 : 1) * 0.9; // even aantikken: het schommelt
    else { f.pull = null; f.body.setAngularDamping(2.5); f.body.wakeUp(); }
    return true;
  }
  function move(raycaster) {
    if (!grab.f) return;
    const ray = toLocalRay(raycaster);
    ray.intersectPlane(grab.plane, grab.target);
    grab.ray.copy(ray);
    // los vastgehouden blijft het een eindje vóór de muur, zodat het niet blijft haken aan kaders die er hangen;
    // de magneet trekt het er het laatste stukje tegen
    if (!grab.f.nail && wallFront !== null) grab.target.z = Math.max(grab.target.z, wallFront + 0.1);
  }
  function end() {
    const f = grab.f;
    if (!f) return;
    grab.f = null;
    f.swing.target = 0;
    if (f.nail) return;
    f.body.setAngularDamping(0.5); // losgelaten: tolt vrij verder
    // ... tenzij de magneet het al stevig vasthad: dan haakt het er toch op
    if (f.pull && f.pull.s > 0.5) { f.pull.s = 1; f.pull.age = 0; } else f.pull = null;
  }

  // de nagel die het dichtst bij je muis is (waar het kader zou hangen), als je er dicht genoeg bij bent
  function nearestNail(f) {
    if (!f.armed) {
      f.armed = !f.left || grab.ray.distanceToPoint(centerOn(f, f.left)) > ARM;
      if (!f.armed) return null;
    }
    let best = null, bd = MAGNET;
    for (const n of freeNails()) {
      const d = grab.ray.distanceToPoint(centerOn(f, n));
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) return null;
    const x = Math.min(1, (MAGNET - bd) / (MAGNET * 0.65)); // het laatste stuk trekt de magneet volledig
    return { n: best, s: x * x * (3 - 2 * x), age: 0 };
  }

  // het punt `local` van f met een gedempte veer naar `target` trekken (zoals de afstandsbediening in de jaren '70):
  // het hangt scheef onder je muis, draait mee en tolt verder als je het gooit
  function springTo(f, local, target, gain = 16) {
    const t = f.body.translation(), q = f.body.rotation(), lv = f.body.linvel(), av = f.body.angvel(), com = f.body.worldCom();
    const p = _w.copy(local).applyQuaternion(_q.set(q.x, q.y, q.z, q.w)).add(_v.set(t.x, t.y, t.z));
    const rx = p.x - com.x, ry = p.y - com.y, rz = p.z - com.z;
    const pvx = lv.x + av.y * rz - av.z * ry, pvy = lv.y + av.z * rx - av.x * rz, pvz = lv.z + av.x * ry - av.y * rx;
    _v.copy(target).sub(p).multiplyScalar(gain);
    if (_v.length() > 7) _v.setLength(7);
    const k = f.body.mass() * 0.35;
    f.body.applyImpulseAtPoint({ x: (_v.x - pvx) * k, y: (_v.y - pvy) * k, z: (_v.z - pvz) * k }, p, true);
  }

  const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _tgt = new THREE.Vector3();
  const _av = new THREE.Vector3();
  function beforeStep() {
    const g = grab.f;
    if (g && g.nail && !g.snap) {
      // aan de nagel: zijwaarts trekken laat het meeschommelen; ver genoeg en het komt los
      const dx = grab.target.x - grab.start.x;
      g.swing.target = THREE.MathUtils.clamp(-dx * 4, -0.25, 0.25);
      if (grab.target.distanceTo(grab.start) >= PULL) {
        unhang(g);
        g.body.setAngularDamping(2.5);
      }
    }
    for (const f of frames) {
      if (f.nail || f.snap) continue;
      const held = grab.f === f;
      if (held) {
        const near = nearestNail(f);
        // de magneet blijft bij dezelfde nagel tot je er echt weg bent (geen gespring tussen twee nagels)
        f.pull = near && (!f.pull || f.pull.n === near.n || near.s > f.pull.s + 0.2) ? near : null;
        if (f.pull && f.pull.n !== f.lastPull) { f.lift = liftFor(f, f.pull.n); f.lastPull = f.pull.n; }
      } else if (f.pull) {
        f.pull.age += STEP;
        if (f.pull.age > PULL_TIMEOUT || f.pull.n.frame) { f.pull = null; f.lift = 0; }
      }
      if (!f.pull) {
        f.lastPull = null;
        f.lift = 0;
        if (held) springTo(f, grab.local, grab.target);
        continue;
      }
      // magneet: het doel schuift van je muis naar waar het kader aan de nagel hangt, en het draait recht
      const { n, s } = f.pull;
      hangPose(f, n, 0, _hp, _hq);
      // draaien naar de hangstand: een gedempte veer op de hoeksnelheid
      const q = f.body.rotation();
      _q.set(q.x, q.y, q.z, q.w);
      _q2.copy(_hq).multiply(_q.invert());
      if (_q2.w < 0) { _q2.x *= -1; _q2.y *= -1; _q2.z *= -1; _q2.w *= -1; }
      const angle = 2 * Math.acos(Math.min(1, _q2.w)), sn = Math.sqrt(1 - _q2.w * _q2.w);
      if (sn > 1e-5) _av.set(_q2.x / sn, _q2.y / sn, _q2.z / sn).multiplyScalar(angle * 14);
      else _av.set(0, 0, 0);
      const av = f.body.angvel();
      f.body.setAngvel(_av.lerp(_w.set(av.x, av.y, av.z), 1 - Math.min(1, 0.06 + 0.2 * s)), true);
      // het doel schuift van je muis naar waar het kader aan de nagel hangt. Zolang het nog scheef hangt of
      // ver weg is, blijft het een eindje vóór de muur (anders klemt het dwars in de muur): eerst recht, dan ertegen
      const t = f.body.translation();
      const local = held ? grab.local : f.centerLocal;
      _tgt.copy(local).applyQuaternion(_hq).add(_hp);
      const away = Math.max(Math.min(1, angle / 0.5), Math.min(1, Math.hypot(t.x - _hp.x, t.y - _hp.y) / 0.12));
      _tgt.z += 0.12 * away;
      if (held) _tgt.lerpVectors(grab.target, _tgt, s);
      springTo(f, local, _tgt, 16 + 14 * s);
      // zwaartekracht opheffen in de magneet, anders zakt het net onder de nagel
      f.body.applyImpulse({ x: 0, y: f.body.mass() * 9.81 * STEP * s, z: 0 }, true);
      // dicht en recht genoeg: inhaken
      if (s > 0.6 && _w.set(t.x, t.y, t.z).distanceTo(_hp) < LATCH && angle < LATCH_ANGLE) hang(f, n);
    }
  }

  let acc = 0, time = 0;
  function update(dt) {
    time += dt;
    acc = Math.min(acc + dt, STEP * 8);
    while (acc >= STEP) {
      beforeStep();
      world.step();
      acc -= STEP;
    }
    // de ringetjes rond de vrije nagels
    const holding = grab.f && !grab.f.nail ? grab.f : null;
    for (const n of nails) {
      const pulled = frames.find((f) => f.pull?.n === n);
      let want = 0;
      if (!n.frame) want = pulled ? 1.15 + 0.25 * pulled.pull.s : holding ? 0.95 + 0.12 * Math.sin(time * 6) : 0.7;
      n.glow += (want - n.glow) * (1 - Math.exp(-dt * 12));
      n.ring.visible = n.glow > 0.05;
      n.ring.scale.setScalar(n.glow);
    }
    for (const f of frames) {
      if (f.nail) {
        // schommelen rond de nagel: een stevig gedempte slinger
        const s = f.swing;
        s.v += (-60 * (s.a - s.target) - 9 * s.v) * dt;
        s.a += s.v * dt;
        hangPose(f, f.nail, s.a, _v, _q);
        if (f.snap) {
          const sn = f.snap;
          sn.t = Math.min(1, sn.t + dt / HANG_TIME);
          const e = sn.t * sn.t * (3 - 2 * sn.t);
          _v.lerpVectors(sn.p, _v, e);
          _q.copy(_q2.copy(sn.q).slerp(_q, e));
          if (sn.t >= 1) f.snap = null;
        }
        f.body.setNextKinematicTranslation(_v);
        f.body.setNextKinematicRotation(_q);
        f.obj.position.copy(_v);
        f.obj.quaternion.copy(_q);
        continue;
      }
      const t = f.body.translation(), q = f.body.rotation();
      f.obj.position.set(t.x, t.y, t.z);
      f.obj.quaternion.set(q.x, q.y, q.z, q.w);
      // van het diorama gevallen: terug aan de muur, aan zijn eigen nagel als die nog vrij is
      if (t.y < FALL_LIMIT && grab.f !== f) {
        const n = !f.home.nail?.frame ? f.home.nail : freeNails()[0];
        hang(f, n, { animate: false });
      }
    }
  }
  for (const f of frames) f.home.nail = f.nail;

  return {
    objects: objs,
    owns: (o) => !!owner(o),
    start, move, end, update,
    get grabbing() { return !!grab.f; },
  };
}

// een spijkertje: een pinnetje uit de muur met een bol koperen kopje en een schaduwvlekje eronder op het
// behang. Het steekt net niet voorbij de achterkant van het kader dat eraan hangt, zodat je het pas ziet als
// het kader weg is.
function makeNail(at, wallZ, material, shadowMat) {
  const len = Math.max(0.006, at.z - wallZ - 0.0005);
  const g = new THREE.Group();
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, len, 10), material);
  pin.rotation.x = Math.PI / 2;
  pin.position.z = -len / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), material);
  head.rotation.x = Math.PI / 2;
  head.scale.y = 0.4;
  head.position.z = -0.0048;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.015, 24), shadowMat);
  shadow.position.set(0.002, -0.004, -len + 0.0015);
  g.add(shadow, pin, head);
  g.position.set(at.x, at.y, wallZ + len);
  g.traverse((m) => { m.raycast = () => {}; });
  return g;
}
