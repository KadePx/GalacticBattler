// All tuning numbers for Goblin Hold live here. Times are in game seconds at 1x speed,
// distances in tiles (16 px each).

export const TILE = 16;
export const MAP_W = 48;
export const MAP_H = 34;

export const DAY_LEN = 150;
export const DUSK_LEN = 20;
export const MAX_SPEED = 3;

// ---------- terrain ----------
export const T_GRASS = 0;
export const T_TREE = 1;
export const T_ROCK = 2;
export const T_WATER = 3;
export const T_SAPLING = 4;
export const T_DIRT = 5;
export const T_BUSH = 6;

export const TREE_WOOD = 8;
export const ROCK_STONE = 10;
export const BUSH_BERRIES = 4;
export const SAPLING_DAYS = 2;

// ---------- resources ----------
export type Res = 'food' | 'wood' | 'stone' | 'gold';
export const RES_ORDER: Res[] = ['food', 'wood', 'stone', 'gold'];
export type Cost = Partial<Record<Res, number>>;

// ---------- seasons ----------
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_DAYS = 5;
export interface SeasonDef { name: string; farm: number; berries: number; cold: number; dayCold: boolean; desc: string; }
export const SEASONS: Record<Season, SeasonDef> = {
  spring: { name: 'Spring', farm: 1, berries: 1, cold: 1, dayCold: false, desc: 'Mild nights. Saplings take root.' },
  summer: { name: 'Summer', farm: 1.25, berries: 1.5, cold: 0.5, dayCold: false, desc: 'Warm nights, fat berry bushes.' },
  autumn: { name: 'Autumn', farm: 1.5, berries: 0.7, cold: 1.3, dayCold: false, desc: 'Harvest time: farms yield half again as much. Stock up.' },
  winter: { name: 'Winter', farm: 0, berries: 0, cold: 2, dayCold: true, desc: 'Fields lie frozen and nights bite. Live off your stores, the river and the hearth.' },
};

// ---------- buildings ----------
export type BuildKind = 'keep' | 'hut' | 'farm' | 'garden' | 'market' | 'barracks' | 'healer' | 'tower' | 'ballista' | 'brazier' | 'wall' | 'stonewall' | 'trap' | 'flag';

export interface BuildDef {
  name: string;
  w: number;
  h: number;
  hp: number;
  cost: Cost;
  work: number; // build points; builders add ~10/s
  solid: boolean; // blocks settlers and goblins (walls block goblins only)
  goblinCost: number; // flow-field cost of pushing through this tile
  desc: string;
  key: string;
  blueprint?: boolean; // must be found or bought before it can be built
  cat: 'build' | 'defend';
}

