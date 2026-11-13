// Several colonies in one land. Each colony is its own sim; this file is the thin layer
// between them: where they sit, what passes from one to another, and how a settler party
// becomes a new colony. The server does the same job with one Durable Object per colony;
// this version runs them all in one place for tests and local play.

import { TICKS_PER_DAY } from '../config';
import { createColony } from './index';
import { Rand, S, hash32 } from './rng';
import type { SettlerMsg } from './settle';
import { step } from './step';
import type { Colony } from './types';

export interface Site { id: string; name: string; x: number; y: number; founded: number; from?: string; seed: number; dead?: number }

export interface World {
  seed: number;
  tick: number;
  sites: Site[];
  colonies: Colony[];
  /** colonies founded so far, for naming and seeding the next */
  count: number;
}

export const REGION_W = 48;
export const REGION_H = 36;

/** A place on the region map for a new colony: a few days' walk from its parent, clear of the others. */
export function pickSpot(seed: number, sites: Site[], near: Site | undefined, n: number): [number, number] {
  const r = new Rand(seed, S.GEN, 500, n);
  let best: [number, number] = [r.range(4, REGION_W - 5), r.range(4, REGION_H - 5)];
  let score = -1e9;
  for (let tries = 0; tries < 60; tries++) {
    const x = near ? Math.max(3, Math.min(REGION_W - 4, near.x + r.range(-9, 9))) : r.range(4, REGION_W - 5);
    const y = near ? Math.max(3, Math.min(REGION_H - 4, near.y + r.range(-7, 7))) : r.range(4, REGION_H - 5);
    let gap = 99;
    for (const s of sites) gap = Math.min(gap, Math.abs(s.x - x) + Math.abs(s.y - y));
    const sc = Math.min(gap, 9) + r.float();
    if (sc > score) { score = sc; best = [x, y]; }
  }
  return best;
}

export const colonySeed = (worldSeed: number, n: number): number => hash32(worldSeed, S.GEN, 900, n) || 1;

/** A new world: a handful of settled colonies that have already lived a while. */
export function createWorld(o: { seed: number; colonies?: number; pop?: number; preDays?: number }): World {
  const w: World = { seed: o.seed >>> 0, tick: 0, sites: [], colonies: [], count: 0 };
  const n = o.colonies ?? 4;
  for (let k = 0; k < n; k++) {
    const seed = colonySeed(w.seed, w.count);
    const c = createColony({ seed, pop: o.pop ?? 14 + (seed % 5), id: 'c' + w.count });
    const [x, y] = pickSpot(w.seed, w.sites, undefined, w.count);
    w.sites.push({ id: c.id, name: c.name, x, y, founded: 0, seed });
    w.colonies.push(c);
    w.count++;
  }
  w.tick = w.colonies[0]?.tick ?? 0;
  const end = w.tick + (o.preDays ?? 0) * TICKS_PER_DAY;
  while (w.tick < end) stepWorld(w);
  return w;
}

/** Found a colony from a settler party. */
export function foundFrom(w: World, msg: SettlerMsg): Colony {
  const seed = colonySeed(w.seed, w.count);
  const parent = w.sites.find((s) => s.id === msg.from);
  const c = createColony({ seed, id: 'c' + w.count, settlers: msg, avoid: w.sites.map((s) => s.name) });
  const [x, y] = pickSpot(w.seed, w.sites, parent, w.count);
  w.sites.push({ id: c.id, name: c.name, x, y, founded: msg.t, from: msg.from, seed });
  w.colonies.push(c);
  w.count++;
  return c;
}

/** One tick for every living colony, then deliver whatever they sent out. */
export function stepWorld(w: World): void {
  for (const c of w.colonies) {
    if (!c.pawns.length) continue;
    step(c);
  }
  w.tick++;
  for (const c of w.colonies.slice()) {
    if (!c.out.length) continue;
    const out = c.out;
    c.out = [];
    for (const m of out) {
      if (m.k === 'settlers') {
        const made = foundFrom(w, m as unknown as SettlerMsg);
        // the old home hears where they ended up
        c.inq.push({ t: c.tick + 1, k: 'news', what: 'founded', name: made.name });
      }
    }
  }
  for (const s of w.sites) {
    if (s.dead) continue;
    const c = w.colonies.find((x) => x.id === s.id);
    if (c && !c.pawns.length) s.dead = w.tick;
  }
}
