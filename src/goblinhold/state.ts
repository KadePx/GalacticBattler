// Game state. Everything here is plain JSON so a run can be saved at any moment.
import { BuildKind, GobKind, Job, MAP_H, MAP_W, Res, START } from './defs';

export type Phase = 'day' | 'dusk' | 'night' | 'dawn';

export interface Memory { id: string; t: number; }

export interface Needs { hunger: number; rest: number; warmth: number; safety: number; }

export interface Task {
  k: 'move' | 'eat' | 'warm' | 'sleep' | 'build' | 'repair' | 'chop' | 'quarry' | 'forage' | 'fish' | 'deliver' | 'farm' | 'trade' | 'tend' | 'train' | 'wander' | 'guard' | 'shelter' | 'flee' | 'sulk' | 'recover';
  tx?: number; // target tile
  ty?: number;
  id?: number; // target building
  t?: number; // timer
  res?: Res; // what is being carried
}

export interface Settler {
  id: number;
  name: string;
  traits: string[];
  job: Job;
  gear: Job[]; // gear already paid for
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  needs: Needs;
  mem: Memory[];
  task: Task | null;
  path: number[]; // remaining tile indices
  carry: number;
  carryRes: Res;
  home: number; // hut/barracks id, 0 = keep floor
  post: number; // tower/ballista/flag id assigned by the player (0 = auto)
  inside: number; // building id the settler is hidden in
  cool: number;
  face: number; // 1 right, -1 left
  walk: number; // anim clock
  lowT: number; // time spent at breakdown-level mood
  xp: number;
  hitT: number; // flash timer
  days: number;
  sick: number; // seconds of fever left
  away: number; // seconds left on an expedition (not on the map)
  look: number;
  promo?: string; // promotion path taken
}

export interface Building {
  id: number;
  kind: BuildKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  progress: number; // build points so far
  done: boolean;
  occupant: number; // tower/ballista: settler id inside
  cool: number;
  hitT: number;
  lit?: boolean; // brazier fuelled tonight
  level?: number; // keep fortification / defense upgrades
  sprung?: boolean; // spike pit used
}

export interface Goblin {
  id: number;
  kind: GobKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cool: number;
  face: number;
  walk: number;
  ox: number; // crowd lane offset
  oy: number;
  tgt: number; // building id it is chasing or 0
  retarget: number;
  hitT: number;
  slow: number;
  buff: number; // warchief aura
  root?: number; // stuck in a pit
}

export interface Shot {
  kind: 'arrow' | 'bolt' | 'stone' | 'heavy' | 'spell';
  x: number;
  y: number;
  sx: number;
  sy: number;
  tt: 'g' | 's' | 'b'; // target type: goblin / settler / building
  tid: number;
  tids?: number[]; // heavy bolts pierce
  src?: number; // settler who fired it (for experience)
  dmg: number;
  t: number;
  dur: number;
  ex: number; // last known target point
  ey: number;
}

export interface Floater { x: number; y: number; text: string; color: string; t: number; }

export interface WaveGroup { entry: number; kind: GobKind; count: number; }
export interface Wave { day: number; kind: 'raid' | 'assault' | 'boss'; groups: WaveGroup[]; mult: number; omen?: string; }

export interface NightStats { kills: number; lost: string[]; gold: number; hurt: string[]; buildingsLost: number; rescued: string[]; heroes?: Record<string, number>; wrecked?: string[]; }

export interface Applicant { name: string; traits: string[]; }

export interface Buff { id: string; days: number; }

/** A pending event card. Choices are resolved by id in events.ts. */
export interface PendingEvent { id: string; data: Record<string, number | string>; }

export interface Offer { kind: 'relic' | 'blueprint' | 'goods' | 'merc'; id: string; price: number; amount?: number; sold?: boolean; }

export interface Game {
  v: number;
  seed: number;
  rng: number;
  day: number;
  phase: Phase;
  phaseT: number;
  time: number;
  res: Record<Res, number>;
  terrain: number[];
  amount: number[]; // wood in a tree, stone in a rock, berries on a bush
  sapling: number[]; // days left until sapling grows
  blds: Building[];
  settlers: Settler[];
  goblins: Goblin[];
  shots: Shot[];
  floaters: Floater[];
  nextId: number;
  wave: Wave;
  spawn: { t: number; entry: number; kind: GobKind }[];
  night: NightStats;
  applicant: Applicant | null;
  report: string[];
  over: boolean;
  keepId: number;
  entries: { x: number; y: number; name: string }[];
  names: string[]; // names already used this run
  relics: string[];
  blueprints: BuildKind[];
  buffs: Buff[];
  event: PendingEvent | null;
  eventsSeen: string[];
  prices: Record<'food' | 'wood' | 'stone', number>; // multipliers that drift day to day
  traded: number; // goods traded today (big trades move the price)
  merchant: Offer[] | null; // a caravan is in town today
  stats: { kills: number; bosses: number; traded: number; events: number; cleanAssaults?: number; omenClean?: number; oathKept?: boolean };
  nextOmen?: string;
  charters?: { active: string[]; done: string[] };
  fallen?: string[]; // everyone lost this run, for the memorial
  tut?: number; // onboarding step, -1 when finished or skipped
  pending?: { id: string; day: number; data?: Record<string, number | string> }[]; // event chain follow-ups
}

export function idx(x: number, y: number) { return y * MAP_W + x; }
export function inMap(x: number, y: number) { return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H; }

// Mulberry32 kept in state so a reload continues the same sequence.
export function rand(g: Game) {
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function randInt(g: Game, n: number) { return Math.floor(rand(g) * n); }
export function pick<T>(g: Game, arr: T[]): T { return arr[randInt(g, arr.length)]; }

export const SAVE_VERSION = 2;

export function blankGame(seed: number): Game {
  return {
    v: SAVE_VERSION,
    seed,
    rng: seed,
    day: 1,
    phase: 'day',
    phaseT: 0,
    time: 0,
    res: { ...START },
    terrain: new Array(MAP_W * MAP_H).fill(0),
    amount: new Array(MAP_W * MAP_H).fill(0),
    sapling: new Array(MAP_W * MAP_H).fill(0),
    blds: [],
    settlers: [],
    goblins: [],
    shots: [],
    floaters: [],
    nextId: 1,
    wave: { day: 1, kind: 'raid', groups: [], mult: 1 },
    spawn: [],
    night: { kills: 0, lost: [], gold: 0, hurt: [], buildingsLost: 0, rescued: [] },
    applicant: null,
    report: [],
    over: false,
    keepId: 0,
    entries: [],
    names: [],
    relics: [],
    blueprints: [],
    buffs: [],
    event: null,
    eventsSeen: [],
    prices: { food: 1, wood: 1, stone: 1 },
    traded: 0,
    merchant: null,
    stats: { kills: 0, bosses: 0, traded: 0, events: 0 },
  };
}

export const hasRelic = (g: Game, id: string) => g.relics.includes(id);
export const hasBuff = (g: Game, id: string) => g.buffs.some((b) => b.id === id);

const SAVE_KEY = 'goblinhold.save';
const BEST_KEY = 'goblinhold.best';

export function saveGame(g: Game) {
  try {
    if (g.over) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(g));
  } catch { /* storage full or blocked: the run just won't persist */ }
}

export function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Game;
    return g && g.v === SAVE_VERSION && !g.over ? g : null;
  } catch {
    return null;
  }
}

export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

export function getBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
export function setBest(day: number) {
  try { if (day > getBest()) localStorage.setItem(BEST_KEY, String(day)); } catch { /* ignore */ }
}