export const BUILD: Record<BuildKind, BuildDef> = {
  keep: { name: 'Keep', w: 3, h: 3, hp: 600, cost: {}, work: 0, solid: true, goblinCost: 0, cat: 'build', key: '', desc: 'The heart of the hold. Stores your goods, warms settlers at its hearth and shoots from its arrow slits. If it falls, the run ends.' },
  hut: { name: 'Hut', w: 2, h: 2, hp: 90, cost: { wood: 25 }, work: 180, solid: true, goblinCost: 14, cat: 'build', key: 'h', desc: 'Three beds. Settlers sleep warm and safe here. Without a bed they sleep on the keep floor and grumble.' },
  farm: { name: 'Farm', w: 3, h: 2, hp: 40, cost: { wood: 15 }, work: 120, solid: false, goblinCost: 1, cat: 'build', key: 'f', desc: 'One farmer works it by day. Yield follows the seasons: best in autumn, nothing in winter.' },
  market: { name: 'Market', w: 2, h: 2, hp: 80, cost: { wood: 30, stone: 10 }, work: 200, solid: true, goblinCost: 14, cat: 'build', key: 'm', desc: 'Trade food, wood and stone for gold every day. A trader working the stall gets better prices.' },
  barracks: { name: 'Barracks', w: 3, h: 2, hp: 160, cost: { wood: 40, stone: 20 }, work: 320, solid: true, goblinCost: 16, cat: 'build', key: 'b', blueprint: true, desc: 'Four beds for militia and archers. Fighters who bunk together drill faster and fight 15% harder.' },
  healer: { name: "Healer's hut", w: 2, h: 2, hp: 80, cost: { wood: 30, stone: 10 }, work: 220, solid: true, goblinCost: 14, cat: 'build', key: 'k', blueprint: true, desc: 'Settlers who drop in a fight are carried here instead of dying, if there is room. The healer patches them up by morning.' },
  tower: { name: 'Arrow tower', w: 1, h: 1, hp: 130, cost: { wood: 25, gold: 8 }, work: 260, solid: true, goblinCost: 14, cat: 'defend', key: 't', desc: 'Fires a crossbow on its own. Post an archer inside for fast arrows at full strength.' },
  ballista: { name: 'Ballista', w: 1, h: 1, hp: 150, cost: { wood: 30, stone: 25, gold: 25 }, work: 300, solid: true, goblinCost: 14, cat: 'defend', key: 'l', blueprint: true, desc: 'Slow, heavy bolts that pierce a whole line of goblins and hit brutes and warchiefs extra hard. Fires slowly on its own; much faster with an archer crew.' },
  brazier: { name: 'Brazier', w: 1, h: 1, hp: 90, cost: { stone: 12 }, work: 120, solid: true, goblinCost: 14, cat: 'defend', key: 'z', blueprint: true, desc: 'Burns 3 wood a night. Goblins near it are slowed and singed; settlers near it stay warm.' },
  wall: { name: 'Palisade', w: 1, h: 1, hp: 90, cost: { wood: 3 }, work: 35, solid: true, goblinCost: 13, cat: 'defend', key: 'p', desc: 'Funnels goblins into kill zones. Settlers climb over; goblins go around or chop through. Drag to lay a line.' },
  stonewall: { name: 'Stone wall', w: 1, h: 1, hp: 220, cost: { stone: 4 }, work: 70, solid: true, goblinCost: 24, cat: 'defend', key: 'w', blueprint: true, desc: 'Three times as tough as a palisade. Drag to lay a line.' },
  trap: { name: 'Spike pit', w: 1, h: 1, hp: 1, cost: { wood: 6 }, work: 40, solid: false, goblinCost: 1, cat: 'defend', key: 'x', blueprint: true, desc: 'Hidden pit on a goblin path. The first goblin in takes 30 damage and is stuck for a moment. Builders re-arm sprung pits at dawn for 2 wood.' },
  garden: { name: 'Garden', w: 1, h: 1, hp: 30, cost: { wood: 8, stone: 6 }, work: 80, solid: false, goblinCost: 1, cat: 'build', key: 'n', desc: 'Flowers and a bench. Settlers who pass within 4 tiles get a mood lift.' },
  flag: { name: 'Guard post', w: 1, h: 1, hp: 1, cost: {}, work: 0, solid: false, goblinCost: 1, cat: 'defend', key: 'g', desc: 'Militia and shieldbearers muster here at dusk and fight anything that comes within 4 tiles.' },
};

export const BUILD_ORDER: BuildKind[] = ['hut', 'farm', 'garden', 'market', 'barracks', 'healer', 'tower', 'ballista', 'brazier', 'wall', 'stonewall', 'trap', 'flag'];
export const LINE_KINDS: BuildKind[] = ['wall', 'stonewall'];
export const HUT_BEDS = 3;
export const BARRACKS_BEDS = 4;
export const HEALER_BEDS = 3;
export const MAX_FLAGS = 4;
export const REFUND = 0.5;

// ---------- settlers ----------
export type Job = 'idle' | 'builder' | 'woodcutter' | 'quarrier' | 'forager' | 'farmer' | 'fisher' | 'trader' | 'healer' | 'militia' | 'archer' | 'shieldbearer';

export interface JobDef {
  name: string;
  color: string; // tunic
  shade: string;
  gold: number; // one-time gear cost
  combat: boolean;
  desc: string;
  needs?: BuildKind; // building that makes this job useful
}

