// Tiny synthesized sound kit (no audio files). Every sound is throttled so a
// big firefight stays a texture rather than a wall of noise.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
const last: Record<string, number> = {};

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function gate(name: string, ms: number) {
  if (!ctx || !master) return false;
  const now = performance.now();
  if (now - (last[name] ?? 0) < ms) return false;
  last[name] = now;
  return true;
}

function noise(dur: number, freq: number, type: BiquadFilterType, vol: number, q = 1) {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur);
}

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Zombie moan: a sawtooth through a vowel-ish band, with a sagging pitch. */
function groanVoice(f0: number, vol: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const dur = 0.9 + Math.random() * 0.8;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f0 * 1.15, t + dur * 0.3);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5 + Math.random() * 4;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = f0 * 0.04;
  lfo.connect(lfoGain).connect(o.frequency);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 500 + Math.random() * 300;
  f.Q.value = 3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(master);
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.05);
  lfo.stop(t + dur + 0.05);
}

/** Falling-pitch sweep of filtered noise (jets, incoming shells). */
function sweep(dur: number, f0: number, f1: number, vol: number, type: BiquadFilterType = 'bandpass') {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

export type GunSound = 'rifle' | 'mg' | 'sniper' | 'pistol' | 'cannon' | 'launcher' | 'flame';

export const sfx = {
  shot(gun: GunSound) {
    switch (gun) {
      case 'rifle':
        if (gate('rifle', 55)) noise(0.07, 2000, 'bandpass', 0.08, 0.8);
        break;
      case 'mg':
        if (gate('mg', 40)) noise(0.05, 1500, 'bandpass', 0.07, 1);
        break;
      case 'pistol':
        if (gate('pistol', 80)) noise(0.05, 2800, 'bandpass', 0.05, 1);
        break;
      case 'sniper':
        if (gate('sniper', 120)) {
          noise(0.25, 900, 'bandpass', 0.2, 0.7);
          tone('square', 1800, 300, 0.08, 0.03);
        }
        break;
      case 'cannon':
        if (gate('cannon', 120)) {
          noise(0.45, 260, 'lowpass', 0.4);
          tone('sine', 90, 40, 0.35, 0.25);
        }
        break;
      case 'launcher':
        if (gate('launcher', 100)) {
          tone('sine', 160, 60, 0.12, 0.18);
          noise(0.08, 700, 'lowpass', 0.12);
        }
        break;
      case 'flame':
        if (gate('flame', 110)) noise(0.16, 500 + Math.random() * 300, 'bandpass', 0.06, 0.5);
        break;
    }
  },
  boom(big = false) {
    if (!gate(big ? 'boomB' : 'boom', big ? 60 : 45)) return;
    noise(big ? 0.9 : 0.55, big ? 220 : 320, 'lowpass', big ? 0.5 : 0.32);
    tone('sine', big ? 70 : 95, 30, big ? 0.6 : 0.4, big ? 0.35 : 0.22);
  },
  kill() {
    if (!gate('kill', 50)) return;
    noise(0.14, 380 + Math.random() * 200, 'lowpass', 0.14);
  },
  hit() {
    if (!gate('hit', 200)) return;
    tone('square', 140, 70, 0.12, 0.05);
  },
  groan() {
    if (!gate('groan', 500)) return;
    groanVoice(70 + Math.random() * 60, 0.05 + Math.random() * 0.04);
  },
  heal() {
    if (!gate('heal', 700)) return;
    tone('sine', 880, 1320, 0.15, 0.03);
  },
  repair() {
    if (!gate('repair', 450)) return;
    tone('square', 1200, 900, 0.04, 0.03);
    tone('square', 1000, 800, 0.04, 0.025, 0.09);
  },
  build() {
    noise(0.12, 600, 'lowpass', 0.2);
    tone('triangle', 220, 330, 0.12, 0.08, 0.05);
  },
  train() {
    tone('triangle', 520, 780, 0.08, 0.06);
    tone('triangle', 780, 1040, 0.08, 0.05, 0.07);
  },
  engine() {
    tone('sawtooth', 55, 110, 0.5, 0.08);
    tone('sawtooth', 58, 95, 0.6, 0.06, 0.05);
  },
  radio() {
    noise(0.12, 2500, 'bandpass', 0.06, 2);
    tone('square', 1100, 1100, 0.06, 0.03, 0.14);
    tone('square', 1100, 1100, 0.06, 0.03, 0.26);
  },
  jet() {
    sweep(2.6, 3500, 300, 0.3);
    tone('sawtooth', 300, 80, 2.4, 0.04);
  },
  whistle() {
    if (!gate('whistle', 180)) return;
    tone('sine', 1500 + Math.random() * 300, 500, 1.1, 0.04);
  },
  error() {
    if (!gate('err', 150)) return;
    tone('square', 180, 150, 0.12, 0.05);
  },
  horde() {
    tone('sawtooth', 70, 52, 1.6, 0.12);
    tone('sawtooth', 105, 78, 1.6, 0.07);
    for (let i = 0; i < 3; i++) setTimeout(() => groanVoice(60 + Math.random() * 50, 0.08), 200 + i * 350);
  },
  clear() {
    [523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.18, 0.07, i * 0.09));
  },
  collapse() {
    noise(0.5, 300, 'lowpass', 0.3);
  },
  lose() {
    tone('sawtooth', 200, 40, 1.4, 0.12);
  },
};
