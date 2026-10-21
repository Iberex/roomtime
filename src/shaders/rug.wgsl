// "Genuary #15: Design a rug" door Flopine — https://www.shadertoy.com/view/MXtfz8 (CC BY-NC-SA 3.0)
// Geport van GLSL naar WGSL voor de poster van de jaren '90: Bauhaus-tegels (kwartcirkels, strepen, bladvormen,
// ruiten) in geel, rood, blauw en zwart, met een geweven stofstructuur, die traag naar boven schuiven.
// Voor de jaren '90 aangepast:
//  - kleuren: turkoois, hot pink, paars en mosterdgeel in plaats van Bauhaus-rood, -geel en -blauw
//  - interactie: de tegels rond de muis draaien weg (mouse, hover); klikken geeft een nieuw patroon (seed) en de
//    vormen ploppen even (pop)
// Verschillen met het origineel:
//  - de ruistextuur van Shadertoy (iChannel0, 256 × 256, lineair gefilterd) wordt hier berekend (rugNoise)
//  - fwidth mag in WGSL niet binnen de keuze per tegel: de pixelbreedte wordt bovenaan één keer bepaald en alle
//    vormen worden berekend, daarna wordt er een gekozen (zelfde beeld)
// de hoofdfunctie staat eerst (wgslFn leest haar signatuur), de helpers en constanten volgen
// p: positie op de poster, y van 0 (onder) tot 1 (boven), x van 0 tot aspect (breedte / hoogte); mouse in dezelfde maat
fn rug(p: vec2f, aspect: f32, iTime: f32, seed: f32, mouse: vec2f, hover: f32, pop: f32) -> vec3f {
  // fragCoord / iResolution: de poster als een beeld van RUG_RES pixels hoog
  var uv = p - vec2f(aspect * 0.5, 0.5);
  uv.y += iTime * 0.25;
  let uu = vec2f(p.x, p.y + iTime * 0.25); // uu * iResolution.xy / iResolution.y

  let weave = smoothstep(0.45, 0.99, rugNoi(uu * RUG_RES / 500.0));
  uv *= 3.0;
  uv += (weave * 2.0 - 1.0) * 0.005;
  let w = max(fwidth(uv.x), fwidth(uv.y)); // pixelbreedte (de afstandsvelden hebben helling 1)

  let grid = rugGrid(uv);
  // de tegels rond de muis draaien weg (tot een kwartslag); klikken: de vormen krimpen en ploppen terug
  var m = mouse - vec2f(aspect * 0.5, 0.5);
  m.y += iTime * 0.25;
  let near = hover * smoothstep(1.3, 0.2, length(grid.zw - m * 3.0));
  let g = rugRot(grid.xy, near * RUG_PI * 0.5) * (1.0 + 1.5 * pop);
  let ofs = vec2f(seed * 0.137, seed * 0.291); // elk patroon (seed) een andere plek in de ruis
  let n = rugNoi(grid.zw * 0.24 + ofs);

  let d1 = rugPattern1(select(rugRot(g, -RUG_PI / 2.0), rugRot(g, RUG_PI), n < 0.9 / 5.0), w);
  let d2 = rugPattern2(g, w);
  let d3 = rugPattern3(select(rugRot(g, -RUG_PI / 4.0), rugRot(g, RUG_PI / 4.0), n < 2.5 / 5.0), w);
  let d4 = rugPattern4(g, w);
  var d = d4;
  if (n < 3.5 / 5.0) { d = 0.0; }
  if (n < 3.0 / 5.0) { d = d3; }
  if (n < 2.0 / 5.0) { d = d2; }
  if (n < 1.0 / 5.0) { d = d1; }

  // de kleur per tegel, in het palet van de jaren '90 (als schermkleur: de shader geeft sqrt(col) terug)
  let k = rugNoi(grid.zw * 0.11 + ofs);
  var c = RUG_PURPLE;
  if (k < 3.0 / 4.0) { c = RUG_PINK; }
  if (k < 2.0 / 4.0) { c = RUG_TEAL; }
  if (k < 1.0 / 4.0) { c = RUG_YELLOW; }
  c *= c;

  // minder witte korrel dan het origineel (0.45): op de kleine poster maakte die de kleuren flets
  let matter = smoothstep(0.65, 0.99, rugNoi(uu * RUG_RES / 100.0));
  var col = clamp(vec3f(d) + c, vec3f(0.0), vec3f(1.0));
  col = mix(col, vec3f(0.5), matter);
  col = mix(col, vec3f(1.0), matter);
  return sqrt(col);
}

