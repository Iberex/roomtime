import * as THREE from 'three/webgpu';
import { texture, uv, uniform, mix, vec2 } from 'three/tsl';

import { createGlitch } from './shaders/glitch.js';
import { createTvAudio } from './audio/tvAudio.js';

/**
 * Een tv met zenders, zoals in elke kamer: testbeeld, dan de uitzendingen in chronologische volgorde.
 *
 *   zender (testbeeld of video) + onderschrift ─► channelRT (640×480, 4:3)
 *   channelRT ─► Glitchy Glitch (Shadertoy wld3WN, WGSL) ─► glitchRT ─► het scherm
 *
 * Alle bronnen worden in één 4:3 render target getekend, zo blijft de glitch-shader dezelfde input zien.
 * De glitch-shader zelf draait zoals op Shadertoy op een vast canvas (640×480) en komt als gemipmapte
 * texture op het scherm: rechtstreeks op het kleine scherm-mesh gerekend wordt elke pixel ruis en
 * scanline even fel terwijl het beeld krimpt, en overheerst de ruis.
 *
 * @param {object[]} broadcasts - { src, title, sub }
 * @param {Texture}  card       - het testbeeld
 * @param {object}   profile    - geluid van het toestel (tvAudio.js)
 * @param {number}   clean      - 0 zoals in de jaren '70 en '80 … 1 een beter toestel: minder ruis en storing
 * @param {number[]} size       - resolutie van het beeld (4:3); een beter toestel krijgt meer pixels
 */
