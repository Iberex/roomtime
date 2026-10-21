import * as THREE from 'three/webgpu';

import { createTv } from './tv.js';
import { createAntennas } from './antennas.js';
import { PROFILE_80 } from './audio/tvAudio.js';
import { createRadioAudio, renderMixtape } from './audio/radioAudio.js';

/**
 * Wat je in de kamer van de jaren '80 kunt doen:
 *  - de tv: zelfde Glitchy Glitch-shader als in de jaren '70, met uitzendingen uit de jaren '80.
 *    Klik op het scherm om te zappen, houd de muis erop voor het magneeteffect.
 *  - de cassettes op de salontafel: vastpakken en naar de radio slepen. Dicht bij de radio klapt het
 *    cassettevak open; loslaten en de cassette schuift erin en speelt. Klik op het vak om uit te werpen,
 *    op de toetsen of de kast om te pauzeren. Een andere cassette erin duwt de vorige eruit.
 *    Je kunt een cassette ook uit het vak trekken: vastpakken en wegslepen.
 *  - de lichtschakelaar aan de muur: kamerlicht aan en uit, zoals in de jaren '70.
 *  - de kaders aan de muur: van hun nagel trekken, gooien en terug ophangen aan een vrije nagel (frames.js).
 *
 * Alle posities hier zijn in de ruimte van de kamer (r), los van het draaitoneel.
 */

// het scherm van de tv (television_02): de opening in de kast, gemeten in het Blender-model (breedte 0.40 m),
// in de assen van het toestel (glTF: y omhoog, z naar voren). Het bakscript zet de schaal van de groep erboven
// in de mesh, dus alles wordt herschaald naar de breedte van de geometrie.
const TV_MODEL_WIDTH = 0.4;
const TV_SCREEN = { x: [-0.161, 0.158], y: [0.139, 0.375], bulge: 0.005 };

const BROADCASTS = [
  { src: 'video/smurfen.mp4', title: 'DE SMURFEN', sub: 'TEKENFILMREEKS · 1981' },
  { src: 'video/u2-live-aid.mp4', title: 'U2 · BAD', sub: 'LIVE AID, WEMBLEY · 1985' },
  { src: 'video/bende-van-nijvel.mp4', title: 'OVERVAL IN AALST', sub: 'BENDE VAN NIJVEL · 1985' },
  { src: 'video/berlijnse-muur.mp4', title: 'DE BERLIJNSE MUUR VALT', sub: 'SKY NEWS · 1989' },
];
// de zelf opgenomen bandjes: een stukje tape met de titel in alcoholstift (etiketten in blender/etiketten).
// bpm: sprongen per minuut (Take On Me: 169 bpm, één sprong per twee tellen); beat: tijdstip van de eerste tel.
// gain: de opnames zijn allemaal bijna -10 LUFS (Arno -15); dit brengt ze op één niveau, met ruimte voor de versterker.
// Staat een nummer nog niet in public/audio, dan speelt die cassette de zelfgemaakte synthpop-mixtape.
const CASSETTES = [
  { name: 'd80_cassette_1', label: 'a-ha · Take On Me', src: 'audio/take-on-me.mp3', gain: 0.29, bpm: 84.5, beat: 0.05 },
  { name: 'd80_cassette_2', label: 'Michael Jackson · Billie Jean', src: 'audio/billie-jean.mp3', gain: 0.3, bpm: 117, beat: 0.3 },
  { name: 'd80_cassette_3', label: 'TC Matic · Oh La La La', src: 'audio/oh-la-la-la-tcmatic.mp3', gain: 0.33, bpm: 106, beat: 0.52 },
];
export const RADIO_PARTS = ['Body', 'Radio013', 'Casette', 'Handle', 'Motor', 'Motor001', 'Switch', 'Switch001', 'Slider',
  'Roller001', 'Roller002', 'Roller003', ...Array.from({ length: 7 }, (_, i) => `Buttons00${i + 1}`)];

const NEAR = 0.07;      // wijst de muis naar de radio, of zo dicht (m) langs het vak, dan klapt het open en klikt de cassette erin
const ARM = 0.03;       // ... maar pas als de cassette zo ver (m) van waar je ze vastpakte is (ze ligt vlak voor de radio)
const LIFT = 0.04;      // vastgepakt zweeft de cassette zo hoog (m) boven de tafel
const FRONT_GAP = 0.09; // de cassette lijnt zich zo ver voor het vak uit, en schuift dan naar binnen

