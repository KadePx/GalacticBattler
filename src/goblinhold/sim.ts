// The simulation: day/night phases, seasons, settler needs and jobs, goblin waves and combat,
// trading and player actions.
import {
  ARCHER, BALLISTA, BARRACKS_BEDS, BLUEPRINTS, BRAZIER, BUILD, BuildKind, BUSH_BERRIES, Cost, DAY_LEN, DUSK_LEN, GOBS, GobKind,
  HEALER_BEDS, HUT_BEDS, Job, JOBS, KEEP_LEVELS, MAP_W, MAX_FLAGS, MEMORIES, MILITIA, MOOD, NAMES, NEEDS, REFUND, RELIC_IDS, Res,
  RES_ORDER, MEAL, OMENS, UPGRADES, TRAP_REARM, PROMO_GOLD, PROMO_MOOD, PROMO_XP, PROMOS, SAPLING_DAYS, Season, SEASON_DAYS, SEASON_ORDER, SEASONS, SETTLER_HP, SETTLER_SPEED, SHIELD, T_BUSH, T_GRASS, T_ROCK,
  T_SAPLING, T_TREE, T_WATER, TOWER, TRADE, TRADE_LOT, TRADE_SPREAD, TRAIT_IDS, TRAP_DMG, TREE_WOOD, WAVE, WORK, RELICS,
} from './defs';
import {
  bld, bldAtTile, bldGrid, canPlace, computeFlow, distToBld, findPath, flow, flowNext, generate, gobFree, KEEP_X, KEEP_Y, keepCenter,
  nearestFree, rebuild, settlerFree,
} from './map';
import { rollEvent } from './events';
import {
  Applicant, blankGame, Building, Game, Goblin, hasBuff, hasRelic, idx, inMap, Offer, pick, rand, randInt, Settler, setBest, Task, Wave,
} from './state';

// ---------- events for audio / effects ----------
export interface FxEvent { k: string; x?: number; y?: number; n?: number; }
export const events: FxEvent[] = [];
const CRITICAL = new Set(['dawn', 'over', 'dusk', 'horn', 'relic', 'charter', 'boss', 'season']);
export const emit = (k: string, x?: number, y?: number, n?: number) => { if (events.length < 200 || CRITICAL.has(k)) events.push({ k, x, y, n }); };

export const toasts: { text: string; kind: string }[] = [];
export const toast = (text: string, kind = '') => { toasts.push({ text, kind }); };

export function floater(g: Game, x: number, y: number, text: string, color: string) {
  if (g.floaters.length < 60) g.floaters.push({ x, y, text, color, t: 1.3 });
}

// ---------- seasons ----------
export function dayLen(g: Game) { return g.day === 1 ? 110 : DAY_LEN; }
export function season(g: Game, day = g.day): Season { return SEASON_ORDER[Math.floor((day - 1) / SEASON_DAYS) % 4]; }
export function seasonDay(g: Game, day = g.day) { return ((day - 1) % SEASON_DAYS) + 1; }
export function year(g: Game) { return Math.floor((g.day - 1) / (SEASON_DAYS * 4)) + 1; }

// ---------- costs ----------
export function canPay(g: Game, c: Cost) { return RES_ORDER.every((r) => g.res[r] >= (c[r] ?? 0)); }
export function pay(g: Game, c: Cost) { for (const r of RES_ORDER) g.res[r] -= c[r] ?? 0; }
export function gain(g: Game, c: Cost) { for (const r of RES_ORDER) g.res[r] += c[r] ?? 0; }
export function costText(c: Cost, short = false) {
  const parts = RES_ORDER.filter((r) => c[r]).map((r) => short ? `${c[r]}${r[0]}` : `${c[r]} ${r}`);
  return parts.join(short ? ' ' : ' + ') || 'free';
}
export function buildCost(g: Game, kind: BuildKind): Cost {
  void g;
  return BUILD[kind].cost;
}
export const unlocked = (g: Game, kind: BuildKind) => !BUILD[kind].blueprint || g.blueprints.includes(kind);

// ---------- creation ----------
export function newName(g: Game) {
  const free = NAMES.filter((n) => !g.names.includes(n));
  const n = free.length ? pick(g, free) : pick(g, NAMES) + ' ' + (g.names.length + 1);
  g.names.push(n);
  return n;
}

export function rollTraits(g: Game): string[] {
  const a = pick(g, TRAIT_IDS);
  if (rand(g) < 0.45) {
    let b = pick(g, TRAIT_IDS);
    const clash = (p: string, q: string) => [['cheerful', 'gloomy'], ['lazy', 'diligent'], ['brave', 'skittish']].some(([x, y]) => (p === x && q === y) || (p === y && q === x));
    for (let i = 0; i < 6 && (b === a || clash(a, b)); i++) b = pick(g, TRAIT_IDS);
    if (b !== a && !clash(a, b)) return [a, b];
  }
  return [a];
}

function baseHp(job: Job, traits: string[], promo?: string) {
  const tough = traits.includes('tough') ? 1.3 : 1;
  const p = promo && PROMOS[promo]?.job === job ? (promo === 'veteran' ? 1.4 : promo === 'bulwark' ? 1.5 : promo === 'berserker' ? 0.85 : 1) : 1;
  return Math.round((job === 'militia' ? MILITIA.hp : job === 'shieldbearer' ? SHIELD.hp : SETTLER_HP) * tough * p);
}
/** Promotion path if it applies to the settler's current job. */
export const promoOf = (s: Settler) => (s.promo && PROMOS[s.promo]?.job === s.job ? s.promo : '');
export function canPromote(g: Game, s: Settler) { return JOBS[s.job].combat && !s.promo && s.xp >= PROMO_XP && Object.values(PROMOS).some((p) => p.job === s.job); }
export function promote(g: Game, s: Settler, id: string): string | null {
  const p = PROMOS[id];
  if (!p || p.job !== s.job) return 'Not a path for this job.';
  if (!canPromote(g, s)) return `Needs ${PROMO_XP} experience.`;
  if (mood(g, s) < PROMO_MOOD) return `${s.name} is too miserable to train (needs mood ${PROMO_MOOD}).`;
  if (g.res.gold < PROMO_GOLD) return `Needs ${PROMO_GOLD} gold.`;
  g.res.gold -= PROMO_GOLD;
  s.promo = id;
  const f = s.hp / s.maxHp;
  s.maxHp = baseHp(s.job, s.traits, id);
  s.hp = Math.max(1, Math.round(s.maxHp * f));
  emit('built', s.x, s.y);
  toast(`${s.name} is now a ${p.name.toLowerCase()}!`, 'good');
  return null;
}

export function makeSettler(g: Game, name: string, traits: string[], job: Job, x: number, y: number): Settler {
  const hp = baseHp(job, traits);
  const s: Settler = {
    id: g.nextId++, name, traits, job, gear: JOBS[job].gold ? [job] : [], x, y, hp, maxHp: hp,
    needs: { hunger: 80 + rand(g) * 20, rest: 75 + rand(g) * 25, warmth: 90, safety: 70 },
    mem: [], task: null, path: [], carry: 0, carryRes: 'wood', home: 0, post: 0, inside: 0, cool: 0, face: 1, walk: 0, lowT: 0, xp: 0, hitT: 0, days: 0,
    sick: 0, away: 0, look: randInt(g, 997),
  };
  g.settlers.push(s);
  return s;
}

export function addBuilding(g: Game, kind: BuildKind, x: number, y: number, done: boolean): Building {
  const d = BUILD[kind];
  const max = maxHp(g, kind);
  const b: Building = { id: g.nextId++, kind, x, y, hp: done ? max : Math.max(1, max * 0.15), maxHp: max, progress: done ? d.work : 0, done, occupant: 0, cool: 0, hitT: 0 };
  g.blds.push(b);
  return b;
}

function maxHp(g: Game, kind: BuildKind) { return Math.round(BUILD[kind].hp * (kind === 'wall' && hasRelic(g, 'stakes') ? 1.6 : 1)); }

export function newGame(seed: number): Game {
  const g = blankGame(seed);
  generate(g);
  const keep = addBuilding(g, 'keep', KEEP_X, KEEP_Y, true);
  g.keepId = keep.id;
  addBuilding(g, 'hut', KEEP_X + 4, KEEP_Y, true);
  addBuilding(g, 'farm', KEEP_X - 1, KEEP_Y + 4, true);
  addBuilding(g, 'tower', KEEP_X - 3, KEEP_Y + 1, true);
  addBuilding(g, 'flag', KEEP_X - 2, KEEP_Y + 3, true);
  rebuild(g);
  const jobs: Job[] = ['builder', 'woodcutter', 'farmer', 'militia', 'archer'];
  jobs.forEach((j, i) => {
    const p = nearestFree(g, KEEP_X + 1 + (i - 2), KEEP_Y + 3.5);
    makeSettler(g, newName(g), rollTraits(g), j, p.x, p.y);
  });
  assignHomes(g);
  g.wave = makeWave(g, 1);
  return g;
}

// ---------- homes ----------
export const bedsOf = (b: Building) => b.kind === 'hut' ? HUT_BEDS + ((b.level ?? 0) > 0 ? 1 : 0) : b.kind === 'barracks' ? BARRACKS_BEDS : 0;
export function bedCount(g: Game) { return g.blds.filter((b) => b.done).reduce((a, b) => a + bedsOf(b), 0); }

export function assignHomes(g: Game) {
  const homes = g.blds.filter((b) => b.done && bedsOf(b) > 0);
  const used = new Map<number, number>();
  const fits = (s: Settler, h: Building) => (used.get(h.id) ?? 0) < bedsOf(h) && (h.kind !== 'barracks' || JOBS[s.job].combat);
  for (const s of g.settlers) {
    const h = homes.find((h) => h.id === s.home);
    if (h && fits(s, h)) used.set(h.id, (used.get(h.id) ?? 0) + 1);
    else s.home = 0;
  }
  // fighters first into barracks, then everyone into huts
  const order = [...g.settlers].sort((a, b) => Number(JOBS[b.job].combat) - Number(JOBS[a.job].combat));
  for (const s of order) {
    if (s.home) continue;
    const pref = homes.filter((h) => fits(s, h)).sort((a, b) => (a.kind === 'barracks' ? -1 : 1) - (b.kind === 'barracks' ? -1 : 1));
    const h = JOBS[s.job].combat ? pref[0] : pref.find((h) => h.kind === 'hut');
    if (h) { s.home = h.id; used.set(h.id, (used.get(h.id) ?? 0) + 1); }
  }
}

// ---------- waves ----------
export function makeWave(g: Game, day: number): Wave {
  const sd = seasonDay(g, day);
  const kind: Wave['kind'] = sd === SEASON_DAYS ? 'boss' : sd === 3 ? 'assault' : 'raid';
  const pop = g.settlers.length;
  let mult = kind === 'assault' ? (day <= SEASON_DAYS ? 1.25 : WAVE.assaultMult) : kind === 'boss' ? WAVE.bossMult : 1;
  if (hasBuff(g, 'drums')) mult *= 1.4;
  if (hasBuff(g, 'defector')) mult *= 0.8;
  const ambush = hasBuff(g, 'ambush') ? 2 : 0;
  let omen: string | undefined;
  if (day > SEASON_DAYS * 4 && kind !== 'raid' && !hasBuff(g, 'noomen')) {
    // keep tonight's omen if the wave is only being re-made after a morning event
    if (g.wave?.day === day && g.wave.omen) omen = g.wave.omen;
    else { omen = g.nextOmen ?? pick(g, Object.keys(OMENS)); g.nextOmen = undefined; }
    if (omen === 'swarm') mult *= 1.3;
  }
  if (hasBuff(g, 'leak')) mult *= 1.2;
  const budget = (WAVE.base + WAVE.perDay * (day - 1) + WAVE.perDay2 * (day - 1) ** 2 + WAVE.perSettler * Math.max(0, pop - 8)) * mult;
  let ne = day <= 2 ? 1 : day <= 5 ? (kind !== 'raid' ? 2 : 1) : day <= 9 ? (kind !== 'raid' ? 3 : 2) : kind !== 'raid' ? 3 : 2 + randInt(g, 2);
  ne = Math.min(3, ne);
  const order = [0, 1, 2].sort(() => rand(g) - 0.5);
  if (day === 1) order.sort((a, b) => (a === 1 ? 1 : 0) - (b === 1 ? 1 : 0)); // first night never comes from the north
  const groups: Wave['groups'] = [];
  const add = (entry: number, k: GobKind, n: number) => { if (n <= 0) return; const ex = groups.find((q) => q.entry === entry && q.kind === k); if (ex) ex.count += n; else groups.push({ entry, kind: k, count: n }); };
  // shares of the budget per goblin type, unlocked by day
  const shares: [GobKind, number][] = [
    ['slinger', day < GOBS.slinger.from ? 0 : Math.min(0.3, 0.15 + day * 0.02)],
    ['wolfrider', day < GOBS.wolfrider.from ? 0 : Math.min(0.15, 0.05 + (day - GOBS.wolfrider.from) * 0.01)],
    ['shieldgob', day < GOBS.shieldgob.from ? 0 : Math.min(0.15, 0.05 + (day - GOBS.shieldgob.from) * 0.01)],
    ['brute', day < GOBS.brute.from ? 0 : Math.min(0.25, 0.08 + day * 0.012)],
    ['sapper', day < GOBS.sapper.from ? 0 : Math.min(0.15, 0.06 + day * 0.006)],
    ['shaman', day < GOBS.shaman.from ? 0 : Math.min(0.14, 0.05 + day * 0.005)],
  ];
  for (let i = 0; i < ne; i++) {
    let pts = budget / ne;
    const e = order[i];
    for (const [k, sh] of shares) {
      const want = (pts * sh) / GOBS[k].cost;
      const n = Math.floor(want) + (rand(g) < want % 1 ? 1 : 0);
      add(e, k, n);
      pts -= n * GOBS[k].cost;
    }
    add(e, 'scrapper', Math.max(1, Math.round(pts)));
  }
  if (ambush) add(order[0], 'scrapper', ambush);
  if (kind === 'boss') {
    // the warchief leads from the first group; the first season's boss is a pair of brutes
    if (day >= SEASON_DAYS * 2) add(order[0], 'warchief', 1);
    else add(order[0], 'brute', 1);
  }
  return { day, kind, groups, mult, omen };
}