export const JOBS: Record<Job, JobDef> = {
  idle: { name: 'Idle', color: '#8d8a80', shade: '#6a675f', gold: 0, combat: false, desc: 'Wanders near the keep.' },
  builder: { name: 'Builder', color: '#c9822e', shade: '#94591c', gold: 0, combat: false, desc: 'Builds new structures and repairs damaged ones. Repairs walls during raids too.' },
  woodcutter: { name: 'Woodcutter', color: '#4f8a3a', shade: '#335f26', gold: 0, combat: false, desc: 'Chops trees and hauls wood to the keep.' },
  quarrier: { name: 'Quarrier', color: '#7d8590', shade: '#565d66', gold: 0, combat: false, desc: 'Breaks boulders into stone.' },
  forager: { name: 'Forager', color: '#9a5a8a', shade: '#6e3e62', gold: 0, combat: false, desc: 'Picks berries from bushes. Bushes regrow; best in summer, bare in winter.' },
  farmer: { name: 'Farmer', color: '#c4a648', shade: '#8f7a30', gold: 0, combat: false, desc: 'Works a farm for food. Needs a farm.', needs: 'farm' },
  fisher: { name: 'Fisher', color: '#3f7fa8', shade: '#2b5a78', gold: 0, combat: false, desc: 'Fishes from the shore. Slow but steady, even in winter.' },
  trader: { name: 'Trader', color: '#b0473a', shade: '#7e2f26', gold: 0, combat: false, desc: 'Works the market: better prices and a little gold from passing trade. Needs a market.', needs: 'market' },
  healer: { name: 'Healer', color: '#e2ddd0', shade: '#a8a294', gold: 0, combat: false, desc: 'Tends the hurt: settlers nearby heal four times faster. Works from a healer\'s hut if there is one.' },
  militia: { name: 'Militia', color: '#4d6a9e', shade: '#344a73', gold: 8, combat: true, desc: 'Frontline melee. Sturdy, but slingers pick them apart. Rests by day.' },
  archer: { name: 'Archer', color: '#3f6f55', shade: '#2a4d3a', gold: 12, combat: true, desc: 'Ranged support. Mans towers and ballistas at dusk. Rests by day.' },
  shieldbearer: { name: 'Shieldbearer', color: '#8a8f9a', shade: '#5e636c', gold: 18, combat: true, desc: 'Tank. Goblins nearby attack them first; allies beside them take less damage.' },
};
export const JOB_ORDER: Job[] = ['builder', 'woodcutter', 'quarrier', 'forager', 'farmer', 'fisher', 'trader', 'healer', 'militia', 'archer', 'shieldbearer', 'idle'];

export const SETTLER_HP = 30;

// Promotions: fighters with enough experience (and the spirit for it) pick one of two paths.
export const PROMO_XP = 6;
export const PROMO_GOLD = 15;
export const PROMO_MOOD = 40;
export interface PromoDef { job: Job; name: string; desc: string; }
export const PROMOS: Record<string, PromoDef> = {
  veteran: { job: 'militia', name: 'Veteran', desc: '+40% health; never routs before 15% health.' },
  berserker: { job: 'militia', name: 'Berserker', desc: '+30% damage and 20% faster swings, but 15% less health.' },
  marksman: { job: 'archer', name: 'Marksman', desc: '+1.5 range and +25% damage, on foot or in a tower.' },
  volley: { job: 'archer', name: 'Volley archer', desc: 'Shoots 25% faster, on foot or in a tower.' },
  bulwark: { job: 'shieldbearer', name: 'Bulwark', desc: '+50% health and covers allies 1 tile further away.' },
  warden: { job: 'shieldbearer', name: 'Warden', desc: 'Allies beside them take 40% less damage instead of 25%; draws goblins from further.' },
};
export const SETTLER_SPEED = 2.3;
export const MILITIA = { hp: 44, dmg: 6, rate: 0.85, range: 0.95, leash: 4 };
export const SHIELD = { hp: 75, dmg: 4, rate: 1, range: 0.95, taunt: 2.6, guard: 2, cut: 0.25 };
export const ARCHER = { hp: 30, dmg: 5, rate: 1.15, range: 5.5 };
export const TOWER = { range: 6.2, dmg: 5, rate: 0.75, idleDmg: 4, idleRate: 1.5 };
export const BALLISTA = { range: 7, dmg: 20, rate: 3.5, pierce: 4, heavyMult: 1.75, idleRate: 0.4 };
export const BRAZIER = { range: 2.5, slow: 0.5, dps: 2, fuel: 3 };
export const TRAP_DMG = 30;
export const TRAP_REARM: Cost = { wood: 2 };
export const KEEP_BOW = { range: 7, dmg: 4, rate: 1.3 };
// Fortifying the keep: each level adds health and sharpens its arrow slits.
export const KEEP_LEVELS = [
  { name: 'Keep', hp: 600, dmg: 4, range: 7, rate: 1.3, cost: {} as Cost },
  { name: 'Fortified keep', hp: 900, dmg: 7, range: 8, rate: 1.1, cost: { stone: 40, gold: 60 } as Cost },
  { name: 'Fortress', hp: 1300, dmg: 10, range: 9, rate: 0.8, cost: { stone: 90, gold: 160 } as Cost },
  { name: 'Citadel', hp: 1800, dmg: 13, range: 9.5, rate: 0.7, cost: { stone: 200, gold: 400 } as Cost },
];

