/**
 * "Wigglestrips" door cacheflowe — https://www.shadertoy.com/view/lsjBRD (CC BY-NC-SA 3.0)
 *
 * Het tapijt van de jaren '90: golvende strepen in zijn kleuren uit Blender, geport naar WGSL (wiggle.wgsl), net als
 * de lucht. iTime is een uniform die room90.js elke frame bijwerkt. fragCoord / iResolution wordt de positie op
 * het tapijt: achteraan 0, vooraan 1, de breedte in dezelfde maat.
 */
import * as THREE from 'three/webgpu';
import { wgslFn, uniform, float } from 'three/tsl';
import wiggleShader from './wiggle.wgsl?raw';

const wiggle = wgslFn(wiggleShader);

/**
 * @param {Node}   p      - positie op het tapijt (vec2): x van 0 tot aspect, y van 0 tot 1
 * @param {number} aspect - breedte / diepte van het tapijt
 */
export function createWiggle(p, aspect) {
  const time = uniform(0);                    // iTime
  const seed = uniform(0);                    // klikken: de strepen verschuiven, de kleuren schuiven door
  const mouse = uniform(new THREE.Vector2()); // waar de muis op het tapijt staat (zelfde maat als p)
  const hover = uniform(0);                   // 0..1: staat de muis erop (dan rimpelen de strepen eromheen)
  const pop = uniform(0);                     // 1 -> 0 na een klik: een golfstoot
  // de kleuren zijn die van het tapijt in Blender: al lineair, zoals three rekent
  const node = wiggle({ p, aspect: float(aspect), iTime: time, seed, mouse, hover, pop });
  return { node, time, seed, mouse, hover, pop };
}
