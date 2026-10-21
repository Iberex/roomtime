/**
 * "2D Clouds" door drift — https://www.shadertoy.com/view/4tdSWr
 *
 * De lucht achter het raam van de jaren '80: geport naar WGSL (sky.wgsl), net als de glitch-shader.
 * iTime is een uniform die main.js elke frame bijwerkt. fragCoord / iResolution wordt de positie op het
 * vlak (de uv's van het luchtvlak liggen gedraaid): onderaan 0, bovenaan 1, de breedte in dezelfde maat.
 */
import { wgslFn, uniform, positionLocal, vec2 } from 'three/tsl';
import skyShader from './sky.wgsl?raw';

const sky = wgslFn(skyShader);

/** @param {Box3} box - doos van de geometrie van het luchtvlak (lokaal) */
export function createSky(box) {
  const time = uniform(0); // iTime
  const h = box.max.y - box.min.y;
  const p = vec2(positionLocal.x.sub(box.min.x), positionLocal.y.sub(box.min.y)).div(h);
  return { node: sky({ p, iTime: time }), time };
}