const ease = (t) => t * t * (3 - 2 * t);

export function setupRoom80({ r, card, onRoom, antennaMaterial, frames, cable }) {
  const get = (n) => r.getObjectByName(n);
  r.updateMatrixWorld(true);

  // ---------------------------------------------------------------- tv
  const tvBody = get('television_02');
  const tv = createTv({ broadcasts: BROADCASTS, card, profile: PROFILE_80 });
  const tvBox = new THREE.Box3();
  tvBody.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); tvBox.union(o.geometry.boundingBox); } });
  const k = (tvBox.max.x - tvBox.min.x) / TV_MODEL_WIDTH;
  const x = TV_SCREEN.x.map((v) => v * k), y = TV_SCREEN.y.map((v) => v * k), bulge = TV_SCREEN.bulge * k;
  const z = tvBox.max.z + 0.001;
  const geo = new THREE.PlaneGeometry(x[1] - x[0], y[1] - y[0], 16, 12);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { // licht bol, zoals een beeldbuis
    const u = pos.getX(i) / ((x[1] - x[0]) / 2), v = pos.getY(i) / ((y[1] - y[0]) / 2);
    pos.setZ(i, bulge * (1 - u * u) * (1 - v * v));
  }
  geo.computeVertexNormals();
  // uv zoals op het scherm van de jaren '70 (uit glTF): v loopt van boven naar onder
  const uvs = geo.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setY(i, 1 - uvs.getY(i));
  const screen = new THREE.Mesh(geo, tv.material);
  screen.name = 'd80_tv_scherm';
  screen.position.set((x[0] + x[1]) / 2, (y[0] + y[1]) / 2, z);
  tvBody.add(screen);
  screen.updateMatrixWorld(true);
  // dezelfde zilveren konijnenoren als op de tv van de jaren '70 (antennas.js), bovenop de kast
  const antennas = createAntennas({ tv: tvBody, box: tvBox, material: antennaMaterial });

  // ---------------------------------------------------------------- radio en cassettes
  const radio = RADIO_PARTS.map(get).filter(Boolean);
  const keys = Array.from({ length: 7 }, (_, i) => get(`Buttons00${i + 1}`)).filter(Boolean);
  const toRoom = r.matrixWorld.clone().invert();
  const door = get('Radio013');
  const deck = get('Casette'); // de cassette die in Blender in het vak zit: daar moet een cassette terechtkomen
  deck.visible = false;        // het vak begint leeg
  const slot = { pos: deck.position.clone(), quat: deck.quaternion.clone() };
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(slot.quat); // voorkant van de radio (glTF: +z)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(slot.quat);
  const preSlot = slot.pos.clone().addScaledVector(front, FRONT_GAP);

  // het klepje van het vak kantelt naar voren rond zijn onderrand
  const doorBox = new THREE.Box3();
  door.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); doorBox.union(o.geometry.boundingBox); } });
  const hinge = new THREE.Vector3(0, doorBox.min.y, doorBox.max.z);
  door.matrixAutoUpdate = false;
  const door0 = door.matrix.clone();
  const doorState = { open: 0, target: 0 };
  const _m = new THREE.Matrix4(), _h = new THREE.Matrix4(), _hi = new THREE.Matrix4();
  _h.makeTranslation(hinge.x, hinge.y, hinge.z);
  _hi.makeTranslation(-hinge.x, -hinge.y, -hinge.z);

  const table = new THREE.Box3().setFromObject(get('Cube002')).applyMatrix4(toRoom);
  const tapes = CASSETTES.map((c, i) => {
    const obj = get(c.name);
    return { ...c, i, obj, home: { pos: obj.position.clone(), quat: obj.quaternion.clone() }, rest: obj.position.y, anim: null };
  });
  let inDeck = null;
  // de radio danst mee: alle onderdelen zitten samen in één groep (main.js: piece), die we rond de voet laten springen.
  // De sprong loopt op de maat van het nummer (bpm + eerste tel per cassette, uitgemeten met ffmpeg), de hele song lang,
  // en wisselt elke sprong van kant: kantelen naar links, landen, kantelen naar rechts.
  const shell = radio[0]?.parent;
  const hop = { amp: 0, pivot: null, rest: true, m: new THREE.Matrix4() };
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _sc = new THREE.Vector3(), _tp = new THREE.Vector3();
  const HOP_H = 0.06, TILT = 0.38;
  function bounce(dt, playingTape, pulse) {
    if (!shell || shell === r) return;
    const on = playingTape && audio.time > 0;
    hop.amp += ((on ? 1 : 0) - hop.amp) * (1 - Math.exp(-dt * (on ? 10 : 7)));
    if (hop.amp < 0.003) {
      if (!hop.rest && hop.pivot) { shell.matrixAutoUpdate = true; shell.position.set(0, 0, 0); shell.updateMatrix(); hop.m.identity(); hop.rest = true; }
      return;
    }
    if (!hop.pivot) { // voet van de radio, in de ruimte van de kamer (de drop is dan allang klaar)
      const b = new THREE.Box3();
      for (const o of radio) b.expandByObject(o);
      b.applyMatrix4(toRoom);
      hop.pivot = new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
    }
    const tp = playingTape ?? tapes[0];
    const phase = Math.max(0, (audio.time - tp.beat) * tp.bpm / 60); // sprongen sinds de eerste tel
    const k = Math.floor(phase), u = phase - k, dir = k % 2 ? 1 : -1;
    const power = hop.amp * (0.85 + 0.3 * pulse);
    // u 0..0.78: in de lucht (boog), daarna door de knieën: inzakken, klaar voor de volgende
    const air = u < 0.78 ? u / 0.78 : 1;
    const arc = 4 * air * (1 - air);
    const crouch = u < 0.78 ? Math.max(0, 1 - u / 0.08) * 0.5 : Math.sin(Math.PI * (u - 0.78) / 0.22) * 0.8 + 0.2 * (u - 0.78) / 0.22;
    const lean = dir * TILT * Math.sin(Math.PI * air) * power; // kantelt tijdens de sprong, rechtop bij de landing
    const p = hop.pivot;
    _e.set(0.04 * Math.sin(Math.PI * air) * power, 0.25 * lean, lean);
    _q.setFromEuler(_e);
    const sy = 1 + (0.12 * arc - 0.2 * crouch) * power;     // rekken in de lucht, platdrukken bij het afzetten
    const sxz = 1 - (0.5 * (sy - 1));                       // zelfde volume
    _sc.set(sxz, sy, sxz);
    _tp.set(0, HOP_H * arc * power, 0);
    shell.matrixAutoUpdate = false;
    shell.matrix.compose(_tp, _q, _sc);
    // rond de voet: M = T(p) · (T(lift) R S) · T(-p)
    shell.matrix.premultiply(_m.makeTranslation(p.x, p.y, p.z)).multiply(_m.makeTranslation(-p.x, -p.y, -p.z));
    shell.matrixWorldNeedsUpdate = true;
    hop.rest = false;
    hop.m.copy(shell.matrix);
  }
  let manualDoor = false; // klepje met de hand open (leeg vak aangeklikt)
  // geluidsfocus: waar je het laatst mee bezig was (tv of radio); een spelende radio wint van de tv
  let focus = 'tv', active = false, tvVol = null, radioVol = null;

  const audio = createRadioAudio(tapes.map((t) => t.src), tapes.map((t) => t.gain));
  const label = document.getElementById('radio-label');
  let labelTime = 0;
  const showLabel = (text) => { label.textContent = text; labelTime = 4; };

  // animaties: een cassette glijdt van pose naar pose (positie + draaiing), eventueel in een boog
  // deck: de animatie gaat door het vak, dus het klepje moet open zijn; delay: wacht tot de vorige cassette eruit is.
  // Het klepje wordt elke frame uit de toestand afgeleid (update), niet uit losse callbacks die elkaar kunnen overschrijven.
  function fly(tape, to, dur, { arc = 0, then, deck = false, delay = 0 } = {}) {
    tape.anim = { from: { pos: tape.obj.position.clone(), quat: tape.obj.quaternion.clone() }, to, dur, t: 0, arc, then, deck, delay };
  }
  function insert(tape) {
    const push = inDeck && inDeck !== tape;
    if (push) eject({ push: true }); // een andere cassette erin duwt de vorige eruit
    inDeck = tape;
    manualDoor = false;
    fly(tape, { pos: preSlot, quat: slot.quat }, 0.35, {
      deck: true,
      delay: push ? 0.4 : 0,
      then: () => fly(tape, slot, 0.25, {
        deck: true,
        then: () => { audio.insert(); tape.timer = setTimeout(() => play(tape), 350); },
      }),
    });
  }
  function eject({ push = false } = {}) {
    const tape = inDeck;
    if (!tape) return;
    clearTimeout(tape.timer);
    inDeck = null;
    audio.play(null);
    audio.eject();
    // bij wegduwen springt ze een stukje omhoog, zodat de nieuwe cassette er niet doorheen schuift
    const out = push ? preSlot.clone().addScaledVector(up, 0.08) : preSlot;
    fly(tape, { pos: out, quat: slot.quat }, 0.3, {
      deck: true,
      then: () => fly(tape, tape.home, 0.6, { arc: 0.08 }),
    });
    labelTime = 0;
  }
  // uit het vak trekken: de band stopt en je hebt de cassette vast
  function pullOut() {
    const tape = inDeck;
    clearTimeout(tape.timer);
    inDeck = null;
    tape.anim = null;
    audio.play(null);
    audio.eject();
    labelTime = 0;
    return tape;
  }
  function play(tape) {
    if (inDeck !== tape) return;
    focus = 'radio';
    pressKey(1);
    audio.key();
    audio.play(tape.i);
    showLabel(`▶ ${tape.label}`);
  }
  function togglePause() {
    if (!inDeck) return;
    focus = 'radio';
    audio.key();
    if (audio.playing === null) { pressKey(1); audio.play(inDeck.i); showLabel(`▶ ${inDeck.label}`); }
    else { pressKey(3); audio.play(null); showLabel(`❚❚ ${inDeck.label}`); }
  }
  const keyState = keys.map((k) => ({ k, y0: k.position.y, t: 0 }));
  const pressKey = (i) => { if (keyState[i]) keyState[i].t = 1; };

  // ontbreekt het nummer van een cassette (nog niet in public/audio), dan speelt ze de mixtape. Vite en de meeste
  // hosts geven voor een onbekend pad index.html terug, daarom ook het type controleren.
  let mixtape = null;
  for (const t of tapes) {
    fetch(t.src, { method: 'HEAD' })
      .then((res) => { if (!res.ok || !(res.headers.get('content-type') || '').startsWith('audio')) throw new Error(t.src); })
      .catch(() => {
        mixtape ??= renderMixtape();
        mixtape.then((url) => audio.setSource(t.i, url));
        console.info(`[cassettes] ${t.src} ontbreekt: ${t.label} speelt de mixtape`);
      });
  }

  // ---------------------------------------------------------------- aanwijzen en slepen
  const _inv = new THREE.Matrix4(), _ray = new THREE.Ray(), _p = new THREE.Vector3(), _plane = new THREE.Plane();
  const tapeObjs = tapes.map((t) => t.obj);
  const owner = (o, list) => { for (; o; o = o.parent) if (list.includes(o)) return o; return null; };
  function hit(raycaster) {
    const h = raycaster.intersectObjects([screen, ...antennas.rods, ...tapeObjs, ...radio, lightSwitch, lightKnob, ...(frames?.objects ?? []), ...(cable?.objects ?? [])].filter(Boolean), true)[0];
    if (!h) return null;
    if (h.object === screen) return { kind: 'screen', h };
    if (cable?.owns(h.object)) return { kind: 'plug', h };
    if (frames?.owns(h.object)) return { kind: 'frame', h };
    if (antennas.owns(h.object)) return { kind: 'antenna', rod: h.object };
    const tapeObj = owner(h.object, tapeObjs);
    if (tapeObj) {
      const tape = tapes[tapeObjs.indexOf(tapeObj)];
      return tape === inDeck ? { kind: 'deck' } : tape.anim ? null : { kind: 'tape', tape };
    }
    if (owner(h.object, [lightSwitch, lightKnob])) return { kind: 'switch' };
    const part = owner(h.object, radio);
    return { kind: part === door ? 'deck' : 'radio', part };
  }
  // waar de muis wijst op een horizontaal vlak boven de tafel, in de ruimte van de kamer
  function onTable(raycaster, height) {
    _inv.copy(r.matrixWorld).invert();
    _ray.copy(raycaster.ray).applyMatrix4(_inv);
    _plane.set(new THREE.Vector3(0, 1, 0), -height);
    return _ray.intersectPlane(_plane, _p);
  }
  // pull: de cassette zit nog in het vak; pas als je de muis van de radio wegtrekt, komt ze eruit
  // (gewoon klikken zonder weg te trekken werpt haar uit)
  const drag = { tape: null, offset: new THREE.Vector3(), near: false, pull: false, start: new THREE.Vector3(), armed: false };
  // wijst de muis naar de radio of vlak langs het vak? (_ray staat in de ruimte van de kamer, de cassettes tellen niet mee)
  const nearDeck = (raycaster) => _ray.distanceToPoint(slot.pos) < NEAR || raycaster.intersectObjects(radio, true).length > 0;

  // ---------------------------------------------------------------- lichtschakelaar
  // zelfde tuimelschakelaar als in de jaren '70: kantelt ±0.15 rad rond x, aan = +0.15
  const lightSwitch = get('d70_schakelaar001'), lightKnob = get('d70_schakelaar_knop001');
  const knob = lightKnob && { q0: lightKnob.quaternion.clone(), angle: 0.15, target: 0.15, on: true };
  const X = new THREE.Vector3(1, 0, 0);
  function toggleLight() {
    knob.on = !knob.on;
    knob.target = knob.on ? 0.15 : -0.15;
    onRoom?.(knob.on);
  }

  let onScreen = false;
  const room = {
    tv, screen, audio, antennas,
    /** inzoomplekken (dozen in de ruimte van de kamer) */
    spots: {
      tv: { normal: new THREE.Vector3(0, 0, 1).applyQuaternion(tvBody.quaternion) },
      radio: { objects: [...radio, ...tapeObjs], normal: front.clone().setY(0).normalize().add(up.clone().multiplyScalar(0.9)).normalize() },
    },
    get grabbing() { return !!drag.tape || antennas.grabbing || !!frames?.grabbing || !!cable?.grabbing; },
    /** cursor voor deze plek, of null */
    hover(raycaster) {
      const h = hit(raycaster);
      onScreen = h?.kind === 'screen';
      if (onScreen) tv.glitch.uniforms.magnet.value.copy(h.h.uv);
      if (!h) return null;
      return h.kind === 'tape' || h.kind === 'antenna' || h.kind === 'frame' || h.kind === 'plug' || (h.kind === 'deck' && inDeck) ? 'grab' : 'pointer';
    },
    down(raycaster) {
      const h = hit(raycaster);
      if (!h) return false;
      if (h.kind === 'antenna' || h.kind === 'screen') focus = 'tv';
      else if (h.kind === 'deck' || h.kind === 'radio' || h.kind === 'tape') focus = 'radio';
      if (h.kind === 'frame') frames.start(h.h, raycaster);
      else if (h.kind === 'plug') cable.start(h.h, raycaster);
      else if (h.kind === 'antenna') antennas.start(h.rod);
      else if (h.kind === 'screen') { if (tv.power) tv.switchChannel(); } // zonder stroom zapt hij niet
      else if (h.kind === 'switch') toggleLight();
      else if (h.kind === 'deck' && inDeck) {
        drag.tape = inDeck;
        drag.pull = drag.near = drag.armed = true;
        drag.offset.set(0, 0, 0);
      } else if (h.kind === 'deck') manualDoor = !manualDoor; // leeg vak: klepje open/dicht
      else if (h.kind === 'radio') togglePause();
      else if (h.kind === 'tape') {
        const p = onTable(raycaster, h.tape.rest + LIFT);
        drag.tape = h.tape;
        drag.offset.copy(h.tape.obj.position).sub(p ?? h.tape.obj.position).setY(0);
        drag.start.copy(h.tape.obj.position);
        drag.armed = false;
      }
      return true;
    },
    move(raycaster) {
      if (antennas.grabbing) { antennas.move(raycaster); return; }
      if (frames?.grabbing) { frames.move(raycaster); return; }
      if (cable?.grabbing) { cable.move(raycaster); return; }
      const tape = drag.tape;
      if (!tape) return;
      const p = onTable(raycaster, tape.rest + LIFT);
      if (!p) return;
      const target = p.add(drag.offset);
      drag.armed ||= Math.hypot(target.x - drag.start.x, target.z - drag.start.z) > ARM;
      drag.near = drag.armed && nearDeck(raycaster); // _ray staat nog in de ruimte van de kamer (onTable)
      if (drag.pull) {
        if (drag.near) return; // nog op de radio: de cassette blijft zitten
        drag.pull = false;     // weggetrokken: ze komt uit het vak en hangt aan de muis
        pullOut();
      }
      // dicht bij het vak richt de cassette zich al rechtop naar de opening
      tape.obj.position.lerp(drag.near ? preSlot : target, 0.5);
      tape.obj.quaternion.slerp(drag.near ? slot.quat : tape.home.quat, 0.25);
    },
    up() {
      if (antennas.grabbing) { antennas.end(); return; }
      if (frames?.grabbing) { frames.end(); return; }
      if (cable?.grabbing) { cable.end(); return; }
      const tape = drag.tape;
      if (!tape) return;
      drag.tape = null;
      if (drag.pull) { drag.pull = drag.near = false; eject(); return; } // enkel geklikt: uitwerpen
      const p = tape.obj.position;
      if (drag.near) insert(tape);
      else if (p.x > table.min.x && p.x < table.max.x && p.z > table.min.z && p.z < table.max.z) {
        fly(tape, { pos: new THREE.Vector3(p.x, tape.rest, p.z), quat: tape.home.quat }, 0.25);
      } else fly(tape, tape.home, 0.5, { arc: 0.06 }); // naast de tafel: terug naar zijn plek
      drag.near = false;
    },
    startAudio() { tv.startAudio(); audio.start(); },
    /** de kamer staat in beeld (true) of is weggedraaid (false): geluid aan of uit */
    setActive(on) { active = on; },
    update(t, dt, camera, canvasRect) {
      antennas.update(dt, t, tv.current + 1);
      frames?.update(dt);
      cable?.update(dt);
      tv.glitch.uniforms.snow.value = antennas.noise; // slecht gerichte antennes: sneeuw op het scherm
      tv.update(t, dt, onScreen);
      audio.update(t);
      bounce(dt, audio.playing !== null ? tapes[audio.playing] : null, audio.pulse);
      // één geluidsbron tegelijk: de radio als je hem het laatst gebruikte en er een nummer loopt, anders de tv
      const radioOn = active && focus === 'radio', tvOn = active && !(focus === 'radio' && audio.playing !== null);
      if (tvOn !== tvVol) { tvVol = tvOn; tv.audio.setVolume(tvOn ? 0.6 : 0); }
      if (radioOn !== radioVol) { radioVol = radioOn; audio.setVolume(radioOn ? 1 : 0); }
      // de cassette in het vak is niet te zien zolang ze speelt (anders steekt ze door de kast als die springt)
      for (const tp of tapes) tp.obj.visible = !(tp === inDeck && !tp.anim && audio.playing !== null);
      // de cassette in het vak danst met de kast mee
      if (inDeck && !inDeck.anim && drag.tape !== inDeck) inDeck.obj.position.copy(slot.pos).applyMatrix4(hop.m);
      for (const tape of tapes) {
        const a = tape.anim;
        if (!a) continue;
        if (a.delay > 0) { a.delay -= dt; continue; }
        a.t = Math.min(1, a.t + dt / a.dur);
        const e = ease(a.t);
        tape.obj.position.lerpVectors(a.from.pos, a.to.pos, e);
        tape.obj.position.y += a.arc * Math.sin(Math.PI * e);
        tape.obj.quaternion.slerpQuaternions(a.from.quat, a.to.quat, e);
        if (a.t >= 1) { tape.anim = null; a.then?.(); }
      }
      doorState.target = manualDoor || drag.near || tapes.some((tp) => tp.anim?.deck) ? 1 : 0;
      doorState.open += (doorState.target - doorState.open) * (1 - Math.exp(-dt * 10));
      door.matrix.copy(door0).multiply(_h).multiply(_m.makeRotationX(0.55 * doorState.open)).multiply(_hi);
      door.matrixWorldNeedsUpdate = true;
      if (knob) {
        knob.angle += (knob.target - knob.angle) * (1 - Math.exp(-dt * 18));
        lightKnob.quaternion.setFromAxisAngle(X, knob.angle).multiply(knob.q0);
      }
      for (const s of keyState) {
        s.t = Math.max(0, s.t - dt * 4);
        s.k.position.y = s.y0 - 0.004 * Math.sin(Math.PI * s.t);
      }
      labelTime = Math.max(0, labelTime - dt);
      // de titel blijft boven de radio staan zolang er een nummer speelt; gepauzeerd nog even
      const showing = active && (labelTime > 0 || audio.playing !== null);
      label.classList.toggle('on', showing);
      if (showing) {
        const b = new THREE.Box3();
        for (const o of radio) b.expandByObject(o);
        const v = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2).project(camera);
        label.style.transform = `translate(${(v.x + 1) / 2 * canvasRect.width}px, ${(1 - v.y) / 2 * canvasRect.height - 34}px) translate(-50%, -50%)`;
      }
    },
    render(renderer, visible) {
      if (visible) tv.render(renderer);
    },
  };
  return room;
}
