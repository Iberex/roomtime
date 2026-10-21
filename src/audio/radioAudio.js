/**
 * Het geluid van de radio-cassettespeler uit de jaren '80.
 *
 *   cassette ─► wow & flutter (toonhoogte zwiept licht) ─┐
 *                                                         ├─► highpass ─► bas ─► hoog eraf ─► vervorming ─► compressor ─► uit
 *   mechaniek: klik, klonk (gesynthetiseerd)             ─┘
 *
 * De nummers zijn gewone <audio>-elementen; hun geluid loopt via MediaElementSource door de keten.
 */

// zachte verzadiging, een goedkoop eindtrapje
function softClip(drive) {
  const k = 1 + drive * 6, n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export function createRadioAudio(tracks, gains = []) {
  const els = tracks.map((src) => Object.assign(new Audio(), { loop: true, preload: 'none', preservesPitch: false }, src && { src }));
  let ctx = null, n = null, playing = null, volume = 1;
  let spec = null, avg = 0, pulse = 0, lastT = 0, n_an = null;

  function build() {
    ctx = new AudioContext();
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 70, Q: 0.7 });
    const bass = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 110, Q: 0.9, gain: 4 }); // "bass boost"-knop
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 8000, gain: -6 });   // de band verliest hoog
    const clip = new WaveShaperNode(ctx, { curve: softClip(0.2), oversample: '2x' });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -20, ratio: 4, attack: 0.01, release: 0.25 });
    const out = new GainNode(ctx, { gain: volume });
    hp.connect(bass).connect(high).connect(clip).connect(comp).connect(out).connect(ctx.destination);

    // per nummer een eigen niveau: de opnames liggen allemaal veel te hard (-10 LUFS, pieken boven 0 dBFS)
    els.forEach((el, i) => {
      new MediaElementAudioSourceNode(ctx, { mediaElement: el })
        .connect(new GainNode(ctx, { gain: gains[i] ?? 1 })).connect(hp);
    });

    // de bas van wat de luidspreker écht uitzendt: de radio danst mee op de kick
    const an = new AnalyserNode(ctx, { fftSize: 512, smoothingTimeConstant: 0.3 });
    out.connect(an);
    spec = new Uint8Array(an.frequencyBinCount);
    n_an = an;

    // ruisbuffer enkel voor de mechaniek-klikken (geen doorlopende taperuis meer)
    const buf = new AudioBuffer({ length: ctx.sampleRate * 2, sampleRate: ctx.sampleRate });
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n = { hp, out, buf };
  }

  // mechaniek: korte ruisstoot door een bandfilter + een doffe dreun van de kast
  function mech(freq, level, thump) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = new AudioBufferSourceNode(ctx, { buffer: n.buf });
    const g = new GainNode(ctx, { gain: 0 });
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: freq, Q: 2 })).connect(g).connect(n.out);
    src.start(t, Math.random(), 0.08);
    if (thump) {
      const o = new OscillatorNode(ctx, { type: 'sine', frequency: 140 });
      const og = new GainNode(ctx, { gain: 0 });
      o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      og.gain.setValueAtTime(thump, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(og).connect(n.out);
      o.start(t);
      o.stop(t + 0.15);
    }
  }

  return {
    /** Moet vanuit een klik gebeuren (autoplay-regels van de browser). */
    start() {
      if (ctx) return ctx.resume();
      build();
    },
    insert() { mech(900, 0.5, 0.6); },
    eject() { mech(2200, 0.35, 0.3); },
    key() { mech(3000, 0.25, 0.15); },
    /** nummer i afspelen (null = stoppen); begint waar die cassette gebleven was */
    play(i) {
      if (playing !== null && playing !== i) els[playing].pause();
      playing = i;
      if (i === null) return;
      els[i].play().catch(() => {});
    },
    get playing() { return playing; },
    /** afspeelpositie (s) van het lopende nummer, 0 als er niets speelt */
    get time() { return playing === null ? 0 : els[playing].currentTime; },
    /** 0..1: hoe hard de bas nu stoot (voor het dansen van de kast) */
    get pulse() { return pulse; },
    /** nummer i krijgt (later) een bron, bv. de gerenderde mixtape */
    setSource(i, src) { els[i].src = src; },
    /** 0 = stil (ander decennium) … 1 */
    setVolume(v) {
      volume = v;
      if (ctx) n.out.gain.setTargetAtTime(v, ctx.currentTime, 0.15);
    },
    /** elke frame: wow (traag) en flutter (snel) van de bandloop, als toonhoogte */
    update(t) {
      const dt = Math.min(0.1, t - lastT); lastT = t;
      if (n_an && playing !== null) {
        n_an.getByteFrequencyData(spec);
        const hz = ctx.sampleRate / n_an.fftSize; // breedte van een bin
        let low = 0, c = 0;
        for (let i = Math.max(1, Math.round(50 / hz)); i <= Math.round(180 / hz); i++, c++) low += spec[i];
        low /= Math.max(1, c) * 255;
        avg += (low - avg) * Math.min(1, dt * 3);                  // het langzame gemiddelde
        const hit = Math.max(0, low - avg * 1.05) * 4 + low * 0.25; // een stoot boven het gemiddelde = een kick
        pulse = Math.max(Math.min(1, hit), pulse * Math.exp(-dt * 9));
      } else pulse *= Math.exp(-dt * 9);
      if (playing === null) return;
      els[playing].playbackRate = 1 + 0.0035 * Math.sin(t * 2 * Math.PI * 0.55) + 0.0012 * Math.sin(t * 2 * Math.PI * 6.3);
    },
  };
}