const RUG_PI = 3.14159265;
const RUG_TEAL = vec3f(0.0, 0.66, 0.66);    // #00a8a8
const RUG_PINK = vec3f(1.0, 0.17, 0.55);    // #ff2b8c
const RUG_PURPLE = vec3f(0.38, 0.17, 0.56); // #612b8f
const RUG_YELLOW = vec3f(1.0, 0.78, 0.15);  // #ffc726
const RUG_RES = 40.0; // de stofstructuur: in het origineel op een scherm van 720 pixels één korrel per ~2 pixels;
                        // de poster is op het scherm maar ~150 pixels hoog, dus grover, anders wordt het ruis

// iChannel0 van Shadertoy: 256 × 256 willekeurige texels, lineair gefilterd, herhalend
fn rugHash(i: vec2f) -> f32 {
  let q = (i % 256.0 + 256.0) % 256.0;
  return fract(sin(dot(q, vec2f(127.1, 311.7))) * 43758.5453);
}
fn rugNoi(p: vec2f) -> f32 {
  let x = p * 256.0 - 0.5;
  let i = floor(x);
  let f = x - i;
  let a = rugHash(i);
  let b = rugHash(i + vec2f(1.0, 0.0));
  let c = rugHash(i + vec2f(0.0, 1.0));
  let e = rugHash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}

// GLSL: v *= mat2(cos(a), sin(a), -sin(a), cos(a))
fn rugRot(v: vec2f, a: f32) -> vec2f {
  let c = cos(a);
  let s = sin(a);
  return vec2f(v.x * c + v.y * s, -v.x * s + v.y * c);
}

fn rugAA(thre: f32, val: f32, w: f32) -> f32 {
  return smoothstep(-0.7, 0.7, (val - thre) / min(0.02, w));
}

// https://iquilezles.org/articles/distfunctions2d/
fn rugVesica(q: vec2f, w: f32, h: f32) -> f32 {
  let d = 0.5 * (w * w - h * h) / h;
  let p = abs(q);
  let c = select(vec3f(-d, 0.0, d + h), vec3f(0.0, w, 0.0), w * p.y < d * (p.x - w));
  return length(p - c.yx) - c.z;
}

fn rugBox(u: vec2f, c: vec2f) -> f32 {
  let q = abs(u) - c;
  return min(0.0, max(q.x, q.y)) + length(max(q, vec2f(0.0)));
}

// ruitvormig raster: twee rasters een halve tegel verschoven, het dichtste midden wint (xy: in de tegel, zw: tegel)
fn rugGrid(u: vec2f) -> vec4f {
  let ua = fract(u) - 0.5;
  let ub = fract(u - 0.5) - 0.5;
  let guv = select(ub, ua, dot(ua, ua) < dot(ub, ub));
  return vec4f(guv, u - guv);
}

fn rugPattern1(v: vec2f, w: f32) -> f32 {
  let s = select(-1.0, 1.0, v.x < -v.y);
  let u = v + 0.25 * s;
  return rugAA(0.01, length(u) - 0.35, w);
}

fn rugPattern2(v: vec2f, w: f32) -> f32 {
  let per = 0.25;
  let x = v.x - per * floor(v.x / per) - per * 0.5; // GLSL mod
  return rugAA(0.01, abs(x) - 0.05, w);
}

fn rugPattern3(v: vec2f, w: f32) -> f32 {
  return rugAA(0.01, rugVesica(v.yx, 0.35, 0.2), w);
}

fn rugPattern4(v: vec2f, w: f32) -> f32 {
  let u = rugRot(v, RUG_PI / 4.0);
  let d = rugAA(0.01, abs(rugBox(u, vec2f(0.3))), w);
  return d * rugAA(0.01, rugBox(u, vec2f(0.23)), w);
}
