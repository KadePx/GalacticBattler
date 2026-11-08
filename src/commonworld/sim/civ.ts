// Civilizations and settlements: land yields, territory, founding, and site scoring.

import { forWithin, hexDist, neighbors } from './hex';
import { NAME_KEY, peopleName, word } from './names';
import { hash32, Rand, S } from './rng';
import {
  RULER_TRAITS, TICKS_PER_YEAR, type BKey, type Civ, type Ev, type Ruler, type Sett, type ValueId, type World,
} from './types';
import { B, BIOMES, RES_FOOD, RES_MAT, isLand } from './worldgen';

export const TIER_POP = [0, 300, 1500, 6000, 20000];
export const TIER_R = [1, 2, 2, 3, 3];
export const PEOPLE_PER_FOOD = 100;
export const RESERVE_TARGET = 8; // frontier sites held open for new players
const RESERVE_KEEP = 2; // no civ claims land this close to a reserve
const RESERVE_AVOID = 4; // AI settlers don't found this close to a reserve

export function nearReserve(w: World, tile: number, r: number): boolean {
  for (const t of w.reserves) if (hexDist(w.W, t, tile) <= r) return true;
  return false;
}

export function tierFor(pop: number): number {
  let t = 0;
  while (t + 1 < TIER_POP.length && pop >= TIER_POP[t + 1]) t++;
  return t;
}

export function has(c: Civ, v: ValueId): boolean {
  return c.values.includes(v);
}

export function ev(w: World, e: Omit<Ev, 't'>): void {
  w.log.push({ t: w.tick, ...e });
}

/** Global id of an event at position i in w.log. */
export function evId(w: World, i: number): number {
  return w.logBase + i;
}

export { mods, type Mods } from './techs';

// ---- Land ----

export function foodYield(w: World, i: number, seafaring: boolean): number {
  const t = w.t;
  const b = t.biome[i];
  let f = BIOMES[b].f + RES_FOOD[t.res[i]];
  if (t.river[i]) {
    f += t.flow[i] >= 3 ? 2 : 1;
    if (b === B.DESERT) f += 2; // floodplain
  }
  if (!BIOMES[b].land && seafaring) f += 1;
  return f;
}

export function matYield(w: World, i: number): number {
  return BIOMES[w.t.biome[i]].m + RES_MAT[w.t.res[i]];
}

/** Claim free tiles in reach and refresh what the land can give. */
export function claimTiles(w: World, s: Sett): void {
  const t = w.t;
  const c = w.civs[s.civ];
  const sea = has(c, 'seafaring');
  let f = 0;
  let m = 0;
  forWithin(w.W, w.H, s.tile, TIER_R[s.tier], (i) => {
    if (t.biome[i] === B.OCEAN) return;
    if (t.owner[i] === -1 && w.reserves.length && nearReserve(w, i, RESERVE_KEEP)) return;
    if (t.owner[i] === -1) {
      t.owner[i] = s.civ;
      t.work[i] = s.id;
    } else if (t.owner[i] === s.civ && t.work[i] === -1) {
      t.work[i] = s.id;
    }
    if (t.work[i] === s.id) {
      f += i === s.tile ? Math.max(2, foodYield(w, i, sea)) : foodYield(w, i, sea);
      m += matYield(w, i);
    }
  });
  s.cap = f * PEOPLE_PER_FOOD;
  s.matBase = m;
}

export function releaseTiles(w: World, s: Sett): void {
  const t = w.t;
  forWithin(w.W, w.H, s.tile, 3, (i) => {
    if (t.work[i] === s.id) {
      t.work[i] = -1;
      t.owner[i] = -1;
    }
  });
}