function queueWave(g: Game) {
  g.spawn = [];
  const perEntry = new Map<number, number>();
  // weaker goblins lead, heavies and the boss come last
  const rank: Record<GobKind, number> = { wolfrider: 0, scrapper: 1, slinger: 2, sapper: 3, shieldgob: 4, brute: 5, shaman: 6, warchief: 7 };
  const groups = [...g.wave.groups].sort((a, b) => rank[a.kind] - rank[b.kind]);
  for (const gr of groups) {
    let t = perEntry.get(gr.entry) ?? 3;
    for (let i = 0; i < gr.count; i++) {
      g.spawn.push({ t, entry: gr.entry, kind: gr.kind });
      t += WAVE.spacing * (0.7 + rand(g) * 0.6);
    }
    perEntry.set(gr.entry, t + 1);
  }
  g.spawn.sort((a, b) => a.t - b.t);
}

function spawnGoblin(g: Game, kind: GobKind, entry: number) {
  const e = g.entries[entry];
  const d = GOBS[kind];
  const om = g.wave.omen;
  const hp = Math.round(d.hp * (1 + WAVE.hpPerDay * (g.day - 1) + WAVE.hpPerDay2 * (g.day - 1) ** 2) * (om === 'ironhide' ? 1.4 : om === 'swarm' ? 0.85 : 1));
  const p = nearestFree(g, e.x + 0.5, e.y + 0.5, false);
  const gob: Goblin = {
    id: g.nextId++, kind, x: p.x + (rand(g) - 0.5) * 0.4, y: p.y + (rand(g) - 0.5) * 0.4, hp, maxHp: hp, cool: rand(g), face: 1, walk: rand(g) * 4,
    ox: (rand(g) - 0.5) * 0.5, oy: (rand(g) - 0.5) * 0.5, tgt: 0, retarget: 0, hitT: 0, slow: 0, buff: 0,
  };
  g.goblins.push(gob);
  if (kind === 'warchief') { emit('boss', p.x, p.y); toast('The warchief has come!', 'bad'); }
}

// ---------- memories, mood, efficiency ----------
export function addMem(s: Settler, id: string) {
  const m = s.mem.find((m) => m.id === id);
  const ttl = MEMORIES[id]?.ttl ?? 100;
  if (m) m.t = ttl; else s.mem.push({ id, t: ttl });
}
export function addMemAll(g: Game, id: string) { for (const s of g.settlers) addMem(s, id); }

export function moodParts(g: Game, s: Settler): { label: string; v: number }[] {
  const out: { label: string; v: number }[] = [];
  if (s.traits.includes('cheerful')) out.push({ label: 'Cheerful', v: 8 });
  if (s.traits.includes('gloomy')) out.push({ label: 'Gloomy', v: -8 });
  if (hasRelic(g, 'banner')) out.push({ label: 'Banner of the Hold', v: 5 });
  for (const m of s.mem) { const d = MEMORIES[m.id]; if (d) out.push({ label: d.label, v: d.v }); }
  const n = s.needs;
  if (n.hunger < 30) out.push({ label: 'Hungry', v: -Math.min(12, Math.round((30 - n.hunger) / 2.5)) });
  if (n.rest < 25) out.push({ label: 'Exhausted', v: -Math.min(10, Math.round((25 - n.rest) / 2.5)) });
  if (n.warmth < 30) out.push({ label: 'Cold', v: -Math.min(10, Math.round((30 - n.warmth) / 3)) });
  if (n.safety < 35) out.push({ label: 'Scared', v: -Math.min(10, Math.round((35 - n.safety) / 3)) });
  if (s.hp < s.maxHp * 0.5) out.push({ label: 'Injured', v: -5 });
  return out;
}

export function mood(g: Game, s: Settler) {
  let m = MOOD.base;
  for (const p of moodParts(g, s)) m += p.v;
  return Math.max(0, Math.min(100, Math.round(m)));
}

export function efficiency(g: Game, s: Settler) {
  let e = 1;
  const n = s.needs;
  if (n.hunger < 25) e -= 0.25;
  if (n.rest < 25) e -= 0.25;
  if (n.warmth < 25) e -= 0.15;
  if (s.hp < s.maxHp * 0.5) e -= 0.3;
  if (s.sick > 0) e -= 0.4;
  const m = mood(g, s);
  if (m >= MOOD.inspiredAt) e += 0.2;
  else if (m < 25) e -= 0.15;
  if (s.traits.includes('diligent')) e += 0.15;
  if (s.traits.includes('lazy')) e -= 0.15;
  return Math.max(0.25, Math.min(1.4, e));
}

export function avgMood(g: Game) {
  if (!g.settlers.length) return 0;
  return Math.round(g.settlers.reduce((a, s) => a + mood(g, s), 0) / g.settlers.length);
}

/** What the settler is doing, in words, for the UI. */
export function activity(g: Game, s: Settler): string {
  if (s.away > 0) return 'Away on an errand';
  const t = s.task;
  if (!t) return 'Thinking';
  const b = t.id ? bld(g, t.id) : undefined;
  switch (t.k) {
    case 'eat': return 'Eating';
    case 'warm': return 'Warming up by the hearth';
    case 'sleep': return s.inside ? 'Sleeping' : 'Heading to bed';
    case 'build': return `Building ${b ? BUILD[b.kind].name.toLowerCase() : ''}`;
    case 'repair': return `Repairing ${b ? BUILD[b.kind].name.toLowerCase() : ''}`;
    case 'chop': return 'Chopping wood';
    case 'quarry': return 'Breaking stone';
    case 'forage': return 'Picking berries';
    case 'fish': return 'Fishing';
    case 'deliver': return `Hauling ${s.carryRes}`;
    case 'farm': return 'Farming';
    case 'trade': return 'Minding the stall';
    case 'tend': return 'Tending the sick';
    case 'train': return 'Drilling';
    case 'wander': return s.job === 'farmer' && season(g) === 'winter' ? 'Idle (fields frozen)' : 'Idling';
    case 'guard': return s.inside ? `Manning a ${b ? BUILD[b.kind].name.toLowerCase() : 'post'}` : 'On guard';
    case 'shelter': return s.inside ? 'Sheltering' : 'Running for shelter';
    case 'recover': return 'Recovering at the healer';
    case 'flee': return 'Fleeing!';
    case 'sulk': return 'Having a breakdown';
    default: return 'Walking';
  }
}

// ---------- movement ----------
function speedOf(g: Game, s: Settler) {
  let v = SETTLER_SPEED;
  if (s.traits.includes('nimble')) v *= 1.15;
  if (hasRelic(g, 'boots')) v *= 1.12;
  if (s.hp < s.maxHp * 0.5) v *= 0.75;
  if (s.needs.rest < 15) v *= 0.85;
  return v;
}

/** Walk along s.path. Returns true once the path is used up. */
function walkPath(g: Game, s: Settler, dt: number): boolean {
  if (!s.path.length) return true;
  const i = s.path[0];
  const tx = (i % MAP_W) + 0.5, ty = Math.floor(i / MAP_W) + 0.5;
  if (!settlerFree(g, tx - 0.5, ty - 0.5)) { s.path = []; s.task = null; return false; }
  const dx = tx - s.x, dy = ty - s.y;
  const d = Math.hypot(dx, dy);
  const step = speedOf(g, s) * dt;
  if (Math.abs(dx) > 0.02) s.face = dx > 0 ? 1 : -1;
  s.walk += dt * 8;
  if (d <= step) { s.x = tx; s.y = ty; s.path.shift(); return !s.path.length; }
  s.x += (dx / d) * step;
  s.y += (dy / d) * step;
  return false;
}

/** Straight-line move with wall sliding. */
function moveDirect(g: Game, e: { x: number; y: number; face: number; walk: number }, tx: number, ty: number, speed: number, dt: number, free: (g: Game, x: number, y: number) => boolean): boolean {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) return true;
  const step = Math.min(d, speed * dt);
  const nx = e.x + (dx / d) * step, ny = e.y + (dy / d) * step;
  if (Math.abs(dx) > 0.02) e.face = dx > 0 ? 1 : -1;
  e.walk += dt * 8;
  if (free(g, Math.floor(nx), Math.floor(ny))) { e.x = nx; e.y = ny; }
  else if (free(g, Math.floor(nx), Math.floor(e.y))) e.x = nx;
  else if (free(g, Math.floor(e.x), Math.floor(ny))) e.y = ny;
  // only count it as moving if we actually got closer
  return Math.hypot(tx - e.x, ty - e.y) < d - 1e-4;
}

function goTo(g: Game, s: Settler, tx: number, ty: number, tw = 0, th = 0): boolean {
  const p = findPath(g, Math.floor(s.x), Math.floor(s.y), tx, ty, tw, th);
  if (!p) return false;
  s.path = p;
  return true;
}

function goToBld(g: Game, s: Settler, b: Building) {
  const d = BUILD[b.kind];
  if (!d.solid || !b.done) {
    const tx = b.x + randInt(g, d.w), ty = b.y + randInt(g, d.h);
    return goTo(g, s, tx, ty) || goTo(g, s, b.x, b.y, d.w, d.h);
  }
  return goTo(g, s, b.x, b.y, d.w, d.h);
}

function enter(g: Game, s: Settler, b: Building) {
  s.inside = b.id;
  s.path = [];
  if (b.kind === 'tower' || b.kind === 'ballista') b.occupant = s.id;
}

function leave(g: Game, s: Settler) {
  if (!s.inside) return;
  const b = bld(g, s.inside);
  s.inside = 0;
  if (b) {
    if (b.occupant === s.id) b.occupant = 0;
    const d = BUILD[b.kind];
    const p = nearestFree(g, b.x + d.w / 2, b.y + d.h + 0.2);
    s.x = p.x; s.y = p.y;
  }
}

// ---------- settler AI ----------
const isNight = (g: Game) => g.phase === 'night';

function nearestGoblin(g: Game, x: number, y: number, r: number): Goblin | undefined {
  let best: Goblin | undefined, bd = r;
  for (const gb of g.goblins) {
    const d = Math.hypot(gb.x - x, gb.y - y);
    if (d < bd) { bd = d; best = gb; }
  }
  return best;
}

const crewed = (k: BuildKind) => k === 'tower' || k === 'ballista';