export const WORK = {
  build: 10, // bp/s
  repair: 6, // hp/s
  chop: 4, // s per swing
  chopYield: 2,
  quarry: 5,
  quarryYield: 2,
  forage: 4.5, // s per berry
  carry: 4,
  farm: 13, // s per food
  fish: 17,
  eat: 2,
  traderGold: 22, // s per gold while a trader works the stall
};

// Needs drain per second (1x). 100 = fully satisfied.
export const NEEDS = {
  hunger: 0.46,
  rest: 0.3,
  warmDay: 0.25, // gain in daylight outdoors
  coldNight: 0.6,
  warmIndoor: 2.2,
  sleep: 1.25,
  eatAt: 38,
  warmAt: 30,
  sleepAt: 24,
};

export interface TraitDef { name: string; desc: string; }
export const TRAITS: Record<string, TraitDef> = {
  hardy: { name: 'Hardy', desc: 'Loses warmth half as fast.' },
  glutton: { name: 'Glutton', desc: 'Gets hungry 40% faster.' },
  brave: { name: 'Brave', desc: 'Never panics; guards hold to the last.' },
  nimble: { name: 'Nimble', desc: 'Moves 15% faster.' },
  lazy: { name: 'Lazy', desc: 'Works 15% slower but tires slower.' },
  diligent: { name: 'Diligent', desc: 'Works 15% faster.' },
  sharp: { name: 'Sharp-eyed', desc: '+1 range with a bow.' },
  strong: { name: 'Strong', desc: '+25% melee damage, chopping and quarrying.' },
  cheerful: { name: 'Cheerful', desc: '+8 mood.' },
  gloomy: { name: 'Gloomy', desc: '-8 mood.' },
  tough: { name: 'Tough', desc: '+30% health.' },
  skittish: { name: 'Skittish', desc: 'Loses safety twice as fast.' },
  haggler: { name: 'Haggler', desc: 'Better prices when working the market.' },
  green: { name: 'Green thumb', desc: '+30% from farms and bushes.' },
};
export const TRAIT_IDS = Object.keys(TRAITS);

// Memory id -> label, mood value, lifetime (s). Same id refreshes instead of stacking.
export const MEMORIES: Record<string, { label: string; v: number; ttl: number }> = {
  meal: { label: 'Hot meal', v: 4, ttl: 150 },
  bed: { label: 'Slept in a bed', v: 6, ttl: 260 },
  floor: { label: 'Slept on the keep floor', v: -5, ttl: 260 },
  cold: { label: 'Cold night watch', v: -6, ttl: 220 },
  victory: { label: 'Held the night', v: 8, ttl: 260 },
  flawless: { label: 'Nobody lost', v: 6, ttl: 260 },
  loss: { label: 'Lost a neighbour', v: -10, ttl: 360 },
  garden: { label: 'Strolled in the garden', v: 4, ttl: 120 },
  unpaid: { label: 'Went unpaid', v: -6, ttl: 300 },
  built: { label: 'Finished a building', v: 3, ttl: 140 },
  hurt: { label: 'Got hurt', v: -6, ttl: 220 },
  homeless: { label: 'Home was wrecked', v: -8, ttl: 400 },
  relief: { label: 'Let it all out', v: 12, ttl: 200 },
  starving: { label: 'Went without food', v: -8, ttl: 200 },
  welcome: { label: 'New in town', v: 6, ttl: 300 },
  feast: { label: 'Feast day', v: 14, ttl: 400 },
  music: { label: 'Heard the bard play', v: 9, ttl: 300 },
  taxed: { label: 'Bled dry by the tax man', v: -7, ttl: 300 },
  distrust: { label: 'A goblin in the hold?!', v: -5, ttl: 400 },
  shrine: { label: 'Blessed at the shrine', v: 8, ttl: 400 },
  cursed: { label: 'Uneasy since the shrine', v: -6, ttl: 400 },
  generous: { label: 'We helped someone', v: 5, ttl: 300 },
  callous: { label: 'We turned them away', v: -4, ttl: 300 },
  boss: { label: 'Saw the warchief fall', v: 12, ttl: 400 },
  barracks: { label: 'Bunks with comrades', v: 4, ttl: 260 },
  sick: { label: 'Feverish', v: -8, ttl: 300 },
  rescued: { label: 'Patched up by the healer', v: 3, ttl: 300 },
};

export const MOOD = { base: 52, breakAt: 14, breakHold: 10, sulk: 40, inspiredAt: 72 };

