// Milestone 7: world wonders and culture. Each wonder can stand only once in the world; peoples
// race to finish them, and whoever holds the town holds the wonder. Culture is prestige: it
// grows from great works, temples, wonders and great people, and it draws unhappy towns of
// weaker neighbours across the border.

import { ev, has, tally } from './civ';
import { isCoastal } from './econ';
import { forWithin } from './hex';
import { greatCount } from './people';
import { edictOn } from './player';
import { Rand, S } from './rng';
import { civAge } from './techs';
import type { Civ, ValueId, World } from './types';
import { B } from './worldgen';

export interface WonderFx { lore?: number; stab?: number; wealth?: number; food?: number; def?: number; plagueRes?: number }
export interface WonderDef { name: string; age: number; site?: 'coast' | 'river' | 'hills'; fx: WonderFx; text: string }

export const WONDERS: WonderDef[] = [
  { name: 'the Great Ziggurat', age: 1, fx: { stab: 4 }, text: 'Every town is steadier (+4 stability).' },
  { name: 'the Hanging Gardens', age: 1, site: 'river', fx: { food: 0.1 }, text: 'Fields yield 10% more food.' },
  { name: 'the Colossus', age: 2, site: 'coast', fx: { wealth: 0.25 }, text: 'Towns earn 25% more coin.' },
  { name: 'the Great Wall', age: 2, fx: { def: 0.4 }, text: 'Towns are far harder to take in war.' },
  { name: 'the Great Library', age: 3, fx: { lore: 0.25 }, text: 'Research runs 25% faster.' },
  { name: 'the Lighthouse', age: 3, site: 'coast', fx: { wealth: 0.15, stab: 2 }, text: '15% more coin and +2 stability.' },
  { name: 'the Grand Amphitheatre', age: 3, fx: { stab: 5 }, text: 'Every town is steadier (+5 stability).' },
  { name: 'the Cathedral of Ages', age: 4, fx: { stab: 6 }, text: 'Every town is steadier (+6 stability).' },
  { name: 'the Grand Bazaar', age: 4, fx: { wealth: 0.3 }, text: 'Towns earn 30% more coin.' },
  { name: 'the Star Observatory', age: 5, site: 'hills', fx: { lore: 0.3 }, text: 'Research runs 30% faster.' },
  { name: 'the Palace of Mirrors', age: 5, fx: { stab: 4, wealth: 0.15 }, text: '+4 stability and 15% more coin.' },
  { name: 'the Royal Academy', age: 6, fx: { lore: 0.3 }, text: 'Research runs 30% faster.' },
  { name: 'the Botanic Gardens', age: 6, fx: { food: 0.12, plagueRes: 0.15 }, text: '12% more food, and plagues kill fewer.' },
  { name: 'the Iron Bridge', age: 7, site: 'river', fx: { wealth: 0.25 }, text: 'Towns earn 25% more coin.' },
  { name: 'the Grand Exposition', age: 7, fx: { lore: 0.15, wealth: 0.15 }, text: '15% faster research and 15% more coin.' },
  { name: 'the Great Dam', age: 8, site: 'river', fx: { food: 0.15 }, text: 'Fields yield 15% more food.' },
  { name: 'the Radio Tower', age: 8, fx: { stab: 4, lore: 0.15 }, text: '+4 stability and 15% faster research.' },
  { name: 'the Space Elevator', age: 9, fx: { lore: 0.4 }, text: 'Research runs 40% faster.' },
];

export const wonderCost = (id: number) => 2000 * (WONDERS[id].age + 1);
const MAX_PROJECTS = 3; // wonders being built at once, world-wide, so they arrive over generations

// Which values favour which effect when a people picks what to build.
const LIKES: Record<keyof WonderFx, ValueId[]> = {
  lore: ['curious'], stab: ['devout', 'ancestral', 'stubborn'], wealth: ['mercantile', 'seafaring'],
  food: ['pragmatic', 'egalitarian'], def: ['martial', 'isolationist'], plagueRes: ['pragmatic'],
};

/** The people holding a wonder now (-1 if its town is gone). */
export function wonderHolder(w: World, i: number): number {
  const s = w.setts[w.wonders[i].s];
  return s && s.died < 0 ? s.civ : -1;
}

// Every people's wonder effects, refreshed at the start of each tick and when a wonder is
// finished. Never refreshed lazily: the result must not depend on when a viewer last looked.
let fxAll: Required<WonderFx>[] = [];
const ZERO: Required<WonderFx> = { lore: 0, stab: 0, wealth: 0, food: 0, def: 0, plagueRes: 0 };

/** Wonder effects of one people, worked out fresh (for display). */
export function wonderFxOf(w: World, civ: number): Required<WonderFx> {
  const t = { ...ZERO };
  for (let i = 0; i < w.wonders.length; i++) {
    if (wonderHolder(w, i) !== civ) continue;
    const f = WONDERS[w.wonders[i].id].fx;
    for (const k of Object.keys(f) as (keyof WonderFx)[]) t[k] += f[k] ?? 0;
  }
  return t;
}

