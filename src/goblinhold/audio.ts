// Tiny WebAudio synth: no audio files to download.
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try { muted = localStorage.getItem('goblinhold.mute') === '1'; } catch { /* ignore */ }

export function unlock() {
  if (!ac) {
    try {
      ac = new AudioContext();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);
    } catch { return; }
  }
  if (ac.state === 'suspended') ac.resume();
}

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('goblinhold.mute', muted ? '1' : '0'); } catch { /* ignore */ }
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  if (!ac || !master || muted) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(dur: number, vol: number, freq: number, q = 1, delay = 0) {
  if (!ac || !master || muted) return;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + delay;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf;
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

const last: Record<string, number> = {};
function limit(k: string, gap: number) {
  const now = performance.now();
  if ((last[k] ?? 0) + gap > now) return false;
  last[k] = now;
  return true;
}

export function sfx(k: string) {
  if (!ac || muted) return;
  switch (k) {
    case 'chop': if (limit(k, 90)) { noise(0.08, 0.25, 900, 2); tone(180, 0.06, 'square', 0.05); } break;
    case 'fell': noise(0.5, 0.25, 300, 0.8); tone(90, 0.4, 'triangle', 0.15, 0.5); break;
    case 'hammer': if (limit(k, 120)) { tone(520, 0.05, 'square', 0.05); noise(0.04, 0.12, 2000, 3); } break;
    case 'twang': if (limit(k, 50)) { tone(700, 0.09, 'triangle', 0.06, 0.6); noise(0.05, 0.05, 3000, 2); } break;
    case 'sling': if (limit(k, 80)) noise(0.12, 0.08, 1400, 1.5); break;
    case 'hit': if (limit(k, 40)) noise(0.05, 0.12, 1200, 2); break;
    case 'slash': if (limit(k, 60)) { noise(0.07, 0.15, 2600, 1.5); } break;
    case 'gobdie': if (limit(k, 70)) { tone(420, 0.18, 'square', 0.06, 0.4); } break;
    case 'hurt': if (limit(k, 100)) tone(260, 0.12, 'sawtooth', 0.06, 0.6); break;
    case 'death': tone(330, 0.5, 'triangle', 0.12, 0.5); tone(247, 0.7, 'triangle', 0.1, 0.5, 0.2); break;
    case 'keephit':
    case 'thud': if (limit(k, 110)) { tone(110, 0.08, 'square', 0.06, 0.7); noise(0.06, 0.1, 400, 1); } break;
    case 'collapse': noise(0.8, 0.35, 250, 0.7); tone(70, 0.6, 'triangle', 0.2, 0.5); break;
    case 'built': [523, 659, 784].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, 1, i * 0.08)); break;
    case 'place': tone(330, 0.06, 'square', 0.05); break;
    case 'demolish': noise(0.3, 0.2, 500, 1); break;
    case 'harvest': if (limit(k, 300)) tone(880, 0.06, 'sine', 0.04); break;
    case 'job': tone(440, 0.05, 'square', 0.04); tone(660, 0.07, 'square', 0.04, 1, 0.05); break;
    case 'click': tone(600, 0.03, 'square', 0.03); break;
    case 'bell':
      for (let i = 0; i < 4; i++) { tone(880, 0.9, 'sine', 0.12, 1, i * 0.45); tone(1320, 0.6, 'sine', 0.05, 1, i * 0.45); }
      break;
    case 'horn': tone(147, 1.2, 'sawtooth', 0.09, 1.02); tone(220, 1.2, 'sawtooth', 0.05, 1.02, 0.05); break;
    case 'dusk': [392, 330, 262].forEach((f, i) => tone(f, 0.5, 'triangle', 0.07, 1, i * 0.25)); break;
    case 'dawn': [262, 330, 392, 523].forEach((f, i) => tone(f, 0.45, 'triangle', 0.08, 1, i * 0.18)); break;
    case 'morning': tone(1800, 0.08, 'sine', 0.03, 1.3); tone(2100, 0.08, 'sine', 0.03, 1.2, 0.12); break;
    case 'pick': if (limit(k, 110)) { tone(900, 0.05, 'square', 0.05); noise(0.05, 0.12, 3000, 3); } break;
    case 'pluck': if (limit(k, 150)) tone(1200, 0.05, 'sine', 0.04, 1.2); break;
    case 'splash': if (limit(k, 300)) noise(0.25, 0.1, 1800, 0.8); break;
    case 'crumble': noise(0.5, 0.25, 600, 0.7); tone(120, 0.3, 'triangle', 0.1, 0.6); break;
    case 'coin': if (limit(k, 90)) { tone(1320, 0.06, 'square', 0.04); tone(1760, 0.09, 'square', 0.035, 1, 0.05); } break;
    case 'boom': noise(0.7, 0.4, 180, 0.6); tone(60, 0.6, 'sine', 0.3, 0.4); break;
    case 'trap': noise(0.15, 0.25, 900, 1.5); tone(200, 0.15, 'square', 0.08, 0.5); break;
    case 'block': if (limit(k, 70)) { tone(300, 0.05, 'square', 0.06, 0.8); noise(0.04, 0.12, 900, 3); } break;
    case 'smash': if (limit(k, 100)) { noise(0.15, 0.3, 300, 1); tone(80, 0.15, 'sine', 0.2, 0.6); } break;
    case 'heal': if (limit(k, 200)) { tone(660, 0.2, 'sine', 0.04, 1.5); } break;
    case 'spell': if (limit(k, 150)) { tone(440, 0.25, 'sawtooth', 0.03, 2); } break;
    case 'ballista': if (limit(k, 100)) { tone(160, 0.2, 'triangle', 0.15, 0.5); noise(0.1, 0.15, 600, 2); } break;
    case 'rescue': [523, 784].forEach((f, i) => tone(f, 0.2, 'sine', 0.06, 1, i * 0.1)); break;
    case 'relic': [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.3, 'triangle', 0.07, 1, i * 0.09)); break;
    case 'charter': [659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.08, 1, i * 0.1)); break;
    case 'season': [392, 523, 659, 784].forEach((f, i) => tone(f, 0.5, 'sine', 0.06, 1, i * 0.15)); break;
    case 'boss': tone(98, 1.6, 'sawtooth', 0.12, 1); tone(73, 1.6, 'sawtooth', 0.1, 1, 0.1); for (let i = 0; i < 3; i++) tone(55, 0.3, 'sine', 0.3, 0.6, 0.6 + i * 0.3); break;
    case 'bossdie': noise(0.9, 0.3, 300, 0.6); [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 'triangle', 0.08, 1, 0.3 + i * 0.1)); break;
    case 'over': [294, 262, 220, 147].forEach((f, i) => tone(f, 0.7, 'triangle', 0.1, 1, i * 0.35)); break;
  }
}

