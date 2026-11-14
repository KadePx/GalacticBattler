// What to sow, and how varied the colony's table is.

import { DAYS_PER_YEAR, dayOf, seasonOf } from '../config';
import { CROPS, type CropDef } from './data/buildings';
import { mouths } from './econ';
import { hash32, S } from './rng';
import type { Bld, Colony } from './types';

/** Can this crop still be sown today and ripen before the cold? */
export function sowable(c: Colony, def: CropDef): boolean {
  if (def.old) return false;
  const doy = dayOf(c.tick) % DAYS_PER_YEAR;
  if (!def.sow.includes(seasonOf(c.tick))) return false;
  if (c.temp < (def.hardy ? -1 : 2)) return false;
  return doy + def.days <= (def.hardy ? 52 : 43);
}

/** Can anything at all be sown today? */
export function anySowable(c: Colony): boolean {
  for (const k in CROPS) if (sowable(c, CROPS[k])) return true;
  return false;
}

/**
 * What a bare field should grow next. The colony weighs what it is short of, likes a varied
 * table, and does not sow the same crop in the same field twice running if it can help it.
 */
export function chooseCrop(c: Colony, b: Bld | null): string {
  const pop = c.pawns.length;
  const m = mouths(c);
  const s = c.stock;
  const others: Record<string, number> = {};
  for (const f of c.blds) if (f.k === 'field' && f !== b && f.crop) others[f.crop] = (others[f.crop] ?? 0) + 1;
  const pub = c.blds.some((x) => x.built && (x.k === 'tavern' || x.k === 'hall' || x.k === 'brewery'));
  const now = Object.values(CROPS).filter((d) => sowable(c, d));
  const list = now.length ? now : Object.values(CROPS).filter((d) => !d.old);
  const year = Math.floor(dayOf(c.tick) / DAYS_PER_YEAR);
  let best = 'grain';
  let bestS = -1e9;
  for (const d of list) {
    let v: number;
    if (d.res === 'grain') v = 1.2 + 2 * Math.max(0, 1 - s.grain / (m * 26));
    else if (d.res === 'veg') v = 1 + 2 * Math.max(0, 1 - s.veg / (m * 12));
    else if (d.res === 'hops') v = pub && pop >= 6 && !others[d.k] && s.hops < pop * 1.5 ? 2.4 : -5;
    else if (d.res === 'herbs') v = pop >= 8 && !others[d.k] && s.herbs < 4 + pop * 0.3 ? 2 : -5;
    else v = pop >= 8 && !others[d.k] && s.cloth < 6 + pop * 0.2 ? 2.2 : -5; // flax
    // a varied table: a crop nobody else is growing is worth more
    if (d.res === 'grain' || d.res === 'veg') v += others[d.k] ? -0.9 * others[d.k] : 0.9;
    // rotation: the same crop again wears out the ground
    if (b && b.crop === d.k) v -= 0.8;
    v += (d.yield / 4) * 0.4;
    v += (hash32(c.seed, S.PLAN, b?.id ?? 0, year, d.k.length * 31 + d.days) / 4294967296) * 0.9;
    if (v > bestS) { bestS = v; best = d.k; }
  }
  return best;
}

const varMemo = new WeakMap<Colony, [number, number]>();

/**
 * How many different kinds of food are in the stores: each crop brought in this past season
 * (while some of it is left), plus meat, fish and berries.
 */
export function variety(c: Colony): number {
  const m = varMemo.get(c);
  if (m && m[0] === c.tick) return m[1];
  const s = c.stock;
  let n = (s.meat >= 1 ? 1 : 0) + (s.fish >= 1 ? 1 : 0) + (s.berries >= 1 ? 1 : 0) + (s.mushrooms >= 1 ? 1 : 0);
  const fresh = c.fresh ?? {};
  for (const k in fresh) {
    const def = CROPS[k];
    if (!def || (def.res !== 'grain' && def.res !== 'veg')) continue;
    if (c.tick - fresh[k] > 240 * 50) continue;
    if (s[def.res] >= 1) n++;
  }
  varMemo.set(c, [c.tick, n]);
  return n;
}
