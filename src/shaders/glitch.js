/**
 * "Glitchy Glitch" door piyushslayer — https://www.shadertoy.com/view/wld3WN
 *
 * Zoals in de les: de Shadertoy-code is geport naar WGSL (glitch.wgsl) en wordt met wgslFn
 * een node die in een MeshBasicNodeMaterial past. De Shadertoy-inputs (iTime, iFrame,
 * iResolution) en de interactie zijn uniforms die main.js elke frame bijwerkt.
 *
 * iChannel0 (in het origineel een video) is hier het beeld van de actieve "zender".
 */
import { wgslFn, uniform, texture } from 'three/tsl';
import { Vector2 } from 'three';
import glitchShader from './glitch.wgsl?raw';

const glitch = wgslFn(glitchShader);

/**
 * @param {Texture} channel0 - beeld van de zender (iChannel0)
 * @param {Node} uvNode     - uv's van het vlak waarop de shader rendert (0..1)
 */
export function createGlitch(channel0, uvNode) {
  // uniforms are TSL nodes, we update their .value every frame
  const u = {
    time: uniform(0),                           // iTime
    frame: uniform(0),                          // iFrame
    resolution: uniform(new Vector2(640, 480)), // iResolution: canvas van de shader (de render target in main.js)
    // interactie:
    boost: uniform(0),                       // glitch-burst bij kanaalwissel / aanzetten
    magnet: uniform(new Vector2(0.5, 0.5)),  // muispositie op het scherm (uv)
    magnetStrength: uniform(0),              // 0..1, sterker naarmate je de muis langer op de buis houdt
    power: uniform(0),                       // 0 uit … 1 aan (CRT-opstart-animatie)
    snow: uniform(0),                        // 0 goede ontvangst … 1 enkel sneeuw (antennes)
    clean: uniform(0),                       // 0 zoals het origineel … 1 een beter toestel (de jaren '90): minder ruis
  };

  // the channel texture is passed twice: once as texture, once as sampler
  const iChannel0 = texture(channel0);
  const node = glitch({
    fragCoord: uvNode.mul(u.resolution),
    iTime: u.time,
    iFrame: u.frame,
    iResolution: u.resolution,
    iChannel0,
    iChannel0Sampler: iChannel0,
    boost: u.boost,
    magnet: u.magnet,
    magnetStrength: u.magnetStrength,
    power: u.power,
    snow: u.snow,
    clean: u.clean,
  });

  return { node, uniforms: u };
}
