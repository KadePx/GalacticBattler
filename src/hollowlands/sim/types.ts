// The whole state of one colony. Everything here is plain data (plus a few typed arrays for
// the map) so it can be saved, sent to browsers and replayed tick for tick.

export type Id = number;

export type RaceK = 'human' | 'dwarf' | 'elf' | 'halfling' | 'orc' | 'goblin' | 'halfelf' | 'halforc';

export const SKILLS = ['melee', 'archery', 'build', 'mine', 'farm', 'cook', 'craft', 'smith', 'medic', 'animal', 'social', 'lore'] as const;
export type SkillK = (typeof SKILLS)[number];
export const SK: Record<SkillK, number> = { melee: 0, archery: 1, build: 2, mine: 3, farm: 4, cook: 5, craft: 6, smith: 7, medic: 8, animal: 9, social: 10, lore: 11 };
export const SKILL_NAMES = ['Melee', 'Archery', 'Building', 'Mining', 'Farming', 'Cooking', 'Crafting', 'Smithing', 'Medicine', 'Animals', 'Social', 'Lore'] as const;

/** Personality axes. Each colonist has a hidden baseline (-1..1) per axis; traits shift it. */
export const AX = { KIND: 0, TEMPER: 1, HUMOR: 2, GOSSIP: 3, HONEST: 4, FLIRT: 5, BRAVE: 6, AMBITION: 7, PIETY: 8, GREED: 9, SOCIABLE: 10, DILIGENT: 11, CURIOUS: 12, LOYAL: 13 } as const;
export const AX_N = 14;

// Terrain
export const T = { GRASS: 0, DIRT: 1, SOIL: 2, SAND: 3, MARSH: 4, SHALLOW: 5, DEEP: 6, ROCK: 7, STONE: 8, PATH: 9 } as const;
// Natural features (one per tile)
export const F = { NONE: 0, TREE: 1, PINE: 2, BUSH: 3, BOULDER: 4, ORE: 5, HERB: 6, RUIN: 7, SAPLING: 8, STUMP: 9, FLOWERS: 10, REEDS: 11 } as const;
// Built things (one per tile)
export const B = {
  NONE: 0, WALL_WOOD: 1, WALL_STONE: 2, DOOR: 3, FLOOR_WOOD: 4, FLOOR_STONE: 5, FENCE: 6, TILLED: 7,
  BED: 16, TABLE: 17, CHAIR: 18, HEARTH: 19, STOVE: 20, BENCH: 21, ANVIL: 22, CRATE: 23, BARREL: 24, ALTAR: 25, PEW: 26, LOOM: 27, WELL: 28, GRAVE: 29, FORGE: 30, SHELF: 31, COT: 32, STATUE: 33, TORCH: 34,
} as const;

export const RES = ['grain', 'veg', 'meat', 'fish', 'berries', 'meal', 'feast', 'ale', 'wood', 'stone', 'ore', 'iron', 'leather', 'cloth', 'herbs', 'medicine', 'tools', 'clothes', 'weapons', 'silver', 'goods'] as const;
export type ResK = (typeof RES)[number];
export const RAW_FOOD: readonly ResK[] = ['grain', 'veg', 'meat', 'fish', 'berries'];

export type WorkK = 'farm' | 'forage' | 'hunt' | 'fish' | 'wood' | 'mine' | 'cook' | 'build' | 'craft' | 'smith' | 'brew' | 'heal' | 'teach' | 'preach' | 'guard' | 'herbs';

export type ActK =
  | 'fight' | 'flee' | 'hide' | 'tend' | 'train' | 'stalk'
  | 'idle' | 'wander' | 'sleep' | 'eat' | 'work' | 'drink' | 'relax' | 'walk' | 'pray' | 'dice' | 'hobby' | 'play' | 'visit' | 'sulk' | 'binge' | 'tantrum' | 'rave'
  | 'court' | 'wed' | 'attend' | 'mourn' | 'labour' | 'rest' | 'perform' | 'listen' | 'stargaze' | 'bathe';

