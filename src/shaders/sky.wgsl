// "2D Clouds" door drift — https://www.shadertoy.com/view/4tdSWr
// Geport van GLSL naar WGSL: een blauwe daglucht met traag drijvende wolken.
// de hoofdfunctie staat eerst (wgslFn leest haar signatuur), de helpers en constanten volgen
// p: positie op het vlak, y van 0 (onder) tot 1 (boven), x in dezelfde maat (= uv * vec2(aspect, 1) in het origineel)
fn sky(p: vec2f, iTime: f32) -> vec3f {
  var time = iTime * SKY_SPEED;
  let q = skyFbm(p * SKY_SCALE * 0.5);

  // ridged noise shape
  var r = 0.0;
  var uv = p * SKY_SCALE - (q - time);
  var weight = 0.8;
  for (var i = 0; i < 8; i++) {
    r += abs(weight * skyNoise(uv));
    uv = SKY_M * uv + time;
    weight *= 0.7;
  }

  // noise shape
  var f = 0.0;
  uv = p * SKY_SCALE - (q - time);
  weight = 0.7;
  for (var i = 0; i < 8; i++) {
    f += weight * skyNoise(uv);
    uv = SKY_M * uv + time;
    weight *= 0.6;
  }
  f *= r + f;

  // noise colour
  var c = 0.0;
  time = iTime * SKY_SPEED * 2.0;
  uv = p * SKY_SCALE * 2.0 - (q - time);
  weight = 0.4;
  for (var i = 0; i < 7; i++) {
    c += weight * skyNoise(uv);
    uv = SKY_M * uv + time;
    weight *= 0.6;
  }

  // noise ridge colour
  var c1 = 0.0;
  time = iTime * SKY_SPEED * 3.0;
  uv = p * SKY_SCALE * 3.0 - (q - time);
  weight = 0.4;
  for (var i = 0; i < 7; i++) {
    c1 += abs(weight * skyNoise(uv));
    uv = SKY_M * uv + time;
    weight *= 0.6;
  }
  c += c1;

  let skycolour = mix(SKY_COL2, SKY_COL1, p.y);
  let cloudcolour = vec3f(1.1, 1.1, 0.9) * clamp(SKY_DARK + SKY_LIGHT * c, 0.0, 1.0);
  f = SKY_COVER + SKY_ALPHA * f * r;
  return mix(skycolour, clamp(SKY_TINT * skycolour + cloudcolour, vec3f(0.0), vec3f(1.0)), clamp(f + c, 0.0, 1.0));
}

const SKY_SCALE = 1.1;
const SKY_SPEED = 0.03;
const SKY_DARK = 0.5;
const SKY_LIGHT = 0.3;
const SKY_COVER = 0.2;
const SKY_ALPHA = 8.0;
const SKY_TINT = 0.5;
const SKY_COL1 = vec3f(0.2, 0.4, 0.6);
const SKY_COL2 = vec3f(0.4, 0.7, 1.0);
const SKY_M = mat2x2f(1.6, 1.2, -1.2, 1.6);

fn skyHash(p: vec2f) -> vec2f {
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

fn skyNoise(p: vec2f) -> f32 {
  let K1 = 0.366025404; // (sqrt(3)-1)/2
  let K2 = 0.211324865; // (3-sqrt(3))/6
  let i = floor(p + (p.x + p.y) * K1);
  let a = p - i + (i.x + i.y) * K2;
  let o = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), a.x > a.y);
  let b = a - o + K2;
  let c = a - 1.0 + 2.0 * K2;
  let h = max(0.5 - vec3f(dot(a, a), dot(b, b), dot(c, c)), vec3f(0.0));
  let n = h * h * h * h * vec3f(dot(a, skyHash(i + 0.0)), dot(b, skyHash(i + o)), dot(c, skyHash(i + 1.0)));
  return dot(n, vec3f(70.0));
}

fn skyFbm(p: vec2f) -> f32 {
  var n = p;
  var total = 0.0;
  var amplitude = 0.1;
  for (var i = 0; i < 7; i++) {
    total += skyNoise(n) * amplitude;
    n = SKY_M * n;
    amplitude *= 0.4;
  }
  return total;
}