function guardSpot(g: Game, s: Settler): { b?: Building; x: number; y: number } {
  let b = s.post ? bld(g, s.post) : undefined;
  if (b && !b.done) b = undefined;
  if (b && s.job === 'archer' && crewed(b.kind) && b.occupant && b.occupant !== s.id) b = undefined;
  if (b && s.job !== 'archer' && b.kind !== 'flag') b = undefined;
  if (!b) {
    if (s.job === 'archer') {
      const free = (t: Building) => crewed(t.kind) && t.done && (!t.occupant || t.occupant === s.id) && !g.settlers.some((o) => o !== s && o.post === t.id && o.job === 'archer');
      // ballistas first (useless unmanned), then towers, nearest first
      const list = g.blds.filter(free).sort((a, c) => (a.kind === 'ballista' ? -1 : 0) - (c.kind === 'ballista' ? -1 : 0) || Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(c.x - s.x, c.y - s.y));
      b = list[0];
    }
    if (!b) {
      const flags = g.blds.filter((f) => f.kind === 'flag');
      if (flags.length) {
        const count = (f: Building) => g.settlers.filter((o) => o !== s && o.task?.k === 'guard' && o.task.id === f.id).length;
        flags.sort((a, c) => count(a) - count(c) || Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(c.x - s.x, c.y - s.y));
        b = flags[0];
      }
    }
  }
  if (b) return { b, x: b.x + 0.5, y: b.y + 0.5 };
  const kc = keepCenter(g);
  return { x: kc.x, y: kc.y + 2.2 };
}

