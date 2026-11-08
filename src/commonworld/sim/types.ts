// World state. Everything here is plain data so it can be saved, hashed and sent to a browser.
// Rule for all of src/commonworld/sim: no Math.random, Date, DOM, or Math.sin/exp/pow
// (those can differ between JS engines); only + - * / sqrt floor on numbers.

export const SIM_V = 5;
export const TICKS_PER_YEAR = 12; // one tick = one game month

export const VALUES = [
  'curious', 'devout', 'martial', 'mercantile', 'seafaring', 'stubborn',
  'artistic', 'expansionist', 'isolationist', 'egalitarian', 'ancestral', 'pragmatic',
] as const;
export type ValueId = (typeof VALUES)[number];

export const GOALS = ['grow', 'expand', 'fortify', 'worship', 'build', 'trade'] as const;
export type Goal = (typeof GOALS)[number];

export const BUILDINGS = ['fields', 'granary', 'walls', 'temple', 'market', 'workshop', 'monument'] as const;
export type BKey = (typeof BUILDINGS)[number];

export const TIER_NAMES = ['hamlet', 'village', 'town', 'city', 'metropolis'];

export interface Tiles {
  h: Int16Array; // height, 0 = sea level
  temp: Int8Array; // average °C
  moist: Uint8Array; // 0..100
  biome: Uint8Array;
  river: Uint16Array; // river id, 0 = none
  flow: Uint16Array; // how many river branches pass through
  down: Int32Array; // the tile this river flows into, -1 = none
  res: Uint8Array; // resource
  owner: Int16Array; // civ id, -1 = unclaimed
  work: Int32Array; // settlement working this tile, -1 = none
  city: Int32Array; // settlement centred on this tile, -1 = none
}

export interface River {
  id: number;
  src: number;
  mouth: number;
  len: number;
  name: string | null;
  namedBy: number; // civ id, -1
}

export interface Ruler {
  name: string;
  born: number; // tick
  dies: number; // tick
  since: number; // tick
  founded: number; // settlements founded during the reign
  famines: number;
  built: number;
  won: number; // battles won during the reign
  trait: RulerTrait;
  house: string; // dynasty
}

export const RULER_TRAITS = ['bold', 'cautious', 'pious', 'greedy', 'wise', 'cruel', 'builder', 'just'] as const;
export type RulerTrait = (typeof RULER_TRAITS)[number];

export const GREAT_KINDS = ['general', 'scholar', 'builder', 'merchant', 'prophet'] as const;
export type GreatKind = (typeof GREAT_KINDS)[number];

export interface Great {
  name: string;
  kind: GreatKind;
  born: number; // tick they came to prominence
  dies: number; // tick
  deeds: number;
}

export interface Civ {
  id: number;
  name: string; // "Ashkari"
  phon: number; // sound of the language (shared with daughter civs)
  lex: number; // the words themselves
  hue: number; // 0..359
  values: ValueId[];
  born: number;
  died: number; // -1 while alive
  capital: number; // settlement id
  founder: string | null; // hash of the founding player's id, null for AI civs
  byName: string; // the founder's chosen display name ('' if none)
  banner: number[] | null; // [hue, second, metal, division, charge] chosen at founding
  protectedUntil: number; // tick; a young player civ can't be attacked before this
  parent: number; // civ it broke away from, -1
  motto: string;
  goal: Goal;
  ruler: Ruler;
  rulers: number; // count so far
  lore: number; // research points toward the current tech
  techs: number[]; // tech ids, in order learned
  research: number; // tech being studied, -1
  access: number; // bitmask of resources reachable (own land or trade), refreshed yearly
  wealth: number;
  army: number; // soldiers under arms
  weary: number; // war weariness, 0..100
  houses: number; // dynasties so far (for name keys)
  greats: Great[];
  greatN: number; // great people so far (for name keys)
  contacts: number[];
  peakPop: number;
  peakSetts: number;
  named: number; // settlements named so far (for name keys)
}

export interface Sett {
  id: number;
  civ: number;
  name: string;
  tile: number;
  born: number;
  died: number; // -1 while alive
  pop: number;
  food: number;
  mat: number;
  tier: number;
  maxTier: number;
  stab: number; // 0..100
  cap: number; // people the land can feed in an average month (cached yearly)
  matBase: number; // materials the land gives (cached yearly)
  b: Record<BKey, number>;
  starve: number; // deaths from hunger this year
  lastFamine: number; // tick, -1
  plague: number; // months of sickness left
  plagueId: number;
  immune: number; // tick until which plague can't return
  silt: number; // tick until which flood silt boosts food
  monument: string | null;
  parent: number; // settlement that sent its founders, -1
  noSites: number; // tick; skip settler searches until then
  siege: number; // progress of an enemy siege
  siegeBy: number; // civ besieging, -1
  conq: number; // tick of the last conquest, -1
}

export type RelState = 'peace' | 'pact' | 'ally' | 'war';
export interface Rel {
  a: number; // lower civ id
  b: number;
  op: number; // -100..100
  st: RelState;
  since: number; // tick the state began
  truce: number; // no war before this tick
  grudge: number; // memory of wrongs, decays
}

export interface War {
  id: number;
  name: string;
  atk: number; // the civ that declared
  def: number;
  atkAllies: number[];
  defAllies: number[];
  cause: 'land' | 'grudge' | 'succession' | 'plunder';
  start: number;
  end: number; // -1 while ongoing
  score: number; // positive favours the attacker
  battles: number;
  deaths: number;
  taken: number[]; // settlements captured by the attacker side
  lost: number[]; // settlements the defender took back or captured
  result: '' | 'victory' | 'defeat' | 'stalemate' | 'conquered';
}

export interface Route {
  a: number; // settlement
  b: number; // settlement
  start: number;
  sea: boolean;
}

export interface Spell {
  k: 'drought' | 'bounty' | 'winter';
  tile: number;
  r: number;
  start: number;
  end: number;
  mult: number; // per mille food multiplier
}

export interface Plague {
  id: number;
  name: string;
  start: number;
  end: number; // -1 while spreading
  deaths: number;
  origin: number; // settlement id
  civs: number[];
}

/** One line of history. Text is written from these at read time (see chronicle.ts). */
export interface Ev {
  t: number;
  k: string;
  a?: number; // civ
  b?: number; // other civ
  s?: number; // settlement
  n?: number; // a number (people, years, ...)
  x?: string; // a name
  y?: string; // a second name
  z?: string; // a third name
}

export interface World {
  v: number;
  seed: number;
  tick: number;
  W: number;
  H: number;
  t: Tiles;
  rivers: River[];
  civs: Civ[];
  setts: Sett[];
  spells: Spell[];
  plagues: Plague[];
  rels: Rel[];
  wars: War[];
  routes: Route[];
  age: number; // world age, 0 = Dawn
  log: Ev[];
  logBase: number; // global id of log[0]; the server moves old events out to storage
  reserves: number[]; // frontier tiles held open for players to found on; AI settlers keep clear
}

/** Intents from players, applied at the start of the next tick. */
export interface FoundInput {
  k: 'found';
  founder: string; // hash of the player's id (the raw id never enters the world)
  tile: number;
  values: ValueId[];
  name?: string; // people name
  capital?: string; // capital name
  motto?: string;
  byName?: string;
  banner?: number[];
  phon?: number; // language chosen from suggestions
  lex?: number;
}
export type Input = FoundInput;
