// Sound for the village, all synthesized with the Web Audio API (no audio files):
//   - Music: four slow, hushed songs, one per season, in the spirit of an intimate
//     bedroom-pop ballad: soft felt piano (a Rhodes in summer), a wordless breathy "ooh"
//     voice, warm sub-bass swells, airy pads, breath noise and a muffled heartbeat kick,
//     all through a dark low-pass and a long reverb. Each is a real ~3 minute
//     composition (intro, verse, chorus, verse 2, bridge, chorus 2, outro) built from a
//     few bars of chords and melody below, with the variations generated in compose().
//     The outro fades back into the intro, so it loops seamlessly. Notes are scheduled
//     a few seconds ahead as it plays. At night the voice mostly rests (only its long
//     held notes stay), the beat drops out and everything gets quieter and darker.
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
// Each song has three parts (verse, chorus, bridge). A part is four bars of chords,
// '|' between bars, each chord as BASS:VOICING in MIDI notes (two chords in a bar split
// it in half), plus a second four-bar pass ('B') that turns somewhere new. The melody
// for a part is four bars of NAME+OCTAVE:BEATS ('-' rests); its 'End' replaces the
// last bars on the second pass. `scale` is the key's pitch classes (for harmonies).
const SONGS = {
  // Spring: F major / D minor, hopeful but a little sad. Felt piano, soft finger snaps.
  // Bass walks down F-E-D-Bb, and the verse turns to a borrowed B-flat minor.
  spring: {
    bpm: 70, keys: 'piano', kick: true, snap: true, scale: [0, 2, 4, 5, 7, 9, 10],
    verse: '41:53 60 64 69 | 40:57 60 64 67 | 38:53 57 60 64 | 34:53 57 62 65',
    verseB: '41:53 60 64 69 | 40:57 60 64 67 | 38:53 57 60 64 | 34:53 55 61 65',
    chorus: '38:53 57 62 64 | 34:53 57 62 65 | 36:53 57 60 65 | 36:53 55 60 65, 36:52 55 60 64',
    chorusB: '38:53 57 62 64 | 34:53 57 62 65 | 43:53 58 62 65 | 45:52 57 62 64, 45:52 57 61 64',
    bridge: '43:53 58 62 65 | 39:55 58 62 67 | 34:53 57 62 65 | 34:53 55 61 65',
    bridgeB: '43:53 58 62 65 | 39:55 58 62 67 | 38:53 57 60 64 | 36:53 55 60 65, 36:52 55 60 64',
    mel: {
      verse: '-:1 A4:1 G4:.5 F4:1.5 | -:.5 E4:.5 G4:1 E4:2 | -:1 F4:.5 E4:.5 D4:1 A4:1 | G4:3 -:1',
      verseEnd: 'F4:1.5 C#4:.5 C4:2',
      chorus: 'D5:1.5 E5:.5 F5:1 E5:1 | D5:2 -:.5 A4:.5 C5:1 | C5:1.5 A4:.5 G4:1 F4:1 | G4:3 -:1',
      chorusEnd: 'A#4:1.5 A4:.5 G4:1 F4:1 | E4:3 -:1',
      bridge: 'D5:4 | D5:2 A#4:2 | A4:4 | F4:3 -:1',
      bridgeEnd: 'A4:3 F4:1 | G4:4',
    },
  },
  // Summer: A major, warm and hazy. A soft Rhodes, a dreamy borrowed F major (bVI).
  summer: {
    bpm: 66, keys: 'rhodes', kick: true, snap: true, scale: [1, 2, 4, 6, 8, 9, 11],
    verse: '45:56 59 61 64 | 44:52 56 59 61 | 42:52 57 61 64 | 38:54 57 61 64',
    verseB: '45:56 59 61 64 | 44:52 56 59 61 | 42:52 57 61 64 | 41:52 57 60 64',
    chorus: '38:54 57 61 64 | 37:52 57 61 64 | 35:50 54 57 61 | 40:52 57 59 64, 40:52 56 59 64',
    chorusB: '38:54 57 61 64 | 37:52 56 59 61 | 35:50 54 57 61 | 41:52 57 60 64',
    bridge: '41:52 57 60 64 | 43:52 55 59 62 | 45:56 59 61 64 | 42:52 57 61 64',
    bridgeB: '41:52 57 60 64 | 43:52 55 59 62 | 35:50 54 57 61 | 40:52 57 59 64, 40:52 56 59 64',
    mel: {
      verse: '-:1.5 E4:.5 C#5:1 B4:1 | B4:1.5 G#4:.5 E4:2 | -:1 F#4:.5 A4:.5 C#5:1 B4:1 | A4:3 -:1',
      verseEnd: 'A4:1.5 G4:.5 E4:2',
      chorus: 'E5:1.5 C#5:.5 E5:1 F#5:1 | E5:2 C#5:1 B4:1 | D5:1.5 C#5:.5 B4:1 A4:1 | B4:3 -:1',
      chorusEnd: 'D5:1 C#5:1 B4:1 A4:1 | C5:2 A4:2',
      bridge: 'A4:4 | B4:2 D5:2 | C#5:4 | A4:3 -:1',
      bridgeEnd: 'F#4:2 A4:2 | B4:3 -:1',
    },
  },
  // Fall: G minor, wistful. Felt piano over a falling lament bass (G-F#-F-E).
  fall: {
    bpm: 62, keys: 'piano', kick: true, scale: [0, 2, 3, 5, 7, 9, 10],
    verse: '43:53 57 58 62 | 42:50 54 57 60 | 41:50 53 55 58 | 40:52 55 60 62',
    verseB: '43:53 57 58 62 | 42:50 54 57 60 | 39:50 55 58 62 | 38:50 55 57 62, 38:50 54 57 62',
    chorus: '39:50 55 58 62 | 38:53 58 62 65 | 36:51 55 58 62 | 43:53 57 58 62',
    chorusB: '39:50 55 58 62 | 38:53 58 62 65 | 36:51 55 58 62 | 38:50 55 57 62, 38:50 54 57 62',
    bridge: '36:51 55 58 62 | 44:51 55 60 63 | 39:50 55 58 62 | 38:50 55 57 62, 38:50 54 57 62',
    bridgeB: '36:51 55 58 62 | 44:51 55 60 63 | 46:50 55 58 62 | 38:50 55 57 62, 38:50 54 57 62',
    mel: {
      verse: '-:1 D5:.5 C5:.5 A#4:1 A4:1 | A4:1.5 G4:.5 F#4:2 | -:1 G4:.5 A4:.5 A#4:1 D5:1 | C5:3 -:1',
      verseEnd: '-:1 G4:.5 A#4:.5 D5:1 A#4:1 | A4:3 -:1',
      chorus: 'G4:1 A#4:1 D5:1.5 C5:.5 | D5:1 C5:1 A#4:2 | D#5:1.5 D5:.5 C5:1 A#4:1 | A4:1 G4:3',
      chorusEnd: 'A4:3 -:1',
      bridge: 'G4:4 | G4:2 D#4:2 | A#4:4 | A4:3 -:1',
      bridgeEnd: 'D5:4 | A4:3 -:1',
    },
  },
  // Winter: E minor, very sparse and still. Piano, pad and breath, no beat; the bridge
  // drifts to a dark F major (bII).
  winter: {
    bpm: 56, keys: 'piano', still: true, scale: [0, 2, 4, 6, 7, 9, 11],
    plan: [['intro', 4], ['verse', 8], ['chorus', 8], ['bridge', 8], ['chorus2', 8], ['outro', 4]],
    verse: '40:50 54 55 59 | 38:50 55 59 64 | 36:54 55 59 64 | 35:52 54 57 59',
    verseB: '40:50 54 55 59 | 38:50 55 59 64 | 33:52 55 59 60 | 36:52 55 59 62',
    chorus: '36:52 55 59 62 | 35:50 55 59 62 | 33:52 55 59 60 | 40:50 54 55 59',
    chorusB: '36:52 55 59 62 | 35:50 55 59 62 | 33:52 55 59 60 | 35:52 54 57 59, 35:51 54 59 63',
    bridge: '33:52 55 59 60 | 41:52 57 59 64 | 36:52 55 59 62 | 35:52 54 57 59',
    bridgeB: '33:52 55 59 60 | 41:52 57 59 64 | 40:50 54 55 59 | 35:52 54 57 59, 35:51 54 59 63',
    mel: {
      verse: '-:2 B4:1 A4:1 | G4:3 -:1 | -:1 F#4:1 G4:1 B4:1 | A4:4',
      verseEnd: '-:1 E4:1 G4:1 C5:1 | B4:4',
      chorus: 'E5:2 D5:1 B4:1 | D5:3 -:1 | C5:1.5 B4:.5 A4:1 G4:1 | G4:2 F#4:2',
      chorusEnd: 'F#4:3 -:1',
      bridge: 'A4:4 | B4:2 A4:2 | G4:4 | F#4:3 -:1',
      bridgeEnd: 'G4:2 F#4:2 | F#4:3 -:1',
    },
  },
};
// The song's shape (bars per section) and how each section is arranged: piano style,
// which layers play and how loud (0..1), and the section's overall dynamics.
const PLAN = [['intro', 4], ['verse', 8], ['chorus', 8], ['verse2', 8], ['bridge', 8], ['chorus2', 8], ['outro', 4]];
const ARR = {
  // Piano alone, with a few melody notes high up; fades in from the outro.
  intro: { part: 'verse', piano: 'sparse', pmel: 0.5, air: 0.7, vel: 0.75, fadeIn: true },
  // The voice comes in over plain piano chords and a quiet bass.
  verse: { part: 'verse', piano: 'block', voice: 1, bass: 0.5, air: 0.4, vel: 0.8 },
  // Bass and pad swell in, a muffled heartbeat, harmony on the second half.
  chorus: { part: 'chorus', piano: 'pulse', voice: 1, harm: [1], bass: 1, pad: 0.8, kick: 0.8, vel: 1 },
  // Broken piano chords; the voice sings the first half an octave lower, close and low.
  verse2: { part: 'verse', piano: 'broken', voice: 1, low: true, harm: [1], bass: 0.7, kick: 0.5, air: 0.3, vel: 0.85 },
  // Drops to just piano and breath, long held notes; bass and pad swell back in.
  bridge: { part: 'bridge', piano: 'sparse', voice: 1, air: 1, swell: true, vel: 0.8 },
  // Everything, harmonies throughout, soft snaps.
  chorus2: { part: 'chorus', piano: 'pulse', voice: 1, harm: [0, 1], bass: 1, pad: 1, kick: 1, snap: 1, vel: 1.05 },
  // The voice hums the start of the verse and leaves the piano and pad to fade out.
  outro: { part: 'verse', piano: 'block', hum: 2, pad: 0.6, air: 0.6, vel: 0.75, fadeOut: true },
};
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midi = (name) => { const m = /^([A-G]#?)(\d)$/.exec(name); return m ? 12 * (+m[2] + 1) + NOTE[m[1]] : null; };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// 'E5:1.5 G5:.5 | ...' -> bars of [beat in bar, beats, midi]
const parseBars = (str) => str.split('|').map((bar) => {
  const out = [];
  let beat = 0;
  for (const tok of bar.trim().split(/\s+/).filter(Boolean)) {
    const [n, d] = tok.split(':');
    const len = parseFloat(d) || 1;
    if (n !== '-') out.push([beat, len, midi(n)]);
    beat += len;
  }
  return out;
});
// '41:53 60 64 | 40:57 60, 38:55 62' -> bars of [{ bass, notes }]
const parseChords = (str) => str.split('|').map((bar) => bar.split(',').map((ch) => {
  const [b, n] = ch.split(':');
  return { bass: +b, notes: n.trim().split(/\s+/).map(Number) };
}));
// The note a third below in the key (for a harmony line).
function third(m, scale) {
  if (!scale.includes(m % 12)) return m - 3;
  let k = m, steps = 0;
  while (steps < 2) { k--; if (scale.includes(((k % 12) + 12) % 12)) steps++; }
  return k;
}

// Write out a whole song as a list of notes { t (s), i (instrument), n (MIDI note or
// notes), d (s), v (loudness), plus flags: o 'day'/'night' only, long (a held voice note,
// kept at night), harm (harmony voice) }. Built once per song and cached.
function compose(name) {
  const S = SONGS[name];
  if (S.piece) return S.piece;
  const beat = 60 / S.bpm, bar = beat * 4, ev = [];
  let seed = 1234 + name.length * 97;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // A slightly human note: tiny timing and loudness wobbles.
  const add = (b, at, i, n, beats, v, extra) => ev.push({ t: Math.max(0, b * bar + at * beat + (rnd() - 0.5) * 0.018), i, n, d: beats * beat, v: v * (0.92 + rnd() * 0.16), ...extra });
  const parts = {};
  for (const p of ['verse', 'chorus', 'bridge']) {
    const mel = parseBars(S.mel[p]), end = parseBars(S.mel[p + 'End']);
    parts[p] = { chords: [parseChords(S[p]), parseChords(S[p + 'B'])], mel: [mel, [...mel.slice(0, 4 - end.length), ...end]] };
  }
  let b0 = 0;
  for (const [sec, len] of S.plan || PLAN) {
    const A = ARR[sec], P = parts[A.part];
    let piano = A.piano;
    if (S.still && piano === 'pulse') piano = 'block';
    for (let k = 0; k < len; k++) {
      const b = b0 + k, half = Math.floor(k / 4) % 2, bars = P.chords[half][k % 4];
      const lvl = A.vel * (A.fadeOut ? 1 - 0.6 * (k + 1) / len : A.fadeIn ? 0.7 + 0.3 * k / len : 1);
      const span = 4 / bars.length;
      bars.forEach(({ bass, notes }, j) => {
        const at = j * span, lh = bass + 12;
        // Piano (or Rhodes): rolled chords, gently.
        const chord = (x, v, beats, extra) => notes.forEach((n, q) => add(b, x + q * 0.035, S.keys, n, beats, v * (q === notes.length - 1 ? 1.1 : 1), extra));
        if (piano === 'sparse') {
          chord(at, 0.42 * lvl, span);
          if (k % 2 === 0 || j > 0) add(b, at, S.keys, lh, span, 0.4 * lvl);
        } else if (piano === 'block') {
          chord(at, 0.46 * lvl, span);
          add(b, at, S.keys, lh, span, 0.45 * lvl);
        } else if (piano === 'pulse') {
          chord(at, 0.44 * lvl, span > 2 ? 2 : span);
          if (span > 2) chord(at + 2, 0.3 * lvl, 2);
          add(b, at, S.keys, lh, span, 0.45 * lvl);
        } else if (piano === 'broken') {
          // Slow eighths up and down the chord (quarters in winter); a plain chord at night.
          const seq = [lh, ...notes], pat = [0, 2, 1, 3, 4, 3, 2, 1], step = S.still ? 1 : 0.5;
          for (let q = 0; q * step < span; q++) add(b, at + q * step, S.keys, seq[pat[q % 8] % seq.length], 1.6, (q === 0 ? 0.42 : 0.32) * lvl, { o: 'day' });
          chord(at, 0.42 * lvl, span, { o: 'night' });
          add(b, at, S.keys, lh, span, 0.42 * lvl, { o: 'night' });
        }
        // Sub-bass and pad: steady, or swelling up through the bridge's second half.
        const swell = A.swell ? (half ? (k % 4 + 1) / 4 : 0) : 0;
        const bassV = A.bass ?? swell, padV = A.pad ?? swell * 0.8;
        if (bassV) add(b, at, 'bass', bass, span + 0.05, bassV * lvl);
        if (padV) add(b, at, 'pad', notes, span + 0.1, padV * lvl);
      });
      // A long breath of air every two bars.
      if (A.air && k % 2 === 0) add(b, 0, 'air', bars[0].notes[1], Math.min(8, (len - k) * 4), A.air * lvl);
      // A muffled heartbeat kick (lub-dub), and soft finger snaps on 2 and 4.
      if (S.kick && A.kick) for (const x of A.kick >= 0.8 ? [0, 2] : [0]) { add(b, x, 'kick', 0, 0.5, A.kick * lvl); add(b, x + 0.42, 'kick', 0, 0.5, 0.55 * A.kick * lvl); }
      if (S.snap && A.snap) for (const x of [1, 3]) add(b, x, 'snap', 0, 0.3, A.snap * lvl);
      // The voice: the melody (an octave down for verse 2's first half), with a harmony.
      if (A.voice || k < (A.hum || 0)) {
        for (const [x, beats, m] of P.mel[half][k % 4]) {
          const n = A.low && !half ? m - 12 : m, long = beats >= 2;
          add(b, x, 'voice', n, beats * 0.96, (A.hum ? 0.7 : 0.9) * lvl, { long });
          if (A.harm?.includes(half)) add(b, x, 'voice', third(n, S.scale), beats * 0.96, 0.5 * lvl, { harm: true });
        }
      }
      // Intro: a few of the verse's notes, high on the piano.
      if (A.pmel) for (const [x, beats, m] of P.mel[half][k % 4]) if (beats >= 1) add(b, x, S.keys, m + 12, beats, A.pmel * lvl);
    }
    b0 += len;
  }
  ev.sort((a, b) => a.t - b.t);
  return (S.piece = { ev, len: b0 * bar });
}

export function createAudio({ store } = {}) {
  let ctx = null, master, musicBus, musicTone, mNoise, vibrato, ambBus, sfxBus, objBus, reverb, ambFilter;
  const vol = { master: 1, music: 0.6, ambience: 0.7, objects: 0.7, sfx: 0.8, muted: false };
  const near = { sprinkler: 0, fire: 0, machine: 0, clock: 0, bubble: 0 };
  let nextTick = 0, nextPop = 0, nextSprTick = 0;
  const obj = {};
  try { Object.assign(vol, JSON.parse(store?.get('audio') || '{}')); } catch { /* defaults */ }
  const state = { season: 'spring', night: false, weather: null, indoor: false, water: 0, fountain: 0 };
  let nextChirp = 0, nextOwl = 0;
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
    reverb.buffer = impulse(c, 4.2, 2.6);
    const wet = c.createGain(); wet.gain.value = 0.32;
    reverb.connect(wet).connect(master);
    ambFilter = c.createBiquadFilter(); ambFilter.type = 'lowpass'; ambFilter.frequency.value = 18000;
    ambBus.connect(ambFilter).connect(master);
    // Music: close and soft (a dark low-pass, darker at night) into a big reverb.
    musicTone = c.createBiquadFilter(); musicTone.type = 'lowpass'; musicTone.frequency.value = 2400; musicTone.Q.value = 0.5;
    const sendHP = c.createBiquadFilter(); sendHP.type = 'highpass'; sendHP.frequency.value = 220;
    const send = c.createGain(); send.gain.value = 1.3;
    musicBus.connect(musicTone).connect(master);
    musicTone.connect(sendHP).connect(send).connect(reverb);
    mNoise = noise(c, 2, 'pink');
    vibrato = c.createOscillator(); vibrato.frequency.value = 4.6; vibrato.start(); // shared by the voice's notes
    sfxBus.connect(master); objBus.connect(master);
    applyVolumes();
    buildAmbience(c);
    buildObjects(c);
  }
  function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime, m = vol.muted ? 0 : vol.master ?? 1;
    musicBus.gain.setTargetAtTime((state.night ? 0.8 : 1) * 0.42 * vol.music * m, t, 0.3);
    musicTone.frequency.setTargetAtTime(state.night ? 1500 : 2400, t, 2);
    ambBus.gain.setTargetAtTime(0.9 * vol.ambience * m, t, 0.3);
    sfxBus.gain.setTargetAtTime(0.7 * vol.sfx * m, t, 0.1);
    objBus.gain.setTargetAtTime(0.8 * (vol.objects ?? 0.7) * m, t, 0.2);
  }
  function setVolume(k, v) {
    vol[k] = v;
    try { store?.set('audio', JSON.stringify(vol)); } catch { /* private mode */ }
    applyVolumes();
  }

  // A reverb tail: decaying stereo noise that gets darker as it dies away.
  function impulse(c, secs, decay) {
    const len = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, len, c.sampleRate), pre = Math.floor(c.sampleRate * 0.02);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = pre; i < len; i++) {
        const x = i / len, a = 0.9 - 0.8 * x; // one-pole low-pass, closing over time
        y += a * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.sqrt((2 - a) / a) * Math.pow(1 - x, decay);
      }
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
  // Each plays one note into `out` and disconnects itself when it has finished.
  const node = (kind, type, f) => {
    const n = kind === 'osc' ? ctx.createOscillator() : ctx.createBiquadFilter();
    if (type) n.type = type;
    if (f) n.frequency.value = f;
    return n;
  };
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const run = (srcs, t, end, cleanup) => {
    for (const s of srcs) { s.start(t); s.stop(end); }
    srcs[0].onended = () => { for (const n of cleanup) n.disconnect(); };
  };
  const INST = {
    // Felt piano: a soft-hammered sine with a fading second harmonic.
    piano(m, t, d, v, out) {
      const f = hz(m), g = gain(0), h = gain(0), o = node('osc', 'sine', f), o2 = node('osc', 'sine', f * 2.003);
      const peak = 0.14 * v * (m < 52 ? 0.85 : 1), tau = Math.min(2.6, Math.max(0.9, 2.6 - (m - 45) * 0.06));
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.016); g.gain.setTargetAtTime(0, t + 0.016, tau); g.gain.setTargetAtTime(0, t + d, 0.3);
      h.gain.setValueAtTime(0.3, t); h.gain.setTargetAtTime(0, t, tau * 0.3);
      o.connect(g); o2.connect(h).connect(g); g.connect(out);
      run([o, o2], t, t + d + 1.6, [g, h]);
    },
    // Rhodes: a sine tine with a little bell in its attack (FM), long and warm.
    rhodes(m, t, d, v, out) {
      const f = hz(m), g = gain(0), o = node('osc', 'sine', f), mod = node('osc', 'sine', f), mg = gain(0);
      const peak = 0.13 * v * (m < 52 ? 0.85 : 1);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.012); g.gain.setTargetAtTime(0, t + 0.012, 2.4); g.gain.setTargetAtTime(0, t + d, 0.35);
      mg.gain.setValueAtTime(f * 0.9 * Math.min(1, v + 0.3), t); mg.gain.setTargetAtTime(f * 0.06, t, 0.25);
      mod.connect(mg).connect(o.frequency); o.connect(g).connect(out);
      run([o, mod], t, t + d + 1.6, [g, mg]);
    },
    // Sub-bass: a sine that swells in, with an octave on top so phones can hear it.
    bass(m, t, d, v, out) {
      const f = hz(m), g = gain(0), o = node('osc', 'sine', f), o2 = node('osc', 'sine', f * 2), h = gain(0.3);
      const peak = 0.12 * v;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.3); g.gain.setTargetAtTime(0, t + d, 0.35);
      o.connect(g); o2.connect(h).connect(g); g.connect(out);
      run([o, o2], t, t + d + 2, [g, h]);
    },
    // Airy pad: detuned saws through a dark filter, a slow swell.
    pad(notes, t, d, v, out) {
      const lp = node('filter', 'lowpass', 650), g = gain(0), oscs = [];
      lp.Q.value = 0.4;
      notes.forEach((n, i) => { const o = node('osc', 'sawtooth', hz(n)); o.detune.value = i % 2 ? 7 : -7; o.connect(lp); oscs.push(o); });
      const peak = 0.034 * v;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(2.5, d * 0.45)); g.gain.setTargetAtTime(0, t + d, 1.1);
      lp.connect(g).connect(out);
      run(oscs, t, t + d + 5, [lp, g]);
    },
    // A wordless, breathy "ooh": a saw through two vowel formants, a pure sine body and
    // a little breath noise, scooping gently up into pitch, with a late soft vibrato.
    voice(m, t, d, v, out, e) {
      const f = hz(m), g = gain(0), saw = node('osc', 'sawtooth', f), sin = node('osc', 'sine', f);
      const f1 = node('filter', 'bandpass', Math.max(330, f)), f2 = node('filter', 'bandpass', 850), f2g = gain(0.3), sg = gain(0.55);
      f1.Q.value = 2.5; f2.Q.value = 4;
      for (const o of [saw, sin]) { o.frequency.setValueAtTime(f * 0.985, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.15); }
      const lg = gain(0);
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.005, t + Math.min(1, d));
      vibrato.connect(lg); lg.connect(saw.frequency); lg.connect(sin.frequency);
      saw.connect(f1).connect(g); saw.connect(f2).connect(f2g).connect(g); sin.connect(sg).connect(g);
      const lfo = vibrato, srcs = [saw, sin], cleanup = [g, f1, f2, f2g, sg, lg, { disconnect: () => { try { lfo.disconnect(lg); } catch { /* gone */ } } }];
      if (!e?.harm) {
        const ns = ctx.createBufferSource(), nf = node('filter', 'bandpass', 1500), ng = gain(0.9);
        ns.buffer = mNoise; ns.loop = true; nf.Q.value = 0.7;
        ns.connect(nf).connect(ng).connect(g); srcs.push(ns); cleanup.push(nf, ng);
      }
      const a = Math.min(0.25, d * 0.4), peak = 0.08 * v;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(peak * 0.75, t + a, 1.2); g.gain.setTargetAtTime(0, t + d, 0.25);
      g.connect(out);
      run(srcs, t, t + d + 1.5, cleanup);
    },
    // Breath: a long swell of soft filtered noise.
    air(m, t, d, v, out) {
      const ns = ctx.createBufferSource(), bp = node('filter', 'bandpass', 700 + (m % 12) * 30), g = gain(0);
      ns.buffer = mNoise; ns.loop = true; bp.Q.value = 0.6;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4 * v, t + d * 0.45); g.gain.linearRampToValueAtTime(0, t + d);
      ns.connect(bp).connect(g).connect(out);
      run([ns], t, t + d + 0.1, [bp, g]);
    },
    // A muffled heartbeat kick.
    kick(m, t, d, v, out) {
      const o = node('osc', 'sine', 90), g = gain(0);
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3 * v, t + 0.008); g.gain.setTargetAtTime(0, t + 0.012, 0.09);
      o.connect(g).connect(out);
      run([o], t, t + 0.7, [g]);
    },
    // A soft finger snap, mostly heard in the reverb.
    snap(m, t, d, v, out) {
      const ns = ctx.createBufferSource(), bp = node('filter', 'bandpass', 1700), g = gain(0);
      ns.buffer = mNoise; bp.Q.value = 1.3;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.8 * v, t + 0.003); g.gain.setTargetAtTime(0, t + 0.004, 0.03);
      ns.connect(bp).connect(g).connect(out);
      run([ns], t, t + 0.35, [bp, g]);
    },
  };
  // Play one of compose()'s notes at time t. At night the voice keeps only its long
  // notes, the harmonies and beat rest, and the rest plays softer.
  function note(e, t, night, out) {
    let v = e.v;
    if (night) {
      if (e.o === 'day' || e.harm || e.i === 'kick' || e.i === 'snap' || (e.i === 'voice' && !e.long)) return;
      v *= e.i === 'voice' ? 0.6 : e.i === 'air' ? 1.2 : 0.8;
    } else if (e.o === 'night') return;
    INST[e.i](e.n, t, e.d, v, out, e);
  }

  // Schedule a song's notes from `from` to `to` seconds into it, starting at time t0
  // (offline renders and tests). Returns the song's length (s).
  function scheduleLoop(name, t0, night, out, from = 0, to = Infinity) {
    const P = compose(name);
    for (const e of P.ev) if (e.t >= from && e.t < to) note(e, t0 + e.t - from, night, out);
    return P.len;
  }

  // Live: keep the next few seconds of the season's song scheduled, looping it, and
  // crossfade to the new season's song (from its intro) when the season changes.
  const AHEAD = 4;
  let cur = null, lastNight = null;
  function music(now) {
    const name = state.season;
    if (state.night !== lastNight) { lastNight = state.night; applyVolumes(); }
    if (cur && cur.name !== name) {
      const g = cur.gain;
      g.gain.setTargetAtTime(0, now, 1.2);
      setTimeout(() => g.disconnect(), (AHEAD + 8) * 1000);
      cur = null;
    }
    if (!cur) { const g = ctx.createGain(); g.connect(musicBus); cur = { name, piece: compose(name), start: now + 0.2, idx: 0, gain: g }; }
    const P = cur, { ev, len } = P.piece, until = now + AHEAD;
    if (now > P.start + len + 1) { P.start = now + 0.2; P.idx = 0; } // we were asleep: start over
    for (;;) {
      if (P.idx >= ev.length) { if (P.start + len > until) break; P.start += len; P.idx = 0; continue; }
      const e = ev[P.idx], t = P.start + e.t;
      if (t > until) break;
      if (t >= now - 0.05) note(e, Math.max(t, now), state.night, P.gain);
      P.idx++;
    }
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
    // Tests: render `secs` of a season's music offline, from `from` seconds into it.
    async renderSong(name, night = false, secs = 12, from = 0) {
      const c = new OfflineAudioContext(2, 44100 * secs, 44100), wasNight = state.night;
      state.night = night;
      build(c);
      state.night = wasNight;
      scheduleLoop(name, 0.05, night, musicBus, from, from + secs);
      const buf = await c.startRendering();
      ctx = null;
      return buf;
    },
    songs: Object.keys(SONGS),
    // A song's length in seconds (it loops after this).
    songLength: (name) => compose(name).len,
  };
}