function shoreTile(g: Game, s: Settler): number {
  let best = -1, bd = Infinity;
  const taken = new Set(g.settlers.filter((o) => o !== s && o.task?.k === 'fish').map((o) => idx(o.task!.tx!, o.task!.ty!)));
  for (let i = 0; i < g.terrain.length; i++) {
    const x = i % MAP_W, y = Math.floor(i / MAP_W);
    if (!settlerFree(g, x, y) || taken.has(i) || bldGrid[i]) continue;
    let wet = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inMap(x + dx, y + dy) && g.terrain[idx(x + dx, y + dy)] === T_WATER) wet = true;
    if (!wet) continue;
    const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function nearestResource(g: Game, s: Settler, t: number, k: Task['k']): number {
  let best = -1, bd = Infinity;
  const taken = new Set(g.settlers.filter((o) => o !== s && o.task?.k === k).map((o) => idx(o.task!.tx!, o.task!.ty!)));
  for (let i = 0; i < g.terrain.length; i++) {
    if (g.terrain[i] !== t || taken.has(i) || g.amount[i] <= 0) continue;
    const x = i % MAP_W, y = Math.floor(i / MAP_W);
    if (!(settlerFree(g, x + 1, y) || settlerFree(g, x - 1, y) || settlerFree(g, x, y + 1) || settlerFree(g, x, y - 1))) continue;
    const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

const GATHER: Job[] = ['woodcutter', 'quarrier', 'forager', 'fisher'];

function decide(g: Game, s: Settler) {
  const combat = JOBS[s.job].combat;
  const keep = bld(g, g.keepId)!;
  s.path = [];
  const set = (t: Task) => { s.task = t; };
  const kc = keepCenter(g);

  if (isNight(g) && !combat) {
    // builders keep walls standing if it's safe to reach them
    if (s.job === 'builder') {
      const hurt = g.blds.filter((b) => b.done && b.hp < b.maxHp * 0.85 && (b.kind === 'wall' || b.kind === 'stonewall' || b.kind === 'tower' || b.kind === 'ballista') && !nearestGoblin(g, b.x + 0.5, b.y + 0.5, 3.5));
      hurt.sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp);
      if (hurt[0] && goToBld(g, s, hurt[0])) return set({ k: 'repair', id: hurt[0].id });
    }
    const home = s.home ? bld(g, s.home) : undefined;
    const b = home ?? keep;
    if (goToBld(g, s, b)) return set({ k: 'shelter', id: b.id });
    return set({ k: 'flee', t: 2 });
  }
  if (combat && (isNight(g) || g.phase === 'dusk')) {
    const spot = guardSpot(g, s);
    if (spot.b && crewed(spot.b.kind) && s.job === 'archer') {
      if (goToBld(g, s, spot.b)) return set({ k: 'guard', id: spot.b.id });
    } else {
      const tx = Math.floor(spot.x + (rand(g) - 0.5) * 2), ty = Math.floor(spot.y + (rand(g) - 0.5) * 2);
      goTo(g, s, tx, ty) || goTo(g, s, Math.floor(spot.x), Math.floor(spot.y));
      return set({ k: 'guard', id: spot.b?.id ?? 0, tx: spot.x, ty: spot.y });
    }
  }
  const n = s.needs;
  if (n.hunger < NEEDS.eatAt && g.res.food >= 1 && goToBld(g, s, keep)) return set({ k: 'eat', id: keep.id, t: WORK.eat });
  if (n.warmth < NEEDS.warmAt && goToBld(g, s, keep)) return set({ k: 'warm', id: keep.id, t: 0 });
  if (n.rest < NEEDS.sleepAt || (combat && g.phase === 'day' && n.rest < 55) || (s.sick > 0 && n.rest < 70)) {
    const home = s.home ? bld(g, s.home) : undefined;
    const b = home ?? keep;
    if (goToBld(g, s, b)) return set({ k: 'sleep', id: b.id });
  }
  if (g.phase === 'night') return set({ k: 'wander', t: 2 });
  const sea = SEASONS[season(g)];

  // anyone still carrying goods from an old job drops them off first
  if (s.carry > 0 && !GATHER.includes(s.job) && goToBld(g, s, keep)) return set({ k: 'deliver', id: keep.id });

  switch (s.job) {
    case 'builder': {
      const sites = g.blds.filter((b) => !b.done);
      const hurt = g.blds.filter((b) => b.done && b.hp < b.maxHp && b.kind !== 'flag' && b.kind !== 'trap');
      const near = (list: Building[]) => list.sort((a, c) => distToBld(a, s.x, s.y) - distToBld(c, s.x, s.y))[0];
      const site = near(sites);
      if (site && goToBld(g, s, site)) return set({ k: 'build', id: site.id });
      const fix = near(hurt);
      if (fix && goToBld(g, s, fix)) return set({ k: 'repair', id: fix.id });
      break;
    }
    case 'woodcutter':
    case 'quarrier':
    case 'forager':
    case 'fisher': {
      if (s.carry >= WORK.carry) { if (goToBld(g, s, keep)) return set({ k: 'deliver', id: keep.id }); break; }
      if (s.job === 'fisher') {
        const sh = shoreTile(g, s);
        if (sh >= 0 && goTo(g, s, sh % MAP_W, Math.floor(sh / MAP_W))) return set({ k: 'fish', tx: sh % MAP_W, ty: Math.floor(sh / MAP_W), t: 0 });
      } else {
        const terr = s.job === 'woodcutter' ? T_TREE : s.job === 'quarrier' ? T_ROCK : T_BUSH;
        const k: Task['k'] = s.job === 'woodcutter' ? 'chop' : s.job === 'quarrier' ? 'quarry' : 'forage';
        const ok = s.job !== 'forager' || sea.berries > 0;
        const r = ok ? nearestResource(g, s, terr, k) : -1;
        if (r >= 0 && goTo(g, s, r % MAP_W, Math.floor(r / MAP_W), 1, 1)) return set({ k, tx: r % MAP_W, ty: Math.floor(r / MAP_W), t: 0 });
      }
      if (s.carry > 0 && goToBld(g, s, keep)) return set({ k: 'deliver', id: keep.id });
      break;
    }
    case 'farmer': {
      if (sea.farm <= 0) break;
      const farms = g.blds.filter((b) => b.kind === 'farm' && b.done && !g.settlers.some((o) => o !== s && o.task?.k === 'farm' && o.task.id === b.id));
      farms.sort((a, c) => distToBld(a, s.x, s.y) - distToBld(c, s.x, s.y));
      if (farms[0] && goToBld(g, s, farms[0])) return set({ k: 'farm', id: farms[0].id, t: 0 });
      break;
    }
    case 'trader': {
      const m = g.blds.find((b) => b.kind === 'market' && b.done);
      if (m && goToBld(g, s, m)) return set({ k: 'trade', id: m.id, t: 0 });
      break;
    }
    case 'healer': {
      const h = g.blds.find((b) => b.kind === 'healer' && b.done);
      const sick = g.settlers.find((o) => o !== s && (o.sick > 0 || o.hp < o.maxHp * 0.6) && !o.inside && o.away <= 0);
      if (sick && goTo(g, s, Math.floor(sick.x), Math.floor(sick.y))) return set({ k: 'tend', t: 8 });
      if (h && goToBld(g, s, h)) return set({ k: 'tend', id: h.id, t: 10 });
      break;
    }
    case 'militia':
    case 'archer':
    case 'shieldbearer': {
      if (goTo(g, s, Math.floor(kc.x - 2 + rand(g) * 4), Math.floor(kc.y + 2 + rand(g) * 2))) return set({ k: 'train', t: 6 + rand(g) * 4 });
      break;
    }
  }
  // idle: drift around the keep
  for (let i = 0; i < 4; i++) {
    const tx = Math.floor(kc.x + (rand(g) - 0.5) * 10), ty = Math.floor(kc.y + (rand(g) - 0.5) * 8);
    if (inMap(tx, ty) && settlerFree(g, tx, ty) && goTo(g, s, tx, ty)) return set({ k: 'wander', t: 2 + rand(g) * 3 });
  }
  set({ k: 'wander', t: 2 });
}

function gatherRate(g: Game, s: Settler) {
  let r = efficiency(g, s);
  if (s.traits.includes('strong') && (s.job === 'woodcutter' || s.job === 'quarrier')) r *= 1.25;
  if (hasRelic(g, 'axeheads') && (s.job === 'woodcutter' || s.job === 'quarrier')) r *= 1.3;
  if (hasBuff(g, 'wolves') && s.job === 'woodcutter') r *= 0.5;
  return r;
}

function cropMult(g: Game, s: Settler) {
  let m = 1;
  if (s.traits.includes('green')) m *= 1.3;
  if (hasRelic(g, 'seeds')) m *= 1.25;
  return m;
}

function runTask(g: Game, s: Settler, dt: number) {
  const t = s.task!;
  if (!walkPath(g, s, dt)) return;
  if (!s.task) return; // path broke
  const eff = efficiency(g, s);
  const b = t.id ? bld(g, t.id) : undefined;
  const sea = SEASONS[season(g)];
  switch (t.k) {
    case 'eat':
      t.t! -= dt;
      if (t.t! <= 0) {
        if (g.res.food >= 1) { g.res.food = Math.max(0, g.res.food - MEAL); s.needs.hunger = 100; addMem(s, 'meal'); s.mem = s.mem.filter((m) => m.id !== 'starving'); }
        s.task = null;
      }
      break;
    case 'warm':
      if (s.needs.warmth >= 90 || (isNight(g) && !JOBS[s.job].combat)) s.task = null;
      break;
    case 'sleep':
    case 'shelter':
    case 'recover':
      if (!b) { s.task = null; break; }
      if (!s.inside) enter(g, s, b);
      if (t.k === 'sleep' && (s.needs.rest >= 96 || (g.phase !== 'day' && JOBS[s.job].combat))) {
        addMem(s, b.kind === 'keep' ? 'floor' : 'bed');
        if (b.kind === 'barracks') addMem(s, 'barracks');
        leave(g, s);
        s.task = null;
      }
      break;
    case 'build':
      if (!b || b.done) { s.task = null; break; }
      b.progress += WORK.build * eff * dt;
      b.hp = Math.min(b.maxHp, Math.max(b.hp, b.maxHp * (b.progress / BUILD[b.kind].work)));
      if (Math.random() < dt * 2.5) emit('hammer', b.x + 0.5, b.y + 0.5);
      if (b.progress >= BUILD[b.kind].work) finishBuilding(g, b, s);
      break;
    case 'repair':
      if (!b || b.hp >= b.maxHp || (isNight(g) && nearestGoblin(g, b.x + 0.5, b.y + 0.5, 2.5))) { s.task = null; break; }
      b.hp = Math.min(b.maxHp, b.hp + WORK.repair * eff * dt);
      if (Math.random() < dt * 2) emit('hammer', b.x + 0.5, b.y + 0.5);
      break;
    case 'chop':
    case 'quarry':
    case 'forage': {
      const i = idx(t.tx!, t.ty!);
      const terr = t.k === 'chop' ? T_TREE : t.k === 'quarry' ? T_ROCK : T_BUSH;
      if (g.terrain[i] !== terr || g.amount[i] <= 0 || (t.k === 'forage' && sea.berries <= 0)) { s.task = null; break; }
      s.face = t.tx! + 0.5 > s.x ? 1 : -1;
      const rate = t.k === 'forage' ? eff * cropMult(g, s) : gatherRate(g, s);
      t.t! += dt * rate;
      const swing = t.k === 'chop' ? WORK.chop : t.k === 'quarry' ? WORK.quarry : WORK.forage;
      if (t.t! >= swing) {
        t.t = 0;
        const per = t.k === 'chop' ? WORK.chopYield : t.k === 'quarry' ? WORK.quarryYield : 1;
        const got = Math.min(per, g.amount[i]);
        g.amount[i] -= got;
        s.carry += got;
        s.carryRes = t.k === 'chop' ? 'wood' : t.k === 'quarry' ? 'stone' : 'food';
        emit(t.k === 'chop' ? 'chop' : t.k === 'quarry' ? 'pick' : 'pluck', t.tx! + 0.5, t.ty! + 0.5);
        if (g.amount[i] <= 0 && t.k !== 'forage') {
          g.terrain[i] = T_GRASS;
          computeFlow(g);
          emit(t.k === 'chop' ? 'fell' : 'crumble', t.tx! + 0.5, t.ty! + 0.5);
        }
        if (s.carry >= WORK.carry || g.amount[i] <= 0) s.task = null;
      }
      break;
    }
    case 'fish': {
      t.t! += dt * eff;
      const wx = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => inMap(t.tx! + dx, t.ty! + dy) && g.terrain[idx(t.tx! + dx, t.ty! + dy)] === T_WATER);
      if (wx && wx[0]) s.face = wx[0];
      if (t.t! >= WORK.fish) {
        t.t = 0;
        s.carry += 1;
        s.carryRes = 'food';
        emit('splash', t.tx! + 0.5 + (wx?.[0] ?? 0), t.ty! + 0.5 + (wx?.[1] ?? 0));
        if (s.carry >= 3) s.task = null;
      }
      break;
    }
    case 'deliver':
      if (s.carry) {
        g.res[s.carryRes] += s.carry;
        floater(g, s.x, s.y - 0.8, `+${s.carry} ${s.carryRes}`, s.carryRes === 'wood' ? '#d9a066' : s.carryRes === 'stone' ? '#c8ccd2' : '#e8d070');
      }
      s.carry = 0;
      s.task = null;
      break;
    case 'farm':
      if (!b || g.phase === 'night' || sea.farm <= 0 || needsBreak(g, s)) { s.task = null; break; }
      t.t! += dt * eff * sea.farm * cropMult(g, s) / (1 + upStat(b, 'rate'));
      s.walk += dt * 2;
      if (t.t! >= WORK.farm) {
        t.t = 0;
        g.res.food += 1;
        floater(g, s.x, s.y - 0.8, '+1 food', '#e8d070');
        emit('harvest', s.x, s.y);
        if (rand(g) < 0.4) { const d = BUILD.farm; goTo(g, s, b.x + randInt(g, d.w), b.y + randInt(g, d.h)); }
      }
      break;
    case 'trade':
      if (!b || g.phase === 'night' || needsBreak(g, s)) { s.task = null; break; }
      t.t! += dt * eff;
      if (Math.random() < dt * 0.4) s.face = -s.face;
      if (t.t! >= WORK.traderGold) { t.t = 0; g.res.gold += 1; floater(g, s.x, s.y - 0.8, '+1g', '#ffd166'); emit('coin', s.x, s.y); }
      break;
    case 'tend':
      t.t! -= dt;
      if (t.t! <= 0) s.task = null;
      break;
    case 'train':
      t.t! -= dt;
      s.xp += dt * 0.01 * (bld(g, s.home)?.kind === 'barracks' ? 2 : 1);
      if (Math.random() < dt * 0.8) s.face = -s.face;
      if (t.t! <= 0) s.task = null;
      break;
    case 'wander':
      t.t! -= dt;
      if (t.t! <= 0) s.task = null;
      break;
    case 'sulk':
      t.t! -= dt;
      if (Math.random() < dt * 0.6) {
        const tx = Math.floor(s.x + (rand(g) - 0.5) * 6), ty = Math.floor(s.y + (rand(g) - 0.5) * 6);
        if (inMap(tx, ty) && settlerFree(g, tx, ty)) goTo(g, s, tx, ty);
      }
      if (t.t! <= 0) { s.task = null; addMem(s, 'relief'); s.lowT = 0; toast(`${s.name} pulled themselves together.`); }
      break;
    case 'flee':
      t.t! -= dt;
      if (t.t! <= 0) s.task = null;
      break;
    case 'guard':
      guard(g, s, dt, b);
      break;
    default:
      s.task = null;
  }
}

function needsBreak(g: Game, s: Settler) {
  const n = s.needs;
  return (n.hunger < NEEDS.eatAt && g.res.food >= 1) || n.rest < NEEDS.sleepAt || n.warmth < NEEDS.warmAt;
}

function fleeAt(g: Game, s: Settler) {
  if (s.traits.includes('brave')) return 0.08;
  if (promoOf(s) === 'veteran') return 0.15;
  return Math.max(0.1, Math.min(0.5, 0.55 - mood(g, s) / 200));
}

function dmgMult(g: Game, s: Settler) {
  let m = 1 + Math.min(0.3, s.xp * 0.02);
  if (s.traits.includes('strong') && s.job !== 'archer') m *= 1.25;
  if (mood(g, s) >= MOOD.inspiredAt) m *= 1.15;
  if (hasRelic(g, 'warhorn')) m *= 1.25;
  if (bld(g, s.home)?.kind === 'barracks') m *= 1.15;
  const p = promoOf(s);
  if (p === 'berserker') m *= 1.3;
  if (p === 'marksman') m *= 1.25;
  return m;
}

function guard(g: Game, s: Settler, dt: number, b: Building | undefined) {
  const t = s.task!;
  if (g.phase === 'day') { if (s.inside) leave(g, s); s.task = null; return; }
  if (b && crewed(b.kind) && s.job === 'archer') {
    if (!b.done) { s.task = null; return; }
    if (s.inside !== b.id) {
      if (b.occupant && b.occupant !== s.id) { s.task = null; return; }
      if (s.inside) leave(g, s);
      enter(g, s, b);
    }
    return;
  }
  const hx = t.tx ?? s.x, hy = t.ty ?? s.y;
  if (s.job === 'archer') {
    const tgt = nearestGoblin(g, s.x, s.y, ARCHER.range + (s.traits.includes('sharp') ? 1 : 0) + (hasRelic(g, 'spyglass') ? 1 : 0) + (promoOf(s) === 'marksman' ? 1.5 : 0));
    s.cool -= dt;
    if (tgt) {
      s.face = tgt.x > s.x ? 1 : -1;
      if (s.cool <= 0) { s.cool = ARCHER.rate * (promoOf(s) === 'volley' ? 0.75 : 1); fire(g, 'arrow', s.x, s.y - 0.4, 'g', tgt.id, ARCHER.dmg * dmgMult(g, s), undefined, s.id); }
    } else if (Math.hypot(hx - s.x, hy - s.y) > 1.5) moveDirect(g, s, hx, hy, speedOf(g, s), dt, settlerFree);
    return;
  }
  // militia & shieldbearers: engage anything near the post, and answer the alarm when goblins reach the hold
  const kc = keepCenter(g);
  const tgt = nearestGoblin(g, hx, hy, MILITIA.leash + 0.5) ?? nearestGoblin(g, kc.x, kc.y, 9.5);
  const st = s.job === 'shieldbearer' ? SHIELD : MILITIA;
  s.cool -= dt;
  if (tgt) {
    const d = Math.hypot(tgt.x - s.x, tgt.y - s.y);
    if (d > st.range) moveDirect(g, s, tgt.x, tgt.y, speedOf(g, s), dt, settlerFree);
    else {
      s.face = tgt.x > s.x ? 1 : -1;
      if (s.cool <= 0) {
        s.cool = st.rate * (promoOf(s) === 'berserker' ? 0.8 : 1);
        hitGoblin(g, tgt, st.dmg * dmgMult(g, s), s);
        emit('slash', tgt.x, tgt.y);
      }
    }
  } else if (Math.hypot(hx - s.x, hy - s.y) > 1.2) {
    if (!moveDirect(g, s, hx, hy, speedOf(g, s), dt, settlerFree)) { s.task = null; }
  }
}

function finishBuilding(g: Game, b: Building, by?: Settler) {
  b.done = true;
  b.progress = BUILD[b.kind].work;
  b.hp = b.maxHp;
  rebuild(g);
  if (BUILD[b.kind].solid && b.kind !== 'wall') {
    for (const s of g.settlers) if (!s.inside && bldAtTile(g, Math.floor(s.x), Math.floor(s.y))?.id === b.id) { const p = nearestFree(g, s.x, s.y + 1); s.x = p.x; s.y = p.y; s.path = []; }
  }
  if (bedsOf(b)) assignHomes(g);
  if (by) addMem(by, 'built');
  if (b.kind !== 'wall' && b.kind !== 'stonewall' && b.kind !== 'trap') { emit('built', b.x + 0.5, b.y + 0.5); toast(`${BUILD[b.kind].name} finished.`); }
  if (by) by.task = null;
}

// ---------- combat ----------
function fire(g: Game, kind: 'arrow' | 'bolt' | 'stone' | 'heavy' | 'spell', x: number, y: number, tt: 'g' | 's' | 'b', tid: number, dmg: number, tids?: number[], src?: number) {
  let ex = x, ey = y;
  if (tt === 'g') { const t = g.goblins.find((q) => q.id === tid); if (t) { ex = t.x; ey = t.y - 0.3; } }
  else if (tt === 's') { const t = g.settlers.find((q) => q.id === tid); if (t) { ex = t.x; ey = t.y - 0.3; } }
  else { const t = bld(g, tid); if (t) { const d = BUILD[t.kind]; ex = t.x + d.w / 2; ey = t.y + d.h / 2; } }
  const dist = Math.hypot(ex - x, ey - y);
  const v = kind === 'stone' ? 8 : kind === 'spell' ? 7 : kind === 'heavy' ? 16 : 14;
  g.shots.push({ kind, x, y, sx: x, sy: y, tt, tid, tids, src, dmg, t: 0, dur: Math.max(0.08, dist / v), ex, ey });
  emit(kind === 'stone' ? 'sling' : kind === 'heavy' ? 'ballista' : kind === 'spell' ? 'spell' : 'twang', x, y);
}

function hitGoblin(g: Game, gb: Goblin, dmg: number, by?: Settler) {
  if (!g.goblins.includes(gb)) return;
  gb.hp -= dmg;
  gb.hitT = 0.15;
  if (gb.hp <= 0) {
    g.goblins = g.goblins.filter((q) => q !== gb);
    let gold = Math.max(1, Math.round(GOBS[gb.kind].gold * Math.max(0.6, 1 - 0.01 * (g.day - 15)))) + (hasRelic(g, 'horseshoe') ? 1 : 0);
    if (hasRelic(g, 'idol') && rand(g) < 0.25) gold *= 2;
    if (hasBuff(g, 'drums')) gold *= 2;
    g.res.gold += gold;
    g.night.kills++;
    g.night.gold += gold;
    g.stats.kills++;
    floater(g, gb.x, gb.y - 0.8, `+${gold}g`, '#ffd166');
    emit(gb.kind === 'warchief' ? 'bossdie' : 'gobdie', gb.x, gb.y);
    if (gb.kind === 'warchief') { g.stats.bosses++; addMemAll(g, 'boss'); toast('The warchief is slain!', 'good'); }
    if (by) { by.xp += 1; const h = (g.night.heroes ??= {}); h[by.name] = (h[by.name] ?? 0) + 1; }
  }
}

function hitSettler(g: Game, s: Settler, dmg: number) {
  if (s.inside || s.away > 0) return;
  // shieldbearers cover people standing beside them
  if (s.job !== 'shieldbearer') {
    let cut = 0;
    for (const o of g.settlers) {
      if (o.job !== 'shieldbearer' || o.inside || o.away > 0) continue;
      const p = promoOf(o);
      if (Math.hypot(o.x - s.x, o.y - s.y) < SHIELD.guard + (p === 'bulwark' ? 1 : 0)) cut = Math.max(cut, p === 'warden' ? 0.4 : SHIELD.cut);
    }
    dmg *= 1 - cut;
  }
  s.hp -= dmg;
  s.hitT = 0.15;
  s.needs.safety = Math.max(0, s.needs.safety - (s.traits.includes('brave') ? 5 : 12));
  addMem(s, 'hurt');
  if (!g.night.hurt.includes(s.name)) g.night.hurt.push(s.name);
  emit('hurt', s.x, s.y);
  if (s.hp <= 0) downOrKill(g, s);
}

function downOrKill(g: Game, s: Settler) {
  const h = g.blds.find((b) => b.kind === 'healer' && b.done && g.settlers.filter((o) => o.inside === b.id).length < HEALER_BEDS);
  if (h) {
    s.hp = 1;
    if (s.inside) leave(g, s);
    s.inside = h.id;
    s.task = { k: 'recover', id: h.id };
    s.path = [];
    addMem(s, 'rescued');
    g.night.rescued.push(s.name);
    toast(`${s.name} went down and was carried to the healer.`, 'warn');
    emit('rescue', s.x, s.y);
    return;
  }
  killSettler(g, s);
}

export function killSettler(g: Game, s: Settler, why = 'has fallen') {
  g.settlers = g.settlers.filter((q) => q !== s);
  for (const b of g.blds) if (b.occupant === s.id) b.occupant = 0;
  for (const o of g.settlers) addMem(o, 'loss');
  g.night.lost.push(s.name);
  (g.fallen ??= []).push(s.name);
  toast(`${s.name} ${why}.`, 'bad');
  emit('death', s.x, s.y);
  assignHomes(g);
}

function hitBuilding(g: Game, b: Building, dmg: number, byGob = true) {
  if (!g.blds.includes(b)) return;
  if (byGob && g.wave.omen === 'torches' && g.phase === 'night') dmg *= 2;
  b.hp -= dmg;
  b.hitT = 0.12;
  if (Math.random() < 0.5) emit(b.kind === 'keep' ? 'keephit' : 'thud', b.x + 0.5, b.y + 0.5);
  if (b.hp <= 0) destroyBuilding(g, b, true);
}

function destroyBuilding(g: Game, b: Building, byGoblins: boolean) {
  g.blds = g.blds.filter((q) => q !== b);
  for (const s of g.settlers) {
    if (s.inside === b.id) { s.inside = 0; const d = BUILD[b.kind]; const p = nearestFree(g, b.x + d.w / 2, b.y + d.h / 2); s.x = p.x; s.y = p.y; s.task = null; }
    if (s.home === b.id) { s.home = 0; if (byGoblins) addMem(s, 'homeless'); }
    if (s.post === b.id) s.post = 0;
    if (s.task?.id === b.id) s.task = null;
  }
  rebuild(g);
  assignHomes(g);
  if (byGoblins) {
    g.night.buildingsLost++;
    if (b.kind !== 'trap') for (const s of g.settlers) s.needs.safety = Math.max(0, s.needs.safety - 8);
    emit('collapse', b.x + BUILD[b.kind].w / 2, b.y + BUILD[b.kind].h / 2);
    if (b.kind !== 'wall' && b.kind !== 'stonewall' && b.kind !== 'trap') toast(`The goblins wrecked a ${BUILD[b.kind].name.toLowerCase()}!`, 'bad');
  }
  if (b.id === g.keepId) gameOver(g, 'The keep has fallen.');
}

function gobDmg(gb: Goblin) { return GOBS[gb.kind].dmg * (gb.buff > 0 ? 1.3 : 1); }
let omenNow: string | undefined;
function gobSpeed(gb: Goblin) { if ((gb.root ?? 0) > 0) return 0; return (omenNow === 'ironhide' ? 0.75 : omenNow === 'bloodmoon' ? 1.25 : 1) * GOBS[gb.kind].speed * (gb.slow > 0 ? BRAZIER.slow : 1) * (gb.buff > 0 ? 1.25 : 1); }

function visibleSettlers(g: Game) { return g.settlers.filter((s) => !s.inside && s.away <= 0); }

const flowAt = (gb: Goblin) => flow[idx(Math.floor(gb.x), Math.floor(gb.y))] ?? 999;

function updateGoblin(g: Game, gb: Goblin, dt: number) {
  const d = GOBS[gb.kind];
  gb.cool -= dt;
  gb.retarget -= dt;
  gb.hitT = Math.max(0, gb.hitT - dt);
  gb.slow = Math.max(0, gb.slow - dt);
  if (gb.root) gb.root = Math.max(0, gb.root - dt);
  gb.buff = Math.max(0, gb.buff - dt);
  const keep = bld(g, g.keepId);
  if (!keep) return;
  // traps
  const tb = bldAtTile(g, Math.floor(gb.x), Math.floor(gb.y));
  if (tb && tb.kind === 'trap' && tb.done && !tb.sprung) {
    tb.sprung = true;
    emit('trap', tb.x + 0.5, tb.y + 0.5);
    gb.root = 1.5;
    hitGoblin(g, gb, TRAP_DMG);
    if (!g.goblins.includes(gb)) return;
  }
  const speed = gobSpeed(gb);
  const vis = visibleSettlers(g);

  if (gb.kind === 'warchief') for (const o of g.goblins) if (o !== gb && Math.hypot(o.x - gb.x, o.y - gb.y) < 4) o.buff = 0.5;

  if (gb.kind === 'shaman') {
    // heal the most hurt goblin nearby, or hex a settler; keep behind the pack
    if (gb.cool <= 0) {
      const hurt = g.goblins.filter((o) => o !== gb && o.hp < o.maxHp && Math.hypot(o.x - gb.x, o.y - gb.y) < 4).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (hurt) { gb.cool = d.rate; hurt.hp = Math.min(hurt.maxHp, hurt.hp + 6); emit('heal', hurt.x, hurt.y); floater(g, hurt.x, hurt.y - 0.9, '+6', '#9cf07a'); return; }
      const near = vis.find((s) => Math.hypot(s.x - gb.x, s.y - gb.y) < d.range);
      if (near) { gb.cool = d.rate; fire(g, 'spell', gb.x, gb.y - 0.5, 's', near.id, d.dmg); }
    }
    const others = g.goblins.filter((o) => o.kind !== 'shaman');
    const lead = others.sort((a, b) => flowAt(a) - flowAt(b))[0];
    if (lead && flowAt(gb) < flowAt(lead) + 2.5) return; // wait for the pack to get ahead
    flowStep(g, gb, dt, speed);
    return;
  }

  if (gb.kind === 'sapper') {
    // run for the nearest wall or tower and blow it up
    if (gb.retarget <= 0) {
      gb.retarget = 1;
      let best = 0, bd = 14;
      for (const b of g.blds) {
        if (!b.done || !['wall', 'stonewall', 'tower', 'ballista', 'brazier'].includes(b.kind)) continue;
        const dd = distToBld(b, gb.x, gb.y);
        if (dd < bd) { bd = dd; best = b.id; }
      }
      gb.tgt = best;
    }
    const tb2 = (gb.tgt ? bld(g, gb.tgt) : undefined) ?? keep;
    if (distToBld(tb2, gb.x, gb.y) <= d.range) { explode(g, gb, tb2); return; }
    const nb = nextBlock(g, gb);
    if (nb) { explode(g, gb, nb); return; }
    if (gb.tgt) {
      const bd = BUILD[tb2.kind];
      const tx = Math.max(tb2.x, Math.min(tb2.x + bd.w, gb.x)), ty = Math.max(tb2.y, Math.min(tb2.y + bd.h, gb.y));
      if (distToBld(tb2, gb.x, gb.y) < 5 && moveDirect(g, gb, tx, ty, speed, dt, gobFree)) return;
    }
    flowStep(g, gb, dt, speed);
    return;
  }

  if (gb.kind === 'slinger') {
    let near: Settler | undefined, nd = 6.5;
    for (const s of vis) { const dd = Math.hypot(s.x - gb.x, s.y - gb.y); if (dd < nd) { nd = dd; near = s; } }
    if (near) {
      gb.face = near.x > gb.x ? 1 : -1;
      if (nd < 2.6) moveDirect(g, gb, gb.x - (near.x - gb.x), gb.y - (near.y - gb.y), speed, dt, gobFree);
      else if (nd > d.range) { if (!moveDirect(g, gb, near.x, near.y, speed, dt, gobFree)) flowStep(g, gb, dt, speed); }
      if (nd <= d.range && gb.cool <= 0) { gb.cool = d.rate; fire(g, 'stone', gb.x, gb.y - 0.4, 's', near.id, gobDmg(gb)); }
      return;
    }
    if (distToBld(keep, gb.x, gb.y) <= d.range - 0.5) {
      if (gb.cool <= 0) { gb.cool = d.rate; fire(g, 'stone', gb.x, gb.y - 0.4, 'b', keep.id, gobDmg(gb)); }
      return;
    }
    flowStep(g, gb, dt, speed);
    return;
  }

  if (gb.kind === 'wolfrider') {
    let prey: Settler | undefined, pd = 5;
    for (const s of vis) { const dd = Math.hypot(s.x - gb.x, s.y - gb.y); if (dd < pd) { pd = dd; prey = s; } }
    if (prey && pd > d.range && moveDirect(g, gb, prey.x, prey.y, speed, dt, gobFree)) return;
  }
  // melee: scrapper, brute, warchief. Shieldbearers draw them in; anyone in reach gets hit.
  let near: Settler | undefined, nd = d.range;
  const taunt = vis.find((s) => s.job === 'shieldbearer' && Math.hypot(s.x - gb.x, s.y - gb.y) < SHIELD.taunt + (promoOf(s) === 'warden' ? 1.5 : 0));
  if (taunt) {
    const dd = Math.hypot(taunt.x - gb.x, taunt.y - gb.y);
    if (dd > d.range) { if (moveDirect(g, gb, taunt.x, taunt.y, speed, dt, gobFree)) return; }
    else near = taunt;
  }
  if (!near) for (const s of vis) { const dd = Math.hypot(s.x - gb.x, s.y - gb.y); if (dd < nd) { nd = dd; near = s; } }
  if (near) {
    gb.face = near.x > gb.x ? 1 : -1;
    if (gb.cool <= 0) {
      gb.cool = d.rate;
      hitSettler(g, near, gobDmg(gb));
      emit(gb.kind === 'scrapper' ? 'slash' : 'smash', near.x, near.y);
      if (gb.kind !== 'scrapper' && near.job !== 'shieldbearer') {
        // brutes shove people aside
        const ax = near.x - gb.x, ay = near.y - gb.y, al = Math.hypot(ax, ay) || 1;
        moveDirect(g, near, near.x + (ax / al) * 0.8, near.y + (ay / al) * 0.8, 20, 0.05, settlerFree);
      }
    }
    return;
  }
  if (gb.kind === 'scrapper') {
    if (gb.retarget <= 0) {
      gb.retarget = 0.6;
      let best = 0, bd = 4.5;
      for (const b of g.blds) {
        if (b.kind === 'wall' || b.kind === 'stonewall' || b.kind === 'flag' || b.kind === 'trap') continue;
        const dd = distToBld(b, gb.x, gb.y);
        if (dd < bd) { bd = dd; best = b.id; }
      }
      gb.tgt = best;
    }
    const tb2 = gb.tgt ? bld(g, gb.tgt) : undefined;
    if (tb2) {
      if (distToBld(tb2, gb.x, gb.y) <= d.range * 0.8) {
        if (gb.cool <= 0) { gb.cool = d.rate; hitBuilding(g, tb2, gobDmg(gb)); }
        return;
      }
      const bd = BUILD[tb2.kind];
      const tx = Math.max(tb2.x, Math.min(tb2.x + bd.w, gb.x)), ty = Math.max(tb2.y, Math.min(tb2.y + bd.h, gb.y));
      if (moveDirect(g, gb, tx, ty, speed, dt, gobFree)) return;
      gb.tgt = 0;
      gb.retarget = 2;
    }
  }
  flowStep(g, gb, dt, speed);
}

function nextBlock(g: Game, gb: Goblin): Building | undefined {
  const i = idx(Math.floor(gb.x), Math.floor(gb.y));
  const next = flowNext[i];
  if (next < 0) return undefined;
  const nb = bldGrid[next] ? bld(g, bldGrid[next]) : undefined;
  return nb && nb.done && BUILD[nb.kind].solid && distToBld(nb, gb.x, gb.y) < 0.9 ? nb : undefined;
}

function explode(g: Game, gb: Goblin, b: Building) {
  g.goblins = g.goblins.filter((q) => q !== gb);
  hitBuilding(g, b, GOBS.sapper.dmg * (b.kind === 'keep' ? 0.6 : 1));
  for (const s of visibleSettlers(g)) if (Math.hypot(s.x - gb.x, s.y - gb.y) < 1.6) hitSettler(g, s, 12);
  emit('boom', gb.x, gb.y);
}

function flowStep(g: Game, gb: Goblin, dt: number, speed: number) {
  const d = GOBS[gb.kind];
  const i = idx(Math.floor(gb.x), Math.floor(gb.y));
  const keep = bld(g, g.keepId)!;
  const next = flowNext[i];
  if (flow[i] === Infinity || next < 0) {
    if (flow[i] === 0 || distToBld(keep, gb.x, gb.y) < Math.max(d.range, 0.9)) { if (gb.cool <= 0) { gb.cool = d.rate; hitBuilding(g, keep, gobDmg(gb)); } return; }
    const kc = keepCenter(g);
    moveDirect(g, gb, kc.x, kc.y, speed, dt, gobFree);
    return;
  }
  const nb = bldGrid[next] ? bld(g, bldGrid[next]) : undefined;
  if (nb && nb.done && BUILD[nb.kind].solid) {
    const dist = distToBld(nb, gb.x, gb.y);
    gb.face = nb.x + 0.5 > gb.x ? 1 : -1;
    if (dist <= d.range || gb.kind !== 'slinger') {
      if (gb.cool <= 0 && dist <= Math.max(d.range, 0.9)) {
        gb.cool = d.rate;
        if (gb.kind === 'slinger') fire(g, 'stone', gb.x, gb.y - 0.4, 'b', nb.id, gobDmg(gb));
        else { hitBuilding(g, nb, gobDmg(gb) * ((gb.kind === 'brute' || gb.kind === 'warchief') && (nb.kind === 'wall' || nb.kind === 'stonewall') ? 1.5 : 1)); if (nb.kind === 'wall' && (nb.level ?? 0) > 0) hitGoblin(g, gb, 2); }
      }
      if (dist > 0.6 && gb.kind !== 'slinger') moveDirect(g, gb, (next % MAP_W) + 0.5, Math.floor(next / MAP_W) + 0.5, speed, dt, gobFree);
      return;
    }
  }
  const tx = (next % MAP_W) + 0.5 + gb.ox, ty = Math.floor(next / MAP_W) + 0.5 + gb.oy;
  if (!moveDirect(g, gb, tx, ty, speed, dt, gobFree)) moveDirect(g, gb, (next % MAP_W) + 0.5, Math.floor(next / MAP_W) + 0.5, speed, dt, gobFree);
}

function towerRange(g: Game, base: number, occ?: Settler) {
  return base + (occ?.traits.includes('sharp') ? 1 : 0) + (hasRelic(g, 'spyglass') ? 1 : 0) + (occ && promoOf(occ) === 'marksman' ? 1.5 : 0);
}

function updateDefense(g: Game, b: Building, dt: number) {
  if (!b.done) return;
  b.cool -= dt;
  if (b.kind === 'keep') {
    if (b.cool > 0) return;
    const L = KEEP_LEVELS[b.level ?? 0];
    const t = nearestGoblin(g, b.x + 1.5, b.y + 1.5, L.range + (hasRelic(g, 'spyglass') ? 1 : 0));
    if (t) { b.cool = L.rate; fire(g, (b.level ?? 0) > 0 ? 'arrow' : 'bolt', b.x + 1.5, b.y + 0.8, 'g', t.id, L.dmg); }
    return;
  }
  if (b.kind === 'brazier') {
    if (!b.lit || !isNight(g)) return;
    const tick = b.cool <= 0;
    if (tick) b.cool = 0.5;
    for (const gb of [...g.goblins]) if (Math.hypot(gb.x - b.x - 0.5, gb.y - b.y - 0.5) < BRAZIER.range + upStat(b, 'range')) { gb.slow = 0.3; if (tick) hitGoblin(g, gb, BRAZIER.dps * 0.5 * (1 + upStat(b, 'dmg'))); }
    return;
  }
  if (!crewed(b.kind)) return;
  const occ = b.occupant ? g.settlers.find((s) => s.id === b.occupant && s.inside === b.id) : undefined;
  if (b.occupant && !occ) b.occupant = 0;
  if (b.cool > 0) return;
  const cx = b.x + 0.5, cy = b.y + 0.2;
  if (b.kind === 'ballista') {
    const range = towerRange(g, BALLISTA.range, occ);
    const tgt = nearestGoblin(g, cx, cy + 0.3, range);
    if (!tgt) return;
    // pierce: everything along the line toward the target
    const dx = tgt.x - cx, dy = tgt.y - cy, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const hits = g.goblins.map((o) => { const px = o.x - cx, py = o.y - cy; const along = px * ux + py * uy; const off = Math.abs(px * uy - py * ux); return { o, along, off }; })
      .filter((h) => h.along > 0 && h.along < range + 1 && h.off < 0.7).sort((a, c) => a.along - c.along).slice(0, BALLISTA.pierce + upStat(b, 'pierce')).map((h) => h.o.id);
    b.cool = (occ ? BALLISTA.rate * (promoOf(occ) === 'volley' ? 0.75 : 1) : BALLISTA.rate / BALLISTA.idleRate) * (1 + upStat(b, 'rate'));
    fire(g, 'heavy', cx, cy - 0.3, 'g', tgt.id, BALLISTA.dmg * (occ ? dmgMult(g, occ) : 1), hits, occ?.id);
    return;
  }
  const range = towerRange(g, TOWER.range, occ) + upStat(b, 'range');
  const tgt = nearestGoblin(g, cx, cy + 0.3, range);
  if (!tgt) return;
  if (occ) {
    b.cool = TOWER.rate / (mood(g, occ) >= MOOD.inspiredAt ? 1.15 : 1) * (promoOf(occ) === 'volley' ? 0.75 : 1) * (1 + upStat(b, 'rate'));
    fire(g, 'arrow', cx, cy - 0.6, 'g', tgt.id, TOWER.dmg * dmgMult(g, occ) * (1 + upStat(b, 'dmg')), undefined, occ.id);
  } else {
    b.cool = TOWER.idleRate;
    fire(g, 'bolt', cx, cy - 0.4, 'g', tgt.id, TOWER.idleDmg * (1 + upStat(b, 'dmg')));
  }
}

function updateShots(g: Game, dt: number) {
  for (const sh of g.shots) {
    sh.t += dt;
    if (sh.tt === 'g' && sh.kind !== 'heavy') { const t = g.goblins.find((q) => q.id === sh.tid); if (t) { sh.ex = t.x; sh.ey = t.y - 0.3; } }
    else if (sh.tt === 's') { const t = g.settlers.find((q) => q.id === sh.tid); if (t && !t.inside) { sh.ex = t.x; sh.ey = t.y - 0.3; } }
    const k = Math.min(1, sh.t / sh.dur);
    sh.x = sh.sx + (sh.ex - sh.sx) * k;
    sh.y = sh.sy + (sh.ey - sh.sy) * k;
  }
  const done = g.shots.filter((s) => s.t >= s.dur);
  g.shots = g.shots.filter((s) => s.t < s.dur);
  for (const sh of done) {
    if (sh.tt === 'g') {
      const by = sh.src ? g.settlers.find((q) => q.id === sh.src) : undefined;
      for (const id of sh.tids ?? [sh.tid]) {
        const t = g.goblins.find((q) => q.id === id);
        if (!t) continue;
        let dmg = sh.dmg * (sh.kind === 'heavy' && (t.kind === 'brute' || t.kind === 'warchief') ? BALLISTA.heavyMult : 1);
        if (t.kind === 'shieldgob' && (sh.kind === 'arrow' || sh.kind === 'bolt')) { dmg *= 0.4; emit('block', t.x, t.y); }
        hitGoblin(g, t, dmg, by); emit('hit', t.x, t.y);
      }
    } else if (sh.tt === 's') {
      const t = g.settlers.find((q) => q.id === sh.tid);
      if (t && !t.inside && Math.hypot(t.x - sh.ex, t.y - 0.3 - sh.ey) < 0.8) hitSettler(g, t, sh.dmg);
    } else {
      const t = bld(g, sh.tid);
      if (t) hitBuilding(g, t, sh.dmg);
    }
  }
}

// ---------- needs ----------
function updateNeeds(g: Game, s: Settler, dt: number) {
  const n = s.needs;
  const keep = bld(g, g.keepId);
  const inB = s.inside ? bld(g, s.inside) : undefined;
  const indoors = !!inB && !crewed(inB.kind);
  const sleeping = indoors && (s.task?.k === 'sleep' || s.task?.k === 'shelter' || s.task?.k === 'recover');
  const sea = SEASONS[season(g)];
  n.hunger -= NEEDS.hunger * (s.traits.includes('glutton') ? 1.4 : 1) * (sleeping ? 0.5 : 1) * dt;
  if (sleeping) n.rest += NEEDS.sleep * (inB!.kind === 'keep' ? 0.8 : 1) * dt;
  else n.rest -= NEEDS.rest * (s.traits.includes('lazy') ? 0.8 : 1) * (isNight(g) ? 1.2 : 1) * dt;
  const nearHearth = keep && distToBld(keep, s.x, s.y) < 2.2;
  const nearFire = isNight(g) && g.blds.some((b) => b.kind === 'brazier' && b.lit && Math.hypot(b.x + 0.5 - s.x, b.y + 0.5 - s.y) < BRAZIER.range + 0.5);
  const cold = g.phase === 'night' || (g.phase === 'dusk' && g.phaseT > DUSK_LEN * 0.5);
  let chill = NEEDS.coldNight * sea.cold * (s.traits.includes('hardy') ? 0.5 : 1) * (hasRelic(g, 'hearthstone') ? 0.65 : 1) * (hasBuff(g, 'coldsnap') ? 2 : 1);
  if (indoors) n.warmth += NEEDS.warmIndoor * dt;
  else if (nearHearth || nearFire) n.warmth += 1.4 * dt;
  else if (cold) n.warmth -= chill * dt;
  else if (sea.dayCold || hasBuff(g, 'coldsnap')) { chill *= 0.35; n.warmth -= chill * dt; }
  else n.warmth += NEEDS.warmDay * dt;
  // safety drifts toward how defended the spot feels; goblins nearby scare people
  const scare = s.traits.includes('brave') ? 0.5 : s.traits.includes('skittish') ? 2 : 1;
  const gob = !s.inside || (inB && crewed(inB.kind)) ? nearestGoblin(g, s.x, s.y, 5) : undefined;
  if (gob) n.safety -= 3 * scare * dt;
  else {
    let target = 55;
    if (indoors) target = 80;
    else {
      for (const b of g.blds) if (b.done && (crewed(b.kind) || b.kind === 'keep') && distToBld(b, s.x, s.y) < 7) target += b.kind === 'keep' ? 10 : 8;
      if (isNight(g)) target -= 15;
    }
    target = Math.min(100, target);
    n.safety += Math.sign(target - n.safety) * Math.min(Math.abs(target - n.safety), 1.2 * dt);
  }
  if (n.hunger <= 0) { s.hp -= 0.35 * dt; addMem(s, 'starving'); if (s.hp <= 0) { killSettler(g, s, 'starved'); return; } }
  if (n.warmth <= 0 && cold) { s.hp -= 0.2 * dt; if (s.hp <= 0) { killSettler(g, s, 'froze to death'); return; } }
  for (const k of ['hunger', 'rest', 'warmth', 'safety'] as const) n[k] = Math.max(0, Math.min(100, n[k]));
  if (!s.inside && g.blds.some((b) => b.kind === 'garden' && b.done && Math.hypot(b.x + 0.5 - s.x, b.y + 0.5 - s.y) < 4)) addMem(s, 'garden');
  // healing and fever
  const tended = g.settlers.some((o) => o.job === 'healer' && o !== s && o.away <= 0 && ((s.inside && o.inside === s.inside) || (!o.inside && !s.inside && Math.hypot(o.x - s.x, o.y - s.y) < 3)));
  const inHealer = inB?.kind === 'healer';
  let heal = sleeping ? 1.2 : g.phase === 'day' ? 0.12 : 0;
  if (tended || inHealer) heal = Math.max(heal, 0.5) * 4;
  if (hasRelic(g, 'satchel')) heal *= 2;
  if (s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + heal * dt);
  if (s.sick > 0) { s.sick -= dt * (tended || inHealer ? 3 : 1); addMem(s, 'sick'); if (s.sick <= 0) { s.sick = 0; s.mem = s.mem.filter((m) => m.id !== 'sick'); toast(`${s.name}'s fever broke.`, 'good'); } }
  for (const m of s.mem) m.t -= dt;
  s.mem = s.mem.filter((m) => m.t > 0);
}

function updateSettler(g: Game, s: Settler, dt: number) {
  if (s.away > 0) {
    s.away -= dt;
    if (s.away <= 0 || g.phase !== 'day') { s.away = 0; returnFromErrand(g, s); }
    return;
  }
  s.hitT = Math.max(0, s.hitT - dt);
  updateNeeds(g, s, dt);
  if (!g.settlers.includes(s)) return;
  const combat = JOBS[s.job].combat;
  // breakdowns
  const m = mood(g, s);
  if (m < MOOD.breakAt && s.task?.k !== 'sulk' && s.task?.k !== 'recover' && !(combat && isNight(g))) {
    s.lowT += dt;
    if (s.lowT > MOOD.breakHold) {
      if (s.inside) leave(g, s);
      s.task = { k: 'sulk', t: MOOD.sulk };
      s.path = [];
      toast(`${s.name} is having a breakdown.`, 'warn');
    }
  } else if (m >= MOOD.breakAt) s.lowT = Math.max(0, s.lowT - dt);
  // panic and morale during raids
  if (!s.inside && g.phase === 'night' && s.task?.k !== 'flee') {
    const gob = nearestGoblin(g, s.x, s.y, 4);
    if (gob) {
      const panic = !combat && s.needs.safety < 20 && !s.traits.includes('brave');
      const rout = combat && s.hp < s.maxHp * fleeAt(g, s);
      if (panic || rout) {
        const keep = bld(g, g.keepId)!;
        if (rout && goToBld(g, s, keep)) { s.task = { k: 'shelter', id: keep.id }; toast(`${s.name} broke and ran for the keep.`, 'warn'); }
        else {
          // panicked settlers bolt away from the goblin, not always toward safety
          const ax = s.x - gob.x, ay = s.y - gob.y, al = Math.hypot(ax, ay) || 1;
          const tx = Math.floor(s.x + (ax / al) * 5), ty = Math.floor(s.y + (ay / al) * 5);
          s.path = [];
          if (inMap(tx, ty) && settlerFree(g, tx, ty)) goTo(g, s, tx, ty);
          s.task = { k: 'flee', t: 3 };
          if (panic) toast(`${s.name} panicked!`, 'warn');
        }
      }
    }
  }
  if (!s.task) decide(g, s);
  if (s.task) runTask(g, s, dt);
}

/** Expeditions sent by events come back at dusk. */
function returnFromErrand(g: Game, s: Settler) {
  const kc = keepCenter(g);
  const e = g.entries[randInt(g, g.entries.length)];
  const p = nearestFree(g, (e.x + kc.x) / 2, (e.y + kc.y) / 2);
  s.x = p.x; s.y = p.y; s.task = null; s.path = [];
  toast(`${s.name} is back.`);
}

// ---------- phases ----------
function startDusk(g: Game) {
  g.phase = 'dusk';
  g.phaseT = 0;
  for (const s of g.settlers) {
    if (!JOBS[s.job].combat || s.task?.k === 'recover') continue;
    if (s.inside && s.task?.k === 'sleep') leave(g, s);
    s.task = null; s.path = [];
  }
  emit('dusk');
  toast('Dusk. Guards are taking their posts.');
}

function startNight(g: Game) {
  g.phase = 'night';
  g.phaseT = 0;
  g.night = { kills: 0, lost: [], gold: 0, hurt: [], buildingsLost: 0, rescued: [] };
  queueWave(g);
  // braziers take fuel from the stockpile
  let unlit = 0;
  for (const b of g.blds.filter((b) => b.kind === 'brazier' && b.done)) {
    if (g.res.wood >= BRAZIER.fuel) { g.res.wood -= BRAZIER.fuel; b.lit = true; } else { b.lit = false; unlit++; }
  }
  if (unlit) toast(`${unlit} brazier${unlit > 1 ? 's' : ''} unlit: not enough wood.`, 'warn');
  for (const s of g.settlers) {
    if (s.away > 0) { s.away = 0; returnFromErrand(g, s); }
    if (s.task?.k === 'recover') continue;
    // sleepers stay in bed; everyone else is re-tasked (shelter or guard)
    if (s.inside && s.task?.k === 'sleep' && !JOBS[s.job].combat) { s.task = { k: 'shelter', id: s.inside }; continue; }
    if (s.inside && s.task?.k !== 'guard') leave(g, s);
    s.task = null; s.path = [];
  }
  emit('horn');
  emit('bell');
}

function endNight(g: Game) {
  g.phase = 'dawn';
  g.phaseT = 0;
  for (const b of g.blds) b.lit = false;
  const n = g.night;
  const flawless = n.lost.length === 0;
  const gold = (WAVE.clearGold + Math.ceil(g.day / 3) + (flawless ? WAVE.flawlessGold : 0)) * (g.wave.kind === 'boss' ? 2 : 1);
  g.res.gold += gold;
  for (const s of g.settlers) { addMem(s, 'victory'); if (flawless) addMem(s, 'flawless'); }
  if (flawless && g.wave.kind !== 'raid') g.stats.cleanAssaults = (g.stats.cleanAssaults ?? 0) + 1;
  if (g.wave.omen && n.buildingsLost === 0) g.stats.omenClean = (g.stats.omenClean ?? 0) + 1;
  g.report = [];
  g.report.push(`Goblins slain: ${n.kills} (+${n.gold} gold)`);
  g.report.push(`Night held: +${gold} gold${flawless ? ' (flawless bonus)' : ''}`);
  if (n.lost.length) g.report.push(`Lost: ${n.lost.join(', ')}`);
  else g.report.push('Nobody was lost.');
  if (n.rescued.length) g.report.push(`Saved by the healer: ${n.rescued.join(', ')}`);
  const hero = Object.entries(n.heroes ?? {}).sort((a, b) => b[1] - a[1])[0];
  if (hero && hero[1] >= 3) g.report.push(`Hero of the night: ${hero[0]}, with ${hero[1]} goblins slain`);
  const hurt = n.hurt.filter((h) => !n.lost.includes(h));
  if (hurt.length) g.report.push(`Hurt: ${hurt.join(', ')}`);
  if (n.buildingsLost) g.report.push(`Structures wrecked: ${n.buildingsLost}`);
  // spoils: blueprints and relics
  const missing = BLUEPRINTS.filter((b) => !g.blueprints.includes(b));
  if (missing.length && (g.wave.kind === 'boss' || rand(g) < (g.wave.kind === 'assault' ? 0.5 : 0.18))) {
    const bp = pick(g, missing);
    g.blueprints.push(bp);
    g.report.push(`Found a blueprint in the goblin loot: ${BUILD[bp].name}!`);
  }
  if (g.wave.kind === 'boss') {
    const r = grantRelic(g);
    if (r) g.report.push(`The warband's trophy is yours: ${RELICS[r].name}.`);
  }
  const ready = g.settlers.filter((s) => canPromote(g, s));
  if (ready.length) g.report.push(`Ready for promotion: ${ready.map((s) => s.name).join(', ')} (select them to choose a path)`);
  // a wanderer might ask to join
  g.applicant = null;
  if (g.settlers.length < bedCount(g) + 3 && (avgMood(g) >= 40 || flawless) && rand(g) < (flawless ? 0.8 : 0.5) * Math.max(0.25, 1 - (g.settlers.length - 10) * 0.04)) {
    g.applicant = { name: newName(g), traits: rollTraits(g) };
  }
  setBest(g.day);
  emit('dawn');
  if (!g.settlers.length) gameOver(g, 'Nobody is left to hold the keep.');
}

export function grantRelic(g: Game): string | null {
  const free = RELIC_IDS.filter((r) => !g.relics.includes(r));
  if (!free.length) return null;
  const r = pick(g, free);
  addRelic(g, r);
  return r;
}

export function addRelic(g: Game, r: string) {
  if (g.relics.includes(r)) return;
  g.relics.push(r);
  if (r === 'stakes') for (const b of g.blds) if (b.kind === 'wall') { const m = Math.round(maxHp(g, 'wall') * (1 + upStat(b, 'hp'))); b.hp = b.hp * (m / b.maxHp); b.maxHp = m; }
  emit('relic');
}

export function beginDay(g: Game, accept: boolean) {
  if (g.phase !== 'dawn') return;
  if (g.applicant && accept) {
    const s = arrive(g, g.applicant.name, g.applicant.traits, 'idle');
    toast(`${s.name} joined the hold. Give them a job.`, 'good');
  }
  g.applicant = null;
  const prevSeason = season(g);
  g.day++;
  g.phase = 'day';
  g.phaseT = 0;
  g.goblins = [];
  g.shots = [];
  for (const s of g.settlers) {
    if (s.inside) {
      const b = bld(g, s.inside);
      if (!JOBS[s.job].combat) addMem(s, b?.kind === 'keep' ? 'floor' : 'bed');
      leave(g, s);
    } else if (!JOBS[s.job].combat) addMem(s, 'floor');
    s.task = null;
    s.path = [];
    s.days++;
  }
  // buffs tick down
  for (const b of g.buffs) b.days--;
  g.buffs = g.buffs.filter((b) => b.days > 0);
  // fever spreads between housemates unless someone is nursing
  const healer = g.settlers.some((s) => s.job === 'healer');
  for (const s of g.settlers.filter((s) => s.sick > 0)) {
    for (const o of g.settlers) if (o !== s && o.home && o.home === s.home && !o.sick && rand(g) < (healer ? 0.08 : 0.3)) { o.sick = 120; toast(`${o.name} caught the fever.`, 'warn'); }
  }
  // sprung pits are re-dug, fighters draw their wage
  for (const b of g.blds) if (b.kind === 'trap' && b.sprung && canPay(g, TRAP_REARM)) { pay(g, TRAP_REARM); b.sprung = false; }
  const fighters = g.settlers.filter((s) => JOBS[s.job].combat);
  let unpaid = 0;
  for (const s of fighters) { const w = promoOf(s) ? 2 : 1; if (g.res.gold >= w) g.res.gold -= w; else { addMem(s, 'unpaid'); unpaid++; } }
  // food spoils above what the stores can hold
  const keepLv = bld(g, g.keepId)?.level ?? 0;
  const cap = 80 + 4 * g.settlers.length + 40 * keepLv;
  if (g.res.food > cap) { const lost = Math.floor((g.res.food - cap) * 0.12); if (lost > 0) { g.res.food -= lost; toast(`${lost} food spoiled in the overfull stores.`, 'warn'); } }
  if (unpaid) toast(`${unpaid} fighter${unpaid > 1 ? 's' : ''} went unpaid this morning.`, 'warn');
  growForest(g);
  driftPrices(g);
  g.merchant = null;
  if (season(g) !== prevSeason) { emit('season'); toast(`${SEASONS[season(g)].name} has come. ${SEASONS[season(g)].desc}`, season(g) === 'winter' ? 'warn' : 'good'); }
  rollEvent(g);
  g.wave = makeWave(g, g.day);
  emit('morning');
}

export function arrive(g: Game, name: string, traits: string[], job: Job): Settler {
  const kc = keepCenter(g);
  const e = g.entries[randInt(g, g.entries.length)];
  const p = nearestFree(g, (e.x + kc.x) / 2, (e.y + kc.y) / 2);
  const s = makeSettler(g, name, traits, job, p.x, p.y);
  addMem(s, 'welcome');
  assignHomes(g);
  return s;
}

function growForest(g: Game) {
  const sea = SEASONS[season(g)];
  for (let i = 0; i < g.terrain.length; i++) {
    if (g.terrain[i] === T_SAPLING && bldGrid[i]) { g.terrain[i] = T_GRASS; continue; }
    if (g.terrain[i] === T_SAPLING) { g.sapling[i] -= season(g) === 'spring' ? 2 : 1; if (g.sapling[i] <= 0) { g.terrain[i] = T_TREE; g.amount[i] = TREE_WOOD; } }
    else if (g.terrain[i] === T_BUSH) g.amount[i] = Math.min(BUSH_BERRIES, g.amount[i] + Math.round(2 * sea.berries));
  }
  const kc = keepCenter(g);
  let planted = 0;
  for (let tries = 0; tries < 300 && planted < (season(g) === 'winter' ? 0 : 5); tries++) {
    const x = randInt(g, MAP_W), y = randInt(g, g.terrain.length / MAP_W);
    const i = idx(x, y);
    if (g.terrain[i] !== T_GRASS || bldGrid[i] || Math.hypot(x - kc.x, y - kc.y) < 8) continue;
    let trees = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inMap(x + dx, y + dy) && g.terrain[idx(x + dx, y + dy)] === T_TREE) trees++;
    if (!trees) continue;
    g.terrain[i] = T_SAPLING;
    g.sapling[i] = SAPLING_DAYS;
    planted++;
  }
  computeFlow(g);
}

