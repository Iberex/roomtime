// Glitchy Glitch by piyushslayer - https://www.shadertoy.com/view/wld3WN
// the main function comes first (wgslFn reads its signature), helper functions follow below
// parameters after iChannel0Sampler are new (interaction), marked with "interaction:" in the code
// clean (0..1): a better set (the Trinitron of the '90s): far less noise, finer scanlines, no blocks between the
// glitch bursts, less wobble. 0 = the original look (the '70s and '80s)
fn glitch(
  fragCoord: vec2f, iTime: f32, iFrame: f32, iResolution: vec2f,
  iChannel0: texture_2d<f32>, iChannel0Sampler: sampler,
  boost: f32, magnet: vec2f, magnetStrength: f32, power: f32, snow: f32, clean: f32
) -> vec4f {
  let DURATION = 5.0;
  let AMT = 0.5;
  let screenUv = fragCoord / iResolution;

  // interaction: power-on. The tube first 'grows' as a horizontal line, then opens up.
  let pv = clamp(power * 2.2, 0.0, 1.0);
  let ph = clamp(power * 1.6 - 0.35, 0.004, 1.0);
  let uv0 = (screenUv - 0.5) / vec2f(max(pv, 0.002), ph) + 0.5;

  // smoothed interval for which the glitch gets triggered (interaction: + boost on channel switch)
  let glitchAmount = clamp(SS(DURATION * 0.001, DURATION * AMT, iTime % DURATION) * (1.0 - 0.85 * clean) + boost, 0.0, 1.4);
  let dirty = 1.0 - 0.8 * clean; // interaction: how much of the constant noise, scanlines and wobble remains
  let displayNoise = 1.0;
  var col = vec3f(0.0);
  let eps = vec2f(5.0 / iResolution.x, 0.0);

  // CRT
  let uv = crt(uv0 * 2.0 - 1.0);

  // analog distortion
  let y = uv.y * iResolution.y;
  var distortion = gnoise(vec3f(0.0, y * 0.01, iTime * 500.0)) * (glitchAmount * 4.0 + 0.1 * dirty);
  distortion *= gnoise(vec3f(0.0, y * 0.02, iTime * 250.0)) * (glitchAmount * 2.0 + 0.025 * dirty);

  // interaction: bad reception (antennas, snow 0..1). Rows tear sideways, and with a very weak signal
  // the vertical hold gives up: the picture rolls
  let rowJitter = hash33(vec3f(0.0, floor(y * 0.5), floor(iTime * 24.0))).x;
  distortion += rowJitter * 0.012 * snow * snow;
  let roll = smoothstep(0.7, 1.0, snow) * fract(iTime * 0.4);

  // ANALOG
  distortion += smoothstep(0.999, 1.0, sin((uv.y + iTime * 1.6) * 2.0)) * 0.02 * dirty;
  distortion -= smoothstep(0.999, 1.0, sin((uv.y + iTime) * 2.0)) * 0.02 * dirty;

  // interaction: a magnet against a CRT bends the electron beam -> local swirl + color shift
  let toM = uv - magnet;
  let fall = exp(-dot(toM, toM) * 38.0) * magnetStrength;
  distortion += sin(toM.y * 40.0 + iTime * 6.0) * 0.012 * fall;
  let swirl = vec2f(-toM.y, toM.x) * fall * 0.25;

  var st = uv + vec2f(distortion, 0.0) + swirl;
  st.y = select(st.y, fract(st.y + roll), roll > 0.0);
  // chromatic aberration
  let ca = eps * (dirty + fall * 6.0);
  col.r += textureSampleLevel(iChannel0, iChannel0Sampler, st + ca + distortion, 0.0).r;
  col.g += textureSampleLevel(iChannel0, iChannel0Sampler, st, 0.0).g;
  col.b += textureSampleLevel(iChannel0, iChannel0Sampler, st - ca - distortion, 0.0).b;
  // interaction: magnet stain, green/purple discoloration like on a real tube
  col *= mix(vec3f(1.0), vec3f(1.25, 0.7, 1.35), fall * 0.8);

  // DIGITAL: blocky distortion
  let bt = floor(iTime * 30.0) * 300.0;
  let blockGlitch = 0.2 * dirty * dirty + 0.9 * glitchAmount;
  let blockNoiseX = step(gnoise01(vec3f(0.0, uv.x * 3.0, bt)), blockGlitch);
  let blockNoiseX2 = step(gnoise01(vec3f(0.0, uv.x * 1.5, bt * 1.2)), blockGlitch);
  let blockNoiseY = step(gnoise01(vec3f(0.0, uv.y * 4.0, bt)), blockGlitch);
  let blockNoiseY2 = step(gnoise01(vec3f(0.0, uv.y * 6.0, bt * 1.2)), blockGlitch);
  var block = blockNoiseX2 * blockNoiseY2 + blockNoiseX * blockNoiseY;
  let st2 = vec2f(uv.x + sin(bt) * hash33(vec3f(uv, 0.5)).x, uv.y);
  col *= 1.0 - block;
  block *= 1.15;
  col.r += textureSampleLevel(iChannel0, iChannel0Sampler, st2 + eps, 0.0).r * block;
  col.g += textureSampleLevel(iChannel0, iChannel0Sampler, st2, 0.0).g * block;
  col.b += textureSampleLevel(iChannel0, iChannel0Sampler, st2 - eps, 0.0).b * block;

  // interaction: bad reception. A ghost image from a reflected signal next to the picture, colour fading
  // away, and snow: grains a bit wider than high, like the noise of an analog tuner
  let ghost = textureSampleLevel(iChannel0, iChannel0Sampler, st + vec2f(0.04, 0.0), 0.0).rgb;
  col = mix(col, (col + ghost * 0.6) / 1.6, smoothstep(0.1, 0.6, snow));
  col = mix(col, vec3f(dot(col, vec3f(0.299, 0.587, 0.114))), smoothstep(0.2, 0.8, snow) * 0.85);
  let grain = 0.5 + 0.5 * hash33(vec3f(floor(fragCoord / vec2f(3.0, 2.0)), iFrame % 1000.0)).x;
  col = mix(col, vec3f(grain * 1.1), snow * 0.9);

  // white noise + scanlines
  col += (0.15 * dirty + 0.65 * glitchAmount) * hash33(vec3f(fragCoord, iFrame % 1000.0)).r * displayNoise;
  col -= (0.25 * dirty + 0.75 * glitchAmount) * sin(4.0 * iTime + uv.y * iResolution.y * 1.75) * displayNoise;

  // crt vignette (from https://www.shadertoy.com/view/Ms23DR)
  let vig = 8.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
  col *= vec3f(pow(max(vig, 0.0), 0.25)) * 1.5;
  if (uv.x < 0.0 || uv.x > 1.0) {
    col *= 0.0;
  }

  // interaction: power-on, black outside the opened part, the line itself flashes brightly
  let inside = uv0.x >= 0.0 && uv0.x <= 1.0 && uv0.y >= 0.0 && uv0.y <= 1.0;
  let flash = 1.0 + (1.0 - ph) * 6.0;
  // switching off: the last dot in the middle fades out instead of staying lit
  let afterglow = smoothstep(0.0, 0.15, power);
  col = select(vec3f(0.0), max(col, vec3f(0.0)) * flash * afterglow, inside);

  return vec4f(col, 1.0);
}

