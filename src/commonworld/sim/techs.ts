// The tech tree: ten Ages, techs with prerequisites, and what each one does. Research is
// chosen by each civ's values and situation, and gets cheaper when neighbours already know it.

import { Rand } from './rng';
import type { Civ, ValueId } from './types';
import { R } from './worldgen';

export const AGES = ['Dawn', 'Bronze', 'Iron', 'Classical', 'Medieval', 'Renaissance', 'Enlightenment', 'Industrial', 'Electric', 'Modern'];
const AGE_COST = [80, 400, 1400, 3500, 7000, 12000, 18000, 26000, 38000, 55000];

export interface Effects {
  food?: number; mat?: number; stab?: number; grow?: number; lore?: number; wealth?: number;
  mil?: number; def?: number; trade?: number; range?: number; sail?: number; sizePen?: number; plagueRes?: number;
}
export interface Tech {
  id: number;
  name: string;
  age: number;
  req: number[];
  fx: Effects;
  needs?: number; // resource that must be reachable for the fx to apply
}

const T = (id: number, name: string, age: number, req: number[], fx: Effects, needs?: number): Tech => ({ id, name, age, req, fx, needs });
export const TECHS: Tech[] = [
  // Dawn
  T(0, 'foraging lore', 0, [], { food: 0.05 }),
  T(1, 'the plough', 0, [0], { food: 0.08 }),
  T(2, 'pottery', 0, [], { mat: 0.06, food: 0.03 }),
  T(3, 'animal husbandry', 0, [0], { food: 0.05, mil: 0.05 }),
  T(4, "the potter's wheel", 0, [2], { mat: 0.08 }),
  T(5, 'mysticism', 0, [], { stab: 3 }),
  T(6, 'rafts', 0, [], { sail: 1 }),
  // Bronze
  T(7, 'bronze working', 1, [4], { mil: 0.2 }, R.COPPER),
  T(8, 'irrigation', 1, [1], { food: 0.1 }),
  T(9, 'writing', 1, [5, 4], { lore: 0.2, stab: 2 }),
  T(10, 'masonry', 1, [2], { def: 0.3, mat: 0.05 }),
  T(11, 'horseback riding', 1, [3], { mil: 0.15, range: 1 }, R.HORSES),
  T(12, 'sailing', 1, [6], { sail: 2, trade: 1 }),
  T(13, 'the calendar', 1, [9], { food: 0.05, stab: 2 }),
  T(14, 'currency', 1, [9], { wealth: 0.3, trade: 1 }),
  // Iron
  T(15, 'iron working', 2, [7], { mil: 0.25 }, R.IRON),
  T(16, 'mathematics', 2, [9], { lore: 0.15, mat: 0.05 }),
  T(17, 'code of laws', 2, [9], { stab: 4, sizePen: 0.2 }),
  T(18, 'roads', 2, [10, 11], { range: 1, trade: 1, sizePen: 0.15 }),
  T(19, 'crop rotation', 2, [8], { food: 0.1 }),
  T(20, 'philosophy', 2, [16, 17], { lore: 0.2, stab: 2 }),
  T(21, 'shipbuilding', 2, [12], { sail: 3, trade: 1 }),
  // Classical
  T(22, 'engineering', 3, [16, 18], { def: 0.3, mat: 0.1 }),
  T(23, 'aqueducts', 3, [22], { grow: 0.15 }),
  T(24, 'banking', 3, [14, 16], { wealth: 0.3 }),
  T(25, 'standing armies', 3, [15, 17], { mil: 0.2 }),
  T(26, 'astronomy', 3, [20, 21], { lore: 0.2, sail: 1 }),
  T(27, 'organized faith', 3, [20], { stab: 5 }),
  T(28, 'medicine', 3, [20], { grow: 0.1, plagueRes: 0.3 }),
  // Medieval
  T(29, 'heavy plough', 4, [19], { food: 0.12 }),
  T(30, 'castles', 4, [22, 25], { def: 0.5 }),
  T(31, 'feudal levies', 4, [25], { mil: 0.2, sizePen: 0.15 }),
  T(32, 'guilds', 4, [24], { mat: 0.15, wealth: 0.2 }),
  T(33, 'universities', 4, [26, 20], { lore: 0.3 }),
  T(34, 'the compass', 4, [26], { sail: 2, trade: 1 }),
  T(35, 'windmills', 4, [29], { food: 0.06, mat: 0.1 }),
  // Renaissance
  T(36, 'printing', 5, [33], { lore: 0.3, stab: 3 }),
  T(37, 'gunpowder', 5, [31, 33], { mil: 0.4 }),
  T(38, 'navigation', 5, [34], { sail: 3, trade: 2 }),
  T(39, 'double-entry books', 5, [32], { wealth: 0.4 }),
  T(40, 'sanitation', 5, [28, 33], { grow: 0.15, plagueRes: 0.3 }),
  T(41, 'cartography', 5, [38], { range: 2 }),
  // Enlightenment
  T(42, 'the scientific method', 6, [36], { lore: 0.3 }),
  T(43, 'optics', 6, [36, 26], { lore: 0.1, sail: 1 }),
  T(44, 'joint-stock companies', 6, [39, 38], { wealth: 0.3, trade: 1 }),
  T(45, 'the social contract', 6, [17, 36], { stab: 4, sizePen: 0.1 }),
  T(46, 'inoculation', 6, [40], { grow: 0.1, plagueRes: 0.2 }),
  T(47, 'the seed drill', 6, [35, 42], { food: 0.12 }),
  T(48, 'flintlocks', 6, [37], { mil: 0.3 }),
  // Industrial
  T(49, 'steam power', 7, [42, 22], { mat: 0.2 }),
  T(50, 'railways', 7, [49, 18], { range: 2, trade: 2, sizePen: 0.1 }, R.IRON),
  T(51, 'factories', 7, [49, 32], { mat: 0.25, wealth: 0.2 }),
  T(52, 'rifling', 7, [48, 15], { mil: 0.3 }),
  T(53, 'steamships', 7, [49, 38], { sail: 3, trade: 2 }),
  T(54, 'fertiliser', 7, [47, 42], { food: 0.15 }),
  T(55, 'public schooling', 7, [45, 42], { lore: 0.25, stab: 2 }),
  // Electric
  T(56, 'electricity', 8, [42, 51], { lore: 0.15, mat: 0.15 }),
  T(57, 'the telegraph', 8, [56, 50], { range: 2, stab: 3, sizePen: 0.1 }),
  T(58, 'germ theory', 8, [46, 43], { grow: 0.15, plagueRes: 0.3 }),
  T(59, 'refrigeration', 8, [56, 54], { food: 0.12, grow: 0.05 }),
  T(60, 'steel', 8, [51, 15], { def: 0.4, mat: 0.15 }, R.IRON),
  T(61, 'combustion engines', 8, [56, 49], { mil: 0.25, range: 1 }),
  T(62, 'stock exchanges', 8, [44, 57], { wealth: 0.3 }),
  // Modern
  T(63, 'flight', 9, [61, 43], { range: 2, mil: 0.2 }),
  T(64, 'radio', 9, [57], { stab: 3, lore: 0.15 }),
  T(65, 'antibiotics', 9, [58], { grow: 0.15, plagueRes: 0.2 }),
  T(66, 'mechanised farming', 9, [59, 61], { food: 0.15 }),
  T(67, 'computing', 9, [64, 42], { lore: 0.4 }),
  T(68, 'mass production', 9, [51, 61], { mat: 0.25, wealth: 0.2 }),
  T(69, 'armoured warfare', 9, [61, 60], { mil: 0.4, def: 0.2 }),
];