/** How good a tile is to settle, or -Infinity if it can't be settled. civ may be null (founding). */
export function scoreSite(w: World, civ: Civ | null, tile: number): number {
  const t = w.t;
  const b = t.biome[tile];
  if (!isLand(t, tile) || b === B.MOUNTAIN || b === B.SNOW) return -Infinity;
  const me = civ ? civ.id : -2;
  if (t.owner[tile] !== -1 && t.owner[tile] !== me) return -Infinity;
  if (civ && w.reserves.length && nearReserve(w, tile, RESERVE_AVOID)) return -Infinity;
  if (t.work[tile] !== -1) return -Infinity;
  let bad = false;
  forWithin(w.W, w.H, tile, 3, (i) => {
    if (t.city[i] !== -1) bad = true;
  });
  if (bad) return -Infinity;
  const sea = civ ? has(civ, 'seafaring') : false;
  let score = 0;
  forWithin(w.W, w.H, tile, 1, (i) => {
    const o = t.owner[i];
    if (o !== -1 && o !== me) { bad = true; return; }
    if (t.work[i] !== -1) return;
    score += foodYield(w, i, sea) + matYield(w, i) * 0.3;
  });
  if (bad) return -Infinity;
  if (t.river[tile]) score += 2;
  const nb: number[] = [];
  for (const j of neighbors(w.W, w.H, tile, nb)) {
    if (!isLand(t, j)) { score += sea ? 4 : 1; break; }
  }
  if (civ && has(civ, 'isolationist')) {
    forWithin(w.W, w.H, tile, 4, (i) => {
      if (t.owner[i] !== -1 && t.owner[i] !== me) bad = true;
    });
    if (bad) score -= 3;
  }
  return score;
}

/** Best unclaimed places to found a brand-new civ, spread apart. */
export function suggestSpots(w: World, n: number, minGap = 10): number[] {
  const t = w.t;
  const cands: [number, number][] = [];
  for (let i = 0; i < w.W * w.H; i++) {
    if (t.owner[i] !== -1 || !isLand(t, i)) continue;
    const x = i % w.W;
    const y = (i - x) / w.W;
    if (x < 3 || y < 3 || x >= w.W - 3 || y >= w.H - 3) continue;
    let near = false;
    forWithin(w.W, w.H, i, 5, (j) => {
      if (t.owner[j] !== -1) near = true;
    });
    if (near) continue;
    const s = scoreSite(w, null, i);
    if (s > 8) cands.push([s, i]);
  }
  cands.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const out: number[] = [];
  for (const [, i] of cands) {
    if (out.length >= n) break;
    if (out.every((o) => hexDist(w.W, o, i) >= minGap)) out.push(i);
  }
  return out;
}

// ---- Founding ----

export function houseName(c: Civ): string {
  return word(c.phon, c.lex, NAME_KEY.HOUSE, c.houses++);
}

/** A new ruler. house = null starts a new dynasty. */
export function newRuler(w: World, c: Civ, house: string | null): Ruler {
  const r = new Rand(w.seed, S.RULER, c.id, c.rulers);
  const name = word(c.phon, c.lex, NAME_KEY.RULER, c.rulers);
  c.rulers++;
  const age = r.range(18, 40);
  const life = r.range(45, 78);
  const born = w.tick - age * TICKS_PER_YEAR;
  const dies = Math.max(w.tick + TICKS_PER_YEAR, born + life * TICKS_PER_YEAR + r.int(TICKS_PER_YEAR));
  return { name, born, dies, since: w.tick, founded: 0, famines: 0, built: 0, won: 0, trait: r.pick(RULER_TRAITS), house: house ?? houseName(c) };
}

function emptyBuildings(): Record<BKey, number> {
  return { fields: 0, granary: 0, walls: 0, temple: 0, market: 0, workshop: 0, monument: 0 };
}

