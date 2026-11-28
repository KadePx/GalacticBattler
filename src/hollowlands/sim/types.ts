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
export const F = { NONE: 0, TREE: 1, PINE: 2, BUSH: 3, BOULDER: 4, ORE: 5, HERB: 6, RUIN: 7, SAPLING: 8, STUMP: 9, FLOWERS: 10, REEDS: 11, LOG: 12, MUSHROOM: 13 } as const;
// Built things (one per tile)
export const B = {
  NONE: 0, WALL_WOOD: 1, WALL_STONE: 2, DOOR: 3, FLOOR_WOOD: 4, FLOOR_STONE: 5, FENCE: 6, TILLED: 7,
  BED: 16, TABLE: 17, CHAIR: 18, HEARTH: 19, STOVE: 20, BENCH: 21, ANVIL: 22, CRATE: 23, BARREL: 24, ALTAR: 25, PEW: 26, LOOM: 27, WELL: 28, GRAVE: 29, FORGE: 30, SHELF: 31, COT: 32, STATUE: 33, TORCH: 34,
  RUG: 35, WARDROBE: 36, LAMP: 37, BOOKS: 38, DESK: 39, RACK: 40, CAULDRON: 41, VAT: 42, BIN: 43, BATH: 44, CHESS: 45, DARTS: 46, MUSIC: 47, DRYRACK: 48, BRAZIER: 49, TROUGH: 50,
  // homes of the poor and the rich
  FLOOR_BARE: 51, FLOOR_FINE: 52, STRAW: 53, GARDEN: 54, LOWWALL: 55, PAVING: 56,
  // street furniture (placed by the town plan on street corners and squares, belonging to no building)
  LAMPPOST: 60, SEAT: 61, SIGNPOST: 62, FOUNTAIN: 63, WAYSHRINE: 64, PUMP: 65,
  // the castle: its heavy walls and towers, the palisade before them, and the things of a lord's hall
  CWALL: 66, CTOWER: 67, PALISADE: 68, THRONE: 69, BANNER: 70, TAPESTRY: 71, HAY: 72,
  // the town wall: a gate in it (always open to colonists; shut against foes at night and in alarms),
  // and the rubble of a breach
  GATE: 73, RUBBLE: 74,
  // the things of the trades a colony discovers (see tech.ts): a millstone, a windmill's sails, a
  // water wheel, a baker's oven, a potter's kiln, a glass furnace, tanning and dye vats, a steel
  // furnace, a jeweller's bench, a printing press
  MILLSTONE: 75, SAILS: 76, WHEEL: 77, OVEN: 78, KILN: 79, GLASSFURN: 80, TANVAT: 81, DYEVAT: 82, BLOOMERY: 83, JEWELBENCH: 84, PRESS: 85,
  // a relic an expedition brought home, on its stand in the hall (see exped.ts)
  RELIC: 86,
} as const;

/** Street furniture: stands on its own, outside any building. */
export const isStreetThing = (s: number): boolean => s >= B.LAMPPOST && s <= B.PUMP;

export const RES = ['grain', 'veg', 'meat', 'fish', 'berries', 'meal', 'feast', 'ale', 'wood', 'stone', 'ore', 'iron', 'leather', 'cloth', 'herbs', 'medicine', 'tools', 'clothes', 'weapons', 'silver', 'goods', 'hops', 'mushrooms', 'eggs', 'milk', 'flour', 'bread', 'brick', 'glass'] as const;
export type ResK = (typeof RES)[number];
export const RAW_FOOD: readonly ResK[] = ['grain', 'veg', 'meat', 'fish', 'berries', 'mushrooms', 'eggs', 'milk'];

export type WorkK = 'farm' | 'forage' | 'hunt' | 'fish' | 'wood' | 'mine' | 'cook' | 'build' | 'craft' | 'smith' | 'brew' | 'heal' | 'teach' | 'preach' | 'guard' | 'herbs' | 'herd';