export function createTv({ broadcasts, card, profile, clean = 0, size = [640, 480] }) {
  const channels = broadcasts.map(({ src, title, sub }) => {
    const video = Object.assign(document.createElement('video'), {
      src, muted: true, loop: true, playsInline: true, preload: 'metadata',
    });
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { video, tex, title, sub };
  });

  // onderschrift zoals een zender het toen inblendde: witte letters met zwarte rand, linksonder.
  // Het wordt ín het zenderbeeld getekend, dus de glitch en de beeldbuis gaan er ook overheen.
  const captionCanvas = Object.assign(document.createElement('canvas'), { width: 640, height: 480 });
  const captionTex = new THREE.CanvasTexture(captionCanvas);
  captionTex.colorSpace = THREE.SRGBColorSpace;
  const captionOpacity = uniform(0);
  let captionTime = 0;
  function drawCaption(ch) {
    const c = captionCanvas.getContext('2d');
    c.clearRect(0, 0, 640, 480);
    if (ch) {
      c.textBaseline = 'alphabetic';
      c.lineJoin = 'round';
      // binnen het "title safe"-gebied blijven: de bolling van de beeldbuis snijdt randen en hoeken weg
      const X = 92, MAX_W = 640 - 2 * X;
      const line = (text, size, y) => {
        c.font = `bold ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        const w = c.measureText(text).width;
        if (w > MAX_W) { size *= MAX_W / w; c.font = `bold ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`; }
        c.lineWidth = size * 0.22;
        c.strokeStyle = 'rgba(0,0,0,0.85)';
        c.strokeText(text, X, y);
        c.fillStyle = '#f4f1e8';
        c.fillText(text, X, y);
      };
      line(ch.title, 42, 350);
      line(ch.sub, 22, 384);
    }
    captionTex.needsUpdate = true;
    captionTime = ch ? 6 : 0; // 6 s in beeld, daarna uitfaden
  }

  const channelRT = new THREE.RenderTarget(size[0], size[1]);
  const channelCrop = uniform(new THREE.Vector4(1, 1, 0, 0)); // breedbeeld-bron bijsnijden tot 4:3
  const channelSrc = texture(card, uv().mul(channelCrop.xy).add(channelCrop.zw));
  const caption = texture(captionTex, vec2(uv().x, uv().y.oneMinus())); // canvas komt net als video ongespiegeld binnen
  const channelQuad = new THREE.QuadMesh(new THREE.MeshBasicNodeMaterial({
    colorNode: mix(channelSrc.rgb, caption.rgb, caption.a.mul(captionOpacity)),
  }));

  const audio = createTvAudio(channels.map((c) => c.video), profile);

  // breedbeeld midden 4:3 uitsnijden; videoframes komen in WebGPU ongespiegeld binnen: y omdraaien
  function cropTo(video) {
    const aspect = (video.videoWidth / video.videoHeight) || 4 / 3;
    const sx = Math.min(1, (4 / 3) / aspect);
    channelCrop.value.set(sx, -1, (1 - sx) / 2, 1);
  }
  for (const { video } of channels) {
    video.addEventListener('loadedmetadata', () => { if (channels[tv.current]?.video === video) cropTo(video); });
  }

  const glitchRT = new THREE.RenderTarget(size[0], size[1], { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const glitch = createGlitch(channelRT.texture, uv());
  glitch.uniforms.power.value = 1;
  glitch.uniforms.clean.value = clean;
  glitch.uniforms.resolution.value.set(size[0], size[1]);
  const glitchQuad = new THREE.QuadMesh(new THREE.MeshBasicNodeMaterial({ colorNode: glitch.node }));

  let frame = 0;
  const tv = {
    channels, audio, glitch,
    texture: glitchRT.texture,
    material: new THREE.MeshBasicNodeMaterial({ colorNode: texture(glitchRT.texture, uv()).rgb.mul(0.85) }),
    current: -1, // -1 = testbeeld
    power: true,
    level: 1,    // 0 uit … 1 aan (opstart-animatie van de beeldbuis)
    magnet: 0,   // hoe lang de muis al op het scherm staat
    switchChannel() {
      channels[tv.current]?.video.pause();
      tv.current = tv.current + 1 < channels.length ? tv.current + 1 : -1;
      const ch = channels[tv.current];
      audio.setChannel(!!ch);
      drawCaption(ch);
      if (ch) {
        if (tv.power) ch.video.play().catch(() => {});
        cropTo(ch.video);
        channelSrc.value = ch.tex;
      } else {
        channelCrop.value.set(1, 1, 0, 0);
        channelSrc.value = card;
      }
      glitch.uniforms.boost.value = 1.6; // korte glitch-burst
    },
    setPower(on) {
      tv.power = on;
      audio.setPower(on);
      const ch = channels[tv.current];
      if (ch) on ? ch.video.play().catch(() => {}) : ch.video.pause();
      if (on) glitch.uniforms.boost.value = 1.2;
    },
    /** eerste klik: geluid aan (testtoon onder het testbeeld) */
    startAudio() {
      audio.start();
      audio.setChannel(tv.current >= 0);
      audio.setPower(tv.power);
    },
    update(t, dt, onScreen) {
      tv.magnet += ((onScreen ? 1 : 0) - tv.magnet) * (1 - Math.exp(-dt * (onScreen ? 1.6 : 4)));
      const g = glitch.uniforms;
      g.time.value = t;
      g.frame.value = frame++;
      g.magnetStrength.value = tv.magnet;
      g.boost.value *= Math.exp(-dt * 2.4);
      audio.update(t, g.boost.value, g.snow.value);
      // aan = opstart-animatie (0 -> 1), uit = beeld klapt snel dicht
      tv.level = THREE.MathUtils.clamp(tv.level + (tv.power ? dt / 0.9 : -dt / 0.45), 0, 1);
      g.power.value = tv.level;
      captionTime = Math.max(0, captionTime - dt);
      captionOpacity.value = Math.min(1, captionTime); // laatste seconde uitfaden
    },
    render(renderer) {
      renderer.setRenderTarget(channelRT);
      channelQuad.render(renderer);
      renderer.setRenderTarget(glitchRT);
      glitchQuad.render(renderer);
      renderer.setRenderTarget(null);
    },
  };
  return tv;
}