// ---------- goblins ----------
export type GobKind = 'scrapper' | 'slinger' | 'wolfrider' | 'brute' | 'sapper' | 'shieldgob' | 'shaman' | 'warchief';
export interface GobDef {
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  rate: number;
  range: number;
  cost: number; // wave budget points
  gold: number;
  from: number; // first day it can appear
  desc: string;
}
export const GOBS: Record<GobKind, GobDef> = {
  scrapper: { name: 'Scrapper', hp: 22, speed: 1.55, dmg: 4, rate: 0.9, range: 0.9, cost: 1, gold: 1, from: 1, desc: 'Melee runner. Hacks at the nearest structure.' },
  slinger: { name: 'Slinger', hp: 14, speed: 1.35, dmg: 3, rate: 1.6, range: 4.6, cost: 1.5, gold: 1, from: 2, desc: 'Ranged. Hunts settlers and keeps its distance.' },
  brute: { name: 'Brute', hp: 85, speed: 0.95, dmg: 11, rate: 1.4, range: 1, cost: 4, gold: 3, from: 5, desc: 'Heavy and slow. Smashes walls and shoves defenders aside.' },
  sapper: { name: 'Sapper', hp: 18, speed: 1.7, dmg: 45, rate: 1, range: 0.9, cost: 2.5, gold: 2, from: 7, desc: 'Runs for the nearest wall and blows it up. Kill it before it gets there.' },
  wolfrider: { name: 'Wolf rider', hp: 28, speed: 2.4, dmg: 5, rate: 0.8, range: 0.9, cost: 2.5, gold: 2, from: 12, desc: 'Fast. Leaps low walls more readily and hunts settlers caught outside.' },
  shieldgob: { name: 'Shield goblin', hp: 50, speed: 1.2, dmg: 5, rate: 1, range: 0.9, cost: 3, gold: 2, from: 14, desc: 'Big plank shield: arrows and bolts do 60% less. Ballistas and melee cut through.' },
  shaman: { name: 'Shaman', hp: 30, speed: 1.1, dmg: 2, rate: 1.5, range: 4, cost: 3.5, gold: 3, from: 11, desc: 'Hangs back and heals nearby goblins. Target it first.' },
  warchief: { name: 'Warchief', hp: 320, speed: 0.9, dmg: 14, rate: 1.2, range: 1.1, cost: 0, gold: 40, from: 99, desc: 'Boss. Its war banner makes every goblin nearby faster and fiercer.' },
};

export const WAVE = {
  base: 3,
  perDay: 1.5,
  perSettler: 0.5, // over 8 settlers
  assaultMult: 1.5,
  bossMult: 1.2,
  hpPerDay: 0.03,
  hpPerDay2: 0.0005, // quadratic: late nights get tough
  perDay2: 0.03,
  spacing: 1.1,
  clearGold: 2,
  flawlessGold: 5,
};

export const MEAL = 1.5; // food per meal

// Upgrades for built defenses and homes. Each level adds to the building's stats.
export interface UpgradeDef { name: string; cost: Cost; desc: string; hp?: number; dmg?: number; rate?: number; range?: number; pierce?: number; }
export const UPGRADES: Partial<Record<BuildKind, UpgradeDef[]>> = {
  tower: [
    { name: 'Longbow loft', cost: { wood: 20, gold: 25 }, desc: '+1 range, +30% health.', range: 1, hp: 0.3 },
    { name: 'Fire arrows', cost: { gold: 45, stone: 10 }, desc: '+40% damage.', dmg: 0.4 },
    { name: 'Arrow storm', cost: { gold: 90, stone: 20 }, desc: 'Shoots 30% faster.', rate: -0.3 },
  ],
  ballista: [
    { name: 'Torsion arms', cost: { stone: 15, gold: 35 }, desc: 'Bolts pierce 6 goblins.', pierce: 2 },
    { name: 'Geared winch', cost: { gold: 60 }, desc: 'Reloads 25% faster.', rate: -0.25 },
  ],
  brazier: [{ name: 'Pitch pot', cost: { gold: 20, wood: 10 }, desc: 'Burns hotter and reaches 3.5 tiles.', range: 1, dmg: 0.5 }],
  wall: [{ name: 'Stakes and spikes', cost: { wood: 3 }, desc: '+60% health; goblins hurt themselves chopping.', hp: 0.6 }],
  stonewall: [{ name: 'Iron-bound', cost: { stone: 4, gold: 2 }, desc: '+50% health.', hp: 0.5 }],
  hut: [{ name: 'Loft', cost: { wood: 12 }, desc: 'Room for a fourth bed.' }],
  farm: [{ name: 'Irrigation', cost: { wood: 20, stone: 15 }, desc: 'Farmers harvest a third faster.', rate: -0.25 }],
};