export function refreshWonderFx(w: World): void {
  fxAll = [];
  for (let i = 0; i < w.wonders.length; i++) {
    const h = wonderHolder(w, i);
    if (h < 0 || fxAll[h]) continue;
    fxAll[h] = wonderFxOf(w, h);
  }
}

/** The sim's view of a people's wonder effects this tick. */
export function wonderFx(c: Civ): Required<WonderFx> {
  return fxAll[c.id] ?? ZERO;
}

function siteOk(w: World, tile: number, site: WonderDef['site']): boolean {
  if (!site) return true;
  if (site === 'coast') return isCoastal(w, tile);
  if (site === 'river') return w.t.river[tile] > 0;
  let hills = false;
  forWithin(w.W, w.H, tile, 2, (i) => {
    if (w.t.biome[i] === B.HILLS || w.t.biome[i] === B.MOUNTAIN) hills = true;
  });
  return hills;
}

/** Yearly: peoples choose, pour into and finish wonders; culture grows and fades. */
export function yearlyWonders(w: World): void {
  const built = new Set(w.wonders.map((x) => x.id));
  const held = new Map<number, number>();
  for (let i = 0; i < w.wonders.length; i++) {
    const h = wonderHolder(w, i);
    if (h >= 0) held.set(h, (held.get(h) ?? 0) + 1);
  }
  let projects = w.civs.filter((c) => c.died < 0 && c.work).length;
  for (const c of w.civs) {
    if (c.died >= 0) continue;
    const ids = tally.list[c.id] ?? [];

    // Culture: fades slowly and is fed by what the people have made and who they honour.
    let monuments = 0;
    let temples = 0;
    for (const id of ids) {
      monuments += w.setts[id].b.monument;
      temples += w.setts[id].b.temple;
    }
    const gain = (monuments + temples * 0.2 + (held.get(c.id) ?? 0) * 4 + (greatCount(c, 'builder') + greatCount(c, 'prophet')) * 1.5) * (has(c, 'artistic') ? 1.3 : 1);
    c.culture = c.culture * 0.98 + gain;

    const r = new Rand(w.seed, S.WONDER, w.tick, c.id);
    if (c.work) {
      const wk = c.work;
      const s = w.setts[wk.s];
      const def = WONDERS[wk.id];
      if (s.died >= 0 || s.civ !== c.id) {
        ev(w, { k: 'wonder_abandoned', a: c.id, s: s.id, x: def.name });
        c.work = null;
        projects--;
        continue;
      }
      if (built.has(wk.id)) {
        const winner = w.wonders.find((x) => x.id === wk.id)!;
        ev(w, { k: 'wonder_beaten', a: c.id, b: winner.civ, s: s.id, x: winner.name });
        c.work = null;
        projects--;
        continue;
      }
      const fromTown = s.mat * 0.5;
      const fromTreasury = c.wealth * 0.04;
      s.mat -= fromTown;
      c.wealth -= fromTreasury;
      wk.prog += (fromTown + fromTreasury * 2) * (greatCount(c, 'builder') ? 1.25 : 1);
      if (wk.prog >= wonderCost(wk.id)) {
        const b = c.greats.find((g) => g.kind === 'builder');
        if (b) b.deeds++;
        w.wonders.push({ id: wk.id, name: def.name, s: s.id, civ: c.id, t: w.tick, by: '' });
        built.add(wk.id);
        c.culture += 60;
        c.work = null;
        projects--;
        refreshWonderFx(w);
        ev(w, { k: 'wonder', a: c.id, s: s.id, x: def.name, y: b?.name ?? c.ruler.name });
      }
      continue;
    }

    // Starting one takes a city, the will to build, and a wonder within reach of their knowledge.
    if (projects >= MAX_PROJECTS) continue;
    const keen = c.goal === 'build' || has(c, 'artistic') || c.ruler.trait === 'builder' || edictOn(w, c) === 'build' || greatCount(c, 'builder') > 0;
    if (!keen || !r.chance(0.35)) continue;
    let city = w.setts[c.capital];
    for (const id of ids) if (w.setts[id].pop > city.pop) city = w.setts[id];
    if (city.tier < 3) continue;
    const age = civAge(c);
    let best = -1;
    let bestW = 0;
    for (let i = 0; i < WONDERS.length; i++) {
      const d = WONDERS[i];
      if (built.has(i) || d.age > age || !siteOk(w, city.tile, d.site)) continue;
      let wt = 1 + d.age * 0.3 + r.float();
      for (const k of Object.keys(d.fx) as (keyof WonderFx)[]) if (LIKES[k].some((v) => has(c, v))) wt += 1.5;
      if (wt > bestW) { bestW = wt; best = i; }
    }
    if (best < 0) continue;
    c.work = { id: best, s: city.id, prog: 0 };
    projects++;
    ev(w, { k: 'wonder_start', a: c.id, s: city.id, x: WONDERS[best].name });
  }
}