// ---------- music ----------
// A small procedural score: a plucked lute tune over I-vi-IV-V by day, a low drone and war drums by night.
let musicOn = true;
try { musicOn = localStorage.getItem('goblinhold.music') !== '0'; } catch { /* ignore */ }
let musicGain: GainNode | null = null;
export function isMusicOn() { return musicOn; }
export function toggleMusic() {
  musicOn = !musicOn;
  try { localStorage.setItem('goblinhold.music', musicOn ? '1' : '0'); } catch { /* ignore */ }
  if (musicGain && ac) musicGain.gain.setTargetAtTime(musicOn ? 0.32 : 0, ac.currentTime, 0.3);
  return musicOn;
}
function mg() {
  if (!ac || !master) return null;
  if (!musicGain) { musicGain = ac.createGain(); musicGain.gain.value = musicOn ? 0.32 : 0; musicGain.connect(master); }
  return musicGain;
}
function note(freq: number, at: number, dur: number, type: OscillatorType, vol: number, attack = 0.005) {
  const out = mg();
  if (!ac || !out) return;
  const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
  o.type = type; o.frequency.value = freq;
  f.type = 'lowpass'; f.frequency.value = type === 'sawtooth' ? 700 : 3200;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(f); f.connect(g); g.connect(out);
  o.start(at); o.stop(at + dur + 0.05);
}
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// chords as MIDI roots + quality (0 major, 1 minor)
const DAY_PROG: [number, number][] = [[60, 0], [57, 1], [53, 0], [55, 0], [60, 0], [64, 1], [53, 0], [55, 0]];
const NIGHT_PROG: [number, number][] = [[57, 1], [57, 1], [53, 0], [52, 0]];
let nextT = 0, stepN = 0, mode = '';
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function chordTones(root: number, minor: number) { return [root, root + (minor ? 3 : 4), root + 7, root + 12]; }
function scheduleMusic(phase: string) {
  if (!ac || muted || !musicOn) return;
  const want = phase === 'night' ? 'night' : phase === 'dusk' ? 'dusk' : 'day';
  if (want !== mode) { mode = want; stepN = 0; nextT = Math.max(nextT, ac.currentTime + 0.1); }
  const eighth = want === 'night' ? 0.34 : 0.33;
  if (nextT < ac.currentTime) nextT = ac.currentTime + 0.05;
  while (nextT < ac.currentTime + 0.25) {
    const bar = Math.floor(stepN / 8), beat = stepN % 8;
    if (want === 'day') {
      const [root, minor] = DAY_PROG[bar % DAY_PROG.length];
      const tones = chordTones(root, minor);
      if (beat === 0) { note(midi(root - 24), nextT, 1.4, 'triangle', 0.16); note(midi(root - 12), nextT, 1.2, 'sine', 0.06); }
      if (beat === 4) note(midi(root - 17), nextT, 1.0, 'triangle', 0.1);
      // melody: mostly chord tones, some pentatonic passing notes and rests
      if (rnd() < (beat % 2 ? 0.55 : 0.85)) {
        const pent = [0, 2, 4, 7, 9].map((x) => 72 + x);
        const m = rnd() < 0.7 ? tones[Math.floor(rnd() * tones.length)] + 12 : pent[Math.floor(rnd() * pent.length)];
        note(midi(m), nextT, 0.5, 'triangle', 0.09);
        note(midi(m + 12), nextT, 0.18, 'sine', 0.02);
      }
    } else if (want === 'night') {
      const [root, minor] = NIGHT_PROG[bar % NIGHT_PROG.length];
      if (beat === 0) { note(midi(root - 24), nextT, eighth * 8.5, 'sawtooth', 0.06, 0.6); note(midi(root - 12 + (minor ? 3 : 4)), nextT, eighth * 8.5, 'sawtooth', 0.025, 0.8); }
      if (beat === 0 || beat === 3 || beat === 6) note(midi(root - 12), nextT, 0.5, 'triangle', 0.12);
      if (bar % 2 === 1 && (beat === 2 || beat === 4) && rnd() < 0.6) note(midi(chordTones(root, minor)[1 + Math.floor(rnd() * 2)] + 12), nextT, 0.7, 'square', 0.03, 0.05);
    }
    nextT += eighth;
    stepN++;
  }
}

// Night drums: a simple loop scheduled while raids are on.
let drumT = 0;
export function ambience(phase: string, dt: number, speed: number) {
  if (!ac || muted) return;
  scheduleMusic(phase);
  if (speed === 0) return;
  drumT -= dt;
  if (drumT > 0) return;
  if (phase === 'night') {
    drumT = 0.6;
    tone(70, 0.25, 'sine', 0.22, 0.6);
    noise(0.1, 0.06, 200, 1);
    tone(95, 0.18, 'sine', 0.12, 0.6, 0.3);
  } else if (phase === 'day') {
    drumT = 3 + Math.random() * 5;
    const f = 1600 + Math.random() * 900;
    tone(f, 0.07, 'sine', 0.02, 1.25);
    tone(f * 1.1, 0.06, 'sine', 0.018, 1.2, 0.1);
  } else drumT = 1;
}