export interface Act {
  k: ActK;
  /** started, arrives (end of the walk), ends */
  t0: number; ta: number; t1: number;
  /** where the walk started and where the action happens */
  sx: number; sy: number; tx: number; ty: number;
  /** tiles walked, start to end (omitted when not moving) */
  path?: number[];
  w?: WorkK;
  /** building id */
  b?: number;
  /** another colonist involved */
  o?: Id;
  /** small extra number (a work variant, a count) */
  d?: number;
  /** why they chose this: a reason code the UI turns into words */
  why: string;
}

export interface Look {
  skin: number; hair: number; hairCol: number; body: number; face: number; eyes: number; beard: number;
  /** scars, tattoos and other marks (codes) */
  marks: number[];
  /** outfit colour index */
  garb: number;
}

/** A memory that weighs on (or lifts) mood for a while. */
export interface Th { k: string; x: number; o?: Id; n?: number }

/** What one colonist holds about another. */
export interface Rel {
  /** opinion memories: [thought key, expiry tick, stacks] */
  m: [string, number, number][];
  /** romantic or sworn tie, if any */
  k?: 'lover' | 'spouse' | 'ex' | 'betrothed';
  /** friend (1) or rival (-1) once opinion crossed the line both ways */
  f?: 1 | -1;
  /** tick they last talked */
  last?: number;
  /** tick the romantic tie began */
  s?: number;
}

export interface Bio { t: number; k: string; o?: Id; s?: string }

/** A wound. Severity falls as it heals; an untended one may bleed or fester. */
export interface Inj { p: string; k: string; sev: number; pk: number; bleed: number; inf: number; tend: number; t: number }

/** A sickness running its course: it gets worse while the body builds resistance. */
export interface Ill { k: string; sev: number; imm: number; t: number; tend: number }

/** Someone or something hostile on the map. */
export interface Foe {
  id: number;
  k: string;
  name: string;
  x: number; y: number;
  /** where they were a tick ago, so the view can glide them */
  px: number; py: number;
  hp: number; max: number;
  /** colonist they are after, 0 for none */
  target: Id;
  /** 0 attacking, 1 looting, 2 leaving */
  mode: number;
  /** what they carry off */
  loot: number;
  /** a colonist they have seized */
  held: Id;
  band: number;
  /** tick until which they hang back at the edge of the map */
  wait: number;
}

export interface Pawn {
  id: Id;
  first: string; fam: string; epi?: string;
  race: RaceK;
  /** 0 female, 1 male */
  sex: 0 | 1;
  /** birth tick (negative for those born before the colony's records) */
  born: number;
  look: Look;
  traits: string[];
  /** childhood and adult backstory keys ('' while still a child) */
  bc: string; ba: string;
  /** skill levels (fractional) and passions (0 none, 1 interested, 2 burning) */
  sk: number[]; pas: number[];
  per: number[];
  /** 0 attracted to the other sex, 1 both, 2 the same sex */
  orient: 0 | 1 | 2;
  x: number; y: number;
  act: Act;
  food: number; rest: number; joy: number; soc: number;
  mood: number;
  th: Th[];
  /** situational thoughts, rebuilt every hour: [key, value, other colonist] */
  sit: [string, number, number?][];
  rel: Record<number, Rel>;
  mo: Id; fa: Id;
  /** partner (lover, betrothed or spouse), 0 for none */
  sp: Id;
  /** someone they have set their heart on, 0 for none */
  crush: Id;
  /** building id where their bed is, 0 for none */
  home: number;
  prof: string;
  /** standing in the colony: 0 thrall, 1 outcast, 2 commoner, 3 freeholder, 4 notable, 5 noble, 6 ruler */
  rank: number;
  faith: string;
  /** devotion 0..3 */
  dev: number;
  goal: string;
  hp: number;
  /** mental break in progress */
  brk?: { k: string; x: number };
  /** hours in a row spent under a break threshold */
  low: number;
  /** hours in a row in high spirits */
  high: number;
  drunk: number;
  cloth: number;
  /** tick of the last break, to space them out */
  lastBrk: number;
  preg?: { x: number; fa: Id };
  /** facts this colonist knows (ids) */
  know: number[];
  bio: Bio[];
  /** the player who made them, if any (a public hash) */
  owner?: string;
  /** coin and belongings, in silver */
  coin: number;
  /** temporary boost: [kind, expiry tick] */
  insp?: [string, number];
  /** their latest exchange, for speech bubbles: [kind, other colonist, tick, went well] */
  say?: [string, Id, number, number];
  inj: Inj[];
  /** lasting marks on the body: lost limbs, scars, the aches of age */
  perm: string[];
  ill?: Ill;
  /** how much they have been drinking lately */
  booze: number;
  /** set when they die this tick; swept at the end of the tick */
  gone?: boolean;
}