export type ActK =
  | 'fight' | 'flee' | 'hide' | 'tend' | 'train' | 'stalk'
  | 'idle' | 'wander' | 'sleep' | 'eat' | 'work' | 'drink' | 'relax' | 'walk' | 'pray' | 'dice' | 'hobby' | 'play' | 'visit' | 'sulk' | 'binge' | 'tantrum' | 'rave'
  | 'court' | 'wed' | 'attend' | 'mourn' | 'labour' | 'rest' | 'perform' | 'listen' | 'stargaze' | 'bathe'
  | 'chess' | 'darts' | 'music' | 'read' | 'study' | 'berserk' | 'subdue'
  | 'shop' | 'sell'
  // going round the street lamps at dusk (see street.ts)
  | 'lamps'
  // lending a hand when the land turns on the colony (see nature.ts: act.d says what), and a duel
  | 'aid' | 'duel'
  // an expedition: mustering at the gate, walking out, walking home (act.why says which);
  // also an envoy, a knight or a bride taking the road to a neighbour (see neigh.ts)
  | 'trek';

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
  /** the tile of town wall they are breaking at, if any */
  wt?: number;
}

/** A war with another colony: since when, and how it is going. */
export interface War { name: string; since: number; sent: number; came: number; lost: number; slain: number; ours: boolean }

/** An animal the colony keeps: livestock in the pen, or a dog with its person. */
export interface Animal { id: number; k: string; x: number; y: number; px: number; py: number; born: number; /** eggs, milk or wool waiting to be collected */ prod: number; /** 0 starving .. 100 well fed */ fed: number; owner?: Id; name?: string }

/** A wild animal wandering the map. */
export interface Beast { id: number; k: string; x: number; y: number; px: number; py: number }

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
  brk?: { k: string; x: number; /** someone they hurt while it lasted, and the fact of it */ o?: Id; f?: number };
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
  /** a lifelong fear, a hidden past, and a keepsake (chosen when a player makes them) */
  phobia?: string;
  secret?: string;
  heirloom?: string;
  /** the player's Resolve: points banked, and the tick the count runs from */
  res?: number;
  resT?: number;
  /** a nudge toward someone: [kind, colonist, until tick, tries left] */
  urge?: [string, Id, number, number];
  /** a nudge toward a kind of work: [skill, until tick] */
  focus?: [number, number];
  /** the colonist this player lived as before */
  prev?: Id;
  /** the player's wish about leaving with settlers: 1 stay, -1 go */
  roots?: number;
  /** apprenticed to: [master, skill, since tick] */
  appr?: [Id, number, number];
  /** when their life's dream came true */
  dreamT?: number;
  /** buildings they finished with their own hands */
  built?: number;
  /** finished an apprenticeship */
  graduated?: boolean;
  /** skills they have mastered (level 12+), in the order earned */
  mastered?: number[];
  /** the trade the player asked for (a profession key) */
  wantProf?: string;
  /** when the player chose to leave (to set out alone if no settlers go soon) */
  leaveT?: number;
  /** held in thrall: owns nothing, chooses nothing */
  thrall?: boolean;
  /** secretly sworn to the Hollow Mother */
  cult?: boolean;
  /** a question waiting for the player: kind, who it concerns, a fact id if any, and the tick it lapses */
  ask?: { k: string; o?: Id; n?: number; x: number };
  /** the tool they carry for their work: [kind, wear left 0..100] */
  tool?: [string, number];
  /** a player's colonist who has stepped forward for the next expedition: until this tick */
  vol?: number;
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
  prev?: Id;
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
  /** progress 0..1 of being rebuilt in stone */
  up?: number;
  /** the floor plan, when it is not the kind's usual one (see SHAPES) */
  s?: string;
  /** a home a family built (or bought) for themselves: the head of that family */
  own?: Id;
  /** a home: the tick it was last found standing empty (unset while lived in) */
  vac?: number;
  /** a home: when its family bought it or moved in, so the move has time to happen */
  got?: number;
  /** a stretch of town wall: the cells (indexes into its plan's cells) broken through, until it is mended */
  br?: number[];
  /** a home with glass in its windows (once the colony can make glass): warmer, and it burns less wood */
  gl?: 1;
}