// SS(a, b, x) = smoothstep(a, b, x) * smoothstep(b, a, x)
// smoothstep with reversed edges is undefined in WGSL, so smoothstep(b, a, x) becomes 1 - smoothstep(a, b, x)
fn SS(a: f32, b: f32, x: f32) -> f32 {
  let s = smoothstep(a, b, x);
  return s * (1.0 - s);
}

// Hash by David_Hoskins
fn hash33(p: vec3f) -> vec3f {
  let UI3 = vec3u(1597334673u, 3812015801u, 2798796415u);
  let UIF = 1.0 / f32(0xffffffffu);
  var q = vec3u(vec3i(p)) * UI3;
  q = vec3u(q.x ^ q.y ^ q.z) * UI3;
  return -1.0 + 2.0 * vec3f(q) * UIF;
}

// Gradient noise by iq
fn gnoise(x: vec3f) -> f32 {
  let p = floor(x);
  let w = fract(x);

  // quintic interpolant
  let u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);

  // gradients
  let ga = hash33(p + vec3f(0.0, 0.0, 0.0));
  let gb = hash33(p + vec3f(1.0, 0.0, 0.0));
  let gc = hash33(p + vec3f(0.0, 1.0, 0.0));
  let gd = hash33(p + vec3f(1.0, 1.0, 0.0));
  let ge = hash33(p + vec3f(0.0, 0.0, 1.0));
  let gf = hash33(p + vec3f(1.0, 0.0, 1.0));
  let gg = hash33(p + vec3f(0.0, 1.0, 1.0));
  let gh = hash33(p + vec3f(1.0, 1.0, 1.0));

  let va = dot(ga, w - vec3f(0.0, 0.0, 0.0));
  let vb = dot(gb, w - vec3f(1.0, 0.0, 0.0));
  let vc = dot(gc, w - vec3f(0.0, 1.0, 0.0));
  let vd = dot(gd, w - vec3f(1.0, 1.0, 0.0));
  let ve = dot(ge, w - vec3f(0.0, 0.0, 1.0));
  let vf = dot(gf, w - vec3f(1.0, 0.0, 1.0));
  let vg = dot(gg, w - vec3f(0.0, 1.0, 1.0));
  let vh = dot(gh, w - vec3f(1.0, 1.0, 1.0));

  return 2.0 * (va +
    u.x * (vb - va) +
    u.y * (vc - va) +
    u.z * (ve - va) +
    u.x * u.y * (va - vb - vc + vd) +
    u.y * u.z * (va - vc - ve + vg) +
    u.z * u.x * (va - vb - ve + vf) +
    u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh));
}

// gradient noise in range [0, 1]
fn gnoise01(x: vec3f) -> f32 {
  return 0.5 + 0.5 * gnoise(x);
}

// warp uvs for the crt effect
fn crt(uvIn: vec2f) -> vec2f {
  let tht = atan2(uvIn.y, uvIn.x);
  var r = length(uvIn);
  // curve without distorting the center
  r /= (1.0 - 0.1 * r * r);
  return vec2f(r * cos(tht) * 0.5 + 0.5, r * sin(tht) * 0.5 + 0.5);
}