export function foundSettlement(w: World, c: Civ, tile: number, pop: number, parent: number, name?: string): Sett {
  const auto = word(c.phon, c.lex, NAME_KEY.SETT, c.named++);
  const s: Sett = {
    id: w.setts.length,
    civ: c.id,
    name: name ?? auto,
    tile,
    born: w.tick,
    died: -1,
    pop,
    food: pop * 3,
    mat: 20,
    tier: tierFor(pop),
    maxTier: tierFor(pop),
    stab: 65,
    cap: 0,
    matBase: 0,
    b: emptyBuildings(),
    starve: 0,
    lastFamine: -1,
    plague: 0,
    plagueId: -1,
    immune: -1,
    silt: -1,
    monument: null,
    parent,
    noSites: -1,
    siege: 0,
    siegeBy: -1,
    conq: -1,
  };
  w.setts.push(s);
  w.t.city[tile] = s.id;
  // Take the tile even if a neighbour was working it.
  w.t.owner[tile] = c.id;
  w.t.work[tile] = s.id;
  claimTiles(w, s);
  const rid = w.t.river[tile];
  if (rid) {
    const river = w.rivers[rid - 1];
    if (!river.name) {
      river.name = word(c.phon, c.lex, NAME_KEY.RIVER, rid);
      river.namedBy = c.id;
      ev(w, { k: 'river_named', a: c.id, s: s.id, x: river.name });
    }
  }
  return s;
}

export interface FoundOpts {
  tile: number;
  values: ValueId[];
  founder: string | null;
  name?: string;
  capital?: string;
  motto?: string;
  byName?: string;
  banner?: number[];
  parent?: number;
  phon?: number;
  lex?: number;
  pop?: number;
}

export function foundCiv(w: World, o: FoundOpts): Civ {
  const id = w.civs.length;
  const lex = o.lex ?? hash32(w.seed, S.FOUND, id, 0x1e7);
  const phon = o.phon ?? hash32(lex, 0x9407);
  const c: Civ = {
    id,
    name: o.name ?? peopleName(phon, lex),
    phon,
    lex,
    hue: o.banner ? o.banner[0] % 360 : (id * 137 + (lex % 40)) % 360,
    values: o.values.slice(0, 3),
    born: w.tick,
    died: -1,
    capital: -1,
    founder: o.founder,
    byName: o.byName ?? '',
    banner: o.banner ?? null,
    protectedUntil: -1,
    parent: o.parent ?? -1,
    motto: o.motto ?? '',
    goal: 'grow',
    ruler: null as unknown as Ruler,
    rulers: 0,
    lore: 0,
    techs: [],
    research: -1,
    access: 0,
    wealth: 0,
    army: 0,
    weary: 0,
    houses: 0,
    greats: [],
    greatN: 0,
    contacts: [],
    peakPop: 0,
    peakSetts: 1,
    named: 0,
  };
  w.civs.push(c);
  c.ruler = newRuler(w, c, null);
  if (o.pop !== undefined) {
    const s = foundSettlement(w, c, o.tile, o.pop, -1, o.capital);
    c.capital = s.id;
    ev(w, { k: 'found_civ', a: c.id, s: s.id, x: c.ruler.name });
  }
  return c;
}

// ---- Per-tick tallies (rebuilt every step, never saved) ----

export const tally = {
  live: new Int32Array(0), // living settlements per civ
  pop: new Float64Array(0), // people per civ
  list: [] as number[][], // living settlement ids per civ
};

export function recount(w: World): void {
  const n = w.civs.length;
  if (tally.live.length < n) {
    tally.live = new Int32Array(n + 64);
    tally.pop = new Float64Array(n + 64);
  }
  tally.live.fill(0);
  tally.pop.fill(0);
  tally.list.length = n;
  for (let i = 0; i < n; i++) tally.list[i] = [];
  for (const s of w.setts) {
    if (s.died >= 0) continue;
    tally.live[s.civ]++;
    tally.pop[s.civ] += s.pop;
    tally.list[s.civ].push(s.id);
  }
}

/** Move a settlement and the land it works to another civ. */
export function transferSett(w: World, s: Sett, to: number): void {
  const from = s.civ;
  forWithin(w.W, w.H, s.tile, 3, (i) => {
    if (w.t.work[i] === s.id) w.t.owner[i] = to;
  });
  s.civ = to;
  s.siege = 0;
  s.siegeBy = -1;
  w.routes = w.routes.filter((r) => r.a !== s.id && r.b !== s.id);
  tally.live[from]--;
  tally.live[to]++;
  tally.list[from] = tally.list[from].filter((id) => id !== s.id);
  (tally.list[to] ??= []).push(s.id);
}