export function techCost(t: Tech): number {
  return AGE_COST[t.age];
}

export interface Mods {
  food: number; mat: number; stab: number; grow: number; lore: number; wealth: number;
  mil: number; def: number; trade: number; range: number; sail: number; sizePen: number; plagueRes: number;
}

const modCache = new WeakMap<Civ, { n: number; acc: number; m: Mods }>();
export function mods(c: Civ): Mods {
  const hit = modCache.get(c);
  if (hit && hit.n === c.techs.length && hit.acc === c.access) return hit.m;
  const m: Mods = { food: 1, mat: 1, stab: 0, grow: 1, lore: 1, wealth: 1, mil: 0, def: 0, trade: 0, range: 0, sail: 0, sizePen: 0, plagueRes: 0 };
  for (const id of c.techs) {
    const t = TECHS[id];
    if (t.needs !== undefined && !(c.access & (1 << t.needs))) continue;
    const f = t.fx;
    m.food += f.food ?? 0;
    m.mat += f.mat ?? 0;
    m.stab += f.stab ?? 0;
    m.grow += f.grow ?? 0;
    m.lore += f.lore ?? 0;
    m.wealth += f.wealth ?? 0;
    m.mil += f.mil ?? 0;
    m.def += f.def ?? 0;
    m.trade += f.trade ?? 0;
    m.range += f.range ?? 0;
    m.sail += f.sail ?? 0;
    m.sizePen += f.sizePen ?? 0;
    m.plagueRes += f.plagueRes ?? 0;
  }
  m.sizePen = Math.min(0.6, m.sizePen);
  m.plagueRes = Math.min(0.7, m.plagueRes);
  modCache.set(c, { n: c.techs.length, acc: c.access, m });
  return m;
}