/**
 * Someone passing through (see visit.ts): a merchant, a minstrel, pilgrims, a refugee family, a
 * wizard, the king's tax collector and his guards, a bounty hunter. Not a colonist: they eat at the
 * tavern, sleep where they can, and are gone in a few days. A party walks together behind its
 * first member (g is that member's id). Every field but path, say and pw is always present.
 */
export interface Visitor {
  id: number; k: string; g: number;
  first: string; fam: string; race: RaceK; sex: 0 | 1; born: number; look: Look;
  /** where they are going (or stand), and the walk there: started, arrives, path */
  x: number; y: number; t0: number; ta: number; path?: number[];
  /** when they next make up their mind */
  t1: number;
  /** arrived, and when they mean to leave */
  arr: number; dep: number;
  /** 0 on the way in, 1 staying, 2 on the way out */
  m: number;
  /** the colonist their business is with (0 none) */
  o: Id;
  /** silver: taken in, asked for or paid */
  n: number;
  /** a count: sales, listeners, leads */
  d: number;
  /** what they have done so far (bits, kind by kind) */
  b: number;
  /** where they come from, their faith, what they hunt: a word or two, kind by kind */
  f: string;
  /** a few words said aloud: [key, tick] */
  say?: [string, number];
  /** a refugee: the colonist they would become */
  pw?: Pawn;
}

/**
 * The land's own events and the colony's dramas (see nature.ts and drama.ts). Lists of tiles are
 * flat number arrays; every optional part is deleted (never set to undefined) when it is over.
 */
export interface Nat {
  /** the day the next one may come, and the day each kind last came */
  nx: number; seen: Record<string, number>;
  /** burning tiles as pairs: tile, ticks of fuel left */
  fire: number[];
  /** a wildfire's tally: where it began, tiles burnt, beaten out, buildings it reached, and when it began */
  wf?: { x: number; y: number; n: number; out: number; hit: number; t0: number };
  /** scorched ground as pairs: tile, the day it burnt (it greens again in time) */
  ash: number[];
  /** heaps of rubble left by a quake (tiles) */
  rub: number[];
  /** cracks in the ground from the last quake, until tick t */
  cr?: { t: number; l: number[] };
  /** the tick of the last quake (the view shakes) */
  qk?: number;
  /** a flood: began, highest at, gone by, the low ground as pairs (tile, depth 1..top), top depth, plots lost, earth heaped */
  fl?: { t0: number; pk: number; t1: number; l: number[]; top: number; lost: number; dk: number };
  /** a night of falling stars or of the northern lights */
  sky?: { k: string; t0: number; t1: number; done: number };
  /** where a star came down: tile, until tick, who went to find it (-1 found) */
  cra?: { i: number; t1: number; a: Id };
  /** a locust swarm: where it is and was a moment ago, where it is headed, began, must leave by, plots eaten, how scared it is, leaving */
  loc?: { x: number; y: number; px: number; py: number; tx: number; ty: number; t0: number; t1: number; n: number; sc: number; go: number; cap: number };
  /** a dragon passing over: from and to (tiles, may lie off the map), when, and what it did ('field', 'beast', 'pass') */
  dr?: { x0: number; y0: number; x1: number; y1: number; t0: number; t1: number; k: string; done: number };
  /** a haunting: the graveyard, the restless dead, until, who keeps vigil, nights kept */
  haunt?: { b: number; d: Id; t1: number; v: Id; n: number };
  /** something cursed out of the mine: who has it, since, until, what it is, mishaps */
  curse?: { a: Id; t0: number; t1: number; s: number; k: number };
  /** a child lost in the woods: who, where, when they went, when the search began, when they find their own way home */
  lost?: { a: Id; x: number; y: number; t0: number; s: number; t1: number; told: number };
  /** lovers running off to marry: who, where to, when they go and come back, the parent against it */
  el?: { a: Id; b: Id; x: number; y: number; t0: number; t1: number; by: Id; told: number };
  /** a feud between two families (their names), until, clashes */
  feud?: { a: string; b: string; t1: number; n: number };
  /** a duel over love: the challenger, the one challenged, for whom, when, and where */
  duel?: { a: Id; b: Id; o: Id; t: number; x: number; y: number };
  /** a match between noble houses waiting for its wedding: the suitor, the one they came for, the house */
  nw?: { a: Id; b: Id; h: string };
}

