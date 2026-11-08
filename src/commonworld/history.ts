// Compact history for the timeline: a map frame every few years plus yearly stats per civ.
// Frames hold only what the map needs (who owns each tile, each living settlement's size),
// run-length encoded, so a thousand years fits in a few MB.

import { TICKS_PER_YEAR, type World } from './sim/types';

export interface Frame {
  year: number;
  own: Int32Array; // RLE pairs: owner, run length
  setts: Int32Array; // per living settlement: id, civ, pop, tier, stab
  routes: Int32Array; // trade routes: settlement a, settlement b, 1 if by sea
}

export const SETT_STRIDE = 5;

export interface CivSeries {
  from: number; // first year recorded
  pop: number[];
  setts: number[];
  tiles: number[];
}

export interface SettView { id: number; tile: number; civ: number; pop: number; tier: number; stab: number }

function rle(a: Int16Array): Int32Array {
  const out: number[] = [];
  let v = a[0];
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === v) n++;
    else {
      out.push(v, n);
      v = a[i];
      n = 1;
    }
  }
  out.push(v, n);
  return Int32Array.from(out);
}

export function decodeOwner(f: Frame, out: Int16Array): Int16Array {
  let k = 0;
  for (let p = 0; p < f.own.length; p += 2) {
    out.fill(f.own[p], k, k + f.own[p + 1]);
    k += f.own[p + 1];
  }
  return out;
}

export function frameSetts(w: World, f: Frame): SettView[] {
  const out: SettView[] = [];
  const s = f.setts;
  for (let p = 0; p < s.length; p += SETT_STRIDE) {
    out.push({ id: s[p], tile: w.setts[s[p]].tile, civ: s[p + 1], pop: s[p + 2], tier: s[p + 3], stab: s[p + 4] });
  }
  return out;
}

/** Trade routes as tile pairs, plus whether they go by sea. */
export function frameRoutes(w: World, f: Frame | null): [number, number, boolean][] {
  if (!f) return w.routes.map((r) => [w.setts[r.a].tile, w.setts[r.b].tile, r.sea]);
  const out: [number, number, boolean][] = [];
  for (let p = 0; p < f.routes.length; p += 3) out.push([w.setts[f.routes[p]].tile, w.setts[f.routes[p + 1]].tile, f.routes[p + 2] === 1]);
  return out;
}

export function liveSetts(w: World): SettView[] {
  const out: SettView[] = [];
  for (const s of w.setts) if (s.died < 0) out.push({ id: s.id, tile: s.tile, civ: s.civ, pop: s.pop, tier: s.tier, stab: s.stab });
  return out;
}

/** Everything recorded about one game year: per-civ stats, and a map frame every few years. */
export interface YearRecord {
  year: number;
  stats: number[]; // civ, pop, settlements, tiles; repeated
  frame: Frame | null;
}

export function yearRecord(w: World, every: number): YearRecord {
  const year = Math.floor(w.tick / TICKS_PER_YEAR);
  const pop = new Map<number, number>();
  const setts = new Map<number, number>();
  const tiles = new Map<number, number>();
  const flat: number[] = [];
  for (const s of w.setts) {
    if (s.died >= 0) continue;
    pop.set(s.civ, (pop.get(s.civ) ?? 0) + s.pop);
    setts.set(s.civ, (setts.get(s.civ) ?? 0) + 1);
    flat.push(s.id, s.civ, s.pop, s.tier, s.stab);
  }
  for (let i = 0; i < w.t.owner.length; i++) {
    const o = w.t.owner[i];
    if (o >= 0) tiles.set(o, (tiles.get(o) ?? 0) + 1);
  }
  const stats: number[] = [];
  for (const c of w.civs) {
    if (c.died >= 0 && c.died < w.tick - TICKS_PER_YEAR) continue;
    stats.push(c.id, pop.get(c.id) ?? 0, setts.get(c.id) ?? 0, tiles.get(c.id) ?? 0);
  }
  let frame: Frame | null = null;
  if (year % every === 0) {
    const routes: number[] = [];
    for (const r of w.routes) routes.push(r.a, r.b, r.sea ? 1 : 0);
    frame = { year, own: rle(w.t.owner), setts: Int32Array.from(flat), routes: Int32Array.from(routes) };
  }
  return { year, stats, frame };
}

// ---- Wire format: frames travel as base64 of their Int32 bytes ----

export function i32ToB64(a: Int32Array): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToI32(s: string): Int32Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new Int32Array(b.buffer);
}
export function frameToWire(f: Frame): string {
  return JSON.stringify([i32ToB64(f.own), i32ToB64(f.setts), i32ToB64(f.routes)]);
}
export function frameFromWire(year: number, s: string): Frame {
  const [own, setts, routes] = JSON.parse(s) as string[];
  return { year, own: b64ToI32(own), setts: b64ToI32(setts), routes: b64ToI32(routes) };
}

export class History {
  frames: Frame[] = [];
  civs = new Map<number, CivSeries>();
  worldPop: number[] = [];
  lastYear = -1;

  constructor(public every = 2) {}

  /** Call after each step; records once per game year. */
  record(w: World): void {
    if (w.tick % TICKS_PER_YEAR !== 0) return;
    if (w.tick / TICKS_PER_YEAR <= this.lastYear) return;
    this.add(yearRecord(w, this.every));
  }

  add(rec: YearRecord): void {
    if (rec.year <= this.lastYear) return;
    this.lastYear = rec.year;
    let total = 0;
    for (let p = 0; p < rec.stats.length; p += 4) {
      const civ = rec.stats[p];
      let ser = this.civs.get(civ);
      if (!ser) this.civs.set(civ, (ser = { from: rec.year, pop: [], setts: [], tiles: [] }));
      // Fill any gap so index = year - from stays true.
      while (ser.from + ser.pop.length < rec.year) {
        ser.pop.push(0);
        ser.setts.push(0);
        ser.tiles.push(0);
      }
      ser.pop.push(rec.stats[p + 1]);
      ser.setts.push(rec.stats[p + 2]);
      ser.tiles.push(rec.stats[p + 3]);
      total += rec.stats[p + 1];
    }
    this.worldPop.push(total);
    if (rec.frame) this.frames.push(rec.frame);
  }

  /** The latest frame at or before the year. */
  frameAt(year: number): Frame | null {
    let lo = 0;
    let hi = this.frames.length - 1;
    let best: Frame | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].year <= year) {
        best = this.frames[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }

  /** A civ's population in a given year (0 if not alive then). */
  civPopAt(civ: number, year: number): number {
    const s = this.civs.get(civ);
    if (!s) return 0;
    return s.pop[year - s.from] ?? 0;
  }

  bytes(): number {
    let b = 0;
    for (const f of this.frames) b += f.own.byteLength + f.setts.byteLength + f.routes.byteLength;
    return b;
  }
}
