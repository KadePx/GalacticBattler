// Public face of the colony sim: make a colony, advance it, save and load it, fingerprint it.

import { MAP_H, MAP_W, SIM_V, TICKS_PER_DAY, TICKS_PER_HOUR, TICKS_PER_YEAR } from '../config';
import { RACES, PLAYABLE, childRace } from './data/races';
import { emptyStock, mouths } from './econ';
import { BIOMES, genMap } from './mapgen';
import { colonyName } from './names';
import { initGov } from './gov';
import { makePawn, mkAct, normPawn } from './pawn';
import { assignBeds, assignProfs, build } from './planner';
import { Rand, S, hashStr } from './rng';
import { importPawns, type SettlerMsg } from './settle';
import { step } from './step';
import { RES, type Colony, type Pawn, type RaceK } from './types';

export { step } from './step';
export * from './types';

export interface CreateOpts {
  seed: number; pop?: number; biome?: string; race?: RaceK; name?: string; id?: string;
  /** found the colony from a settler party instead of making its people */
  settlers?: SettlerMsg;
  /** names already taken by other colonies */
  avoid?: string[];
  /** the abandoned colony these settlers are building over */
  ruinsOf?: string;
}

const RACE_ODDS: [RaceK, number][] = [['human', 40], ['dwarf', 15], ['elf', 10], ['halfling', 15], ['orc', 12], ['goblin', 8]];

function blank(seed: number): Colony {
  const n = MAP_W * MAP_H;
  return {
    v: SIM_V, seed, id: 'c' + seed.toString(36), name: '', biome: 'valley', tick: 6 * TICKS_PER_HOUR, w: MAP_W, h: MAP_H,
    ter: new Uint8Array(n), feat: new Uint8Array(n), fg: new Uint8Array(n), st: new Uint8Array(n), crop: new Uint8Array(n), wear: new Uint8Array(n), sb: new Uint16Array(n),
    cx: 0, cy: 0, gx: 0, gy: 0, beasts: [], pawns: [], dead: [], nextId: 1, blds: [], nextBld: 1, stock: emptyStock(), log: [], logBase: 0, facts: [], nextFact: 1,
    weather: 0, temp: 9, game: 100, stats: {}, inq: [], foes: [], nextFoe: 1, alarm: 0, story: { last: 0, lastBad: 0, heat: 0, band: 0 }, mods: [], nosite: {},
    gov: { k: 'elder', ruler: 0, since: 0, laws: { harsh: 1, tax: 0, ration: 0 }, titles: {}, next: 0, regent: 0 }, trials: [], settle: 0, out: [],
  };
}

/** A settled colony with homes, fields, stores and a few families already living in it. */
export function createColony(o: CreateOpts): Colony {
  const seed = o.seed >>> 0;
  const r = new Rand(seed, S.GEN, 9);
  const c = blank(seed);
  if (o.id) c.id = o.id;
  c.name = o.name ?? colonyName(r);
  for (let k = 0; k < 8 && o.avoid?.includes(c.name); k++) c.name = colonyName(r);
  c.biome = o.biome ?? r.pick(BIOMES);
  genMap(c);
  if (o.ruinsOf) {
    // what is left of the last people who tried to live here
    c.ruins = o.ruinsOf;
    for (let k = 0; k < 26; k++) {
      const x = c.cx + r.range(-11, 11);
      const y = c.cy + r.range(-11, 11);
      const i = y * c.w + x;
      if (Math.abs(x - c.cx) + Math.abs(y - c.cy) > 5 && c.ter[i] <= 2 && !c.feat[i]) c.feat[i] = 7;
    }
  }
  if (o.settlers) return foundColony(c, o.settlers, r);
  const pop = o.pop ?? 16;

  let main = o.race;
  if (!main) {
    let roll = r.int(100);
    main = 'human';
    for (const [k, w] of RACE_ODDS) { roll -= w; if (roll < 0) { main = k; break; } }
  }
  const mainRace: RaceK = main;
  const pickRace = (): RaceK => (r.chance(0.62) ? mainRace : r.pick(PLAYABLE));
  const frac = (p: Pawn): number => {
    const R = RACES[p.race];
    return ((c.tick - p.born) / TICKS_PER_YEAR - R.adult) / (R.old - R.adult);
  };
  const households: Pawn[][] = [];
  while (c.pawns.length < pop) {
    const left = pop - c.pawns.length;
    if (left >= 2 && r.chance(0.5)) {
      const race = pickRace();
      const a = makePawn(c, r, { race, sex: 1 });
      const raceB = r.chance(0.85) ? race : pickRace();
      const RB = RACES[raceB];
      const f = Math.max(0, Math.min(0.9, frac(a) + (r.float() - 0.5) * 0.2));
      const b = makePawn(c, r, { race: raceB, sex: 0, fam: a.fam, age: RB.adult + f * (RB.old - RB.adult) });
      if (a.orient === 2) a.orient = 1;
      if (b.orient === 2) b.orient = 1;
      a.sp = b.id;
      b.sp = a.id;
      a.rel[b.id] = { m: [], k: 'spouse', s: c.tick - TICKS_PER_YEAR };
      b.rel[a.id] = { m: [], k: 'spouse', s: c.tick - TICKS_PER_YEAR };
      const house = [a, b];
      c.pawns.push(a, b);
      const kidRace = childRace(b.race, a.race);
      if (kidRace && left >= 3 && r.chance(0.6)) {
        const n = 1 + r.int(Math.min(2, left - 2));
        const maxAge = Math.min(RACES[kidRace].adult * 0.95, (c.tick - b.born) / TICKS_PER_YEAR - RB.adult);
        for (let k = 0; k < n && maxAge > 0.5; k++) {
          const kid = makePawn(c, r, { race: kidRace, fam: a.fam, mo: b.id, fa: a.id, age: 0.3 + r.float() * (maxAge - 0.3) });
          kid.faith = b.faith;
          house.push(kid);
          c.pawns.push(kid);
        }
      }
      households.push(house);
    } else {
      const p = makePawn(c, r, { race: pickRace() });
      c.pawns.push(p);
      households.push([p]);
    }
  }

  build(c, 'hall', true);
  build(c, 'store', true);
  let singles = 0;
  for (const h of households) {
    if (h.length >= 3) build(c, 'bighouse', true);
    else if (h.length === 2) build(c, 'house', true);
    else singles++;
  }
  for (let k = 0; k < Math.ceil(singles / 2); k++) build(c, 'house', true);
  build(c, 'well', true);
  const fields = Math.ceil(mouths(c) * 0.4);
  const first = ['wheat', 'potato', 'grain', 'beans', 'oats', 'onion', 'cabbage', 'turnip'];
  for (let k = 0; k < fields; k++) build(c, 'field', true, first[k % first.length]);

  // households move in together, then everyone else finds a bed
  for (const h of households) {
    const home = c.blds.find((b) => b.beds.length >= h.length && b.beds.every((x) => !x));
    if (!home) continue;
    h.forEach((p, i) => { home.beds[i] = p.id; p.home = home.id; });
  }
  assignBeds(c, true);
  assignProfs(c, true);
  initGov(c, r);
  for (const p of c.pawns) {
    p.x = c.cx + r.range(-2, 2);
    p.y = c.cy + r.range(-1, 2);
    p.act = mkAct('idle', c.tick, p.x, p.y, 1 + r.int(6), 'new');
  }

  const s = c.stock;
  s.grain = pop * 16; s.veg = pop * 9; s.meal = pop * 3; s.meat = pop * 2; s.wood = 60 + pop * 4; s.stone = 24;
  s.tools = Math.ceil(pop * 0.5); s.clothes = 2; s.ale = Math.round(pop * 1.5); s.leather = 4; s.herbs = 3; s.medicine = 2; s.weapons = Math.ceil(pop * 0.35);
  return c;
}

