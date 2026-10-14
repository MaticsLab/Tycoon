// Sound for the village, all synthesized with the Web Audio API (no audio files):
//   - Music: four calm pieces, one per season, composed below as notes and looped
//     seamlessly (a whole loop is scheduled at a time). At night the melody rests and
//     only the chords, bass and a few bell notes play.
//   - Ambience: rain (with droplets), storms (rumble and thunder), wind, birdsong by
//     day, crickets on summer and fall nights, owls in fall and winter, babbling water
//     near the pond and fountain. Muffled when you're indoors.
//   - Objects: things near you making their own noise: sprinklers hissing and ticking,
//     fires crackling, busy machines humming, a cauldron bubbling, a clock ticking.
//     Louder the closer you are (see objfx.js).
//   - Effects: chopping, mining, splashing, placing, picking up.
// The browser only allows sound after the player touches the page, so start() waits
// for that.

// ---------- the music ----------
// A song: tempo, chords per bar (MIDI notes), a bass line (root per bar, or per half
// bar), and a melody: bars separated by '|', notes as NAME+OCTAVE:BEATS ('-' rests).
const SONGS = {
  // Spring: C major, light and hopeful. Flute over soft electric piano.
  spring: {
    bpm: 74, lead: 'flute', keys: 'epiano', arp: 'pluck',
    chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 64], [60, 64, 67, 71], [52, 55, 59, 62], [53, 57, 60, 65], [55, 60, 62, 67]],
    bass: [36, 33, 29, 31, 36, 28, 29, 31],
    melody: 'E5:1.5 G5:.5 A5:1 G5:1 | E5:2 D5:1 C5:1 | A4:1 C5:1 F5:1.5 E5:.5 | D5:3 -:1 | E5:1 G5:1 C6:1.5 B5:.5 | G5:2 E5:2 | F5:1 E5:1 D5:1 C5:1 | D5:2 G4:2',
    night: 'G5:4 | - :4 | C5:4 | -:4 | E5:4 | -:4 | A5:4 | -:4',
  },
  // Summer: D major, warm and lazy. Marimba arpeggios, a bright pluck melody.
  summer: {
    bpm: 82, lead: 'pluck', keys: 'marimba', arp: 'marimba',
    chords: [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 66], [62, 66, 69, 76], [54, 57, 61, 64], [55, 59, 62, 67], [57, 62, 64, 69]],
    bass: [38, 35, 31, 33, 38, 30, 31, 33],
    melody: 'F#5:.5 A5:.5 B5:1 A5:1 F#5:1 | E5:1.5 D5:.5 E5:2 | D5:.5 E5:.5 F#5:1 B5:1 A5:1 | E5:3 -:1 | F#5:.5 A5:.5 D6:1 C#6:1 A5:1 | F#5:2 E5:1 C#5:1 | D5:1 E5:1 F#5:1 G5:1 | A5:2 E5:2',
    night: 'A5:4 | -:4 | F#5:4 | -:4 | D6:4 | -:4 | B5:4 | -:4',
  },
  // Fall: A minor (dorian), wistful. Piano melody over strings.
  fall: {
    bpm: 66, lead: 'epiano', keys: 'strings', arp: 'epiano',
    chords: [[57, 60, 64, 67, 71], [53, 57, 60, 64], [48, 55, 60, 64], [52, 55, 59, 62], [57, 60, 64, 67], [50, 57, 60, 65], [53, 57, 60, 64], [52, 56, 59, 64]],
    bass: [33, 29, 36, 28, 33, 38, 29, 28],
    melody: 'E5:1 C5:1 B4:1 C5:1 | A4:2 -:1 E5:1 | F5:1.5 E5:.5 D5:1 C5:1 | B4:3 -:1 | E5:1 A5:1 G5:1 E5:1 | F5:2 D5:2 | C5:1 B4:1 A4:1 C5:1 | B4:2 G#4:2',
    night: 'E5:4 | -:4 | C5:4 | -:4 | A5:4 | -:4 | E5:4 | -:4',
  },
  // Winter: E minor, slow and still. A music box over a soft pad.
  winter: {
    bpm: 58, lead: 'bell', keys: 'pad', arp: 'bell',
    chords: [[52, 55, 59, 66], [48, 55, 59, 64], [55, 59, 62, 66], [54, 57, 62, 69], [52, 55, 59, 66], [48, 52, 55, 59], [45, 52, 55, 60], [47, 54, 59, 63]],
    bass: [28, 24, 31, 30, 28, 24, 33, 35],
    melody: 'B5:1 G5:1 F#5:1 E5:1 | G5:3 -:1 | E5:1 D5:1 B4:1 D5:1 | F#5:3 -:1 | B5:1 A5:1 G5:1 B5:1 | E6:2 D6:2 | C6:1 B5:1 A5:1 G5:1 | F#5:2 D#5:2',
    night: 'B5:4 | -:4 | G5:4 | -:4 | E6:4 | -:4 | F#5:4 | -:4',
  },
};
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midi = (name) => { const m = /^([A-G]#?)(\d)$/.exec(name); return m ? 12 * (+m[2] + 1) + NOTE[m[1]] : null; };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// 'E5:1.5 G5:.5 | ...' -> [[beat, beats, midi], ...]
function parseMelody(str) {
  const out = [];
  let beat = 0;
  for (const tok of str.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    const [n, d] = tok.split(':');
    const len = parseFloat(d) || 1;
    if (n !== '-' && n !== '') out.push([beat, len, midi(n)]);
    beat += len;
  }
  return out;
}

export function createAudio({ store } = {}) {
  let ctx = null, master, musicBus, ambBus, sfxBus, objBus, reverb, ambFilter;
  const vol = { master: 1, music: 0.6, ambience: 0.7, objects: 0.7, sfx: 0.8, muted: false };
  const near = { sprinkler: 0, fire: 0, machine: 0, clock: 0, bubble: 0 };
  let nextTick = 0, nextPop = 0, nextSprTick = 0;
  const obj = {};
  try { Object.assign(vol, JSON.parse(store?.get('audio') || '{}')); } catch { /* defaults */ }
  const state = { season: 'spring', night: false, weather: null, indoor: false, water: 0, fountain: 0 };
  let song = null, loopEnd = 0, loopGain = null, nextChirp = 0, nextOwl = 0;
  const amb = {};

  // ---------- setup ----------
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    build(ctx);
    setInterval(tick, 250);
  }
  // Build the graph on any context (an OfflineAudioContext too, for tests).
  function build(c) {
    ctx = c;
    master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    master.connect(comp).connect(c.destination);
    musicBus = c.createGain(); ambBus = c.createGain(); sfxBus = c.createGain(); objBus = c.createGain();
    reverb = c.createConvolver();
    reverb.buffer = impulse(c, 3.2, 2.4);
    const wet = c.createGain(); wet.gain.value = 0.32;
    reverb.connect(wet).connect(master);
    ambFilter = c.createBiquadFilter(); ambFilter.type = 'lowpass'; ambFilter.frequency.value = 18000;
    ambBus.connect(ambFilter).connect(master);
    musicBus.connect(master); sfxBus.connect(master); objBus.connect(master);
    applyVolumes();
    buildAmbience(c);
    buildObjects(c);
  }
  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime, m = vol.muted ? 0 : vol.master ?? 1;
    musicBus.gain.setTargetAtTime(0.42 * vol.music * m, t, 0.3);
    ambBus.gain.setTargetAtTime(0.9 * vol.ambience * m, t, 0.3);
    sfxBus.gain.setTargetAtTime(0.7 * vol.sfx * m, t, 0.1);
    objBus.gain.setTargetAtTime(0.8 * (vol.objects ?? 0.7) * m, t, 0.2);
  }
  function setVolume(k, v) {
    vol[k] = v;
    try { store?.set('audio', JSON.stringify(vol)); } catch { /* private mode */ }
    applyVolumes();
  }

  // A reverb tail: decaying stereo noise.
  function impulse(c, secs, decay) {
    const len = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function noise(c, secs, kind = 'white') {
    const len = Math.floor(c.sampleRate * secs), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') { b0 = 0.997 * b0 + 0.029591 * w; b1 = 0.985 * b1 + 0.032534 * w; b2 = 0.95 * b2 + 0.048056 * w; d[i] = (b0 + b1 + b2 + 0.05 * w) * 0.6; }
      else d[i] = w;
    }
    return buf;
  }
  const loopSrc = (c, buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

  // ---------- instruments ----------
  // One note: instrument, MIDI note, start time, length (s), loudness, output node.
  function play(inst, m, t, dur, vel, out) {
    const c = ctx, f = hz(m);
    const g = c.createGain();
    g.connect(out);
    const send = c.createGain(); send.gain.value = inst === 'bell' || inst === 'flute' ? 0.7 : 0.45;
    g.connect(send).connect(reverb);
    const env = (a, peak, rel) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + Math.max(a, dur), rel); };
    const osc = (type, freq, gain = 1, detune = 0) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
      const og = c.createGain(); og.gain.value = gain;
      o.connect(og).connect(g); o.start(t); o.stop(t + dur + 4);
      return o;
    };
    if (inst === 'flute') {
      const o = osc('sine', f, 1); osc('sine', f * 2, 0.08);
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5.2; lg.gain.value = f * 0.006;
      lfo.connect(lg).connect(o.frequency); lfo.start(t + 0.25); lfo.stop(t + dur + 2);
      env(0.09, 0.16 * vel, 0.18);
    } else if (inst === 'epiano') {
      osc('sine', f, 1); osc('sine', f * 2, 0.35); osc('sine', f * 3.01, 0.08);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13 * vel, t + 0.006); g.gain.setTargetAtTime(0.04 * vel, t + 0.01, 0.4); g.gain.setTargetAtTime(0, t + dur, 0.35);
    } else if (inst === 'pluck' || inst === 'marimba') {
      osc(inst === 'pluck' ? 'triangle' : 'sine', f, 1); osc('sine', f * (inst === 'pluck' ? 2 : 4), inst === 'pluck' ? 0.2 : 0.12);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.004); g.gain.setTargetAtTime(0, t + 0.01, inst === 'pluck' ? 0.28 : 0.2);
    } else if (inst === 'bell') {
      osc('sine', f, 1); osc('sine', f * 2.76, 0.32); osc('sine', f * 5.4, 0.12);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.003); g.gain.setTargetAtTime(0, t + 0.01, 0.9);
    } else if (inst === 'pad' || inst === 'strings') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = inst === 'pad' ? 900 : 1500; lp.Q.value = 0.3;
      g.disconnect(); g.connect(lp).connect(out); lp.connect(send);
      for (const d of [-7, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; const og = c.createGain(); og.gain.value = 0.5; o.connect(og).connect(g); o.start(t); o.stop(t + dur + 4); }
      env(inst === 'pad' ? 1.4 : 0.6, 0.035 * vel, inst === 'pad' ? 1.2 : 0.7);
    } else if (inst === 'bass') {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      g.disconnect(); g.connect(lp).connect(out);
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + dur + 2);
      env(0.03, 0.16 * vel, 0.3);
    }
  }

  // Schedule one whole loop of `song` from time t0 (8 bars). Returns its length (s).
  function scheduleLoop(name, t0, night, out) {
    const S = SONGS[name], beat = 60 / S.bpm, bar = beat * 4;
    S.mel ||= parseMelody(S.melody);
    S.nightMel ||= parseMelody(S.night);
    S.chords.forEach((ch, b) => {
      const tb = t0 + b * bar;
      // chords: held (pad/strings) or gently broken (piano / marimba)
      if (S.keys === 'pad' || S.keys === 'strings') for (const n of ch) play(S.keys, n, tb, bar * 0.98, 0.9, out);
      else ch.forEach((n, i) => play(S.keys, n, tb + i * 0.04, bar * 0.9, 0.55, out));
      // a soft arpeggio on the off-beats
      if (!night) for (let k = 0; k < 4; k++) play(S.arp, ch[(k * 2 + b) % ch.length] + 12, tb + (k + 0.5) * beat, beat * 0.6, 0.35, out);
      play('bass', S.bass[b], tb, bar * 0.95, 0.9, out);
      if (S.keys !== 'pad') play('pad', ch[0], tb, bar * 0.98, 0.5, out);
    });
    for (const [b0, len, n] of night ? S.nightMel : S.mel) play(night ? 'bell' : S.lead, n, t0 + b0 * beat, len * beat * 0.95, night ? 0.6 : 1, out);
    return bar * S.chords.length;
  }

  function music(now) {
    const name = state.season, night = state.night;
    const key = `${name}|${night}`;
    // Change song at the end of a loop (or straight away with a crossfade if it's a new season).
    if (song && song !== key && name !== song.split('|')[0] && loopGain) {
      loopGain.gain.setTargetAtTime(0, now, 1.2);
      loopEnd = now + 2;
      song = null;
    }
    if (now < loopEnd - 1.5) return;
    const t0 = Math.max(now + 0.1, loopEnd);
    loopGain = ctx.createGain();
    loopGain.connect(musicBus);
    const len = scheduleLoop(name, t0, night, loopGain);
    loopEnd = t0 + len;
    song = key;
  }

  // ---------- ambience ----------
  function buildAmbience(c) {
    const white = noise(c, 3), brown = noise(c, 4, 'brown'), pink = noise(c, 3, 'pink');
    const chain = (src, nodes, gain = 0) => { const g = c.createGain(); g.gain.value = gain; let n = src; for (const x of nodes) { n.connect(x); n = x; } n.connect(g).connect(ambBus); return g; };
    const filt = (type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    amb.rain = chain(loopSrc(c, white), [filt('highpass', 500), filt('lowpass', 5200)]);
    amb.rainLow = chain(loopSrc(c, pink), [filt('lowpass', 900)]);
    amb.rumble = chain(loopSrc(c, brown), [filt('lowpass', 110)]);
    // Wind: brown noise through a slowly swaying band.
    const wf = filt('bandpass', 420, 0.6);
    amb.wind = chain(loopSrc(c, brown), [wf]);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.06; lg.gain.value = 220; lfo.connect(lg).connect(wf.frequency); lfo.start();
    // Water: babbling pink noise (a fast random wobble in a band).
    const bf = filt('bandpass', 1100, 1.2);
    amb.water = chain(loopSrc(c, pink), [bf]);
    const wob = c.createOscillator(), wg = c.createGain(); wob.type = 'sawtooth'; wob.frequency.value = 3.3; wg.gain.value = 500; wob.connect(wg).connect(bf.frequency); wob.start();
    // Crickets: a high tone chopped into chirps.
    const cr = c.createOscillator(); cr.frequency.value = 4600;
    const am = c.createGain(); am.gain.value = 0;
    const pulse = c.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 28;
    const pg = c.createGain(); pg.gain.value = 0.5;
    pulse.connect(pg).connect(am.gain);
    const slow = c.createOscillator(); slow.type = 'square'; slow.frequency.value = 0.9;
    const sg = c.createGain(); sg.gain.value = 0.5;
    slow.connect(sg).connect(am.gain);
    cr.connect(am);
    amb.crickets = c.createGain(); amb.crickets.gain.value = 0;
    am.connect(amb.crickets).connect(ambBus);
    cr.start(); pulse.start(); slow.start();
    amb.white = white;
  }
  const level = (node, v, tc = 1.5) => node?.gain.setTargetAtTime(v, ctx.currentTime, tc);
  function ambience(now) {
    const { weather: wx, season, night, indoor, water } = state;
    const wet = wx === 'rain' ? 1 : wx === 'storm' ? 1.6 : 0;
    const muff = indoor ? 0.45 : 1;
    level(amb.rain, 0.16 * wet * muff); level(amb.rainLow, 0.2 * wet * muff);
    level(amb.rumble, wx === 'storm' ? 0.35 * muff : 0);
    const windBase = { winter: 0.2, fall: 0.14, spring: 0.07, summer: 0.05 }[season] + (wx === 'storm' ? 0.18 : wx === 'snow' ? 0.08 : 0);
    level(amb.wind, windBase * muff * (indoor ? 0.5 : 1));
    level(amb.water, Math.min(1, water) * 0.12 * muff, 0.5);
    level(amb.crickets, night && !wet && (season === 'summer' || season === 'fall') ? 0.012 * muff : 0, 2);
    ambFilter.frequency.setTargetAtTime(indoor ? 700 : 18000, now, 0.3);
    // Rain droplets pattering on things.
    if (wet && !indoor) for (let i = 0; i < 6 * wet; i++) drop(now + Math.random() * 0.25);
    // Birds by day (not in the rain), owls at night.
    if (!night && !wet && now > nextChirp) {
      const busy = { spring: 1, summer: 0.8, fall: 0.45, winter: 0.15 }[season];
      nextChirp = now + (1.5 + Math.random() * 5) / busy;
      if (Math.random() < busy) bird(now + Math.random());
    }
    if (night && (season === 'fall' || season === 'winter') && now > nextOwl) { nextOwl = now + 18 + Math.random() * 30; if (Math.random() < 0.7) owl(now + 0.5); }
  }
  function drop(t) {
    const c = ctx, s = c.createBufferSource(); s.buffer = amb.white;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000 + Math.random() * 4000; f.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f).connect(g).connect(ambBus); s.start(t, Math.random() * 2, 0.06);
  }
  function bird(t) {
    const c = ctx, kind = Math.floor(Math.random() * 3), n = 2 + Math.floor(Math.random() * 4);
    const base = [2600, 3400, 1900][kind];
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(), g = c.createGain(), ts = t + i * (kind === 2 ? 0.22 : 0.12);
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), ts);
      o.frequency.exponentialRampToValueAtTime(base * (kind === 1 ? 0.7 : 1.45), ts + 0.08);
      g.gain.setValueAtTime(0, ts); g.gain.linearRampToValueAtTime(0.035, ts + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.1);
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; o.connect(g).connect(pan).connect(ambBus); } else o.connect(g).connect(ambBus);
      const s = c.createGain(); s.gain.value = 0.4; g.connect(s).connect(reverb);
      o.start(ts); o.stop(ts + 0.12);
    }
  }
  function owl(t) {
    const c = ctx;
    for (const [dt, len] of [[0, 0.35], [0.55, 0.6]]) {
      const o = c.createOscillator(), g = c.createGain(), ts = t + dt;
      o.frequency.setValueAtTime(390, ts); o.frequency.linearRampToValueAtTime(350, ts + len);
      g.gain.setValueAtTime(0, ts); g.gain.linearRampToValueAtTime(0.05, ts + 0.06); g.gain.setTargetAtTime(0, ts + len - 0.1, 0.06);
      o.connect(g).connect(ambBus); const s = c.createGain(); s.gain.value = 0.7; g.connect(s).connect(reverb);
      o.start(ts); o.stop(ts + len + 0.5);
    }
  }
  // Thunder: a low rolling burst, a moment after the lightning.
  function thunder(delay = 0.4 + Math.random() * 1.6) {
    if (!ctx) return;
    const c = ctx, t = c.currentTime + delay, s = c.createBufferSource();
    s.buffer = noise(c, 5, 'brown');
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(90, t + 3);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(state.indoor ? 0.35 : 0.8, t + 0.08); g.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
    s.connect(f).connect(g).connect(ambBus); const r = c.createGain(); r.gain.value = 0.5; g.connect(r).connect(reverb);
    s.start(t); s.stop(t + 5);
  }

  // ---------- effects ----------
  function sfx(kind) {
    if (!ctx || ctx.state !== 'running') return;
    const c = ctx, t = c.currentTime;
    const burst = (ff, q, dur, peak, type = 'bandpass') => {
      const s = c.createBufferSource(); s.buffer = amb.white;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = ff; f.Q.value = q;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(sfxBus); s.start(t, Math.random(), dur + 0.05);
    };
    const tone = (freq, dur, peak, type = 'sine', at = 0) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(peak, t + at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(sfxBus); o.start(t + at); o.stop(t + at + dur + 0.05);
    };
    if (kind === 'chop') { burst(380, 1.5, 0.12, 0.5); tone(140, 0.12, 0.25, 'triangle'); }
    else if (kind === 'fell') { burst(250, 0.8, 0.9, 0.5, 'lowpass'); tone(90, 0.5, 0.3, 'triangle'); }
    else if (kind === 'mine') { tone(1850, 0.18, 0.12); tone(2710, 0.14, 0.08); burst(3000, 3, 0.05, 0.25); }
    else if (kind === 'splash') burst(1200, 0.7, 0.45, 0.35, 'lowpass');
    else if (kind === 'bite') { tone(880, 0.08, 0.12); tone(1320, 0.1, 0.1, 'sine', 0.09); }
    else if (kind === 'place') { burst(900, 2, 0.06, 0.3); tone(220, 0.08, 0.12, 'triangle'); }
    else if (kind === 'pickup') { tone(660, 0.07, 0.1); tone(990, 0.09, 0.08, 'sine', 0.06); }
    else if (kind === 'coin') { tone(1320, 0.09, 0.08); tone(1760, 0.16, 0.08, 'sine', 0.07); }
  }

  // ---------- things near you ----------
  function buildObjects(c) {
    const loop = (buf, nodes, gain = 0) => { const s = loopSrc(c, buf); const g = c.createGain(); g.gain.value = gain; let n = s; for (const x of nodes) { n.connect(x); n = x; } n.connect(g).connect(objBus); return g; };
    const bp = (f, q) => { const n = c.createBiquadFilter(); n.type = 'bandpass'; n.frequency.value = f; n.Q.value = q; return n; };
    const lp = (f) => { const n = c.createBiquadFilter(); n.type = 'lowpass'; n.frequency.value = f; return n; };
    // Sprinkler: a soft hiss of spray, fluttering as the head turns.
    const flutter = c.createGain(); flutter.gain.value = 0.7;
    const fl = c.createOscillator(), fg = c.createGain(); fl.frequency.value = 2.3; fg.gain.value = 0.3; fl.connect(fg).connect(flutter.gain); fl.start();
    obj.sprinkler = loop(noise(c, 2, 'white'), [bp(3800, 0.7), flutter]);
    // Fire: a low roar under the crackles (scheduled in objects()).
    obj.fire = loop(noise(c, 3, 'brown'), [lp(420)]);
    // Machines: a gentle electric hum with a slow chug.
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 58;
    const hf = lp(260), chug = c.createGain(); chug.gain.value = 0.6;
    const cl = c.createOscillator(), cg = c.createGain(); cl.frequency.value = 1.6; cg.gain.value = 0.35; cl.connect(cg).connect(chug.gain); cl.start();
    obj.machine = c.createGain(); obj.machine.gain.value = 0;
    hum.connect(hf).connect(chug).connect(obj.machine).connect(objBus); hum.start();
  }
  function objects(now) {
    const lvl = (node, v) => node?.gain.setTargetAtTime(v, now, 0.4);
    lvl(obj.sprinkler, 0.05 * near.sprinkler);
    lvl(obj.fire, 0.16 * near.fire);
    lvl(obj.machine, 0.035 * near.machine);
    const c = ctx;
    const click = (t, f, q, peak, dur) => {
      const s = c.createBufferSource(); s.buffer = amb.white;
      const fi = c.createBiquadFilter(); fi.type = 'bandpass'; fi.frequency.value = f; fi.Q.value = q;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fi).connect(g).connect(objBus); s.start(t, Math.random() * 1.5, dur + 0.05);
    };
    // Crackles and pops from the fire.
    if (near.fire > 0.02) while (nextPop < now + 0.3) { nextPop = Math.max(nextPop, now) + 0.05 + Math.random() * 0.35; click(nextPop, 1500 + Math.random() * 3500, 3, (0.04 + Math.random() * 0.12) * near.fire, 0.03 + Math.random() * 0.05); }
    // An impact sprinkler's tick-tick-tick.
    if (near.sprinkler > 0.02) while (nextSprTick < now + 0.3) { nextSprTick = Math.max(nextSprTick, now) + 0.16; click(nextSprTick, 2600, 8, 0.05 * near.sprinkler, 0.025); }
    // A clock: tick... tock.
    if (near.clock > 0.02) while (nextTick < now + 0.3) { nextTick = Math.max(nextTick, now) + 1; const tock = Math.round(nextTick) % 2; click(nextTick, tock ? 1700 : 2300, 12, 0.08 * near.clock, 0.04); }
    // Bubbles in the cauldron: little rising blips.
    if (near.bubble > 0.02 && Math.random() < 0.6) {
      const t = now + Math.random() * 0.25, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(220 + Math.random() * 200, t); o.frequency.exponentialRampToValueAtTime(700 + Math.random() * 300, t + 0.07);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 * near.bubble, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(objBus); o.start(t); o.stop(t + 0.12);
    }
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    music(now);
    ambience(now);
    objects(now);
  }

  return {
    start, sfx, thunder, setVolume, vol,
    update(s) { Object.assign(state, s); },
    // How near the closest sprinkler, fire, busy machine, clock and cauldron are (0..1).
    objects(levels) { if (levels) Object.assign(near, levels); },
    get running() { return ctx?.state === 'running'; },
    // Tests: render a loop of a season's music offline.
    async renderSong(name, night = false, secs = 12) {
      const c = new OfflineAudioContext(2, 44100 * secs, 44100);
      build(c);
      scheduleLoop(name, 0.05, night, musicBus);
      const buf = await c.startRendering();
      ctx = null;
      return buf;
    },
    songs: Object.keys(SONGS),
  };
}
