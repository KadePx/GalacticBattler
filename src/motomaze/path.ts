// Replays: a 10 Hz track of each run, delta-encoded into a short URL-safe string.
// Shared by the game and the API (which uses checkRun to reject impossible runs).

import { CS, DIRS, type Maze, cellAt } from './maze';
import { DT, SAMPLE_EVERY, MAX_SAMPLE_MOVE } from './sim';

/** One replay frame. state: 0 riding, 1 in the air, 2 crashed. */
export interface Sample { x: number; z: number; y: number; h: number; pitch: number; lean: number; state: number; boost: boolean }

const FIELDS = 6;
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IDX = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) IDX[ALPHA.charCodeAt(i)] = i;

export const SAMPLE_MS = SAMPLE_EVERY * DT * 1000; // 100
export const MAX_SAMPLES = 3600; // six minutes
export const stepsToMs = (steps: number) => Math.round(steps * DT * 1000);

function quant(s: Sample): number[] {
  const flags = (s.state & 3) | (s.boost ? 4 : 0) | (((Math.round(Math.max(-1, Math.min(1, s.lean)) * 100) + 128) & 255) << 3);
  return [Math.round(s.x * 10), Math.round(s.z * 10), Math.round(s.y * 50), Math.round(s.h * 500), Math.round(s.pitch * 200), flags];
}

/** Headings are stored unwrapped so deltas stay small; the recorder keeps them continuous. */
export function encode(samples: Sample[]): string {
  let out = '';
  let prev = [0, 0, 0, 0, 0, 0];
  for (const s of samples) {
    const q = quant(s);
    for (let f = 0; f < FIELDS; f++) {
      const d = q[f] - prev[f];
      let v = d >= 0 ? d * 2 : -d * 2 - 1;
      while (v >= 32) { out += ALPHA[32 | (v & 31)]; v = Math.floor(v / 32); }
      out += ALPHA[v];
    }
    prev = q;
  }
  return out;
}

export function decode(str: string): Sample[] | null {
  if (typeof str !== 'string') return null;
  const out: Sample[] = [];
  const cur = [0, 0, 0, 0, 0, 0];
  let f = 0, v = 0, mul = 1;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const k = code < 128 ? IDX[code] : -1;
    if (k < 0) return null;
    v += (k & 31) * mul;
    if (k & 32) { mul *= 32; if (mul > 2 ** 30) return null; continue; }
    cur[f] += v & 1 ? -(v + 1) / 2 : v / 2;
    v = 0; mul = 1;
    if (++f === FIELDS) {
      f = 0;
      const fl = cur[5];
      out.push({
        x: cur[0] / 10, z: cur[1] / 10, y: cur[2] / 50, h: cur[3] / 500, pitch: cur[4] / 200,
        lean: (((fl >> 3) & 255) - 128) / 100, state: fl & 3, boost: !!(fl & 4),
      });
      if (out.length > MAX_SAMPLES) return null;
    }
  }
  return f === 0 && v === 0 ? out : null;
}

/**
 * A run is believable when it starts in the start cell, ends in the finish cell, never moves faster
 * than a boosted bike can, and only ever moves between cells through gaps in the walls.
 */
export function checkRun(m: Maze, samples: Sample[], ms: number): string | null {
  if (samples.length < 20) return 'too short';
  if (!Number.isFinite(ms) || ms < (samples.length - 2) * SAMPLE_MS || ms > samples.length * SAMPLE_MS + 50) return 'bad time';
  if (!near(m, samples[0], m.start)) return 'bad start';
  if (!near(m, samples[samples.length - 1], m.finish)) return 'not finished';
  const limit = MAX_SAMPLE_MOVE + 0.5;
  for (let k = 1; k < samples.length; k++) {
    const a = samples[k - 1], b = samples[k];
    if (Math.hypot(b.x - a.x, b.z - a.z) > limit) return 'too fast';
    const ca = cellAt(m, a.x, a.z), cb = cellAt(m, b.x, b.z);
    if (cb < 0) return 'left maze';
    if (ca === cb) continue;
    if (!passable(m, ca, cb)) return 'through wall';
  }
  return null;
}

/** In cell c, allowing for the 10 cm rounding of stored positions. */
function near(m: Maze, s: Sample, c: number) {
  for (const [dx, dz] of [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) if (cellAt(m, s.x + dx, s.z + dz) === c) return true;
  return false;
}

function passable(m: Maze, a: number, b: number): boolean {
  const ai = a % m.w, aj = Math.floor(a / m.w), bi = b % m.w, bj = Math.floor(b / m.w);
  const di = bi - ai, dj = bj - aj;
  const gap = (c: number, d: number) => !(m.walls[c] & DIRS[d]);
  const step = (c: number, dx: number, dz: number) => {
    const d = dx === 1 ? 1 : dx === -1 ? 3 : dz === 1 ? 2 : 0;
    return gap(c, d) ? c + dx + dz * m.w : -1;
  };
  if (Math.abs(di) + Math.abs(dj) === 1) return step(a, di, dj) === b;
  if (Math.abs(di) === 1 && Math.abs(dj) === 1) {
    // Cut across a corner: fine if either way round is open.
    const viaX = step(a, di, 0), viaZ = step(a, 0, dj);
    return (viaX >= 0 && step(viaX, 0, dj) === b) || (viaZ >= 0 && step(viaZ, di, 0) === b);
  }
  return false;
}

export { CS };