/** A colony begun by settlers: bare land, a hall raised in the first days, and whatever they carried. */
function foundColony(c: Colony, msg: SettlerMsg, r: Rand): Colony {
  c.tick = msg.t;
  c.from = msg.from;
  build(c, 'hall', true);
  build(c, 'store', true);
  const leader = importPawns(c, msg, r);
  build(c, 'field', true, 'potato');
  build(c, 'field', true, 'grain');
  for (const k of Object.keys(msg.stock) as (keyof typeof msg.stock)[]) c.stock[k] += msg.stock[k] ?? 0;
  // enough to see them through the first weeks
  c.stock.meal += c.pawns.length * 4;
  c.stock.wood += 40;
  assignProfs(c, true);
  initGov(c, r);
  const lead = c.pawns.find((p) => p.id === leader);
  if (lead) {
    const old = c.pawns.find((p) => p.id === c.gov.ruler);
    if (old && old !== lead) old.rank = 2;
    c.gov.ruler = lead.id;
    c.gov.since = c.tick;
    if (c.gov.k === 'lord') c.gov.k = 'elder';
    lead.rank = 6;
    lead.bio.push({ t: c.tick, k: 'ruler', s: 'founded' });
  }
  c.log.push({ t: c.tick, k: 'founded', a: leader, s: msg.fromName, n: c.pawns.length });
  return c;
}

export function runDays(c: Colony, days: number): void {
  const end = c.tick + days * TICKS_PER_DAY;
  while (c.tick < end) step(c);
}

const LAYERS = ['ter', 'feat', 'fg', 'st', 'crop', 'wear'] as const;

function enc(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(s);
}
function dec(s: string): Uint8Array {
  const b = atob(s);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}

export function serialize(c: Colony): string {
  // fields in a fixed order: a field cleared and later set again must not move, or two copies
  // of the same colony would serialise (and fingerprint) differently
  const raw: Record<string, unknown> = {};
  for (const k of Object.keys(c).sort()) raw[k] = (c as unknown as Record<string, unknown>)[k];
  for (const k of LAYERS) raw[k] = enc(c[k]);
  raw.sb = enc(new Uint8Array(c.sb.buffer, c.sb.byteOffset, c.sb.byteLength));
  return JSON.stringify(raw);
}

export function deserialize(json: string): Colony {
  const raw = JSON.parse(json) as Record<string, unknown>;
  for (const k of LAYERS) raw[k] = dec(raw[k] as string);
  const sb = dec(raw.sb as string);
  raw.sb = new Uint16Array(sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength));
  const c = raw as unknown as Colony;
  c.pawns = c.pawns.map(normPawn);
  upgrade(c);
  return c;
}

/** Fingerprint of everything in the colony. Two copies that took the same steps always match. */
export function colonyHash(c: Colony): string {
  // the outbox is the keeper's business (it empties it as it delivers), not part of the colony's state
  return hashStr(serialize(c.out.length ? { ...c, out: [] } : c)).toString(16).padStart(8, '0');
}

/** Bring a colony saved by an older version up to date: new stores start empty, new state starts blank. */
function upgrade(c: Colony): void {
  for (const k of RES) if (typeof c.stock[k] !== 'number') c.stock[k] = 0;
  c.beasts ??= [];
}
