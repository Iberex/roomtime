/**
 * "Genuary #15: Design a rug" door Flopine — https://www.shadertoy.com/view/MXtfz8 (CC BY-NC-SA 3.0)
 *
 * De poster van de jaren '90: tegels in jaren-90-kleuren die traag naar boven schuiven, geport naar WGSL (rug.wgsl), net als
 * de lucht. iTime is een uniform die room90.js elke frame bijwerkt. fragCoord / iResolution wordt de positie op de
 * poster: onderaan 0, bovenaan 1, de breedte in dezelfde maat.
 */
import * as THREE from 'three/webgpu';
import { wgslFn, uniform, float, pow } from 'three/tsl';
import rugShader from './rug.wgsl?raw';

const rug = wgslFn(rugShader);

/**
 * @param {Node}   p      - positie op de poster (vec2): x van 0 tot aspect, y van 0 (onder) tot 1 (boven)
 * @param {number} aspect - breedte / hoogte van de poster
 */
export function createRug(p, aspect) {
  const time = uniform(0);                       // iTime
  const seed = uniform(0);                       // welk patroon (klikken: het volgende)
  const mouse = uniform(new THREE.Vector2());    // waar de muis op de poster staat (zelfde maat als p)
  const hover = uniform(0);                      // 0..1: staat de muis erop
  const pop = uniform(0);                        // 1 -> 0 na een klik: de vormen ploppen terug
  // Shadertoy toont zijn kleur zoals ze is (sRGB); three rekent lineair
  const node = pow(rug({ p, aspect: float(aspect), iTime: time, seed, mouse, hover, pop }), float(2.2));
  return { node, time, seed, mouse, hover, pop };
}