function gameOver(g: Game, why: string) {
  if (g.over) return;
  g.over = true;
  g.report = [why, ...(g.fallen?.length ? [`Remembered: ${g.fallen.join(', ')}`] : []), `Your hold lasted ${g.day} day${g.day === 1 ? '' : 's'} (${SEASONS[season(g)].name}, year ${year(g)}).`, `Goblins slain: ${g.stats.kills}. Warchiefs felled: ${g.stats.bosses}.`];
  setBest(g.day);
  emit('over');
}

export function step(g: Game, dt: number) {
  if (g.over || g.phase === 'dawn' || g.event) return;
  g.time += dt;
  g.phaseT += dt;
  if (g.phase === 'day' && g.phaseT >= dayLen(g)) startDusk(g);
  else if (g.phase === 'dusk' && g.phaseT >= DUSK_LEN) startNight(g);
  if (g.phase === 'night') {
    while (g.spawn.length && g.spawn[0].t <= g.phaseT) { const s = g.spawn.shift()!; spawnGoblin(g, s.kind, s.entry); }
    if (!g.spawn.length && !g.goblins.length && g.phaseT > 4) { endNight(g); return; }
    // safety net: a raid that drags on this long breaks and runs
    if (!g.spawn.length && g.phaseT > 240 && g.goblins.length) { toast('The last goblins lose heart and flee into the dark.', 'good'); for (const gb of g.goblins) emit('gobdie', gb.x, gb.y); g.goblins = []; }
  }
  for (const s of [...g.settlers]) updateSettler(g, s, dt);
  omenNow = g.phase === 'night' ? g.wave.omen : undefined;
  for (const gb of [...g.goblins]) { if (g.over) return; if (g.goblins.includes(gb)) updateGoblin(g, gb, dt); }
  for (const b of [...g.blds]) { b.hitT = Math.max(0, b.hitT - dt); updateDefense(g, b, dt); }
  updateShots(g, dt);
  for (const f of g.floaters) { f.t -= dt; f.y -= dt * 0.8; }
  g.floaters = g.floaters.filter((f) => f.t > 0);
}

