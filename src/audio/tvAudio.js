/**
 * Het geluid van de tv, zoals het uit een toestel van zijn tijd kwam.
 *
 * Eén vaste keten; een kamer uit een ander decennium krijgt enkel een ander profiel:
 *
 *   video ─┐
 *   toon  ─┼─► mono ─► highpass ─► lowpass ─► peaking ─► vervorming ─► compressor ─► uit
 *   ruis  ─┘                  └◄─ brom (na de highpass, zoals in de versterker)
 */

// Profiel '70: mono, klein luidsprekertje, buizenversterker
export const PROFILE_70 = {
  low: 200, high: 5000,          // bereik van de speaker (Hz)
  peakFreq: 1500, peakGain: 4,   // kastresonantie: nasaal, "doosachtig"
  drive: 0.35,                   // buizenvervorming 0..1
  hum: 0.012,                    // 50 Hz netbrom
  noise: 0.006, noiseGlitch: 0.1, // ruis in rust / extra tijdens glitch
  noiseReception: 0.25,          // extra bij slechte ontvangst (antennes)
  tone: 1000, toneLevel: 0.02,   // testtoon onder het testbeeld
};

// Profiel '80: groter toestel met transistorversterker, voller en helderder, nauwelijks brom
export const PROFILE_80 = {
  low: 110, high: 9000,
  peakFreq: 2500, peakGain: 2,
  drive: 0.12,
  hum: 0.003,
  noise: 0.004, noiseGlitch: 0.08, noiseReception: 0.2,
  tone: 1000, toneLevel: 0.02,
};

// Profiel '90: een Trinitron met grotere luidsprekers: breed en helder, geen brom, amper ruis
export const PROFILE_90 = {
  low: 70, high: 14000,
  peakFreq: 3000, peakGain: 1,
  drive: 0.05,
  hum: 0.0008,
  noise: 0.0012, noiseGlitch: 0.025, noiseReception: 0.08,
  tone: 1000, toneLevel: 0.02,
};

// zachte verzadiging (tanh), sterker naarmate drive hoger is
function tubeCurve(drive) {
  const k = 1 + drive * 8, n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

// zelfde glitch-lus als de shader: SS(DURATION * .001, DURATION * AMT, mod(t, DURATION))
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const glitchLoop = (t) => { const s = smooth(0.005, 2.5, t % 5); return s * (1 - s); };

export function createTvAudio(videos, profile = PROFILE_70) {
  let ctx = null, n = null;
  let powered = true, volume = 0.6; // volumeknop 0..1
  let onVideo = false;

  function build() {
    ctx = new AudioContext();
    const p = profile;

    // mono: één kanaal, de browser mixt links en rechts samen
    const mono = new GainNode(ctx, { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: p.low, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: p.high, Q: 0.7 });
    const peak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: p.peakFreq, Q: 1.2, gain: p.peakGain });
    const tube = new WaveShaperNode(ctx, { curve: tubeCurve(p.drive), oversample: '2x' });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -24, ratio: 6, attack: 0.005, release: 0.2 });
    const out = new GainNode(ctx, { gain: powered ? volume * 1.5 : 0 });
    mono.connect(hp).connect(lp).connect(peak).connect(tube).connect(comp).connect(out).connect(ctx.destination);

    // video (MediaElementSource neemt het geluid van het element over)
    const videoGain = new GainNode(ctx, { gain: 0 });
    videoGain.connect(mono);
    for (const v of videos) new MediaElementAudioSourceNode(ctx, { mediaElement: v }).connect(videoGain);

    const toneGain = new GainNode(ctx, { gain: 0 });
    const tone = new OscillatorNode(ctx, { type: 'sine', frequency: p.tone });
    tone.connect(toneGain).connect(mono);

    // netbrom: zaagtand van 50 Hz, enkel de lage boventonen
    const humGain = new GainNode(ctx, { gain: p.hum });
    const humLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400 });
    const hum = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 50 });
    hum.connect(humLp).connect(humGain).connect(lp);

    // ruis: 2 s witte ruis in een lus
    const buf = new AudioBuffer({ length: ctx.sampleRate * 2, sampleRate: ctx.sampleRate });
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseGain = new GainNode(ctx, { gain: 0 });
    const noise = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    noise.connect(noiseGain).connect(mono);

    for (const src of [tone, hum, noise]) src.start();
    n = { videoGain, toneGain, noiseGain, out };
  }

  return {
    /** Moet vanuit een klik gebeuren (autoplay-regels van de browser). */
    start() {
      if (ctx) return ctx.resume();
      build();
      for (const v of videos) v.muted = false; // het geluid loopt nu via de keten
    },
    /** true = een uitzending, false = testbeeld met testtoon */
    setChannel(video) {
      onVideo = video;
      if (!ctx) return;
      const t = ctx.currentTime, p = profile;
      n.videoGain.gain.setTargetAtTime(onVideo ? 1 : 0, t, 0.02);
      n.toneGain.gain.setTargetAtTime(onVideo ? 0 : p.toneLevel, t, 0.02);
    },
    /** stekker uit: alles stil (met een kort 'plop'-uitsterven) */
    setPower(on) {
      powered = on;
      if (!ctx) return;
      n.out.gain.setTargetAtTime(on ? volume * 1.5 : 0, ctx.currentTime, on ? 0.15 : 0.03);
    },
    /** 0 (stil) … 1 (luid) */
    setVolume(v) {
      volume = v;
      if (ctx && powered) n.out.gain.setTargetAtTime(volume * 1.5, ctx.currentTime, 0.05);
    },
    /** elke frame: ruis volgt de glitch van het beeld; snow = slechte ontvangst (0..1): het signaal zakt weg in de ruis */
    update(time, boost, snow = 0) {
      if (!ctx) return;
      const g = Math.min(glitchLoop(time) + boost, 1.4), t = ctx.currentTime, p = profile;
      n.noiseGain.gain.setTargetAtTime(p.noise + g * p.noiseGlitch + snow * p.noiseReception, t, 0.03);
      const signal = 1 - 0.85 * snow;
      n.videoGain.gain.setTargetAtTime(onVideo ? signal : 0, t, 0.03);
      n.toneGain.gain.setTargetAtTime(onVideo ? 0 : p.toneLevel * signal, t, 0.03);
    },
  };
}
