import * as THREE from 'three/webgpu';

/**
 * Gordijnen van de jaren '80: vastpakken en over de rail schuiven, of kort klikken om ze helemaal
 * open of dicht te doen.
 *
 * Elk gordijn is een massa-veersysteem: de breedte volgt het doel met een licht onderdempte veer
 * (de stof schiet even door), en de zoom onderaan reageert op de versnelling en zwiept na.
 * Uitgetrokken worden de plooien vlakker, samengeschoven dieper. De mesh zelf wordt elke frame
 * vervormd: elk hoekpunt houdt zijn plaats in de stof (hoe ver van de vaste rand, hoe hoog).
 *
 * @param {Mesh} left, right - de twee gordijnen (x langs de rail, y omhoog, z de diepte van de plooien)
 * @param {number} center    - x (in de geometrie) waar de gordijnen elkaar raken als ze dicht zijn
 */
export function createCurtains({ left, right, center }) {
  const curtains = [makeCurtain(left, 1), makeCurtain(right, -1)];
  // de opening tussen de open gordijnen = hoeveel raam er te bedekken valt
  const gap = curtains.reduce((s, c) => s + c.closedW - c.restW, 0);

  function makeCurtain(mesh, dir) { // dir 1: vaste rand links, groeit naar rechts; -1 omgekeerd
    const geo = mesh.geometry;
    // de posities los van de rest: de Blender-export zet positie en uv's door elkaar in één buffer (interleaved),
    // en dan schreef het vervormen hieronder in de uv's en de verkeerde hoekpunten (het gordijn ontplofte)
    if (geo.attributes.position.isInterleavedBufferAttribute) {
      const src = geo.attributes.position, flat = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) { flat[i * 3] = src.getX(i); flat[i * 3 + 1] = src.getY(i); flat[i * 3 + 2] = src.getZ(i); }
      geo.setAttribute('position', new THREE.BufferAttribute(flat, 3));
    }
    const pos = geo.attributes.position;
    const rest = pos.array.slice();
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox;
    const fixed = dir > 0 ? min.x : max.x;
    const restW = max.x - min.x;
    const closedW = Math.abs(center - fixed) + 0.015; // net over het midden, zodat er geen spleet blijft
    const zMid = (min.z + max.z) / 2;
    const u = new Float32Array(pos.count), hang = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      u[i] = Math.abs(rest[i * 3] - fixed) / restW;                 // 0 aan de vaste rand … 1 aan de voorrand
      hang[i] = ((max.y - rest[i * 3 + 1]) / (max.y - min.y)) ** 1.5; // 0 aan de rail … 1 aan de zoom
    }
    return { mesh, geo, pos, rest, fixed, dir, restW, closedW, zMid, u, hang, w: restW, v: 0, target: restW, swing: 0, swingV: 0, moving: true };
  }

  function step(c, dt) {
    const a = 70 * (c.target - c.w) - 10 * c.v;
    c.v += a * dt;
    c.w = THREE.MathUtils.clamp(c.w + c.v * dt, c.restW * 0.75, c.closedW * 1.04);
    // de zoom hangt achter: duwt de rail aan, dan blijft de onderkant even achter en zwiept na
    const sa = -40 * c.swing - 4 * c.swingV - a * 0.01;
    c.swingV += sa * dt;
    c.swing += c.swingV * dt;

    c.moving = Math.abs(c.v) > 1e-4 || Math.abs(c.swingV) > 1e-4 || Math.abs(c.target - c.w) > 1e-4;
    if (!c.moving) return;
    const depth = THREE.MathUtils.clamp((c.restW / c.w) ** 0.9, 0.3, 1.5); // plooien: vlakker als ze open waaieren
    const arr = c.pos.array;
    for (let i = 0; i < c.pos.count; i++) {
      arr[i * 3] = c.fixed + c.dir * c.u[i] * (c.w + c.swing * c.hang[i]);
      arr[i * 3 + 2] = c.zMid + (c.rest[i * 3 + 2] - c.zMid) * depth;
    }
    c.pos.needsUpdate = true;
    c.geo.computeBoundingSphere();
    c.geo.computeBoundingBox();
  }

  const grab = { c: null, offset: 0, x: 0, y: 0, moved: false };
  const _ray = new THREE.Ray(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _plane = new THREE.Plane();
  const meshes = curtains.map((c) => c.mesh);

  // waar de muis op de rail van dit gordijn wijst (in zijn eigen geometrie)
  function railX(c, raycaster) {
    _inv.copy(c.mesh.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inv);
    _plane.set(new THREE.Vector3(0, 0, 1), -c.zMid);
    return _ray.intersectPlane(_plane, _p) ? _p.x : null;
  }

  return {
    hitTest(raycaster) {
      return raycaster.intersectObjects(meshes, false)[0] ?? null;
    },
    startGrab(raycaster, e) {
      const hit = this.hitTest(raycaster);
      if (!hit) return false;
      const c = curtains[meshes.indexOf(hit.object)];
      const x = railX(c, raycaster);
      grab.c = c;
      grab.offset = x === null ? 0 : c.w - Math.abs(x - c.fixed);
      grab.x = e.clientX; grab.y = e.clientY; grab.moved = false;
      return true;
    },
    moveGrab(raycaster, e) {
      const c = grab.c;
      if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) > 4) grab.moved = true;
      if (!grab.moved) return;
      const x = railX(c, raycaster);
      if (x !== null) c.target = THREE.MathUtils.clamp(Math.abs(x - c.fixed) + grab.offset, c.restW * 0.8, c.closedW);
    },
    endGrab() {
      const c = grab.c;
      // kort klikken: helemaal open of dicht
      if (!grab.moved) c.target = c.w > (c.restW + c.closedW) / 2 ? c.restW : c.closedW;
      grab.c = null;
    },
    get grabbing() { return !!grab.c; },
    update(dt) {
      for (const c of curtains) step(c, dt);
    },
    /** 0 = raam helemaal vrij … 1 = helemaal bedekt */
    get coverage() {
      return THREE.MathUtils.clamp(curtains.reduce((s, c) => s + c.w - c.restW, 0) / gap, 0, 1);
    },
  };
}