// ---------- trading ----------
export type Goods = 'food' | 'wood' | 'stone';
export const GOODS: Goods[] = ['food', 'wood', 'stone'];
export function hasMarket(g: Game) { return g.blds.some((b) => b.kind === 'market' && b.done); }
export function canTrade(g: Game) { return g.phase !== 'night' && (hasMarket(g) || !!g.merchant); }
function traderBonus(g: Game) {
  const t = g.settlers.find((s) => s.job === 'trader' && s.task?.k === 'trade');
  if (!t) return 0;
  return t.traits.includes('haggler') ? 0.2 : 0.1;
}
/** Gold for one lot of 10. */
export function price(g: Game, r: Goods, side: 'buy' | 'sell') {
  const sea = TRADE[r].season[season(g)] ?? 1;
  const base = TRADE[r].base * g.prices[r] * sea;
  const better = traderBonus(g) + (hasRelic(g, 'ledger') ? 0.15 : 0) - (hasBuff(g, 'embargo') ? 0.3 : 0);
  if (side === 'buy') return Math.max(1, Math.ceil(base * (1 - better * 0.6)));
  return Math.max(1, Math.floor(base * (1 - TRADE_SPREAD) * (1 + better)));
}
export function trade(g: Game, r: Goods, side: 'buy' | 'sell'): string | null {
  if (!canTrade(g)) return 'You need a market (or a visiting caravan) to trade.';
  const p = price(g, r, side);
  if (side === 'buy') {
    if (g.res.gold < p) return 'Not enough gold.';
    g.res.gold -= p; g.res[r] += TRADE_LOT;
    g.prices[r] = Math.min(2.5, g.prices[r] * 1.05);
  } else {
    if (g.res[r] < TRADE_LOT) return `Not enough ${r}.`;
    g.res[r] -= TRADE_LOT; g.res.gold += p;
    g.prices[r] = Math.max(0.4, g.prices[r] * 0.95);
  }
  g.stats.traded++;
  emit('coin');
  return null;
}
function driftPrices(g: Game) {
  for (const r of GOODS) {
    const p = g.prices[r];
    g.prices[r] = Math.max(0.5, Math.min(2, p + (1 - p) * 0.3 + (rand(g) - 0.5) * 0.3));
  }
}