export interface Ev { t: number; k: string; a?: Id; b?: Id; s?: string; n?: number }

/** Somewhere an expedition can go: its kind (ruin, cave, tomb, wreck, tower), name, danger 1-3, what it is said to hold, and days of road each way. */
export interface XSite { k: string; name: string; d: number; p: string; far: number }

/** A relic on display: which kind, its name, who brought it home and when, where from, what it does, its tile (-1 while it has no place) and the floor under it. */
export interface XRelic { id: number; k: number; name: string; by: Id; t: number; from: string; fx: string; i: number; f: number }

/**
 * A party sent out to explore (see exped.ts). While they are away its people are held here, off
 * the map and out of the colony's list, but still the colony's own: homes, families and trades kept.
 */
export interface XParty {
  id: number; site: XSite; lead: Id;
  /** everyone who set out (the fallen too), and what each went as */
  ids: Id[]; ro: string[];
  /** those off the map */
  pw: Pawn[];
  /** 0 mustering, 1 walking out, 2 away, 3 walking home, 4 missing */
  m: number;
  /** called, leaves, due back, came back in at the gate (0 until then) */
  t0: number; go: number; back: number; t3: number;
  /** where they muster, and where they are welcomed home */
  x: number; y: number; wx: number; wy: number;
  /** days planned at the site, and days out so far */
  stay: number; day: number;
  /** the tale so far, a line a day */
  beats: Ev[];
  silver: number; iron: number; goods: number; lore: number;
  /** a relic found (its kind, -1 none), and its name */
  relic: number; rn: string;
  /** wounds taken, who fell, a captive freed, whether word that they are overdue has gone round */
  hurt: number; fallen: Id[]; cap: number; od: number;
  /** a map to somewhere further */
  map?: XSite;
}

/** An expedition that is over: who went, where, when, how it ended, and its tale. */
export interface XDone { id: number; site: XSite; lead: Id; ids: Id[]; t0: number; t1: number; out: string; beats: Ev[] }

/** How we stand with one neighbour (see neigh.ts). Days are game days; every part but the name comes and goes. */
export interface NbTie {
  name: string;
  /** a trade agreement, an alliance, a marriage between the houses: the day each was made */
  trade?: number; ally?: number; kin?: number;
  /** tribute: 1 we pay them, 2 they pay us; and since which day */
  trib?: number; tribT?: number;
  /** which of these the chronicle has told of (bits: 1 trade, 2 alliance, 4 tribute) */
  said?: number;
  /** caravans that have come in from them, tribute carts sent or received, and the day of the last dealing */
  cv?: number; tb?: number; last?: number;
}

/** One of ours who has taken the road to a neighbour and will be back: an envoy, a knight at a tournament, fighters sent to an ally. */
export interface NbAway {
  pw: Pawn;
  /** why they went ('trade', 'ally', 'tribute', 'tourney', 'relief'; 'wed' for one sent to marry, held until word comes that they arrived), where (the colony's name), when they left and when they are due home */
  k: string; to: string; t0: number; t: number;
  /** what came of it, once word has come back: rounds won, hurt, champion, the purse */
  wins?: number; hurt?: number; won?: number; prize?: number; word?: string;
}