/** What is kept of someone who died or left. */
export interface Dead {
  id: Id; first: string; fam: string; epi?: string; race: RaceK; sex: 0 | 1; born: number; died: number;
  cause: string; by?: Id; look: Look; traits: string[]; bc: string; ba: string; prof: string; mo: Id; fa: Id; sp: Id; bio: Bio[];
  /** grave tile index, -1 for none */
  grave: number;
  /** true if they left alive (ran off, joined settlers) */
  left?: boolean;
  owner?: string;
  faith: string;
  /** funeral held or planned */
  fun?: 1;
  /** remembered as a saint */
  saint?: 1;
  rank?: number;
}

export interface Bld {
  id: number;
  /** template key */
  k: string;
  x: number; y: number; w: number; h: number;
  /** 0..1 built */
  prog: number;
  built: boolean;
  /** quality 0..100 */
  q: number;
  /** 0 wood, 1 stone */
  mat: number;
  /** bed owners, matched to the template's beds in order (0 = free) */
  beds: Id[];
  /** fields: crop key and care level 0..100 */
  crop?: string;
  tend?: number;
  /** materials still to deliver */
  need: { wood: number; stone: number };
  made: number;
  name?: string;
  /** damage 0..100 */
  dmg: number;
}

export interface Ev { t: number; k: string; a?: Id; b?: Id; s?: string; n?: number }

/** Something that happened (or is said to have) that people can know and pass on. */
export interface Fact { id: number; k: string; a: Id; b?: Id; t: number; real: boolean; s?: string }

export interface Input { t: number; k: string; [key: string]: unknown }

export interface Colony {
  v: number;
  seed: number;
  id: string;
  name: string;
  biome: string;
  tick: number;
  w: number; h: number;
  ter: Uint8Array; feat: Uint8Array; fg: Uint8Array; st: Uint8Array; crop: Uint8Array; wear: Uint8Array;
  /** building id per tile (0 = none) */
  sb: Uint16Array;
  cx: number; cy: number;
  /** where the road leaves the map */
  gx: number; gy: number;
  pawns: Pawn[];
  dead: Dead[];
  nextId: number;
  blds: Bld[];
  nextBld: number;
  stock: Record<ResK, number>;
  log: Ev[];
  /** events dropped from the front of the log so far */
  logBase: number;
  facts: Fact[];
  nextFact: number;
  /** 0 clear, 1 cloud, 2 rain, 3 storm, 4 snow, 5 fog */
  weather: number;
  /** outdoor temperature in degrees */
  temp: number;
  /** wild game left nearby 0..100 */
  game: number;
  /** running counters for the report and the UI */
  stats: Record<string, number>;
  /** inputs waiting for their tick */
  inq: Input[];
  foes: Foe[];
  nextFoe: number;
  /** tick the alarm was raised, 0 when all is quiet */
  alarm: number;
  /** the storyteller's bookkeeping */
  story: { last: number; lastBad: number; heat: number; band: number };
  /** who rules and how: kind of rule, ruler, laws in force, titles held, next election, regent for a child ruler */
  gov: { k: string; ruler: Id; since: number; laws: Record<string, number>; titles: Record<string, Id>; next: number; regent: Id };
  /** accusations waiting for a trial */
  trials: { a: Id; k: string; f: number; by: Id }[];
  /** building kinds the planner found no room for, and when it last looked */
  nosite: Record<string, number>;
  /** passing conditions: [kind, until tick] */
  mods: [string, number][];
  /** planned gathering (wedding, funeral, feast) */
  gath?: { k: string; t0: number; t1: number; b: number; a?: Id; o?: Id; x: number; y: number };
}

export const idx = (c: { w: number }, x: number, y: number): number => y * c.w + x;
