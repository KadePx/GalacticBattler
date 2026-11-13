// Stateless seeded randomness. Every draw is keyed by (seed, tick, stream, id, ...), so
// systems never share a stream and adding a new one never shifts another's results.
// Nothing here is saved in the world: the same key always gives the same numbers.

export function hash32(...xs: number[]): number {
  let h = 0x811c9dc5 | 0;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export class Rand {
  private s: number;
  constructor(...key: number[]) {
    this.s = hash32(...key);
  }
  /** uint32 (mulberry32) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  float(): number {
    return this.next() / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
  /** inclusive */
  range(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }
  chance(p: number): boolean {
    return this.float() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  /** Rounds up or down at random, so small fractional growth still adds up over time. */
  round(x: number): number {
    const f = Math.floor(x);
    return f + (this.float() < x - f ? 1 : 0);
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }
}

/** Stream ids: one per subsystem. Add new ones at the end; never renumber. */
/** Stream ids: one per subsystem. Add new ones at the end; never renumber. */
export const S = {
  GEN: 1,
  NAME: 2,
  PAWN: 3,
  AI: 4,
  JOB: 5,
  SOC: 6,
  MOOD: 7,
  WEATHER: 8,
  EVENT: 9,
  PLAN: 10,
  ECON: 11,
  HEALTH: 12,
  BIRTH: 13,
  DEATH: 14,
  FAITH: 15,
  GOV: 16,
  LOVE: 17,
  FIGHT: 18,
  STORY: 19,
  CRIME: 20,
} as const;