/**
 * Een zelfgemaakte synthpop-mixtape (118 bpm, Am–F–C–G): drumcomputer, synthbas en arpeggio,
 * eenmalig gerenderd met een OfflineAudioContext en als WAV-blob afgespeeld zoals de andere nummers.
 */
export async function renderMixtape() {
  const SR = 44100, BPM = 118, beat = 60 / BPM, bars = 8, len = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
  const master = new GainNode(ctx, { gain: 0.5 });
  const verb = new DelayNode(ctx, { delayTime: beat * 0.75 });
  const fb = new GainNode(ctx, { gain: 0.3 });
  master.connect(ctx.destination);
  verb.connect(fb).connect(verb);
  verb.connect(new GainNode(ctx, { gain: 0.25 })).connect(ctx.destination);
  master.connect(verb);

  const noise = new AudioBuffer({ length: SR, sampleRate: SR });
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

  const env = (g, t, a, peak, d) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const kick = (t) => {
    const o = new OscillatorNode(ctx, { frequency: 150 }), g = new GainNode(ctx);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    env(g, t, 0.002, 1, 0.3);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.35);
  };
  const hit = (t, freq, q, peak, d) => {
    const s = new AudioBufferSourceNode(ctx, { buffer: noise }), g = new GainNode(ctx);
    env(g, t, 0.001, peak, d);
    s.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: freq, Q: q })).connect(g).connect(master);
    s.start(t, Math.random() * 0.5, d + 0.05);
  };
  const synth = (t, midi, dur, type, peak, cutoff) => {
    for (const det of [-7, 7]) {
      const o = new OscillatorNode(ctx, { type, frequency: mtof(midi), detune: det }), g = new GainNode(ctx);
      env(g, t, 0.01, peak, dur);
      o.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cutoff, Q: 4 })).connect(g).connect(master);
      o.start(t); o.stop(t + dur + 0.1);
    }
  };

  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  for (let bar = 0; bar < bars; bar++) {
    const c = chords[bar % 4], t0 = bar * 4 * beat;
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      kick(t);
      if (b % 2) hit(t, 1800, 0.8, 0.6, 0.18);          // snare op 2 en 4
      hit(t + beat / 2, 8000, 1, 0.18, 0.04);           // open hihat tussendoor
      hit(t, 9000, 1, 0.1, 0.02);
      synth(t, c[0] - 24, beat * 0.45, 'sawtooth', 0.22, 700);             // bas, achtsten
      synth(t + beat / 2, c[0] - 24, beat * 0.45, 'sawtooth', 0.18, 700);
    }
    for (let s = 0; s < 16; s++) { // arpeggio in zestienden
      const note = c[[0, 1, 2, 1][s % 4]] + 12 * (s % 8 < 4 ? 1 : 0);
      synth(t0 + s * beat / 4, note, beat * 0.2, 'square', 0.05, 2600);
    }
    synth(t0, c[0], 4 * beat * 0.95, 'sawtooth', 0.04, 1500); // pad
    synth(t0, c[2], 4 * beat * 0.95, 'sawtooth', 0.03, 1500);
  }

  const buf = await ctx.startRendering();
  return URL.createObjectURL(new Blob([wav(buf)], { type: 'audio/wav' }));
}

// AudioBuffer -> 16-bit WAV
function wav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true); data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++, o += 2) data.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 0x7fff, true);
  return data.buffer;
}