// Omens: from year two, assault and boss nights carry a warband modifier.
export interface OmenDef { name: string; desc: string; }
export const OMENS: Record<string, OmenDef> = {
  ironhide: { name: 'Ironhide', desc: 'Goblins have 40% more health but move 25% slower.' },
  bloodmoon: { name: 'Blood moon', desc: 'Goblins move 25% faster.' },
  torches: { name: 'Torches', desc: 'Goblins deal double damage to buildings.' },
  swarm: { name: 'Swarm', desc: '30% more goblins, each a little frailer.' },
};

export const START: Record<Res, number> = { food: 24, wood: 60, stone: 0, gold: 15 };

// ---------- trading ----------
// Base gold price for 10 units. Buying costs more than selling.
export const TRADE: Record<Exclude<Res, 'gold'>, { base: number; season: Partial<Record<Season, number>> }> = {
  food: { base: 6, season: { autumn: 0.7, winter: 1.6 } },
  wood: { base: 5, season: { winter: 1.3 } },
  stone: { base: 10, season: {} },
};
export const TRADE_SPREAD = 0.3; // sell = buy * (1 - spread)
export const TRADE_LOT = 10;

// ---------- relics (run-long boons found in events and bought from merchants) ----------
export interface RelicDef { name: string; desc: string; icon: string; price: number; }
export const RELICS: Record<string, RelicDef> = {
  horseshoe: { name: 'Lucky horseshoe', desc: '+1 gold for every goblin slain.', icon: 'horseshoe', price: 30 },
  warhorn: { name: 'Old war horn', desc: 'Guards deal +25% damage.', icon: 'horn', price: 40 },
  hearthstone: { name: 'Hearthstone', desc: 'Settlers lose warmth 35% slower.', icon: 'hearth', price: 30 },
  seeds: { name: 'Bountiful seeds', desc: 'Farms and bushes yield 25% more.', icon: 'seeds', price: 30 },
  stakes: { name: 'Fire-hardened stakes', desc: 'Palisades have +60% health.', icon: 'stakes', price: 25 },
  satchel: { name: "Herbalist's satchel", desc: 'Settlers heal twice as fast.', icon: 'satchel', price: 25 },
  axeheads: { name: 'Iron axe heads', desc: 'Woodcutters and quarriers work 30% faster.', icon: 'axe', price: 30 },
  banner: { name: 'Banner of the Hold', desc: '+5 mood for everyone.', icon: 'banner', price: 35 },
  spyglass: { name: 'Spyglass', desc: 'Towers and archers +1 range.', icon: 'spyglass', price: 40 },
  ledger: { name: "Merchant's ledger", desc: 'Market prices 15% better.', icon: 'ledger', price: 25 },
  boots: { name: 'Seven-league boots', desc: 'Settlers move 12% faster.', icon: 'boots', price: 25 },
  idol: { name: 'Goblin idol', desc: 'Goblins sometimes drop double gold.', icon: 'idol', price: 30 },
};
export const RELIC_IDS = Object.keys(RELICS);

export const BLUEPRINTS: BuildKind[] = (Object.keys(BUILD) as BuildKind[]).filter((k) => BUILD[k].blueprint);
export const BLUEPRINT_PRICE = 35;

export const NAMES = [
  'Bren', 'Ida', 'Osric', 'Maud', 'Tam', 'Elsie', 'Godric', 'Wyn', 'Hob', 'Agnes', 'Pip', 'Rowan', 'Edda', 'Colm', 'Nell',
  'Alric', 'Bess', 'Dunstan', 'Fern', 'Gil', 'Hilde', 'Jory', 'Kit', 'Lark', 'Merry', 'Ned', 'Odo', 'Prue', 'Quill', 'Rufus',
  'Sib', 'Tilda', 'Ulf', 'Vera', 'Wat', 'Yara', 'Aldo', 'Briar', 'Cuth', 'Dora', 'Emmet', 'Fleur', 'Hal', 'Isolde', 'Juniper',
  'Mabel', 'Orrin', 'Peg', 'Roderick', 'Sorrel', 'Thane', 'Wren', 'Ysolde', 'Barnaby', 'Clover', 'Dex', 'Gwen', 'Hamish', 'Lotte',
];