export function makeMerchant(g: Game): Offer[] {
  const offers: Offer[] = [];
  const relics = RELIC_IDS.filter((r) => !g.relics.includes(r)).sort(() => rand(g) - 0.5).slice(0, 2);
  for (const r of relics) offers.push({ kind: 'relic', id: r, price: RELICS[r].price });
  const bps = BLUEPRINTS.filter((b) => !g.blueprints.includes(b));
  if (bps.length) offers.push({ kind: 'blueprint', id: pick(g, bps), price: 35 });
  offers.push({ kind: 'merc', id: rand(g) < 0.5 ? 'militia' : 'archer', price: 30 });
  const goods = pick(g, GOODS);
  offers.push({ kind: 'goods', id: goods, amount: 30, price: Math.max(5, Math.round(price(g, goods, 'buy') * 2.2)) });
  return offers;
}
export function buyOffer(g: Game, o: Offer): string | null {
  if (o.sold) return 'Already sold.';
  if (g.res.gold < o.price) return 'Not enough gold.';
  g.res.gold -= o.price;
  o.sold = true;
  if (o.kind === 'relic') { addRelic(g, o.id); toast(`Bought the ${RELICS[o.id].name}.`, 'good'); }
  else if (o.kind === 'blueprint') { g.blueprints.push(o.id as BuildKind); toast(`Blueprint learned: ${BUILD[o.id as BuildKind].name}.`, 'good'); }
  else if (o.kind === 'goods') g.res[o.id as Goods] += o.amount ?? 0;
  else if (o.kind === 'merc') { const s = arrive(g, newName(g), ['brave', ...(rand(g) < 0.5 ? ['tough'] : [])], o.id as Job); toast(`${s.name} the sellsword signs on as ${JOBS[s.job].name.toLowerCase()}.`, 'good'); }
  emit('coin');
  return null;
}

