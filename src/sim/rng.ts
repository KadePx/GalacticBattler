// Seeded random numbers so runs, bots and shops are reproducible.

export interface RngState {
  rng: number;
}

export function rand(s: RngState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s: RngState, n: number): number {
  return Math.floor(rand(s) * n);
}

export function pick<T>(s: RngState, arr: readonly T[]): T {
  return arr[randInt(s, arr.length)];
}

export function hashStr(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