/** A capital is gone: pick the largest settlement left, or the civ falls. */
export function moveCapital(w: World, c: Civ, conqueror = -1): void {
  let best: Sett | null = null;
  for (const o of w.setts) if (o.civ === c.id && o.died < 0 && (!best || o.pop > best.pop)) best = o;
  if (best) {
    c.capital = best.id;
    ev(w, { k: 'capital_move', a: c.id, s: best.id });
  } else {
    c.died = w.tick;
    c.army = 0;
    ev(w, { k: 'civ_fall', a: c.id, b: conqueror >= 0 ? conqueror : undefined, n: Math.floor((w.tick - c.born) / TICKS_PER_YEAR), y: String(Math.round(c.peakPop)) });
  }
}

export function killSett(w: World, s: Sett): void {
  s.died = w.tick;
  s.pop = 0;
  releaseTiles(w, s);
  w.t.city[s.tile] = -1;
  w.routes = w.routes.filter((r) => r.a !== s.id && r.b !== s.id);
  tally.live[s.civ]--;
  ev(w, { k: 'abandon', a: s.civ, s: s.id });
  const c = w.civs[s.civ];
  if (c.capital === s.id) moveCapital(w, c);
}

/** A new civ rising from part of an old one (revolt or civil war). It keeps the old tongue. */
export function spawnCiv(w: World, old: Civ, capital: Sett, r: Rand): Civ {
  const keep = r.shuffle(old.values).slice(0, 2);
  const pool = (['curious', 'devout', 'martial', 'mercantile', 'seafaring', 'stubborn', 'artistic', 'expansionist', 'isolationist', 'egalitarian', 'ancestral', 'pragmatic'] as ValueId[]).filter((v) => !keep.includes(v));
  const c = foundCiv(w, { tile: capital.tile, values: [...keep, r.pick(pool)], founder: null, parent: old.id, phon: old.phon });
  c.techs = old.techs.slice();
  c.access = old.access;
  c.capital = capital.id;
  c.contacts = [old.id];
  if (!old.contacts.includes(c.id)) old.contacts.push(c.id);
  for (const k of old.contacts) {
    if (k !== c.id && w.civs[k].died < 0 && !c.contacts.includes(k)) {
      c.contacts.push(k);
      w.civs[k].contacts.push(c.id);
    }
  }
  if (tally.live.length <= c.id) recount(w);
  transferSett(w, capital, c.id);
  return c;
}

// ---- Founding by players ----

/** Can a new people be founded here right now? */
export function canFoundAt(w: World, tile: number): boolean {
  if (tile < 0 || tile >= w.W * w.H) return false;
  if (scoreSite(w, null, tile) < 6) return false;
  let ok = true;
  forWithin(w.W, w.H, tile, 2, (i) => {
    if (w.t.owner[i] !== -1) ok = false;
  });
  forWithin(w.W, w.H, tile, 4, (i) => {
    if (w.t.city[i] !== -1) ok = false;
  });
  return ok;
}

/** The homelands offered to a new founder: open reserves first, then any other good free land. */
export function foundingSpots(w: World, n: number): number[] {
  const out = w.reserves.filter((t) => canFoundAt(w, t));
  if (out.length < n) {
    for (const t of suggestSpots(w, n * 2, 6)) {
      if (out.length >= n) break;
      if (canFoundAt(w, t) && out.every((o) => hexDist(w.W, o, t) >= 6)) out.push(t);
    }
  }
  return out.slice(0, n);
}

/** Yearly: drop reserves that have been taken and hold new ones open while free land remains. */
export function tendReserves(w: World): void {
  w.reserves = w.reserves.filter((t) => canFoundAt(w, t));
  if (w.reserves.length >= RESERVE_TARGET) return;
  for (const t of suggestSpots(w, RESERVE_TARGET * 2, 8)) {
    if (w.reserves.length >= RESERVE_TARGET) break;
    if (w.reserves.every((o) => hexDist(w.W, o, t) >= 8)) w.reserves.push(t);
  }
}
