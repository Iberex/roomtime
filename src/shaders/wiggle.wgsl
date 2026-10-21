// "Wigglestrips" door cacheflowe — https://www.shadertoy.com/view/lsjBRD (CC BY-NC-SA 3.0)
// Geport van GLSL naar WGSL voor het tapijt van de jaren '90: golvende strepen met ruis die traag deinen.
// Voor de jaren '90 aangepast:
//  - kleuren: niet zwart-wit maar de banden van het tapijt in Blender (Mat_d90_tapijt_memphis in room.blend:
//    marineblauw, turkoois, marineblauw, mosterdgeel, magenta)
//  - minder en bredere strepen: in het origineel groeit hun aantal met de pixelhoogte van het scherm
//  - interactie: rond de muis rimpelen de strepen (mouse, hover); klikken verschuift ze met een golfstoot (seed, pop)
// de hoofdfunctie staat eerst (wgslFn leest haar signatuur), de helpers en constanten volgen
// p: positie op het tapijt, y van 0 tot 1 (diepte), x van 0 tot aspect (breedte / diepte); mouse in dezelfde maat
fn wiggle(p: vec2f, aspect: f32, iTime: f32, seed: f32, mouse: vec2f, hover: f32, pop: f32) -> vec3f {
  // (2 * fragCoord - iResolution.xy) / iResolution.y
  var uv = (p - vec2f(aspect * 0.5, 0.5)) * 2.0;
  let m = (mouse - vec2f(aspect * 0.5, 0.5)) * 2.0;

  // rimpeling rond de muis, en een golfstoot na een klik
  let d = length(uv - m);
  let ripple = exp(-d * d * 6.0) * sin(d * 18.0 - iTime * 5.0);
  uv.x += (hover * 0.12 + pop * 0.3) * ripple;

  uv.x += 0.2 * sin(iTime + uv.y * 4.0);
  uv.x += seed * 0.37;
  let numLines = WIGGLE_LINES + p.y * WIGGLE_LINES * 0.6; // naar boven toe meer strepen, zoals in het origineel
  let colNoise = wiggleNoise(0.6 * uv.x * numLines);
  let colStripes = 0.5 + 0.5 * sin(uv.x * numLines * 0.75);
  let col = mix(colNoise, colStripes, 0.5 + 0.5 * sin(iTime));
  return wiggleRamp(fract(col + seed * 0.13));
}

const WIGGLE_LINES = 7.0;

// simpele ruis, zoals in het origineel (https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83)
fn wiggleRand(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}
fn wiggleNoise(p: f32) -> f32 {
  let fl = floor(p);
  let fc = fract(p);
  return mix(wiggleRand(fl), wiggleRand(fl + 1.0), fc);
}

// de kleurbanden van het tapijt (constante overgangen, lineaire kleuren zoals in Blender)
fn wiggleRamp(v: f32) -> vec3f {
  var c = vec3f(0.03, 0.05, 0.2);                 // marineblauw
  if (v >= 0.3) { c = vec3f(0.05, 0.42, 0.44); }  // turkoois
  if (v >= 0.55) { c = vec3f(0.03, 0.05, 0.2); }  // marineblauw
  if (v >= 0.75) { c = vec3f(0.9, 0.62, 0.1); }   // mosterdgeel
  if (v >= 0.88) { c = vec3f(0.75, 0.1, 0.45); }  // magenta
  return c;
}