// ---------- player actions ----------
export function canAfford(g: Game, kind: BuildKind) { return canPay(g, buildCost(g, kind)); }

export function place(g: Game, kind: BuildKind, x: number, y: number): string | null {
  if (!unlocked(g, kind)) return 'You need the blueprint first.';
  if (g.phase === 'night' && !['flag', 'wall', 'stonewall', 'trap'].includes(kind)) return 'During a raid you can only lay walls, traps and guard posts.';
  if (!canPlace(g, kind, x, y)) return "Can't build there.";
  if (!canAfford(g, kind)) return 'Not enough resources.';
  if (kind === 'flag' && g.blds.filter((b) => b.kind === 'flag').length >= MAX_FLAGS) return `Up to ${MAX_FLAGS} guard posts.`;
  pay(g, buildCost(g, kind));
  addBuilding(g, kind, x, y, BUILD[kind].work === 0);
  rebuild(g);
  emit('place', x + 0.5, y + 0.5);
  return null;
}

export function demolish(g: Game, id: number): string | null {
  const b = bld(g, id);
  if (!b || b.kind === 'keep') return "The keep can't be torn down.";
  const k = b.done ? REFUND : 1;
  const c = buildCost(g, b.kind);
  for (const r of RES_ORDER) g.res[r] += Math.floor((c[r] ?? 0) * k);
  destroyBuilding(g, b, false);
  emit('demolish', b.x + 0.5, b.y + 0.5);
  return null;
}

export function setJob(g: Game, s: Settler, job: Job): string | null {
  if (s.job === job) return null;
  const jd = JOBS[job];
  if (jd.gold && !s.gear.includes(job)) {
    if (g.res.gold < jd.gold) return `Needs ${jd.gold} gold for gear.`;
    g.res.gold -= jd.gold;
    s.gear.push(job);
  }
  const prev = s.job;
  s.job = job;
  if (s.inside && s.task?.k !== 'recover') leave(g, s);
  if (s.task?.k !== 'recover') { s.task = null; s.path = []; }
  s.post = 0;
  const max = baseHp(job, s.traits, s.promo);
  if (max !== baseHp(prev, s.traits, s.promo)) { const f = s.hp / s.maxHp; s.maxHp = max; s.hp = Math.max(1, Math.round(max * f)); }
  if (JOBS[job].combat !== JOBS[prev].combat) assignHomes(g);
  emit('job');
  return null;
}

export function assignPost(g: Game, s: Settler, b: Building): string | null {
  if (!JOBS[s.job].combat) return 'Only fighters take posts.';
  if (s.job === 'archer' && !crewed(b.kind) && b.kind !== 'flag') return 'Archers man towers, ballistas or guard posts.';
  if (s.job !== 'archer' && b.kind !== 'flag') return 'Militia and shieldbearers hold guard posts.';
  if (crewed(b.kind)) {
    for (const o of g.settlers) if (o !== s && o.post === b.id) o.post = 0;
    if (b.occupant && b.occupant !== s.id) { const o = g.settlers.find((q) => q.id === b.occupant); if (o) { leave(g, o); o.task = null; o.path = []; } b.occupant = 0; }
  }
  s.post = b.id;
  if (g.phase !== 'day') { if (s.inside) leave(g, s); s.task = null; s.path = []; }
  return null;
}

/** Sum of one stat over a building's upgrade levels. */
export function upStat(b: Building, k: 'hp' | 'dmg' | 'rate' | 'range' | 'pierce') {
  const ups = UPGRADES[b.kind];
  if (!ups || !b.level) return 0;
  let v = 0;
  for (let i = 0; i < b.level && i < ups.length; i++) v += ups[i][k] ?? 0;
  return v;
}
export function upgrade(g: Game, b: Building): string | null {
  const ups = UPGRADES[b.kind];
  const lv = b.level ?? 0;
  if (!ups || !ups[lv]) return 'Fully upgraded.';
  if (!b.done) return 'Finish building it first.';
  if (g.phase === 'night' && b.kind !== 'wall' && b.kind !== 'stonewall') return 'Not during a raid.';
  const u = ups[lv];
  const cost: Cost = hasBuff(g, 'survey') ? Object.fromEntries(Object.entries(u.cost).map(([k, v]) => [k, Math.ceil((v ?? 0) / 2)])) : u.cost;
  if (!canPay(g, cost)) return `Needs ${costText(cost)}.`;
  pay(g, cost);
  b.level = lv + 1;
  const max = Math.round(BUILD[b.kind].hp * (b.kind === 'wall' && hasRelic(g, 'stakes') ? 1.6 : 1) * (1 + upStat(b, 'hp')));
  b.hp += max - b.maxHp;
  b.maxHp = max;
  if (b.kind === 'hut') assignHomes(g);
  emit('built', b.x + 0.5, b.y + 0.5);
  return null;
}

export function fortify(g: Game): string | null {
  const k = bld(g, g.keepId);
  if (!k) return null;
  const lv = (k.level ?? 0) + 1;
  const L = KEEP_LEVELS[lv];
  if (!L) return 'The keep is already a fortress.';
  if (g.phase === 'night') return 'Not during a raid.';
  if (!canPay(g, L.cost)) return `Needs ${costText(L.cost)}.`;
  pay(g, L.cost);
  k.level = lv;
  const extra = L.hp - k.maxHp;
  k.maxHp = L.hp;
  k.hp += extra;
  emit('built', k.x + 1.5, k.y + 1.5);
  toast(`The keep is now a ${L.name.toLowerCase()}.`, 'good');
  return null;
}

export function callDusk(g: Game) { if (g.phase === 'day') startDusk(g); }
export function soundHorn(g: Game) { if (g.phase === 'dusk') startNight(g); }

export function wallLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) >= Math.abs(dy)) {
    for (let x = x0; x !== x1 + Math.sign(dx || 1); x += Math.sign(dx || 1)) out.push({ x, y: y0 });
    for (let y = y0 + Math.sign(dy); dy && y !== y1 + Math.sign(dy); y += Math.sign(dy)) out.push({ x: x1, y });
  } else {
    for (let y = y0; y !== y1 + Math.sign(dy || 1); y += Math.sign(dy || 1)) out.push({ x: x0, y });
    for (let x = x0 + Math.sign(dx); dx && x !== x1 + Math.sign(dx); x += Math.sign(dx)) out.push({ x, y: y1 });
  }
  return out.slice(0, 40);
}

export function placeWalls(g: Game, kind: BuildKind, tiles: { x: number; y: number }[]): number {
  if (!unlocked(g, kind)) return 0;
  let n = 0;
  for (const t of tiles) {
    if (!canPlace(g, kind, t.x, t.y) || !canAfford(g, kind)) continue;
    pay(g, buildCost(g, kind));
    addBuilding(g, kind, t.x, t.y, false);
    n++;
  }
  if (n) { rebuild(g); emit('place', tiles[0].x + 0.5, tiles[0].y + 0.5); }
  return n;
}

export function applicantText(a: Applicant) {
  return a.traits.map((t) => t[0].toUpperCase() + t.slice(1)).join(', ');
}

export function healerBeds() { return HEALER_BEDS; }