/** A tournament held here (see neigh.ts): the day, its hours, the ground, who rides, and how the bouts have gone. */
export interface NbTourney {
  day: number; t0: number; t1: number;
  /** the middle of the lists, and which way they run (1 along x, 0 along y) */
  x: number; y: number; h: number;
  /** the colonies bidden */
  guests: { id: string; name: string }[];
  /** the riders: one of ours (id > 0, a colonist) or a guest (v > 0, a visitor), their name and town, their skill, wins, whether they are out, hurt */
  kn: { id: Id; v: number; name: string; from: string; fromId: string; home: Id; sk: number; w: number; out: number; hurt: number }[];
  /** bouts fought: [winner index, loser index, tick] */
  b: number[][];
  /** 0 called, 1 riding, 2 over */
  st: number;
  /** the purse the champion took */
  pz?: number;
}

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
  /** the rise beside the town where a keep can stand (made with the land) */
  keep?: { x: number; y: number };
  /** hills and rises of the land: [x, y, radius, height], for shading the ground */
  rises?: number[][];
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
  story: { last: number; lastBad: number; heat: number; band: number; raid?: number };
  /** neighbouring colonies, nearest first (told to us by the region) */
  near?: { id: string; name: string }[];
  /** raiders from another colony are on the map: who sent them, and the counts when they came */
  raidFrom?: { id: string; name: string; loot0: number; slain0: number; died0?: number };
  /** bad blood with other colonies (id -> grudge), and the wars it has come to */
  grudge?: Record<string, number>;
  wars?: Record<string, War>;
  /** the abandoned colony this one was built over */
  ruins?: string;
  /** who rules and how: kind of rule, ruler, laws in force, titles held, next election, regent for a child ruler */
  gov: { k: string; ruler: Id; since: number; laws: Record<string, number>; titles: Record<string, Id>; next: number; regent: Id; /** the seat kept for an heir away with an expedition: [heir, the ruler who died] */ held?: Id[] };
  /** how strongly people want to leave and found a new colony */
  settle: number;
  /** things this colony sends to the rest of the world (settler parties, news); the host delivers them */
  out: { k: string; [key: string]: unknown }[];
  /** the colony this one was founded from */
  from?: string;
  /** a plot against the ruler: who leads it, who is in, when it began, and whether the day has come */
  plot?: { lead: Id; mem: Id[]; t: number; ruler?: Id; go?: boolean };
  /** accusations waiting for a trial */
  trials: { a: Id; k: string; f: number; by: Id }[];
  /** building kinds the planner found no room for, and when it last looked */
  nosite: Record<string, number>;
  /** the castle on the rise: stages finished (0-3), the stage being built (0 none), which way it faces, and when each stage was finished */
  castle?: { stage: number; work: number; turn: number; at: number[] };
  /** the town wall: the stage being raised (1 ditch and palisade, 2 stone), the stage finished, whether the gates are shut, and when each stage was finished */
  walls?: { stage: number; done: number; shut: number; at: number[]; /** the wall's pieces, worked out when it was begun (see walls.ts) */ pl: { k: string; s: string; x: number; y: number; b: number; /** left in timber: the masons cannot get at it */ old?: number }[] };
  /** a warlord's host camped outside the walls: whose, its band, when it came, where it camps, days of supplies left, ladders and ram made, and how it stands (0 camped, 1 assault, 2 gone home) */
  siege?: { name: string; band: number; t0: number; x: number; y: number; sup: number; ladders: number; /** climbers who have gone over on them (two to a ladder, then it is broken) */ cl?: number; ram: number; phase: number; /** the hour each day the host makes up its mind */ hr: number; /** how many came, and the colony's tally of foes slain when they did */ n?: number; s0?: number; from?: string; fromId?: string; paid?: number };
  /** the latest wave of the grey plague: when it began, its last new case, how many lived here then, how many it took */
  plague?: { t: number; last: number; n0: number; dead: number };
  /** passing conditions: [kind, until tick] */
  mods: [string, number][];
  /** animals out in the wild */
  beasts?: Beast[];
  nextBeast?: number;
  /** the colony's own animals */
  herd?: Animal[];
  nextAnimal?: number;
  /** crop kind -> tick it was last brought in, for the variety of the colony's table */
  fresh?: Record<string, number>;
  /** planned gathering (wedding, funeral, feast) */
  gath?: {
    k: string; t0: number; t1: number; b: number; a?: Id; o?: Id; x: number; y: number; /** which festival */ f?: string;
    /** a wedding's or funeral's procession (see street.ts): where it forms up, when it sets off (-1: there is none), and who walks, in order */
    pr?: { x: number; y: number; t: number; ids: Id[] };
  };
  /** the street lamps this evening (see street.ts): [day, lamps in the round, who lights from the start, how many they have lit, who lights from the far end, how many] */
  lamp?: [number, number, Id, number, Id, number];
  /**
   * The weekly market (see market.ts): today's hours (0 when there is none), market days held, the
   * stalls set out (ware index, keeper, the tile they stand on, the way they face, sold, earned),
   * who has been round the stalls today, the carters' carts in the square, silver that changed hands
   * today, whether the day's grand sale has been told, and price multipliers at the opening (x100)
   */
  mkt?: { t0: number; t1: number; n: number; st: { k: number; o: Id; x: number; y: number; dx: number; dy: number; n: number; e: number }[]; went: Id[]; carts: string[]; coin: number; sale: number; pr: number[] };
  /**
   * What the colony knows (see tech.ts): lore gathered toward the next discovery, each discovery in
   * the order made (what, when, who worked it out, and the colony it was heard of from), what
   * neighbours have told of (kind -> their name), when the first of each new kind of building was
   * finished, the jeweller's orders, and the printed chronicle (volumes, pages toward the next).
   */
  tech?: { lore: number; got: { k: string; t: number; a: Id; from?: string }[]; heard: Record<string, string>; first: Record<string, number>; ord: Id[]; vol: number; pg: number };
  /**
   * Visitors (see visit.ts): who is here, the next id, the day the last party left, the day each
   * kind was last here, the party on the road today (kind and tick, '' for none), the day the king's
   * soldiers come for a refused tax (0 none), and taxes paid and refused
   */
  vis?: { l: Visitor[]; n: number; gone: number; seen: Record<string, number>; nx: string; at: number; wrath: number; paid: number; refused: number };
  /** the colony's festivals: its own name for each, how many years held, and this year's champion */
  trad?: Partial<Record<'spring' | 'summer', { name: string; n: number; champ?: Id }>>;
  /** the land's own events and the colony's dramas (see nature.ts) */
  nat?: Nat;
  /**
   * Expeditions (see exped.ts): the next party's id, the day the next may be called, the party out
   * now, relics on display and the next relic's id, places known from maps, places already searched,
   * dead colonies nearby (told to us by the region), expeditions past, and lone survivors of a lost
   * party still on their way home (who, when they come in, from where, which expedition)
   */
  exp?: { n: number; nx: number; l: XParty[]; rel: XRelic[]; nr: number; sites: XSite[]; seen: string[]; dead: string[]; done: XDone[]; late: { pw: Pawn; t: number; site: string; id: number; /** how many of that party lived */ n?: number }[]; /** the day the players' own were last asked if they would go */ ak?: number; /** a lost party still to be remembered together: where, how many, who led, since when */ mem?: { site: string; n: number; a: Id; t: number } };
  /**
   * Dealings with the neighbours (see neigh.ts): how we stand with each (by colony id, as the region
   * keeps it), our own on the road to a neighbour and those getting ready to go (who, why, where, the
   * hour they leave, how long the road is, and what they carry), what is loaded on the carts of the
   * parties here (by party id), a tournament called here, a bride or groom come to marry (who, whom,
   * from where), and the siege we last asked our allies' help against.
   */
  nb?: {
    ties: Record<string, NbTie>;
    away: NbAway[];
    go: { id: Id; k: string; to: string; toId: string; t: number; road: number; back: number; x?: number }[];
    loads: { g: number; res: [string, number][]; silver: number; back?: [string, number][]; bs?: number; to?: string; leg?: number; /** what was carried out, for the telling when the carts come home */ sent?: string }[];
    tn?: NbTourney;
    wed?: { a: Id; b: Id; from: string; fromId: string; house: string; /** their names as they were before the wedding, and who the newcomer was at home */ an: string; bn: string; was: Id };
    aid?: number;
    /** marks of the last things that came down the road, so one delivered twice is taken in once */
    seen?: string[];
  };
}

export const idx = (c: { w: number }, x: number, y: number): number => y * c.w + x;
