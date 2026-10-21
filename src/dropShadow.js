import * as THREE from 'three/webgpu';
import { uniform, positionWorld, float, vec3, abs, max, dot, clamp, smoothstep, pow, mix } from 'three/tsl';

/**
 * Schaduw die meevalt (drop.js). De schaduw van een meubel op de vloer zit in de bake, dus ze lag er al
 * terwijl het meubel nog boven zijn plek hing. Zolang een meubel valt, tilt de vloer onder hem het licht
 * op tot dat van de vloer ernaast; hoe dichter bij de grond, hoe meer van de schaduw terugkomt.
 * Het optillen is een verhouding tussen wazige versies van de bake (een kleine mipmap), zodat de nerf
 * van de vloer blijft staan: enkel het licht verandert.
 *
 *  - floors: de meshes waarop de schaduw valt (vloer, tapijt)
 *  - images: de bake(s) zelf, om naast het meubel een plek zonder schaduw te kiezen
 *  - uvSet: de uv-set van de lightmap ('uv' of 'uv1'), level: hoe wazig (mipmap)
 *  - flat: de lightmap is puur licht, zonder kleur (jaren '80): dan mag het licht gewoon naar dat
 *    ernaast, ook waar de bake onder het meubel zwart is (een verhouding tilt zwart nooit op)
 */
const MARGIN = 0.35;  // m: zo ver loopt de schaduw buiten de voet van het meubel
const MAX_GAIN = 3;   // nooit meer optillen dan dit (aan de rand van een eiland in de bake is het wazige licht te donker)
const SHARPEN = 1.6;  // de wazige bake smeert de kern van de schaduw uit: de verhouding wat aanscherpen
const LUMA = vec3(0.2126, 0.7152, 0.0722);

// helderheid van de bake op een uv, gelezen uit een kleine (dus uitgemiddelde) kopie: zo telt de kleur van één plank niet
function readLuminance(images, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  const sum = new Float32Array(size * size);
  for (const img of images) {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const px = ctx.getImageData(0, 0, size, size).data;
    for (let i = 0; i < sum.length; i++) sum[i] += 0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2];
  }
  const at = (v) => Math.min(size - 1, Math.max(0, Math.floor(v * size)));
  return (uv) => sum[at(uv.y) * size + at(uv.x)]; // flipY staat uit: rij 0 is v = 0
}

export function createDropShadows({ floors, images, uvSet = 'uv', level, flat = false }) {
  floors = floors.filter(Boolean);
  const lum = readLuminance(images);
  const ray = new THREE.Raycaster();
  const from = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  const floorAt = (x, z) => {
    ray.set(from.set(x, 50, z), down);
    const h = ray.intersectObjects(floors, true)[0]; // een vloer met meerdere materialen is een groep
    return h && { mesh: h.object, uv: h[uvSet] ?? h.uv };
  };
  const items = [];

  return {
    /**
     * objs: wat samen valt, in rust op zijn plek. Geeft k => …: 0 = nog in de lucht, 1 = geland.
     * margin: zo ver loopt de schaduw buiten de voet (iets kleins als een cd heeft maar een smalle rand)
     */
    add(objs, margin = MARGIN) {
      const box = new THREE.Box3();
      for (const o of objs) if (o) box.expandByObject(o);
      if (box.isEmpty()) return () => {};
      const c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const under = floorAt(c.x, c.z);
      if (!under) return () => {};
      // de helderste plek rondom, net buiten de schaduw en op dezelfde vloer (tapijt naast tapijt)
      let ref = null, best = -1;
      const d = margin + 0.1;
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const p = floorAt(c.x + sx * (h.x + d), c.z + sz * (h.z + d));
        if (!p || p.mesh !== under.mesh) continue;
        const l = lum(p.uv);
        if (l > best) { best = l; ref = p.uv; }
      }
      if (!ref) return () => {};
      const item = {
        mesh: under.mesh,
        box: uniform(new THREE.Vector4(c.x, c.z, h.x, h.z)),
        ref: uniform(ref.clone()),
        lift: uniform(0),
        margin,
      };
      items.push(item);
      return (k) => { item.lift.value = 1 - k; };
    },
    /**
     * het licht van een vloer, met de schaduw van wat er nog valt opgetild.
     * bakeAt(uv, level): het gebakken licht op die uv (TSL vec3); uvNode: de uv van de lightmap
     */
    apply(light, mesh, bakeAt, uvNode) {
      const mine = items.filter((it) => it.mesh === mesh);
      if (!mine.length) return light;
      const local = flat ? null : dot(bakeAt(uvNode, level), LUMA).max(1e-3);
      let out = light;
      for (const { box, ref, lift, margin } of mine) {
        const d = max(abs(positionWorld.xz.sub(box.xy)).sub(box.zw), 0); // afstand buiten de voet
        const mask = float(1).sub(smoothstep(0, margin, d.x)).mul(float(1).sub(smoothstep(0, margin, d.y)));
        const beside = bakeAt(ref, level);
        const lifted = flat ? max(out, beside)
          : out.mul(clamp(pow(dot(beside, LUMA).div(local), SHARPEN), 1, MAX_GAIN));
        out = mix(out, lifted, mask.mul(lift));
      }
      return out;
    },
  };
}
