// Milestone 7: disasters. Earthquakes near mountains, eruptions, great fires in crowded cities,
// locusts in drought and great waves on the coast. All rare, all remembered.

import { ev } from './civ';
import { isCoastal } from './econ';
import { forWithin, hexDist } from './hex';
import { Rand, S } from './rng';
import { TICKS_PER_YEAR, type BKey, type Sett, type World } from './types';
import { B } from './worldgen';

const BREAKABLE: BKey[] = ['walls', 'temple', 'workshop', 'market', 'granary'];

function nearBiome(w: World, tile: number, r: number, biomes: number[]): boolean {
  let hit = false;
  forWithin(w.W, w.H, tile, r, (i) => {
    if (biomes.includes(w.t.biome[i])) hit = true;
  });
  return hit;
}

function hurt(s: Sett, frac: number): number {
  const lost = Math.floor(s.pop * frac);
  s.pop -= lost;
  return lost;
}

function breakOne(s: Sett, r: Rand): void {
  const opts = BREAKABLE.filter((k) => s.b[k] > 0);
  if (opts.length) s.b[r.pick(opts)]--;
}

export function yearlyDisasters(w: World): void {
  const r = new Rand(w.seed, S.DISASTER, w.tick);
  const live = w.setts.filter((s) => s.died < 0);
  if (!live.length) return;

  // Earthquake: a town in the hills or mountains, and its neighbours.
  if (r.chance(0.06)) {
    const cands = live.filter((s) => nearBiome(w, s.tile, 2, [B.MOUNTAIN, B.HILLS]));
    if (cands.length) {
      const s = r.pick(cands);
      let lost = hurt(s, 0.05 + r.float() * 0.07);
      breakOne(s, r);
      for (const o of live) if (o !== s && hexDist(w.W, o.tile, s.tile) <= 3) lost += hurt(o, 0.02 + r.float() * 0.03);
      s.stab = Math.max(5, s.stab - 8);
      ev(w, { k: 'quake', a: s.civ, s: s.id, n: lost });
    }
  }

  // Eruption: rare and terrible, but the ash makes rich soil.
  if (r.chance(0.015)) {
    const cands = live.filter((s) => nearBiome(w, s.tile, 3, [B.MOUNTAIN]));
    if (cands.length) {
      const s = r.pick(cands);
      let lost = 0;
      for (const o of live) {
        const d = hexDist(w.W, o.tile, s.tile);
        if (d > 3) continue;
        lost += hurt(o, d === 0 ? 0.15 + r.float() * 0.1 : 0.05 + r.float() * 0.05);
        o.silt = w.tick + 5 * TICKS_PER_YEAR;
      }
      breakOne(s, r);
      ev(w, { k: 'eruption', a: s.civ, s: s.id, n: lost });
    }
  }

  // Great fire in a crowded city.
  for (const s of live) {
    if (s.tier < 3) continue;
    const rf = new Rand(w.seed, S.DISASTER, w.tick, s.id);
    if (!rf.chance(0.0015)) continue;
    const lost = hurt(s, 0.02 + rf.float() * 0.03);
    s.mat = 0;
    breakOne(s, rf);
    ev(w, { k: 'fire', a: s.civ, s: s.id, n: lost });
  }

  // Locusts follow drought.
  for (const sp of w.spells.slice()) {
    if (sp.k !== 'drought' || sp.start !== w.tick || !r.chance(0.1)) continue;
    w.spells.push({ k: 'locusts', tile: sp.tile, r: sp.r + 2, start: w.tick, end: w.tick + TICKS_PER_YEAR, mult: 650 });
    const hit = new Set<number>();
    for (const s of live) if (hexDist(w.W, s.tile, sp.tile) <= sp.r + 2) hit.add(s.civ);
    for (const a of hit) ev(w, { k: 'locusts', a });
  }

  // A great wave on a coast.
  if (r.chance(0.012)) {
    const cands = live.filter((s) => isCoastal(w, s.tile));
    if (cands.length) {
      const c = r.pick(cands);
      let lost = 0;
      for (const o of cands) if (hexDist(w.W, o.tile, c.tile) <= 4) lost += hurt(o, 0.04 + r.float() * 0.08);
      ev(w, { k: 'tsunami', a: c.civ, s: c.id, n: lost });
    }
  }
}