export function civAge(c: Civ): number {
  let a = 0;
  for (const id of c.techs) a = Math.max(a, TECHS[id].age);
  return a;
}

/** Techs whose prerequisites are all known. */
export function available(c: Civ): Tech[] {
  return TECHS.filter((t) => !c.techs.includes(t.id) && t.req.every((r) => c.techs.includes(r)));
}

const VALUE_FX: Partial<Record<ValueId, (keyof Effects)[]>> = {
  curious: ['lore'],
  martial: ['mil', 'def'],
  mercantile: ['wealth', 'trade'],
  seafaring: ['sail', 'trade'],
  devout: ['stab'],
  pragmatic: ['food', 'mat'],
  artistic: ['mat', 'stab'],
  expansionist: ['range', 'food'],
  isolationist: ['def', 'stab'],
  egalitarian: ['grow', 'sizePen'],
  ancestral: ['stab', 'food'],
  stubborn: ['def'],
};

export interface ResearchSituation { atWar: boolean; hungry: boolean; coastal: boolean; known: (id: number) => number }

/** Pick the next tech to study: weighted by values, needs, and what neighbours already know. */
export function pickResearch(c: Civ, sit: ResearchSituation, r: Rand): number {
  const opts = available(c);
  if (!opts.length) return -1;
  let total = 0;
  const wts = opts.map((t) => {
    let w = 1;
    const keys = Object.keys(t.fx) as (keyof Effects)[];
    for (const v of c.values) for (const k of VALUE_FX[v] ?? []) if (keys.includes(k)) w += 1.2;
    if (sit.atWar && (keys.includes('mil') || keys.includes('def'))) w += 2;
    if (sit.hungry && keys.includes('food')) w += 2;
    if (sit.coastal && keys.includes('sail')) w += 0.8;
    if (!sit.coastal && keys.includes('sail')) w *= 0.3;
    if (t.needs !== undefined && !(c.access & (1 << t.needs))) w *= 0.25;
    w += Math.min(2, sit.known(t.id) * 0.5);
    w /= 1 + t.age * 0.15; // finish the cheap ones first
    total += w;
    return w;
  });
  let x = r.float() * total;
  for (let k = 0; k < opts.length; k++) {
    x -= wts[k];
    if (x <= 0) return opts[k].id;
  }
  return opts[opts.length - 1].id;
}
